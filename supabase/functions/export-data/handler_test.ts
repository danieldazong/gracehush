import { unzipSync } from "fflate";

import type { ExportDataError, ExportDataResponse } from "../process-entry/contracts.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  installWorld,
  post,
  seedDevotional,
  unscopedRequests,
  unscopedStorage,
  type World,
} from "../process-entry/testing/fakes.ts";
import { DOWNLOAD_NAME, JSON_NAME, MARKDOWN_NAME, README_NAME } from "./archive.ts";
import { EXPORT_MAX_BYTES, exportLimits, handle } from "./handler.ts";

// export-data (step 31) against the fake Supabase: the ZIP it builds and where it keeps it, how much audio it takes and in what
// order, the ten minutes in which it hands back the same file, what a failure leaves, and that only the caller's data is read.

const USER = "user_test";
const MINUTE = 60_000;

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    const saved = { ...exportLimits };
    try {
      await work(world);
    } finally {
      Object.assign(exportLimits, saved);
      world.restore();
    }
  };
}

const ask = (world: World, options: Parameters<typeof post>[3] = {}) =>
  post(world, handle, {}, { sub: USER, ...options });

async function ok(response: Response): Promise<ExportDataResponse> {
  assertEquals(response.status, 200, await response.clone().text());
  return await response.json() as ExportDataResponse;
}

const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

// One reflection of `userId` made `daysAgo` days ago, with its recording and its devotional audio in the bucket when sizes are
// given (0 leaves that file out of the row).
function reflect(
  world: World,
  daysAgo: number,
  sizes: { recording?: number; devotional?: number } = {},
  over: Record<string, unknown> = {},
  userId = USER,
) {
  const id = crypto.randomUUID();
  const clientEntryId = crypto.randomUUID();
  const recording = sizes.recording ? `${userId}/raw/${clientEntryId}.m4a` : null;
  const devotional = sizes.devotional ? `${userId}/devotionals/${id}.wav` : null;
  const entry = seedDevotional(world, userId, {
    id,
    client_entry_id: clientEntryId,
    created_at: new Date(Date.now() - daysAgo * 24 * 60 * MINUTE).toISOString(),
    input_type: recording ? "audio" : "text",
    audio_path: recording,
    devotional_audio_path: devotional,
    ...over,
  });
  if (recording) world.storage.set(recording, bytes(sizes.recording ?? 0, 1));
  if (devotional) world.storage.set(devotional, bytes(sizes.devotional ?? 0, 2));
  return { id, recording, devotional, entry };
}

function zipOf(world: World): Record<string, Uint8Array> {
  assertEquals(world.exports.size, 1, "one ZIP is kept");
  return unzipSync([...world.exports.values()][0].bytes);
}

const text = (files: Record<string, Uint8Array>, name: string) => new TextDecoder().decode(files[name]);
const audioNames = (files: Record<string, Uint8Array>) =>
  Object.keys(files).filter((name) => name.startsWith("audio/")).sort();

Deno.test(
  "requests: OPTIONS is 204, a GET is 405 and a request with no token is 401, and none of them reads or stores anything",
  flow(async (world) => {
    reflect(world, 1, { devotional: 10 });
    assertEquals((await ask(world, { method: "OPTIONS" })).status, 204);
    assertEquals((await ask(world, { method: "GET" })).status, 405);
    const anonymous = await ask(world, { token: null });
    assertEquals(anonymous.status, 401);
    assertEquals(((await anonymous.json()) as ExportDataError).error.code, "UNAUTHORIZED");
    assertEquals(world.requests.length, 0);
    assertEquals(world.exports.size, 0);
  }),
);

