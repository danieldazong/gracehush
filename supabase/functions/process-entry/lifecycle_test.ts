import { createAdmin } from "../_shared/admin.ts";
import { assert, assertEquals, expectAppError } from "./testing/assert.ts";
import { ENTRY_ID, installWorld, seedDevotional, unscopedRequests, type World } from "./testing/fakes.ts";
import { CLAIM_LEASE_MS } from "./constants.ts";
import type { ProcessEntryRequest } from "./contracts.ts";
import {
  claimEntry,
  countRecentEntries,
  decideClaim,
  ensureProfile,
  failEntry,
  findEntry,
  listAffirmations,
  listRecentReflections,
  markSpeechFailed,
  needsSpeech,
  readProfile,
  RECENT_REFLECTION_COLUMNS,
  saveAudio,
  saveReadyEntry,
  saveTranscript,
} from "./lifecycle.ts";

const USER = "user_a";
const text: ProcessEntryRequest = { clientEntryId: ENTRY_ID, inputType: "text", text: "a written prayer for tonight" };
const audio: ProcessEntryRequest = {
  clientEntryId: ENTRY_ID,
  inputType: "audio",
  audioPath: `${USER}/raw/${ENTRY_ID}.m4a`,
  durationMs: 9000,
  mimeType: "audio/mp4",
};
const fields = {
  transcript: "a written prayer for tonight",
  dominant_emotion: "anxious",
  devotional_title: "Peace",
  validation_line: "Your prayer for tonight is written, and you are heard.",
  devotional_script: "Words.",
  closing_prayer: "Lord, hear us.",
  scripture_reference: "John 3:16",
  scripture_text: "For God so loved the world.",
  scripture_verified: true,
  is_active_prayer: false,
  prayer_title: null,
  prayer_category: null,
  prayer_summary: null,
};
const three = [
  { slot: "morning", headline: "m", text: "m" },
  { slot: "afternoon", headline: "a", text: "a" },
  { slot: "evening", headline: "e", text: "e" },
] as const;

function withWorld(work: (world: World, admin: ReturnType<typeof createAdmin>) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      world.seedUser(USER);
      await work(world, createAdmin());
      assertEquals(unscopedRequests(world, USER), [], "every query carries the user id");
    } finally {
      world.restore();
    }
  };
}

const minutesAgo = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString();

Deno.test("decideClaim", () => {
  const now = Date.now();
  const row = (processing_status: string, updated_at: string) => ({ processing_status, updated_at });
  assertEquals(decideClaim(row("ready", minutesAgo(99)), now), { kind: "ready" });
  assertEquals(decideClaim(row("processing", minutesAgo(0.1)), now), { kind: "busy" });
  assertEquals(decideClaim(row("processing", new Date(now - CLAIM_LEASE_MS + 1000).toISOString()), now), {
    kind: "busy",
  });
  const stale = decideClaim(row("processing", new Date(now - CLAIM_LEASE_MS).toISOString()), now);
  assertEquals(stale.kind, "reclaim");
  assertEquals(decideClaim(row("processing", "not a date"), now).kind, "reclaim");
  assertEquals(decideClaim(row("failed", minutesAgo(0)), now), {
    kind: "reclaim",
    fromStatus: "failed",
    staleBefore: null,
  });
  assertEquals(decideClaim(row("pending", minutesAgo(0)), now), {
    kind: "reclaim",
    fromStatus: "pending",
    staleBefore: null,
  });
});

Deno.test(
  "ensureProfile creates a missing profile and never touches an existing one",
  withWorld(async (world, admin) => {
    await ensureProfile(admin, "user_new");
    assertEquals(world.users.filter((user) => user.id === "user_new").length, 1);
    world.users.find((user) => user.id === USER)!.subscription_tier = "pro";
    await ensureProfile(admin, USER);
    assertEquals(world.users.find((user) => user.id === USER)!.subscription_tier, "pro");
  }),
);

