import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdmin } from "../_shared/admin.ts";
import { optionalEnv } from "../_shared/env.ts";
import { readTtsConfig, type TtsSetup } from "../_shared/tts/config.ts";
import { assert, assertEquals } from "./testing/assert.ts";
import { installWorld, seedDevotional, speechOn, type World } from "./testing/fakes.ts";
import { speechTiming } from "./constants.ts";
import type { EntryRow } from "./lifecycle.ts";
import { type SpeechJob, speechStage, uploadCapMs } from "./speech.ts";

// speechStage on its own, against the fake world. The handler tests (handler_test.ts, "speech a" to "speech i") drive the
// whole request; these are the edges of the stage that no request reaches: the upload's time cap, a failure nobody
// expected, a passage that cannot be read, and a stage that must not touch the database when there is nothing to do.

const USER = "user_a";
const PASSAGE =
  "Be anxious for nothing, but in everything, by prayer and petition, with thanksgiving, present your requests to God.";

function speechWorld(work: (world: World, admin: SupabaseClient, setup: TtsSetup) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      speechOn(world);
      await work(world, createAdmin(), readTtsConfig(optionalEnv));
    } finally {
      world.restore();
    }
  };
}

const verified = {
  scripture_reference: "Philippians 4:6–7",
  scripture_text: PASSAGE,
  scripture_verified: true,
};

// The stage gets the row as the handler has it, a copy of what the database holds and not the fake store's own object.
const snapshot = (row: EntryRow): EntryRow => ({ ...row });

function job(admin: SupabaseClient, setup: TtsSetup, row: EntryRow, over: Partial<SpeechJob> = {}): SpeechJob {
  return { admin, userId: USER, row, setup, startedAt: Date.now(), db: (work) => work(), ...over };
}

// A database that must not be used: every call through it fails the test.
const noDatabase: SpeechJob["db"] = () => {
  throw new Error("the speech stage used the database when it had nothing to do");
};

Deno.test(
  "off, a bad secret and a request that is too late change nothing and use no database and no network",
  speechWorld(async (world, admin) => {
    const row = seedDevotional(world, USER, verified);
    const off = await speechStage(job(admin, { state: "off" }, row, { db: noDatabase }));
    assertEquals([off.tts, off.row === row, off.ttsMs, off.ttsAttempts, off.ttsChars, off.audioMs], [
      "off",
      true,
      0,
      0,
      0,
      null,
    ]);

    const bad = await speechStage(job(admin, { state: "bad", name: "TTS_VOICE_NAME" }, row, { db: noDatabase }));
    assertEquals([bad.tts, bad.row === row], ["bad_config:TTS_VOICE_NAME", true]);

    const setup = readTtsConfig(optionalEnv);
    speechTiming.latestStartMs = 1_000;
    const late = await speechStage(job(admin, setup, row, { startedAt: Date.now() - 5_000, db: noDatabase }));
    assertEquals([late.tts, late.row === row], ["skipped:time", true]);

    // At exactly the limit it is too late too: speech starts only while the request is younger than latestStartMs.
    speechTiming.latestStartMs = 0;
    assertEquals((await speechStage(job(admin, setup, row, { db: noDatabase }))).tts, "skipped:time");

    assertEquals([world.tokenCalls.length, world.ttsCalls.length, world.requests.length, world.uploads.length], [
      0,
      0,
      0,
      0,
    ]);
  }),
);

Deno.test(
  "a devotional with nothing to read gives skipped:script, and marks nothing as failed",
  speechWorld(async (world, admin, setup) => {
    const row = seedDevotional(world, USER, { devotional_script: " \n\n [pause] \n " });
    const outcome = await speechStage(job(admin, setup, row, { db: noDatabase }));
    assertEquals([outcome.tts, outcome.row === row, world.ttsCalls.length], ["skipped:script", true, 0]);
  }),
);

Deno.test(
  "a verified passage is read only when its text is there; an unverified one never",
  speechWorld(async (world, admin, setup) => {
    // What was sent to be read. The table never holds some of these rows (a verified passage with no text), so the save at
    // the end may be refused by its constraints in the fake database: only the markup that went to Google matters here.
    const read = async (over: Record<string, unknown>) => {
      world.ttsCalls.length = 0;
      const row = seedDevotional(world, USER, over);
      await speechStage(job(admin, setup, snapshot(row)));
      return (world.ttsCalls[0].json as { input: { markup: string } }).input.markup;
    };
    assert((await read(verified)).includes("A reading from Philippians chapter 4, verses 6 through 7."));
    assert(!(await read({ ...verified, scripture_verified: false })).includes("A reading from"));
    assert(!(await read({ ...verified, scripture_text: null })).includes("A reading from"));
    assert(!(await read({ ...verified, scripture_reference: null })).includes("A reading from"));
    assert(!(await read({ ...verified, scripture_reference: "not a reference" })).includes("A reading from"));
  }),
);

