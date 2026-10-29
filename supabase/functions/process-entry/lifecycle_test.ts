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
  markSpeechFailed,
  needsSpeech,
  readProfile,
  saveAudio,
  saveCrisisEntry,
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
  "a crisis entry keeps only the flag and the words, and loses any affirmations",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    await saveReadyEntry(admin, USER, claim.row.id, {
      ...fields,
      is_active_prayer: true,
      prayer_title: "T",
      prayer_category: "GUIDANCE",
      prayer_summary: "S",
    }, [...three]);
    const crisis = await saveCrisisEntry(admin, USER, claim.row.id, "the words");
    assertEquals(crisis.is_crisis, true);
    assertEquals(crisis.processing_status, "ready");
    assertEquals(crisis.transcript, "the words");
    for (
      const column of [
        "dominant_emotion",
        "devotional_title",
        "devotional_script",
        "closing_prayer",
        "scripture_reference",
        "prayer_title",
        "prayer_category",
        "prayer_summary",
      ]
    ) {
      assertEquals(crisis[column as keyof typeof crisis], null, column);
    }
    assertEquals(crisis.is_active_prayer, false);
    assertEquals(world.affirmations.length, 0);
  }),
);

Deno.test(
  "the fake database enforces the table's crisis rule, so the test above means something",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const { error } = await admin.from("journal_entries").update({ is_crisis: true, devotional_script: "still here" })
      .eq("id", claim.row.id).eq("user_id", USER);
    assertEquals(error?.code, "23514");
    assertEquals(world.entries[0].is_crisis, false);
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
  "a crisis entry saved twice is still one crisis entry with the words it was given and no affirmations",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const first = await saveCrisisEntry(admin, USER, claim.row.id, "the words");
    const second = await saveCrisisEntry(admin, USER, claim.row.id, "the words");
    assertEquals([first.is_crisis, second.is_crisis], [true, true]);
    assertEquals(second.transcript, "the words");
    assertEquals(world.entries.length, 1);
    assertEquals(world.affirmations.length, 0);
    // A recording that was never read has no words, and that is saved as such.
    const blocked = await saveCrisisEntry(admin, USER, claim.row.id, null);
    assertEquals(blocked.transcript, null);
    assertEquals(blocked.processing_status, "ready");
    assertEquals(blocked.error_code, null);
  }),
);

Deno.test(
  "a crisis that cannot be saved is crisis_save_failed and leaves the entry as it was",
  withWorld(async (world, admin) => {
    const claim = await claimEntry(admin, USER, text, null, Date.now());
    assert(claim.kind === "claimed");
    const real = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      if (request.method === "PATCH" && request.url.includes("/rest/v1/journal_entries")) {
        return new Response(JSON.stringify({ code: "XX000", message: "a secret detail" }), {
          status: 500,
          headers: { "Content-Type": "application/json" },
        });
      }
      return await real(input, init);
    };
    try {
      const error = await expectAppError(
        () => saveCrisisEntry(admin, USER, claim.row.id, "the words"),
        "INTERNAL",
        "crisis_save_failed",
      );
      assert(!error.reason.includes("secret"), "a database's words never reach the reason");
    } finally {
      globalThis.fetch = real;
    }
    assertEquals(world.entries[0].is_crisis, false);
    assertEquals(world.entries[0].processing_status, "processing");
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
    is_crisis: false,
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
  // A crisis entry never needs speech, whatever else it holds.
  assertEquals(needsSpeech({ ...row, is_crisis: true }), false);
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
  "saveAudio and markSpeechFailed never touch a crisis entry, an unfinished one or another user's",
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