Deno.test(
  "a new entry is claimed with the person's words saved first",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    assertEquals(claim.row.processing_status, "processing");
    assertEquals(claim.row.transcript, "a written prayer for tonight");
    assertEquals(claim.row.input_type, "text");
    const spoken = await claimEntry(
      admin,
      USER,
      {
        ...audio,
        clientEntryId: "9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f",
        audioPath: `${USER}/raw/9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f.m4a`,
      },
      null,
      Date.now(),
    );
    assert(spoken.kind === "claimed");
    assertEquals(spoken.row.audio_path, `${USER}/raw/9c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f.m4a`);
    assertEquals(spoken.row.transcript, null);
    assertEquals(world.entries.length, 2);
  }),
);

Deno.test(
  "two requests together: exactly one claims, the other is told it is busy",
  withWorld(async (world, admin) => {
    const results = await Promise.all([
      findEntry(admin, USER, ENTRY_ID).then((existing) => claimEntry(admin, USER, text, existing, Date.now())),
      findEntry(admin, USER, ENTRY_ID).then((existing) => claimEntry(admin, USER, text, existing, Date.now())),
    ]);
    assertEquals(results.map((result) => result.kind).sort(), ["busy", "claimed"]);
    assertEquals(world.entries.length, 1);
  }),
);

Deno.test(
  "a failed entry is claimed again by exactly one of two requests",
  withWorld(async (world, admin) => {
    const failed = world.seedEntry({
      user_id: USER,
      client_entry_id: ENTRY_ID,
      input_type: "text",
      transcript: "kept",
      processing_status: "failed",
      error_code: "AI_UNAVAILABLE",
    });
    const results = await Promise.all([
      claimEntry(admin, USER, text, failed, Date.now()),
      claimEntry(admin, USER, text, failed, Date.now()),
    ]);
    assertEquals(results.map((result) => result.kind).sort(), ["busy", "claimed"]);
    assertEquals(failed.processing_status, "processing");
    assertEquals(failed.error_code, null);
    assertEquals(failed.transcript, "kept", "the saved words are not overwritten");
  }),
);

Deno.test(
  "a lapsed claim is taken over, a fresh one is not, a finished one is returned",
  withWorld(async (world, admin) => {
    const stale = world.seedEntry({
      user_id: USER,
      client_entry_id: ENTRY_ID,
      input_type: "text",
      processing_status: "processing",
      updated_at: minutesAgo(4),
    });
    assertEquals((await claimEntry(admin, USER, text, stale, Date.now())).kind, "claimed");
    const fresh = world.seedEntry({
      user_id: USER,
      client_entry_id: "11111111-1111-4111-8111-111111111111",
      input_type: "text",
      processing_status: "processing",
      updated_at: minutesAgo(1),
    });
    assertEquals(
      (await claimEntry(
        admin,
        USER,
        { ...text, clientEntryId: "11111111-1111-4111-8111-111111111111" },
        fresh,
        Date.now(),
      )).kind,
      "busy",
    );
    const ready = world.seedEntry({
      user_id: USER,
      client_entry_id: "22222222-2222-4222-8222-222222222222",
      input_type: "text",
      processing_status: "ready",
    });
    assertEquals(
      (await claimEntry(
        admin,
        USER,
        { ...text, clientEntryId: "22222222-2222-4222-8222-222222222222" },
        ready,
        Date.now(),
      )).kind,
      "ready",
    );
  }),
);

Deno.test(
  "one clientEntryId is one kind of reflection",
  withWorld(async (world, admin) => {
    const written = world.seedEntry({
      user_id: USER,
      client_entry_id: ENTRY_ID,
      input_type: "text",
      processing_status: "failed",
    });
    await expectAppError(
      () => claimEntry(admin, USER, audio, written, Date.now()),
      "INVALID_REQUEST",
      "input_type_changed",
    );
  }),
);

