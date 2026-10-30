import { deflateSync, unzipSync } from "fflate";

import type { UserData, UserEntry } from "../_shared/account/userData.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import {
  audioCandidates,
  buildJson,
  buildMarkdown,
  buildReadme,
  buildZip,
  calendarDay,
  deflateBound,
  JSON_NAME,
  type LeftOut,
  MARKDOWN_NAME,
  README_NAME,
  textCost,
  ZIP_END_BYTES,
  zipEntryBytes,
  zipTime,
  zoneOrUtc,
} from "./archive.ts";

// The pure half of export-data (step 31): what goes in the README, the JSON and the Markdown, which audio comes first and under
// what name, and how many bytes a ZIP takes, measured against the archive fflate really writes.

const USER = "user_test";
const ID_1 = "11111111-1111-4111-8111-111111111111";
const ID_2 = "22222222-2222-4222-8222-222222222222";
const ID_3 = "33333333-3333-4333-8333-333333333333";
const ID_4 = "44444444-4444-4444-8444-444444444444";
const EXPORTED = "2026-10-30T13:05:00.000Z";

// crypto.getRandomValues fills at most 65,536 bytes per call.
function randomBytes(size: number): Uint8Array {
  const bytes = new Uint8Array(size);
  for (let start = 0; start < size; start += 65_536) crypto.getRandomValues(bytes.subarray(start, start + 65_536));
  return bytes;
}

function entry(over: Record<string, unknown>): UserEntry {
  return {
    id: ID_1,
    user_id: USER,
    client_entry_id: crypto.randomUUID(),
    created_at: "2026-10-29T08:46:00.000Z",
    updated_at: "2026-10-29T08:47:00.000Z",
    input_type: "text",
    transcript: "I have been anxious about work.",
    audio_path: null,
    processing_status: "ready",
    error_code: null,
    is_crisis: false,
    dominant_emotion: "anxious",
    scripture_reference: "Philippians 4:6–7",
    scripture_text:
      "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God.",
    scripture_verified: true,
    devotional_title: "Peace in the Waiting",
    devotional_script: "First paragraph.\n\nSecond paragraph.",
    closing_prayer: "Lord, hear us.",
    devotional_audio_path: null,
    devotional_duration_ms: null,
    is_active_prayer: false,
    is_answered: false,
    answered_at: null,
    answered_notes: null,
    prayer_title: null,
    prayer_category: null,
    prayer_summary: null,
    affirmations: [],
    ...over,
  } as UserEntry;
}

const affirmation = (slot: string, headline: string, text: string) => ({
  id: crypto.randomUUID(),
  user_id: USER,
  entry_id: ID_1,
  time_slot: slot,
  headline,
  affirmation_text: text,
  is_delivered: false,
  is_favorite: slot === "morning",
  scheduled_for: null,
  created_at: "2026-10-29T08:47:00.000Z",
});

const profile = (timezone: string) => ({
  id: USER,
  created_at: "2026-10-01T12:00:00.000Z",
  subscription_tier: "free",
  timezone,
  reminder_morning: "08:00",
});

Deno.test("dates: a calendar day is the profile's; a zone Intl does not know is UTC", () => {
  assertEquals(calendarDay("2026-10-29T23:30:00.000Z", "Africa/Lagos"), "2026-10-30");
  assertEquals(calendarDay("2026-10-29T23:30:00.000Z", "Pacific/Honolulu"), "2026-10-29");
  assertEquals(calendarDay("2026-10-29T10:30:00.000Z", "Pacific/Kiritimati"), "2026-10-30");
  assertEquals(zoneOrUtc("Africa/Lagos"), "Africa/Lagos");
  for (const bad of ["Not/AZone", "", null, undefined, 42]) assertEquals(zoneOrUtc(bad), "UTC");
});

Deno.test("audio: recordings newest first, then devotionals newest first, named by the day and the entry", () => {
  const entries = [
    entry({ id: ID_1, created_at: "2026-10-01T08:00:00.000Z", audio_path: `${USER}/raw/a.m4a` }),
    entry({
      id: ID_2,
      created_at: "2026-10-02T08:00:00.000Z",
      audio_path: `${USER}/raw/b.m4a`,
      devotional_audio_path: `${USER}/devotionals/${ID_2}.wav`,
    }),
    entry({
      id: ID_3,
      created_at: "2026-10-29T23:30:00.000Z",
      devotional_audio_path: `${USER}/devotionals/${ID_3}.mp3`,
    }),
    // Never a path outside the person's own folder, whatever a column holds.
    entry({ id: ID_4, created_at: "2026-10-30T08:00:00.000Z", audio_path: "user_other/raw/c.m4a" }),
    entry({ id: crypto.randomUUID(), devotional_audio_path: `${USER}/../user_other/devotionals/x.wav` }),
  ];
  const candidates = audioCandidates(entries, USER, "Africa/Lagos");
  assertEquals(candidates.map((candidate) => candidate.zipPath), [
    `audio/recordings/2026-10-02-${ID_2}.m4a`,
    `audio/recordings/2026-10-01-${ID_1}.m4a`,
    `audio/devotionals/2026-10-30-${ID_3}.mp3`,
    `audio/devotionals/2026-10-02-${ID_2}.wav`,
  ]);
  assertEquals(candidates[0].storagePath, `${USER}/raw/b.m4a`);
  assertEquals(candidates.map((candidate) => candidate.kind), ["recording", "recording", "devotional", "devotional"]);
});

