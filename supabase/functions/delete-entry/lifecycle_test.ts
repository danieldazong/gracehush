import { createAdmin } from "../_shared/admin.ts";
import { assert, assertEquals } from "../process-entry/testing/assert.ts";
import { installWorld, seedDevotional } from "../process-entry/testing/fakes.ts";
import {
  deletableFiles,
  type EntryToDelete,
  findEntryToDelete,
  RECORD_KEEP_MS,
  recordDeletedDevotional,
  removeFiles,
} from "./lifecycle.ts";

const USER = "user_test";

const entry = (over: Partial<EntryToDelete> = {}): EntryToDelete => ({
  id: "11111111-1111-4111-8111-111111111111",
  client_entry_id: "22222222-2222-4222-8222-222222222222",
  created_at: "2026-10-23T12:00:00.000Z",
  updated_at: "2026-10-23T12:00:00.000Z",
  processing_status: "ready",
  audio_path: null,
  devotional_audio_path: null,
  counted: true,
  ...over,
});

Deno.test("deletableFiles: the two names the functions give, in the person's own folder", () => {
  assertEquals(deletableFiles(USER, entry()), [
    `${USER}/raw/22222222-2222-4222-8222-222222222222.m4a`,
    `${USER}/devotionals/11111111-1111-4111-8111-111111111111.wav`,
  ]);
});

Deno.test("deletableFiles: the paths the columns say are added once, and an old .mp3 is removed too", () => {
  const raw = `${USER}/raw/22222222-2222-4222-8222-222222222222.m4a`;
  const mp3 = `${USER}/devotionals/11111111-1111-4111-8111-111111111111.mp3`;
  const files = deletableFiles(USER, entry({ audio_path: raw, devotional_audio_path: mp3 }));
  assertEquals(files, [
    raw,
    mp3,
    `${USER}/devotionals/11111111-1111-4111-8111-111111111111.wav`,
  ]);
});

Deno.test("deletableFiles: nothing outside the person's folder, nothing that climbs out of it", () => {
  const files = deletableFiles(
    USER,
    entry({
      audio_path: "user_victim/raw/a.m4a",
      devotional_audio_path: `${USER}/../user_victim/devotionals/b.wav`,
    }),
  );
  for (const path of files) {
    assert(path.startsWith(`${USER}/`) && !path.includes(".."), path);
  }
  assertEquals(files.length, 2);
  // A user id that only starts the same way is another folder.
  assertEquals(
    deletableFiles("user_te", entry({ audio_path: `${USER}/raw/a.m4a` })).filter((path) => path.includes("a.m4a")),
    [],
  );
});

Deno.test("deletableFiles: a reflection with no client entry id has no recording name to guess", () => {
  assertEquals(deletableFiles(USER, entry({ client_entry_id: null })), [
    `${USER}/devotionals/11111111-1111-4111-8111-111111111111.wav`,
  ]);
});

Deno.test("findEntryToDelete: a devotional counts, a crisis entry and an entry with no devotional do not", async () => {
  const world = installWorld();
  try {
    const admin = createAdmin();
    const made = seedDevotional(world, USER);
    const failed = seedDevotional(world, USER, { processing_status: "failed", devotional_script: null });
    const crisis = world.seedEntry({
      user_id: USER,
      client_entry_id: crypto.randomUUID(),
      input_type: "text",
      processing_status: "ready",
      is_crisis: true,
    });
    assertEquals((await findEntryToDelete(admin, USER, made.id))?.counted, true);
    assertEquals((await findEntryToDelete(admin, USER, failed.id))?.counted, false);
    assertEquals((await findEntryToDelete(admin, USER, crisis.id))?.counted, false);
    assertEquals(await findEntryToDelete(admin, USER, crypto.randomUUID()), null);
    assertEquals(await findEntryToDelete(admin, "user_other", made.id), null, "another person's entry is not found");
    // The devotional itself is read only to know it is there: it is not part of what comes back.
    const found = await findEntryToDelete(admin, USER, made.id);
    assert(found !== null && !("devotional_script" in found) && !("is_crisis" in found));
  } finally {
    world.restore();
  }
});

Deno.test("recordDeletedDevotional: one row with the id, the owner and the time it was made; again changes nothing", async () => {
  const world = installWorld();
  try {
    const admin = createAdmin();
    world.seedUser(USER);
    const subject = entry();
    await recordDeletedDevotional(admin, USER, subject);
    await recordDeletedDevotional(admin, USER, subject);
    assertEquals(world.deletedDevotionals.length, 1);
    const [row] = world.deletedDevotionals;
    assertEquals([row.entry_id, row.user_id, row.made_at], [subject.id, USER, subject.created_at]);
  } finally {
    world.restore();
  }
});

Deno.test("removeFiles: a path that is not there is not an error, and no paths means no request", async () => {
  const world = installWorld();
  try {
    const admin = createAdmin();
    await removeFiles(admin, []);
    assertEquals(world.requests.length, 0);
    await removeFiles(admin, [`${USER}/raw/missing.m4a`]);
    assertEquals(world.removals, [[`${USER}/raw/missing.m4a`]]);
  } finally {
    world.restore();
  }
});

Deno.test("the records are kept for two weeks", () => {
  assertEquals(RECORD_KEEP_MS, 14 * 24 * 60 * 60 * 1000);
});
