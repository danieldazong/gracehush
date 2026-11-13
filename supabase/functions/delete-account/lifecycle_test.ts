import { createAdmin } from "../_shared/admin.ts";
import { assertEquals, expectAppError } from "../process-entry/testing/assert.ts";
import {
  installWorld,
  seedDeletedDevotional,
  seedDevotional,
  unscopedRequests,
  unscopedStorage,
  type World,
} from "../process-entry/testing/fakes.ts";
import { deleteUserRows, removeUserFiles } from "./lifecycle.ts";

// The storage and database halves of delete-account (step 31): every file of the person in both buckets, and every row, with the
// rows a cascade should have taken counted and deleted by hand.

const USER = "user_test";

// One Scholar conversation of the person's (step 38), with one message, and a day of usage.
function seedScholar(world: World, userId: string): void {
  world.seedUser(userId);
  const conversation = crypto.randomUUID();
  world.conversations.push({
    id: conversation,
    user_id: userId,
    entry_id: null,
    title: null,
    is_heavy: false,
    last_message_at: world.now(),
    created_at: world.now(),
  });
  world.messages.push({
    id: crypto.randomUUID(),
    conversation_id: conversation,
    user_id: userId,
    role: "user",
    reply_to: null,
    input_type: "text",
    status: "ready",
    error_code: null,
    content: { blocks: [{ type: "text", text: "A question." }] },
    is_heavy: false,
    claimed_at: null,
    created_at: world.now(),
  });
  world.scholarUsage.push({ user_id: userId, day: "2026-11-11", messages: 2, listens: 1 });
}

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

Deno.test(
  "files: every file of the person in journal_media and exports goes, at any depth; the count is how many went",
  flow(async (world) => {
    for (
      const path of [
        `${USER}/raw/a.m4a`,
        `${USER}/devotionals/b.wav`,
        `${USER}/deeper/still/c.m4a`,
        "user_other/raw/d.m4a",
      ]
    ) {
      world.storage.set(path, new Uint8Array(2));
    }
    world.exports.set(`${USER}/e.zip`, { bytes: new Uint8Array(3), createdAt: world.now() });
    world.exports.set("user_other/f.zip", { bytes: new Uint8Array(3), createdAt: world.now() });
    assertEquals(await removeUserFiles(createAdmin(), USER), 4);
    assertEquals([...world.storage.keys()], ["user_other/raw/d.m4a"]);
    assertEquals([...world.exports.keys()], ["user_other/f.zip"]);
    assertEquals(unscopedStorage(world, USER), []);
    // Nothing left: nothing more to remove.
    assertEquals(await removeUserFiles(createAdmin(), USER), 0);
  }),
);

Deno.test(
  "rows: the profile goes with everything under it; a person with no profile is no error",
  flow(async (world) => {
    seedDevotional(world, USER);
    seedDeletedDevotional(world, USER, world.now());
    seedDevotional(world, "user_other");
    seedScholar(world, USER);
    seedScholar(world, "user_other");
    assertEquals(await deleteUserRows(createAdmin(), USER), { profiles: 1, leftover: 0 });
    assertEquals(world.users.map((row) => row.id), ["user_other"]);
    assertEquals(world.entries.map((row) => row.user_id), ["user_other"]);
    assertEquals(world.deletedDevotionals.length, 0);
    // Scholar (step 38): the person's conversations, messages and usage go too, and nobody else's.
    assertEquals(world.conversations.map((row) => row.user_id), ["user_other"]);
    assertEquals(world.messages.map((row) => row.user_id), ["user_other"]);
    assertEquals(world.scholarUsage.map((row) => row.user_id), ["user_other"]);
    assertEquals(await deleteUserRows(createAdmin(), USER), { profiles: 0, leftover: 0 });
    assertEquals(unscopedRequests(world, USER), []);
  }),
);

Deno.test(
  "rows: when the cascade did not happen, the rows left behind are counted and deleted; a refused delete is db:delete_profile",
  flow(async (world) => {
    const entry = seedDevotional(world, USER);
    world.affirmations.push({
      id: crypto.randomUUID(),
      user_id: USER,
      entry_id: entry.id,
      time_slot: "morning",
      headline: "h",
      affirmation_text: "t",
      is_delivered: false,
      is_favorite: false,
      scheduled_for: null,
      created_at: world.now(),
    });
    seedDeletedDevotional(world, USER, world.now());
    seedScholar(world, USER);
    world.cascade = false;
    assertEquals(await deleteUserRows(createAdmin(), USER), { profiles: 1, leftover: 6 });
    assertEquals([world.entries.length, world.affirmations.length, world.deletedDevotionals.length], [0, 0, 0]);
    assertEquals([world.conversations.length, world.messages.length, world.scholarUsage.length], [0, 0, 0]);
    // A message goes before its conversation, and an affirmation before its entry.
    const deletes = world.requests.filter((request) => request.method === "DELETE").map((request) =>
      request.url.pathname.replace("/rest/v1/", "")
    );
    assertEquals(deletes, [
      "users_profile",
      "scholar_messages",
      "scholar_conversations",
      "scholar_usage",
      "daily_affirmations",
      "journal_entries",
      "deleted_devotionals",
    ]);

    world.seedUser(USER);
    world.fail.profileDelete = 1;
    await expectAppError(() => deleteUserRows(createAdmin(), USER), "INTERNAL", "db:delete_profile");
    assertEquals(world.users.length, 1);
  }),
);
