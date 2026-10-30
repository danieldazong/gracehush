import { createAdmin } from "../admin.ts";
import { assert, assertEquals, expectAppError } from "../../process-entry/testing/assert.ts";
import { installWorld, seedDevotional, unscopedRequests, type World } from "../../process-entry/testing/fakes.ts";
import { collectUserData } from "./userData.ts";

// Reading everything of one person for the export (step 31): the profile, every entry oldest first in pages of 500, and each
// entry's affirmations under it, with every query filtered by that person.

const USER = "user_test";

function flow(work: (world: World) => Promise<void>) {
  return async () => {
    const world = installWorld();
    try {
      await work(world);
    } finally {
      world.restore();
    }
  };
}

function affirm(world: World, userId: string, entryId: string, slots: string[]) {
  for (const slot of slots) {
    world.affirmations.push({
      id: crypto.randomUUID(),
      user_id: userId,
      entry_id: entryId,
      time_slot: slot,
      headline: `${slot} headline`,
      affirmation_text: `${slot} words`,
      is_delivered: false,
      is_favorite: false,
      scheduled_for: null,
      created_at: world.now(),
    });
  }
}

Deno.test(
  "collect: the profile, 1,203 entries oldest first in pages of 500, and the affirmations under their own entry",
  flow(async (world) => {
    world.seedUser(USER);
    const ids: string[] = [];
    for (let index = 0; index < 1203; index += 1) ids.push(String(seedDevotional(world, USER).id));
    // Affirmations in the order evening, morning, afternoon: they come back morning, afternoon, evening.
    for (const id of ids.slice(0, 400)) affirm(world, USER, id, ["evening", "morning", "afternoon"]);
    const theirs = seedDevotional(world, "user_other");
    affirm(world, "user_other", String(theirs.id), ["morning"]);

    const data = await collectUserData(createAdmin(), USER);
    assertEquals(data.profile?.id, USER);
    assertEquals(data.entries.length, 1203);
    assertEquals(data.entries.map((entry) => entry.id), ids, "oldest first, every one once");
    assert(data.entries.every((entry) => entry.user_id === USER));
    assertEquals(data.entries[0].affirmations.map((row) => row.time_slot), ["morning", "afternoon", "evening"]);
    assertEquals(data.entries[399].affirmations.length, 3);
    assertEquals(data.entries[400].affirmations, []);

    const pages = world.requests.filter((request) => request.url.pathname === "/rest/v1/journal_entries");
    assertEquals(pages.map((request) => request.url.searchParams.get("offset")), ["0", "500", "1000"]);
    assert(pages.every((request) => request.url.searchParams.get("limit") === "500"));
    assert(pages.every((request) => request.url.searchParams.get("order") === "created_at.asc,id.asc"));
    const affirmationPages = world.requests.filter((request) => request.url.pathname === "/rest/v1/daily_affirmations");
    assertEquals(affirmationPages.map((request) => request.url.searchParams.get("offset")), ["0", "500", "1000"]);
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "collect: a person with no profile row and no entries reads as nothing, after one request per table",
  flow(async (world) => {
    const data = await collectUserData(createAdmin(), USER);
    assertEquals(data, { profile: null, entries: [] });
    assertEquals(world.requests.length, 3);
  }),
);

Deno.test(
  "collect: a read the database refuses is db:export_read",
  flow(async (world) => {
    seedDevotional(world, USER);
    world.fail.rowsRead = 1;
    await expectAppError(() => collectUserData(createAdmin(), USER), "INTERNAL", "db:export_read");
  }),
);