Deno.test(
  "build: a ZIP of the README, the JSON, the Markdown and the audio, kept privately, with a link that lives an hour",
  flow(async (world) => {
    const spoken = reflect(world, 2, { recording: 300, devotional: 500 }, {
      is_active_prayer: true,
      is_answered: true,
      answered_at: "2026-10-28T12:00:00.000Z",
      answered_notes: "Thank You for the quiet.",
    });
    const written = reflect(world, 1, { devotional: 400 });
    const crisis = reflect(world, 0, {}, {
      is_crisis: true,
      transcript: "Words that were heavy to write.",
      dominant_emotion: null,
      devotional_title: null,
      devotional_script: null,
      closing_prayer: null,
    });
    const startedAt = Date.now();
    const answer = await ok(await ask(world));

    assertEquals([answer.partial, answer.reused], [false, false]);
    assert(Math.abs(Date.parse(answer.expiresAt) - startedAt - 3600_000) < 5_000, answer.expiresAt);
    const [upload] = world.exportUploads;
    assert(new RegExp(`^${USER}/[0-9a-f-]{36}\\.zip$`).test(upload.path), upload.path);
    assertEquals([upload.contentType, upload.upsert], ["application/zip", false]);
    assertEquals(world.signs, [{ bucket: "exports", path: upload.path, expiresIn: 3600 }]);
    const link = new URL(answer.url);
    assertEquals(link.searchParams.get("download"), DOWNLOAD_NAME);
    assert(link.pathname.endsWith(`/object/sign/exports/${upload.path}`), link.pathname);
    assertEquals(answer.sizeBytes, world.exports.get(upload.path)?.bytes.length);
    assert(answer.sizeBytes <= EXPORT_MAX_BYTES);

    const files = zipOf(world);
    const day = (iso: unknown) => String(iso).slice(0, 10);
    assertEquals(audioNames(files), [
      `audio/devotionals/${day(spoken.entry.created_at)}-${spoken.id}.wav`,
      `audio/devotionals/${day(written.entry.created_at)}-${written.id}.wav`,
      `audio/recordings/${day(spoken.entry.created_at)}-${spoken.id}.m4a`,
    ]);
    assertEquals(files[`audio/recordings/${day(spoken.entry.created_at)}-${spoken.id}.m4a`], bytes(300, 1));
    assert(text(files, README_NAME).includes("Every audio file is included."));
    const json = JSON.parse(text(files, JSON_NAME));
    assertEquals(json.entries.map((row: { id: string }) => row.id), [spoken.id, written.id, crisis.id]);
    assertEquals(json.timeZone, "UTC");
    assertEquals(json.entries[2].is_crisis, true);
    const md = text(files, MARKDOWN_NAME);
    assert(md.includes("**Answered on October 28, 2026**\n\nThank You for the quiet."));
    assert(md.includes("Words that were heavy to write."));
    assert(!/crisis/i.test(md), "the Markdown never names a crisis");
    assertEquals(unscopedRequests(world, USER), []);
    assertEquals(unscopedStorage(world, USER), []);
  }),
);

Deno.test(
  "who: the token says who is asking; a user id in the body changes nothing, and another person's data never enters the ZIP",
  flow(async (world) => {
    const mine = reflect(world, 1, { devotional: 50 });
    const theirs = reflect(world, 1, { recording: 60, devotional: 70 }, { transcript: "THEIR-WORDS" }, "user_other");
    await ok(await post(world, handle, { userId: "user_other", user_id: "user_other" }, { sub: USER }));
    const files = zipOf(world);
    assertEquals(audioNames(files).length, 1);
    const everything = Object.values(files).map((file) => new TextDecoder().decode(file)).join("\n");
    assert(everything.includes(mine.id));
    for (const word of [theirs.id, "THEIR-WORDS", "user_other"]) assert(!everything.includes(word), word);
    assertEquals(unscopedRequests(world, USER), []);
    assertEquals(unscopedStorage(world, USER), []);
    assert(world.storage.has(String(theirs.recording)), "nothing of theirs was touched");
  }),
);