Deno.test(
  "another person's entry with the same clientEntryId is a different entry",
  withWorld(async (world, admin) => {
    world.seedEntry({ user_id: "user_b", client_entry_id: ENTRY_ID, input_type: "text", processing_status: "ready" });
    assertEquals(await findEntry(admin, USER, ENTRY_ID), null);
    assertEquals((await claimEntry(admin, USER, text, null, Date.now())).kind, "claimed");
  }),
);

Deno.test(
  "saving a reflection leaves exactly three affirmations, however often it is retried",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const saved = await saveReadyEntry(admin, USER, claim.row.id, fields, [...three]);
    assertEquals(saved.processing_status, "ready");
    assertEquals(saved.validation_line, "Your prayer for tonight is written, and you are heard.");
    assertEquals(saved.scripture_reference, "John 3:16");
    assertEquals(saved.scripture_text, "For God so loved the world.");
    assertEquals(saved.scripture_verified, true);
    assertEquals(saved.devotional_audio_path, null);
    await saveReadyEntry(admin, USER, claim.row.id, fields, [...three]);
    assertEquals((await listAffirmations(admin, USER, claim.row.id)).length, 3);
    assertEquals(world.affirmations.length, 3);
  }),
);

Deno.test(
  "a heavy moment is saved whole (gen-v2.4): the flag, every reflection field and its three affirmations, and saved again it is still one",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const heavy = await saveReadyEntry(admin, USER, claim.row.id, fields, [...three], true);
    assertEquals(heavy.is_crisis, true);
    assertEquals(heavy.processing_status, "ready");
    assertEquals(heavy.devotional_script, fields.devotional_script);
    assertEquals(heavy.validation_line, fields.validation_line);
    assertEquals(heavy.scripture_reference, "John 3:16");
    assertEquals(heavy.scripture_verified, true);
    assertEquals(world.affirmations.length, 3);
    const again = await saveReadyEntry(admin, USER, claim.row.id, fields, [...three], true);
    assertEquals(again.is_crisis, true);
    assertEquals(world.entries.length, 1);
    assertEquals(world.affirmations.length, 3);
    // Saved without the flag, it is an ordinary reflection again: the flag is whatever the last save says.
    assertEquals((await saveReadyEntry(admin, USER, claim.row.id, fields, [...three])).is_crisis, false);
  }),
);

Deno.test(
  "the fake database keeps the validation line's length rule, and lets a heavy moment hold a line (the 2026-11-08 migration)",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const heavy = await admin.from("journal_entries").update({ is_crisis: true, validation_line: "a line" })
      .eq("id", claim.row.id).eq("user_id", USER);
    assertEquals(heavy.error, null);
    const long = await admin.from("journal_entries").update({ validation_line: "x".repeat(241) })
      .eq("id", claim.row.id).eq("user_id", USER);
    assertEquals(long.error?.code, "23514");
    assertEquals(world.entries[0].validation_line, "a line");
  }),
);

Deno.test(
  "the fake database lets a heavy moment hold a devotional, a prayer and affirmations, as the 2026-11-08 migration does",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const { error } = await admin.from("journal_entries").update({
      is_crisis: true,
      devotional_script: "still here",
      is_active_prayer: true,
      prayer_title: "T",
    }).eq("id", claim.row.id).eq("user_id", USER);
    assertEquals(error, null);
    const inserted = await admin.from("daily_affirmations").insert({
      user_id: USER,
      entry_id: claim.row.id,
      time_slot: "morning",
      headline: "You are not alone today",
      affirmation_text: "God is already here.",
    });
    assertEquals(inserted.error, null);
    assertEquals(world.entries[0].is_crisis, true);
    assertEquals(world.affirmations.length, 1);
  }),
);

