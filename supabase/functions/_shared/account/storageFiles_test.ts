import { createAdmin } from "../admin.ts";
import { assert, assertEquals, expectAppError } from "../../process-entry/testing/assert.ts";
import { installWorld, MEDIA_CREATED_AT, type World } from "../../process-entry/testing/fakes.ts";
import { listAllFiles, removeAll } from "./storageFiles.ts";

// Listing and removing a person's files (step 31) against the fake Storage: a listing pages past 100 entries and goes into every
// sub-folder, a removal goes in batches of 100, and a path that is not there is not an error.

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

function fill(world: World, folder: string, count: number, bytes = 3) {
  for (let index = 0; index < count; index += 1) {
    world.storage.set(`${folder}/${String(index).padStart(4, "0")}.m4a`, new Uint8Array(bytes));
  }
}

Deno.test(
  "list: a folder of 230 files and a sub-folder of 5 comes back whole, paged by 100, with each file's size",
  flow(async (world) => {
    fill(world, `${USER}/raw`, 230);
    fill(world, `${USER}/devotionals`, 5, 7);
    fill(world, "user_other/raw", 3);
    const files = await listAllFiles(createAdmin(), "journal_media", USER);
    assertEquals(files.length, 235);
    assert(files.every((file) => file.path.startsWith(`${USER}/`)), "only the person's own files");
    assertEquals(new Set(files.map((file) => file.path)).size, 235, "no file twice");
    assertEquals(files.find((file) => file.path === `${USER}/devotionals/0000.m4a`)?.size, 7);
    assertEquals(files.find((file) => file.path === `${USER}/raw/0229.m4a`)?.createdAt, MEDIA_CREATED_AT);
    // The person's folder holds two sub-folders: one listing of it, then raw/ in three pages and devotionals/ in one.
    assertEquals(
      world.lists.map((list) => `${list.prefix}@${list.offset}`),
      [`${USER}@0`, `${USER}/devotionals@0`, `${USER}/raw@0`, `${USER}/raw@100`, `${USER}/raw@200`],
    );
    assert(world.lists.every((list) => list.limit === 100 && list.bucket === "journal_media"));
  }),
);

Deno.test(
  "list: an empty folder answers nothing after one request, and a trailing slash is the same folder",
  flow(async (world) => {
    assertEquals(await listAllFiles(createAdmin(), "exports", USER), []);
    assertEquals(world.lists.length, 1);
    world.exports.set(`${USER}/a.zip`, { bytes: new Uint8Array(9), createdAt: "2026-10-30T08:00:00.000Z" });
    const files = await listAllFiles(createAdmin(), "exports", `${USER}/`);
    assertEquals(files, [{ path: `${USER}/a.zip`, size: 9, createdAt: "2026-10-30T08:00:00.000Z" }]);
  }),
);

Deno.test(
  "list: a folder of exactly 100 files asks for the next page once and stops at the empty one",
  flow(async (world) => {
    fill(world, USER, 100);
    const files = await listAllFiles(createAdmin(), "journal_media", USER);
    assertEquals(files.length, 100);
    assertEquals(world.lists.map((list) => list.offset), [0, 100]);
  }),
);

Deno.test(
  "list: a listing Storage refuses is storage_list_failed, never a partial answer",
  flow(async (world) => {
    fill(world, `${USER}/raw`, 150);
    world.fail.storageList = 1;
    await expectAppError(() => listAllFiles(createAdmin(), "journal_media", USER), "INTERNAL", "storage_list_failed");
    // The second page failing is the same failure.
    world.lists.length = 0;
    const admin = createAdmin();
    const inner = globalThis.fetch;
    globalThis.fetch = (input, init) => {
      if (world.lists.length === 2) world.fail.storageList = 1;
      return inner(input, init);
    };
    await expectAppError(() => listAllFiles(admin, "journal_media", USER), "INTERNAL", "storage_list_failed");
  }),
);

Deno.test(
  "list: a folder name with '..' or a leading slash is refused before anything is asked",
  flow(async (world) => {
    await expectAppError(() => listAllFiles(createAdmin(), "journal_media", "../user_other"), "INTERNAL", "bad_prefix");
    await expectAppError(() => listAllFiles(createAdmin(), "journal_media", ""), "INTERNAL", "bad_prefix");
    await expectAppError(() => listAllFiles(createAdmin(), "journal_media", "/user_test"), "INTERNAL", "bad_prefix");
    assertEquals(world.lists.length, 0);
  }),
);

Deno.test(
  "remove: 250 paths go in batches of 100, a path that is not there is no error, and the answer is how many went",
  flow(async (world) => {
    fill(world, `${USER}/raw`, 240);
    const paths = [...world.storage.keys()];
    for (let index = 0; index < 10; index += 1) paths.push(`${USER}/raw/missing-${index}.m4a`);
    const removed = await removeAll(createAdmin(), "journal_media", paths);
    assertEquals(removed, 240);
    assertEquals(world.removals.map((batch) => batch.length), [100, 100, 50]);
    assertEquals(world.storage.size, 0);
  }),
);

Deno.test(
  "remove: nothing to remove sends nothing; a removal Storage refuses is storage_remove_failed",
  flow(async (world) => {
    assertEquals(await removeAll(createAdmin(), "exports", []), 0);
    assertEquals(world.exportRemovals.length, 0);
    world.exports.set(`${USER}/a.zip`, { bytes: new Uint8Array(1), createdAt: "2026-10-30T08:00:00.000Z" });
    world.fail.storageRemove = 1;
    await expectAppError(
      () => removeAll(createAdmin(), "exports", [`${USER}/a.zip`]),
      "INTERNAL",
      "storage_remove_failed",
    );
    assert(world.exports.has(`${USER}/a.zip`));
    assertEquals(await removeAll(createAdmin(), "exports", [`${USER}/a.zip`]), 1);
    assertEquals(world.exports.size, 0);
  }),
);