Deno.test(
  "something nobody expected inside the stage is failed:unexpected, never a throw, and the reflection is marked",
  speechWorld(async (world, admin, setup) => {
    assert(setup.state === "ready");
    const row = seedDevotional(world, USER, verified);
    // An account whose address cannot be read: the sign-in code rethrows what it does not know how to handle.
    const broken: TtsSetup = {
      state: "ready",
      config: {
        ...setup.config,
        account: {
          get clientEmail(): string {
            throw new Error("boom");
          },
          privateKey: setup.config.account.privateKey,
        },
      },
    };
    const outcome = await speechStage(job(admin, broken, snapshot(row)));
    assertEquals(outcome.tts, "failed:unexpected");
    assertEquals([outcome.row.error_code, world.entries[0].error_code, world.uploads.length], [
      "TTS_FAILED",
      "TTS_FAILED",
      0,
    ]);
  }),
);

Deno.test(
  "when the write that stores the path fails the stage says so and marks the reflection; the file is left to the next try",
  speechWorld(async (world, admin, setup) => {
    const stored = seedDevotional(world, USER, verified);
    const row = snapshot(stored);
    const real = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const request = new Request(input, init);
      // Only the write that stores the path (it carries devotional_audio_path); marking the failure is a different write.
      if (request.method === "PATCH" && (await request.clone().text()).includes("devotional_audio_path")) {
        const body = JSON.stringify({ code: "XX000", message: "boom" });
        return new Response(body, { status: 500, headers: { "Content-Type": "application/json" } });
      }
      return await real(input, init);
    };
    let outcome;
    try {
      outcome = await speechStage(job(admin, setup, row));
    } finally {
      globalThis.fetch = real;
    }
    assertEquals(outcome.tts, "failed:save");
    assertEquals([outcome.row.error_code, stored.error_code, stored.devotional_audio_path], [
      "TTS_FAILED",
      "TTS_FAILED",
      null,
    ]);
    assertEquals([outcome.ttsChars, outcome.audioMs], [0, null]);
    assertEquals(world.uploads.length, 1, "the file was uploaded: the next try replaces it");
  }),
);

Deno.test(
  "when another request added the audio first the answer is that request's row, or the row it had if that cannot be read",
  speechWorld(async (world, admin, setup) => {
    const theirPath = `${USER}/devotionals/other.wav`;
    // The entry can be read again: the answer is the row as the other request left it.
    const found = seedDevotional(world, USER, verified);
    const withReread = await speechStage(job(admin, setup, snapshot(found), {
      db: (work) => {
        found.devotional_audio_path = theirPath; // the other request's write lands before ours
        return work();
      },
    }));
    assertEquals([withReread.tts, withReread.row.devotional_audio_path], ["ok", theirPath]);
    assertEquals(found.devotional_audio_path, theirPath, "the first writer's path is kept");

    // A row that has no client entry id cannot be found again, which is what a failed second read amounts to.
    const lost = seedDevotional(world, USER, { ...verified, client_entry_id: null });
    const withoutReread = await speechStage(job(admin, setup, snapshot(lost), {
      db: (work) => {
        lost.devotional_audio_path = theirPath;
        return work();
      },
    }));
    assertEquals([withoutReread.tts, withoutReread.row.devotional_audio_path], ["ok", null]);
    assertEquals(lost.devotional_audio_path, theirPath, "the first writer's path is kept");
  }),
);

Deno.test("the upload may not run past five seconds after the speech deadline, nor past its own cap", () => {
  const now = Date.now();
  const near = (found: number, expected: number) => Math.abs(found - expected) < 50;
  // A fresh request: its own cap is the smaller.
  assert(near(uploadCapMs(now), speechTiming.uploadTimeoutMs));
  // Two seconds before the deadline: two seconds and the five of grace.
  assert(near(uploadCapMs(now - (speechTiming.deadlineMs - 2_000)), 7_000));
  // Past the deadline already: only the five seconds of grace are left (never zero, never negative).
  assert(near(uploadCapMs(now - speechTiming.deadlineMs - 60_000), 5_000));
  // A shorter cap of its own wins when it is shorter.
  speechTiming.uploadTimeoutMs = 3_000;
  try {
    assert(near(uploadCapMs(now), 3_000));
    assert(near(uploadCapMs(now - speechTiming.deadlineMs - 60_000), 3_000));
  } finally {
    speechTiming.uploadTimeoutMs = 20_000;
  }
});