Deno.test(
  "failEntry records the code and never throws",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    await failEntry(admin, USER, claim.row.id, "AI_UNAVAILABLE");
    assertEquals(world.entries[0].processing_status, "failed");
    assertEquals(world.entries[0].error_code, "AI_UNAVAILABLE");
    assertEquals(world.entries[0].transcript, "a written prayer for tonight");
    await failEntry(admin, USER, "00000000-0000-4000-8000-000000000000", "INTERNAL");
  }),
);

Deno.test(
  "countRecentEntries counts one user's entries inside the window and can leave one out",
  withWorld(async (world, admin) => {
    const seed = (client: string, user: string, createdAt: string) =>
      world.seedEntry({ user_id: user, client_entry_id: client, input_type: "text", created_at: createdAt });
    const a = seed("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", USER, minutesAgo(1));
    seed("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", USER, minutesAgo(9));
    seed("cccccccc-cccc-4ccc-8ccc-cccccccccccc", USER, minutesAgo(11));
    seed("dddddddd-dddd-4ddd-8ddd-dddddddddddd", "user_b", minutesAgo(1));
    const since = minutesAgo(10);
    assertEquals(await countRecentEntries(admin, USER, since, null), 2);
    assertEquals(await countRecentEntries(admin, USER, since, String(a.id)), 1);
  }),
);

Deno.test(
  "a heavy moment whose words were never read (a blocked recording) is saved with no transcript",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, audio, null, Date.now());
    assert(claim.kind === "claimed");
    const saved = await saveReadyEntry(admin, USER, claim.row.id, { ...fields, transcript: null }, [...three], true);
    assertEquals(saved.transcript, null);
    assertEquals(saved.is_crisis, true);
    assertEquals(saved.processing_status, "ready");
    assertEquals(saved.error_code, null);
    assertEquals(world.affirmations.length, 3);
  }),
);

// -- Step 22: the plan, the held-back recording's words, and the audio -----------------------------------------------------

Deno.test(
  "readProfile gives the plan, the time zone and when a paid plan ends, reads an unknown plan as free, and fails plainly",
  withWorld(async (world, admin) => {
    const row = world.users.find((user) => user.id === USER)!;
    assertEquals(await readProfile(admin, USER), { tier: "free", timezone: "UTC", expiresAt: null });
    for (const tier of ["trial", "pro"] as const) {
      row.subscription_tier = tier;
      row.timezone = "Africa/Lagos";
      row.subscription_expires_at = "2026-11-29T12:00:00.000Z";
      assertEquals(await readProfile(admin, USER), {
        tier,
        timezone: "Africa/Lagos",
        expiresAt: "2026-11-29T12:00:00.000Z",
      });
    }
    row.subscription_expires_at = null;
    row.subscription_tier = "platinum";
    assertEquals((await readProfile(admin, USER)).tier, "free", "a plan this code does not know is not a free pass");
    row.subscription_tier = null;
    row.timezone = null;
    assertEquals(await readProfile(admin, USER), { tier: "free", timezone: "UTC", expiresAt: null });

    // No row at all is a failure, with Postgres' code or "error" and nothing of its message.
    world.users.length = 0;
    await expectAppError(() => readProfile(admin, USER), "INTERNAL", "db:profile_read:error");
  }),
);

Deno.test(
  "saveTranscript keeps the words of a recording that is still being processed, and only that entry's",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, audio, null, Date.now());
    assert(claim.kind === "claimed");
    assertEquals(claim.row.transcript, null);
    await saveTranscript(admin, USER, claim.row.id, "what was heard");
    assertEquals(world.entries[0].transcript, "what was heard");
    // Another user's entry, and an entry that is no longer processing, are left alone.
    const other = world.seedEntry({
      user_id: "user_b",
      client_entry_id: "33333333-3333-4333-8333-333333333333",
      input_type: "audio",
      processing_status: "processing",
    });
    await saveTranscript(admin, USER, String(other.id), "not yours");
    assertEquals(other.transcript, null);
    await failEntry(admin, USER, claim.row.id, "AI_UNAVAILABLE");
    await saveTranscript(admin, USER, claim.row.id, "too late");
    assertEquals(world.entries[0].transcript, "what was heard");
  }),
);