Deno.test("json: every column but user_id, the audio paths replaced by the files in the ZIP, affirmations under their entry", () => {
  const crisis = entry({
    id: ID_2,
    created_at: "2026-10-30T08:00:00.000Z",
    is_crisis: true,
    dominant_emotion: null,
    scripture_reference: null,
    scripture_text: null,
    scripture_verified: false,
    devotional_title: null,
    devotional_script: null,
    closing_prayer: null,
    audio_path: `${USER}/raw/c.m4a`,
  });
  const data: UserData = {
    profile: profile("Africa/Lagos"),
    entries: [
      entry({
        devotional_audio_path: `${USER}/devotionals/${ID_1}.wav`,
        affirmations: [affirmation("morning", "You are held", "Begin the day held.")],
      }),
      crisis,
    ],
  };
  const included = new Map([[`${USER}/devotionals/${ID_1}.wav`, `audio/devotionals/2026-10-29-${ID_1}.wav`]]);
  const json = JSON.parse(buildJson(data, { exportedAt: EXPORTED, zone: "Africa/Lagos", included }));
  assertEquals(Object.keys(json), ["exportedAt", "schemaVersion", "timeZone", "profile", "entries"]);
  assertEquals([json.exportedAt, json.schemaVersion, json.timeZone], [EXPORTED, 1, "Africa/Lagos"]);
  assertEquals(json.profile, profile("Africa/Lagos"));
  assertEquals(json.entries.map((row: { id: string }) => row.id), [ID_1, ID_2], "oldest first, as read");
  const [first, second] = json.entries;
  assertEquals(first.devotional_audio_file, `audio/devotionals/2026-10-29-${ID_1}.wav`);
  assertEquals(first.recording_file, null);
  assertEquals(second.recording_file, null, "a file that is not in the ZIP is null");
  assertEquals(second.is_crisis, true, "the person's own data keeps the flag");
  const text = JSON.stringify(json);
  for (const gone of ["user_id", "audio_path", "devotional_audio_path", `${USER}/`]) {
    assert(!text.includes(gone), `the JSON holds ${gone}`);
  }
  assertEquals(first.affirmations[0].headline, "You are held");
  assertEquals(Object.keys(first.affirmations[0]).includes("user_id"), false);
  assertEquals(Object.keys(first).includes("audio_path"), false);
  // Every other column is there, in the table's order, with the two file fields where the paths were.
  assertEquals(Object.keys(first).slice(0, 8), [
    "id",
    "client_entry_id",
    "created_at",
    "updated_at",
    "input_type",
    "transcript",
    "recording_file",
    "processing_status",
  ]);
});

Deno.test("markdown: newest first, the day in the profile's zone, a finished reflection whole", () => {
  const data: UserData = {
    profile: profile("Africa/Lagos"),
    entries: [
      entry({
        is_active_prayer: true,
        affirmations: [
          affirmation("morning", "You are held", "Begin the day held."),
          affirmation("afternoon", "Rest is allowed!", "Pause and breathe."),
          affirmation("evening", "It is enough", "You did what you could."),
        ],
      }),
      entry({
        id: ID_2,
        created_at: "2026-10-30T07:15:00.000Z",
        transcript: "A newer one.",
        devotional_title: "Newer",
      }),
    ],
  };
  const md = buildMarkdown(data, { exportedAt: EXPORTED, zone: "Africa/Lagos" });
  assert(md.startsWith("# Your Gracehush journal\n\nExported on October 30, 2026 (Africa/Lagos)."), md.slice(0, 120));
  assert(md.indexOf("### Newer") < md.indexOf("### Peace in the Waiting"), "newest first");
  for (
    const part of [
      "## Thursday, October 29, 2026, 9:46 AM\n\n### Peace in the Waiting",
      "**What you shared**\n\nI have been anxious about work.",
      "**Philippians 4:6–7 (BSB)**\n\nBe anxious for nothing",
      "**Devotional**\n\nFirst paragraph.\n\nSecond paragraph.",
      "**Closing prayer**\n\nLord, hear us.",
      "**Prayer request**",
      "**Affirmations**\n\n- Morning: You are held. Begin the day held.\n- Afternoon: Rest is allowed! Pause and breathe.\n- Evening: It is enough. You did what you could.",
    ]
  ) {
    assert(md.includes(part), `missing: ${part}`);
  }
  assert(!md.includes("'"), "no straight apostrophe in the app's own words");
});

