import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "../errors.ts";

// Listing and removing a person's files (step 31: the export and the account deletion). Storage's list answers one level of a
// folder at a time, 100 entries per page by default, and gives a sub-folder as an entry whose id is null, so a whole folder is
// read page by page and level by level. A removal takes a list of paths, and a path that is not there is not an error.

export const LIST_PAGE_SIZE = 100;
export const REMOVE_BATCH_SIZE = 100;
// A person's folder is two levels deep ({userId}/raw/, {userId}/devotionals/). This only stops a listing that would never end.
const MAX_DEPTH = 6;

export type StoredFile = { path: string; size: number | null; createdAt: string | null };

type ListEntry = { name?: unknown; id?: unknown; created_at?: unknown; metadata?: unknown };

function sizeOf(metadata: unknown): number | null {
  if (typeof metadata !== "object" || metadata === null) return null;
  const size = (metadata as Record<string, unknown>).size;
  return typeof size === "number" && Number.isFinite(size) && size >= 0 ? size : null;
}

async function listLevel(admin: SupabaseClient, bucket: string, folder: string, depth: number): Promise<StoredFile[]> {
  const files: StoredFile[] = [];
  const folders: string[] = [];
  for (let offset = 0;; offset += LIST_PAGE_SIZE) {
    const { data, error } = await admin.storage.from(bucket).list(folder, {
      limit: LIST_PAGE_SIZE,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error || !Array.isArray(data)) throw new AppError("INTERNAL", "storage_list_failed");
    for (const entry of data as ListEntry[]) {
      if (typeof entry.name !== "string" || entry.name === "") continue;
      const path = `${folder}/${entry.name}`;
      if (entry.id === null || entry.id === undefined) folders.push(path);
      else {
        files.push({
          path,
          size: sizeOf(entry.metadata),
          createdAt: typeof entry.created_at === "string" ? entry.created_at : null,
        });
      }
    }
    if (data.length < LIST_PAGE_SIZE) break;
  }
  if (depth >= MAX_DEPTH) return files;
  for (const sub of folders) files.push(...(await listLevel(admin, bucket, sub, depth + 1)));
  return files;
}

// Every file under `prefix` in `bucket`, with its full path. The prefix is a person's own folder (their user id): one that is
// empty, starts with a slash or holds "..", is refused before anything is asked.
export async function listAllFiles(admin: SupabaseClient, bucket: string, prefix: string): Promise<StoredFile[]> {
  const folder = prefix.replace(/\/+$/, "");
  if (folder === "" || folder.startsWith("/") || folder.split("/").includes("..")) {
    throw new AppError("INTERNAL", "bad_prefix");
  }
  return await listLevel(admin, bucket, folder, 0);
}

// Removes the paths in batches of REMOVE_BATCH_SIZE. Answers how many files Storage says it removed.
export async function removeAll(admin: SupabaseClient, bucket: string, paths: string[]): Promise<number> {
  let removed = 0;
  for (let start = 0; start < paths.length; start += REMOVE_BATCH_SIZE) {
    const { data, error } = await admin.storage.from(bucket).remove(paths.slice(start, start + REMOVE_BATCH_SIZE));
    if (error) throw new AppError("INTERNAL", "storage_remove_failed");
    removed += Array.isArray(data) ? data.length : 0;
  }
  return removed;
}