Deno.test("needsSpeech is true only for a ready reflection that has its devotional and no audio", () => {
  const row = {
    processing_status: "ready",
    devotional_script: "Words.",
    devotional_audio_path: null as string | null,
  };
  assertEquals(needsSpeech(row), true);
  assertEquals(needsSpeech({ ...row, devotional_audio_path: "u/devotionals/x.wav" }), false);
  assertEquals(needsSpeech({ ...row, devotional_audio_path: "" }), true, "an empty path is no audio");
  assertEquals(needsSpeech({ ...row, devotional_script: null }), false);
  assertEquals(needsSpeech({ ...row, devotional_script: "" }), false);
  for (const status of ["pending", "uploading", "processing", "failed"]) {
    assertEquals(needsSpeech({ ...row, processing_status: status }), false, status);
  }
});

Deno.test(
  "saveAudio stores the path and the length once, clears TTS_FAILED, and gives the row; a second writer gets nothing",
  withWorld(async (world, admin) => {
    const entry = seedDevotional(world, USER, { error_code: "TTS_FAILED" });
    const id = String(entry.id);
    const path = `${USER}/devotionals/${id}.wav`;

    const saved = await saveAudio(admin, USER, id, path, 5064);
    assert(saved !== null);
    assertEquals([saved.devotional_audio_path, saved.devotional_duration_ms, saved.error_code], [path, 5064, null]);
    assertEquals(saved.processing_status, "ready");

    // The path is no longer empty, so a request that comes second changes nothing and is told so.
    assertEquals(await saveAudio(admin, USER, id, `${USER}/devotionals/other.wav`, 1), null);
    assertEquals([entry.devotional_audio_path, entry.devotional_duration_ms], [path, 5064]);

    // A length that could not be measured is stored as null (the player learns it when it loads the file).
    const second = seedDevotional(world, USER);
    const unmeasured = await saveAudio(admin, USER, String(second.id), "p.wav", null);
    assert(unmeasured !== null);
    assertEquals([unmeasured.devotional_audio_path, unmeasured.devotional_duration_ms], ["p.wav", null]);
  }),
);

Deno.test(
  "saveAudio and markSpeechFailed never touch an entry with no devotional (a heavy moment saved before 2026-11-08), an unfinished one or another user's",
  withWorld(async (world, admin) => {
    const crisis = world.seedEntry({
      user_id: USER,
      client_entry_id: "44444444-4444-4444-8444-444444444444",
      input_type: "text",
      processing_status: "ready",
      is_crisis: true,
    });
    const processing = world.seedEntry({
      user_id: USER,
      client_entry_id: "55555555-5555-4555-8555-555555555555",
      input_type: "text",
      processing_status: "processing",
      devotional_script: "Words.",
    });
    const theirs = seedDevotional(world, "user_b");
    for (const entry of [crisis, processing, theirs]) {
      assertEquals(await saveAudio(admin, USER, String(entry.id), "p.wav", 1), null, String(entry.id));
      assertEquals(await markSpeechFailed(admin, USER, String(entry.id)), null, String(entry.id));
      assertEquals([entry.devotional_audio_path, entry.error_code], [null, null], String(entry.id));
    }
    // A heavy moment that has its devotional (gen-v2.4) is read aloud like any other.
    const heavy = seedDevotional(world, USER, { is_crisis: true });
    const saved = await saveAudio(admin, USER, String(heavy.id), "h.wav", 1);
    assert(saved !== null);
    assertEquals(saved.devotional_audio_path, "h.wav");
  }),
);