Deno.test("markdown: an unverified passage shows its reference and never a text; no passage, no line", () => {
  const data: UserData = {
    profile: profile("UTC"),
    entries: [
      entry({ scripture_verified: false, scripture_text: null }),
      entry({ id: ID_2, scripture_reference: null, scripture_text: null, scripture_verified: false }),
    ],
  };
  const md = buildMarkdown(data, { exportedAt: EXPORTED, zone: "UTC" });
  assertEquals(md.split("**Philippians 4:6–7 (BSB)**").length - 1, 1);
  assert(!md.includes("Be anxious for nothing"));
});

Deno.test("markdown: an answered prayer shows the stored calendar day in every zone, with the gratitude note", () => {
  // Stored as 12:00 UTC on the day (AGENTS.md, Prayer Rules): local reading would give October 29 in Kiritimati.
  for (const zone of ["Pacific/Kiritimati", "Pacific/Honolulu", "Africa/Lagos"]) {
    const data: UserData = {
      profile: profile(zone),
      entries: [entry({
        is_active_prayer: true,
        is_answered: true,
        answered_at: "2026-10-28T12:00:00.000Z",
        answered_notes: "Thank You for the peace.",
      })],
    };
    const md = buildMarkdown(data, { exportedAt: EXPORTED, zone });
    assert(md.includes("**Answered on October 28, 2026**\n\nThank You for the peace."), `${zone}: ${md}`);
    assert(!md.includes("**Prayer request**"));
  }
});

Deno.test("markdown: a crisis entry is its day and the person's words, with no heading, label or word about it", () => {
  const crisis = entry({
    is_crisis: true,
    transcript: "Words that were heavy to write.",
    dominant_emotion: null,
    scripture_reference: null,
    scripture_text: null,
    scripture_verified: false,
    devotional_title: null,
    devotional_script: null,
    closing_prayer: null,
  });
  const md = buildMarkdown({ profile: profile("UTC"), entries: [crisis] }, { exportedAt: EXPORTED, zone: "UTC" });
  assert(md.endsWith("## Thursday, October 29, 2026, 8:46 AM\n\nWords that were heavy to write.\n"), md);
  for (const word of ["crisis", "Crisis", "heavy moment", "support", "Support", "988", "What you shared", "###"]) {
    assert(!md.includes(word), `the crisis section says "${word}"`);
  }
  // An entry that never finished looks the same: the day, and the words when there are any.
  const failed = entry({ processing_status: "failed", devotional_title: null, transcript: null });
  const failedMd = buildMarkdown({ profile: null, entries: [failed] }, { exportedAt: EXPORTED, zone: "UTC" });
  assert(failedMd.endsWith("## Thursday, October 29, 2026, 8:46 AM\n"), failedMd);
});

Deno.test("readme: what is inside, when and where, the line about privacy, and every left-out file by name", () => {
  const leftOut: LeftOut[] = [
    { zipPath: `audio/devotionals/2026-10-01-${ID_1}.wav`, reason: "space" },
    { zipPath: `audio/recordings/2026-10-02-${ID_2}.m4a`, reason: "unreadable" },
    { zipPath: `audio/devotionals/2026-10-03-${ID_3}.wav`, reason: "time" },
  ];
  const readme = buildReadme({ exportedAt: EXPORTED, zone: "Africa/Lagos", entries: 34, included: 12, leftOut });
  for (
    const part of [
      "Exported on October 30, 2026 at 2:05 PM (Africa/Lagos).",
      "private",
      "journal.md",
      "journal.json",
      "audio/recordings",
      "audio/devotionals",
      "34 entries",
      "12 audio files",
      `audio/devotionals/2026-10-01-${ID_1}.wav (there was no room for it)`,
      `audio/recordings/2026-10-02-${ID_2}.m4a (it could not be read)`,
      `audio/devotionals/2026-10-03-${ID_3}.wav (there was not enough time)`,
    ]
  ) {
    assert(readme.includes(part), `missing: ${part}`);
  }
  const whole = buildReadme({ exportedAt: EXPORTED, zone: "UTC", entries: 1, included: 0, leftOut: [] });
  assert(whole.includes("Every audio file is included."), whole);
  assert(!whole.includes("Left out"));
});