Deno.test(
  "cap: recordings come first and then the devotionals, newest first; what does not fit is listed, and the export is partial",
  flow(async (world) => {
    // The newest recording is too big; the older, smaller one still fits, then both devotionals.
    const bigNew = reflect(world, 1, { recording: 80_000 });
    const smallOld = reflect(world, 3, { recording: 10_000, devotional: 10_000 });
    const devNew = reflect(world, 2, { devotional: 10_000 });
    exportLimits.maxBytes = 60_000;
    const answer = await ok(await ask(world));
    assertEquals(answer.partial, true);
    assert(world.exportUploads[0].path.endsWith("-partial.zip"), world.exportUploads[0].path);
    assert(answer.sizeBytes <= 60_000, String(answer.sizeBytes));
    const files = zipOf(world);
    const day = (entry: { created_at: unknown }) => String(entry.created_at).slice(0, 10);
    // (Sorted by name, so the older devotional's day comes first here.)
    assertEquals(audioNames(files), [
      `audio/devotionals/${day(smallOld.entry)}-${smallOld.id}.wav`,
      `audio/devotionals/${day(devNew.entry)}-${devNew.id}.wav`,
      `audio/recordings/${day(smallOld.entry)}-${smallOld.id}.m4a`,
    ]);
    const readme = text(files, README_NAME);
    assert(
      readme.includes(`audio/recordings/${day(bigNew.entry)}-${bigNew.id}.m4a (there was no room for it)`),
      readme,
    );
    const json = JSON.parse(text(files, JSON_NAME));
    assertEquals(json.entries.find((row: { id: string }) => row.id === bigNew.id).recording_file, null);
    // The big file was never downloaded: its size was known from the listing.
    assert(!world.downloads.includes(String(bigNew.recording)));
  }),
);

Deno.test(
  "cap: with room for one more file, the person's own recording wins over every devotional",
  flow(async (world) => {
    // The three texts take well under 15,000 bytes here, so 35,000 holds them and one 20,000-byte file, never two.
    const recording = reflect(world, 5, { recording: 20_000 });
    reflect(world, 1, { devotional: 20_000 });
    reflect(world, 2, { devotional: 20_000 });
    exportLimits.maxBytes = 35_000;
    const answer = await ok(await ask(world));
    assertEquals(answer.partial, true);
    assertEquals(audioNames(zipOf(world)), [
      `audio/recordings/${String(recording.entry.created_at).slice(0, 10)}-${recording.id}.m4a`,
    ]);
  }),
);

Deno.test(
  "time: once the audio budget is spent no more audio is added; the rest is listed and the export is partial",
  flow(async (world) => {
    const one = reflect(world, 1, { recording: 100, devotional: 100 });
    exportLimits.audioBudgetMs = 0;
    const answer = await ok(await ask(world));
    assertEquals(answer.partial, true);
    const files = zipOf(world);
    assertEquals(audioNames(files), []);
    assert(text(files, README_NAME).includes(`${one.id}.wav (there was not enough time)`));
    assertEquals(world.downloads, []);
  }),
);

Deno.test(
  "missing: a file a reflection names but Storage does not hold is left out and listed, never a failure",
  flow(async (world) => {
    const gone = reflect(world, 1, { devotional: 100 });
    world.storage.delete(String(gone.devotional));
    const answer = await ok(await ask(world));
    assertEquals(answer.partial, true);
    assert(text(zipOf(world), README_NAME).includes(`${gone.id}.wav (it could not be read)`));
  }),
);

Deno.test(
  "reuse: within ten minutes the same ZIP comes back with a fresh link and nothing is built; after that, a new one replaces it",
  flow(async (world) => {
    reflect(world, 1, { devotional: 100 });
    const first = await ok(await ask(world));
    const [firstPath] = world.exports.keys();
    const reads = world.requests.filter((request) => request.url.pathname.startsWith("/rest/")).length;

    const second = await ok(await ask(world));
    assertEquals([second.reused, second.partial, second.sizeBytes], [true, false, first.sizeBytes]);
    assertEquals(world.exportUploads.length, 1, "nothing new was stored");
    assertEquals(
      world.requests.filter((request) => request.url.pathname.startsWith("/rest/")).length,
      reads,
      "nothing was read",
    );
    assertEquals(world.signs.map((sign) => sign.path), [firstPath, firstPath]);

    // Eleven minutes later: the older ZIP is removed and a new one is built.
    const stored = world.exports.get(firstPath);
    assert(stored);
    stored.createdAt = new Date(Date.now() - 11 * MINUTE).toISOString();
    const third = await ok(await ask(world));
    assertEquals(third.reused, false);
    assertEquals(world.exportRemovals, [[firstPath]]);
    assertEquals(world.exports.size, 1);
    assert(!world.exports.has(firstPath));
  }),
);

