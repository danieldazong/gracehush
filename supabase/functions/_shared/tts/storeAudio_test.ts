import type { SupabaseClient } from "@supabase/supabase-js";

import { assert, assertEquals, expectAppError } from "../../process-entry/testing/assert.ts";
import { devotionalAudioPath, storeDevotionalAudio } from "./storeAudio.ts";

type Upload = { bucket: string; path: string; body: Uint8Array; options: Record<string, unknown> };

// Only the one call the module makes: storage.from(bucket).upload(path, body, options).
function fakeAdmin(error: { message: string } | null = null) {
  const uploads: Upload[] = [];
  const admin = {
    storage: {
      from: (bucket: string) => ({
        upload: (path: string, body: Uint8Array, options: Record<string, unknown>) => {
          uploads.push({ bucket, path, body, options });
          return Promise.resolve({ data: error ? null : { path }, error });
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { admin, uploads };
}

const ENTRY = "11111111-2222-4333-8444-555555555555";

Deno.test("the path is {userId}/devotionals/{entryId}.wav, the step 18 layout", () => {
  assertEquals(devotionalAudioPath("user_abc", ENTRY), `user_abc/devotionals/${ENTRY}.wav`);
});

Deno.test("it uploads to the private bucket as audio/wav, replacing an earlier file, and returns only the path", async () => {
  const { admin, uploads } = fakeAdmin();
  const audio = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0]);
  const path = await storeDevotionalAudio(admin, "user_abc", ENTRY, audio);
  assertEquals(path, `user_abc/devotionals/${ENTRY}.wav`);
  assertEquals(uploads.length, 1);
  assertEquals([uploads[0].bucket, uploads[0].path], ["journal_media", path]);
  assertEquals(uploads[0].body, audio);
  assertEquals(uploads[0].options, { contentType: "audio/wav", upsert: true, cacheControl: "3600" });
  assert(!path.startsWith("http"), "a path, never a URL");
});

Deno.test("an upload that fails is an INTERNAL error with a reason that holds nothing from storage", async () => {
  const { admin } = fakeAdmin({ message: "the object user_abc/devotionals/x is too large" });
  const error = await expectAppError(
    () => storeDevotionalAudio(admin, "user_abc", ENTRY, new Uint8Array(3)),
    "INTERNAL",
    "storage:upload",
  );
  assert(!error.reason.includes("user_abc"));
});

Deno.test("an id that could change the folder is refused before anything is sent", async () => {
  const { admin, uploads } = fakeAdmin();
  for (
    const [userId, entryId] of [["user_abc/../other", ENTRY], ["user_abc", "../x"], ["", ENTRY], ["user abc", ENTRY], [
      "user_abc",
      `${ENTRY}.wav`,
    ]]
  ) {
    await expectAppError(
      () => storeDevotionalAudio(admin, userId, entryId, new Uint8Array(3)),
      "INTERNAL",
      "storage:bad_path",
    );
  }
  assertEquals(uploads.length, 0);
});