Deno.test(
  "markSpeechFailed marks a ready reflection that has no audio, gives the row, and never throws",
  withWorld(async (world, admin) => {
    const entry = seedDevotional(world, USER);
    const marked = await markSpeechFailed(admin, USER, String(entry.id));
    assert(marked !== null);
    assertEquals([marked.error_code, marked.processing_status], ["TTS_FAILED", "ready"]);

    // A reflection that got its audio from another request in the meantime is not marked.
    const withAudio = seedDevotional(world, USER, { devotional_audio_path: "p.wav" });
    assertEquals(await markSpeechFailed(admin, USER, String(withAudio.id)), null);
    assertEquals(withAudio.error_code, null);

    // A database that cannot be reached is not an error here: the reflection is already saved.
    const real = globalThis.fetch;
    globalThis.fetch = () => Promise.reject(new TypeError("connect ECONNREFUSED"));
    try {
      assertEquals(await markSpeechFailed(admin, USER, String(entry.id)), null);
    } finally {
      globalThis.fetch = real;
    }
  }),
);

Deno.test(
  "listRecentReflections: this user's ten newest finished reflections made before this entry, and only three columns",
  withWorld(async (world, admin) => {
    const older = Array.from({ length: 12 }, (_, index) =>
      seedDevotional(world, USER, {
        devotional_title: `Title ${index + 1}`,
        scripture_reference: `Psalm ${index + 1}:1`,
        transcript: `PRIVATE-WORDS-${index}`,
      }));
    seedDevotional(world, "user_b", { devotional_title: "Someone else" });
    world.seedEntry({
      user_id: USER,
      input_type: "text",
      processing_status: "ready",
      is_crisis: true,
      transcript: "x",
    });
    world.seedEntry({ user_id: USER, input_type: "text", processing_status: "failed", transcript: "x" });
    world.seedEntry({ user_id: USER, input_type: "text", processing_status: "ready", transcript: "x" });
    const current = world.seedEntry({
      user_id: USER,
      client_entry_id: ENTRY_ID,
      input_type: "text",
      processing_status: "processing",
    });
    seedDevotional(world, USER, { devotional_title: "Made later" });

    const rows = await listRecentReflections(admin, USER, String(current.id), String(current.created_at));
    const newestTen = Array.from({ length: 10 }, (_, index) => 12 - index);
    assertEquals(rows.map((row) => row.devotional_title), newestTen.map((n) => `Title ${n}`));
    assertEquals(rows.map((row) => row.scripture_reference), newestTen.map((n) => `Psalm ${n}:1`));
    for (const row of rows) {
      assertEquals(Object.keys(row).sort(), ["devotional_script", "devotional_title", "scripture_reference"]);
    }
    assertEquals(older.length, 12);

    const [request] = world.requests.filter((item) =>
      item.method === "GET" && item.url.pathname.endsWith("/journal_entries")
    );
    const params = request.url.searchParams;
    assertEquals(params.get("select"), RECENT_REFLECTION_COLUMNS.replaceAll(" ", ""));
    assert(!request.url.search.includes("transcript"), "the person's words are never asked for");
    assertEquals(params.get("user_id"), `eq.${USER}`);
    assertEquals(params.get("processing_status"), "eq.ready");
    // A heavy moment's reflection counts as any other since gen-v2.4; one with no devotional is left out by the next filter.
    assertEquals(params.get("is_crisis"), null);
    assertEquals(params.get("devotional_script"), "not.is.null");
    assertEquals(params.get("id"), `neq.${current.id}`);
    assertEquals(params.get("created_at"), `lt.${current.created_at}`);
    assertEquals(params.get("order"), "created_at.desc");
    assertEquals(params.get("limit"), "10");

    // A database that refuses is reported like every other read; the handler turns it into no recent reflections.
    world.fail.recentRead = 1;
    await expectAppError(
      () => listRecentReflections(admin, USER, String(current.id), String(current.created_at)),
      "INTERNAL",
      "db:recent:XX000",
    );
  }),
);