Deno.test(
  "reuse: a partial ZIP handed back again still says partial",
  flow(async (world) => {
    reflect(world, 1, { devotional: 50_000 });
    exportLimits.maxBytes = 20_000;
    assertEquals((await ok(await ask(world))).partial, true);
    const again = await ok(await ask(world));
    assertEquals([again.reused, again.partial], [true, true]);
  }),
);

Deno.test(
  "failures: a listing, a read, the upload or the link that fails is a 500 INTERNAL, logged as one word",
  flow(async (world) => {
    reflect(world, 1, { devotional: 100 });
    const failing: [keyof World["fail"], string][] = [
      ["storageList", "storage_list_failed"],
      ["rowsRead", "db:export_read"],
      ["exportUpload", "storage_upload"],
      ["storageSign", "storage_sign"],
    ];
    for (const [switchName, reason] of failing) {
      world.exports.clear();
      world.fail[switchName] = 1;
      const response = await ask(world);
      assertEquals(response.status, 500, switchName);
      const body = (await response.json()) as ExportDataError;
      assertEquals(body.error.code, "INTERNAL");
      const line = JSON.parse(String(world.logs.at(-1)));
      assertEquals([line.account, line.reason], [`export:failed:${reason}`, reason], switchName);
    }
  }),
);

Deno.test(
  "log: one line of 38 fields with the counts, and no id, path, link, token or word",
  flow(async (world) => {
    const one = reflect(world, 2, { recording: 100, devotional: 100 }, { transcript: "SECRET-WORDS" });
    reflect(world, 1, { devotional: 100 });
    const token = await world.token({ sub: USER });
    const answer = await ok(await ask(world, { token }));
    assertEquals(world.logs.length, 1);
    const line = JSON.parse(world.logs[0]);
    assertEquals(Object.keys(line).length, 38);
    assertEquals(
      [line.status, line.account, line.accountEntries, line.accountFiles, line.accountLeftOut, line.accountBytes],
      [200, "export:built", 2, 3, 0, answer.sizeBytes],
    );
    assert(/^[0-9a-f]{8}$/.test(line.user));
    for (
      const word of [USER, token, one.id, "SECRET-WORDS", "signed-test-token", "exports", ".zip", "raw/", "sk_test"]
    ) {
      assert(!world.logs[0].includes(word), `the log holds ${word}`);
    }
    await ok(await ask(world, { token }));
    assertEquals(JSON.parse(String(world.logs.at(-1))).account, "export:reused");
  }),
);

Deno.test(
  "build: the files in the ZIP carry the export time on the profile's clock, not the server's",
  flow(async (world) => {
    reflect(world, 1, { devotional: 10 });
    const row = world.users.find((user) => user.id === USER);
    assert(row !== undefined, "the profile exists");
    row.timezone = "Pacific/Kiritimati";
    await ok(await ask(world));

    const zip = [...world.exports.values()][0].bytes;
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    const time = view.getUint16(10, true);
    const date = view.getUint16(12, true);
    const exportedAt = JSON.parse(text(zipOf(world), JSON_NAME)).exportedAt as string;
    assertEquals(JSON.parse(text(zipOf(world), JSON_NAME)).timeZone, "Pacific/Kiritimati");
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Kiritimati",
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    }).formatToParts(new Date(exportedAt));
    const part = (type: string) => Number(parts.find((item) => item.type === type)?.value);
    assertEquals(
      [(date >> 9) + 1980, (date >> 5) & 15, date & 31, time >> 11, (time >> 5) & 63, (time & 31) * 2],
      [part("year"), part("month"), part("day"), part("hour"), part("minute"), part("second") - (part("second") % 2)],
    );
  }),
);
