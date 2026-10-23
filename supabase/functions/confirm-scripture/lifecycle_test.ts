import { createAdmin } from "../_shared/admin.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { installWorld, unscopedRequests, type World } from "../process-entry/testing/fakes.ts";
import { findEntryById, saveScripture } from "./lifecycle.ts";

const USER = "user_test";
const FIELDS = {
  scripture_reference: "Psalm 23:1–3",
  scripture_text: "The LORD is my shepherd;",
  scripture_verified: true,
};

function withWorld(work: (world: World, admin: ReturnType<typeof createAdmin>) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world, createAdmin());
    } finally {
      world.restore();
    }
  };
}

const ready = (world: World, over: Record<string, unknown> = {}) =>
  world.seedEntry({
    user_id: USER,
    client_entry_id: crypto.randomUUID(),
    input_type: "text",
    processing_status: "ready",
    scripture_reference: "Psalm 23:1–3",
    scripture_text: null,
    scripture_verified: false,
    ...over,
  });

Deno.test(
  "findEntryById finds the caller's entry and nobody else's",
  withWorld(async (world, admin) => {
    const mine = ready(world);
    const theirs = ready(world, { user_id: "user_someone_else" });
    assertEquals((await findEntryById(admin, USER, mine.id))?.id, mine.id);
    assertEquals(await findEntryById(admin, USER, theirs.id), null);
    assertEquals(await findEntryById(admin, USER, crypto.randomUUID()), null);
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "saveScripture writes the passage of a finished, unverified entry and returns the row",
  withWorld(async (world, admin) => {
    const entry = ready(world);
    const saved = await saveScripture(admin, USER, entry.id, FIELDS);
    assert(saved !== null);
    assertEquals(saved.scripture_text, "The LORD is my shepherd;");
    assertEquals(saved.scripture_verified, true);
    assertEquals(world.entries[0].scripture_verified, true);
  }),
);

Deno.test(
  "saveScripture never overwrites a passage that is already verified (a request that got there first wins)",
  withWorld(async (world, admin) => {
    const entry = ready(world, { scripture_text: "the first request's text", scripture_verified: true });
    assertEquals(await saveScripture(admin, USER, entry.id, FIELDS), null);
    assertEquals(world.entries[0].scripture_text, "the first request's text");
  }),
);

Deno.test(
  "saveScripture touches only a finished entry that is not a crisis entry, and only the caller's",
  withWorld(async (world, admin) => {
    const crisis = ready(world, {
      is_crisis: true,
      scripture_reference: null,
      scripture_text: null,
    });
    const unfinished = ready(world, { processing_status: "processing" });
    const theirs = ready(world, { user_id: "user_someone_else" });
    for (const entry of [crisis, unfinished, theirs]) {
      assertEquals(await saveScripture(admin, USER, entry.id, FIELDS), null);
    }
    assert(world.entries.every((row) => row.scripture_text === null && row.scripture_verified === false));
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "saveScripture can remove a reference that cannot exist",
  withWorld(async (world, admin) => {
    const entry = ready(world, { scripture_reference: "Hezekiah 1:1" });
    const cleared = await saveScripture(admin, USER, entry.id, {
      scripture_reference: null,
      scripture_text: null,
      scripture_verified: false,
    });
    assertEquals(cleared?.scripture_reference, null);
    assertEquals(world.entries[0].scripture_reference, null);
  }),
);