Deno.test("readme: its worst case (every file left out for the longest reason) is never shorter than a real one", () => {
  const paths = Array.from(
    { length: 30 },
    (_, index) => `audio/devotionals/2026-10-${String(index + 1).padStart(2, "0")}-x.wav`,
  );
  const reasons: LeftOut["reason"][] = ["space", "unreadable", "time"];
  const longest = reasons.reduce((a, b) =>
    buildReadme({ exportedAt: EXPORTED, zone: "UTC", entries: 9, included: 0, leftOut: [{ zipPath: "x", reason: a }] })
        .length >=
        buildReadme({
          exportedAt: EXPORTED,
          zone: "UTC",
          entries: 9,
          included: 0,
          leftOut: [{ zipPath: "x", reason: b }],
        })
          .length
      ? a
      : b
  );
  const worst = buildReadme({
    exportedAt: EXPORTED,
    zone: "UTC",
    entries: 999,
    included: paths.length,
    leftOut: paths.map((zipPath) => ({ zipPath, reason: longest })),
  }).length;
  for (let mask = 0; mask < 64; mask += 1) {
    const leftOut = paths.filter((_, index) => (mask >> (index % 6)) & 1).map((zipPath, index) => ({
      zipPath,
      reason: reasons[index % 3],
    }));
    const real = buildReadme({
      exportedAt: EXPORTED,
      zone: "UTC",
      entries: 999,
      included: paths.length - leftOut.length,
      leftOut,
    });
    assert(real.length <= worst, `mask ${mask}: ${real.length} > ${worst}`);
  }
});

Deno.test("zip: the stored size is exactly headers plus data, and the text is never larger than its bound", () => {
  const audio = [
    { name: `audio/recordings/2026-10-01-${ID_1}.m4a`, bytes: randomBytes(40_000) },
    { name: `audio/devotionals/2026-10-01-${ID_1}.wav`, bytes: randomBytes(65_536) },
  ];
  const zip = buildZip([], audio, new Date(EXPORTED));
  assertEquals(
    zip.length,
    ZIP_END_BYTES + audio.reduce((sum, file) => sum + zipEntryBytes(file.name, file.bytes.length), 0),
  );

  const texts = [
    { name: README_NAME, text: "Hello.\n".repeat(400) },
    { name: JSON_NAME, text: JSON.stringify({ words: "x".repeat(70_000) }) },
    { name: MARKDOWN_NAME, text: "é" },
  ];
  const withText = buildZip(texts, audio, new Date(EXPORTED));
  const audioBytes = audio.reduce((sum, file) => sum + zipEntryBytes(file.name, file.bytes.length), 0);
  assert(withText.length <= ZIP_END_BYTES + audioBytes + textCost(texts), "the text cost is an upper bound");
  // Random bytes do not compress: the bound still holds for them.
  for (const size of [0, 1, 100, 16_384, 70_000, 300_000]) {
    const random = randomBytes(size);
    assert(deflateSync(random, { level: 6 }).length <= deflateBound(size), `deflate of ${size} random bytes`);
  }

  // It opens, with the names and the bytes that went in.
  const files = unzipSync(withText);
  assertEquals(
    Object.keys(files).sort(),
    [...audio.map((file) => file.name), ...texts.map((file) => file.name)].sort(),
  );
  assertEquals(files[audio[1].name], audio[1].bytes);
  assertEquals(new TextDecoder().decode(files[MARKDOWN_NAME]), "é");
});

// The first file's time and date as a ZIP reader shows them (the local header's DOS fields at offsets 10 and 12).
function firstFileTime(zip: Uint8Array): string {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const time = view.getUint16(10, true);
  const date = view.getUint16(12, true);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${(date >> 9) + 1980}-${pad((date >> 5) & 15)}-${pad(date & 31)} ${pad(time >> 11)}:${
    pad((time >> 5) & 63)
  }:${pad((time & 31) * 2)}`;
}

Deno.test("zip: the files are stamped with the export time on the profile's clock, not the server's", () => {
  const exportedAt = "2026-10-30T16:16:15.878Z";
  const cases: [string, string][] = [
    ["Africa/Lagos", "2026-10-30 17:16:14"],
    ["UTC", "2026-10-30 16:16:14"],
    ["America/Los_Angeles", "2026-10-30 09:16:14"],
    ["Pacific/Kiritimati", "2026-10-31 06:16:14"],
    ["Asia/Kolkata", "2026-10-30 21:46:14"],
  ];
  for (const [zone, expected] of cases) {
    const zip = buildZip([{ name: README_NAME, text: "Hello." }], [], zipTime(exportedAt, zone));
    assertEquals(firstFileTime(zip), expected, zone);
  }
  // Midnight is hour 0, never 24.
  assertEquals(
    firstFileTime(buildZip([{ name: README_NAME, text: "x" }], [], zipTime("2026-10-30T23:00:00Z", "Africa/Lagos"))),
    "2026-10-31 00:00:00",
  );
});
