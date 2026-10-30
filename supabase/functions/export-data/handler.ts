import { collectUserData } from "../_shared/account/userData.ts";
import type { StoredFile } from "../_shared/account/storageFiles.ts";
import { createAdmin } from "../_shared/admin.ts";
import { readAuthConfig, verifyClerkRequest } from "../_shared/auth.ts";
import { corsHeaders, preflightResponse } from "../_shared/cors.ts";
import { AppError, errorResponse, jsonResponse } from "../_shared/errors.ts";
import { type AccountStatus, blankLogLine, shortHash, writeLog } from "../_shared/log.ts";
import type { ExportDataResponse } from "../process-entry/contracts.ts";
import {
  audioCandidates,
  buildJson,
  buildMarkdown,
  buildReadme,
  buildZip,
  JSON_NAME,
  type LeftOut,
  LONGEST_REASON,
  MARKDOWN_NAME,
  README_NAME,
  textCost,
  ZIP_END_BYTES,
  zipEntryBytes,
  type ZipFile,
  zipTime,
  zoneOrUtc,
} from "./archive.ts";
import {
  downloadMedia,
  LINK_SECONDS,
  listExports,
  listMedia,
  removeExports,
  signExport,
  uploadExport,
} from "./lifecycle.ts";

// Builds a ZIP of everything the caller has in Gracehush (step 31): a README, the data as JSON, the journal as Markdown, and their
// audio while it fits, and hands back a link to it that lives one hour. The caller comes only from the verified Clerk token; the
// body is ignored. One export per person: within ten minutes of the newest one the same ZIP comes back with a fresh link, and
// after that the older ZIPs are removed and a new one is built.

// The exports bucket's limit is the project's global upload limit (50 MB on the Free plan, which Supabase counts as 52,428,800
// bytes), and a ZIP stays 2 MB under it.
export const EXPORT_MAX_BYTES = 52_428_800 - 2 * 1_048_576;

// The tests change these; nothing else does.
export const exportLimits = {
  maxBytes: EXPORT_MAX_BYTES,
  // The newest export is handed back again for this long.
  reuseMs: 10 * 60_000,
  // No audio is added after this much of the request (80% of the platform's 150 seconds); the export finishes as partial.
  audioBudgetMs: 120_000,
};

type Context = {
  requestId: string;
  startedAt: number;
  userHash: string | null;
  authMs: number;
  dbMs: number;
  account: AccountStatus | null;
  accountEntries: number | null;
  accountFiles: number | null;
  accountLeftOut: number | null;
  accountBytes: number | null;
};

async function timed<T>(context: Context, bucket: "authMs" | "dbMs", work: () => Promise<T>): Promise<T> {
  const started = Date.now();
  try {
    return await work();
  } finally {
    context[bucket] += Date.now() - started;
  }
}

function newestExport(files: StoredFile[]): (StoredFile & { madeAt: number }) | null {
  let newest: (StoredFile & { madeAt: number }) | null = null;
  for (const file of files) {
    const madeAt = file.createdAt === null ? NaN : Date.parse(file.createdAt);
    if (Number.isFinite(madeAt) && (newest === null || madeAt > newest.madeAt)) newest = { ...file, madeAt };
  }
  return newest;
}

function answer(url: string, partial: boolean, reused: boolean, sizeBytes: number): Response {
  const body: ExportDataResponse = {
    url,
    expiresAt: new Date(Date.now() + LINK_SECONDS * 1000).toISOString(),
    partial,
    reused,
    sizeBytes,
  };
  return jsonResponse(200, body, corsHeaders);
}

async function run(req: Request, context: Context): Promise<Response> {
  if (req.method !== "POST") throw new AppError("METHOD_NOT_ALLOWED");
  const user = await timed(context, "authMs", () => verifyClerkRequest(req, readAuthConfig()));
  context.userHash = await shortHash(user.userId);
  const userId = user.userId;
  const admin = createAdmin();
  const db = <T>(work: () => Promise<T>) => timed(context, "dbMs", work);

  // 1. The newest export, handed back again while it is young: nothing is read or built.
  const existing = await db(() => listExports(admin, userId));
  const newest = newestExport(existing);
  if (newest !== null && Date.now() - newest.madeAt < exportLimits.reuseMs) {
    const url = await db(() => signExport(admin, newest.path));
    context.account = "export:reused";
    context.accountBytes = newest.size;
    return answer(url, newest.path.endsWith("-partial.zip"), true, newest.size ?? 0);
  }

  // 2. Everything of the person, and the audio files it names.
  const data = await db(() => collectUserData(admin, userId));
  const zone = zoneOrUtc(data.profile?.timezone);
  const exportedAt = new Date().toISOString();
  const markdown = buildMarkdown(data, { exportedAt, zone });
  const candidates = audioCandidates(data.entries, userId, zone);
  const media = candidates.length === 0 ? new Map<string, number | null>() : await db(() => listMedia(admin, userId));

  // 3. Room for the texts at their largest (every file named in the JSON, every file listed as left out in the README), so
  // they fit whatever audio is chosen.
  const allFiles = new Map(candidates.map((candidate) => [candidate.storagePath, candidate.zipPath]));
  const worstReadme = buildReadme({
    exportedAt,
    zone,
    entries: data.entries.length,
    included: candidates.length + 10,
    leftOut: candidates.map((candidate) => ({ zipPath: candidate.zipPath, reason: LONGEST_REASON })),
  });
  let used = ZIP_END_BYTES + textCost([
    { name: README_NAME, text: worstReadme },
    { name: JSON_NAME, text: buildJson(data, { exportedAt, zone, included: allFiles }) },
    { name: MARKDOWN_NAME, text: markdown },
  ]);

  // 4. The audio while it fits: the person's recordings first, then the devotionals, newest first, one file at a time, and
  // nothing after the audio budget. A file whose size the listing gave is skipped without being downloaded.
  const audio: ZipFile[] = [];
  const included = new Map<string, string>();
  const leftOut: LeftOut[] = [];
  for (const candidate of candidates) {
    const remaining = exportLimits.audioBudgetMs - (Date.now() - context.startedAt);
    const leave = (reason: LeftOut["reason"]) => leftOut.push({ zipPath: candidate.zipPath, reason });
    if (remaining <= 0) {
      leave("time");
      continue;
    }
    if (!media.has(candidate.storagePath)) {
      leave("unreadable");
      continue;
    }
    const listed = media.get(candidate.storagePath);
    if (typeof listed === "number" && used + zipEntryBytes(candidate.zipPath, listed) > exportLimits.maxBytes) {
      leave("space");
      continue;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), remaining);
    let bytes: Uint8Array | "missing" | "timeout";
    try {
      bytes = await db(() => downloadMedia(admin, candidate.storagePath, controller.signal));
    } finally {
      clearTimeout(timer);
    }
    if (bytes === "timeout") {
      leave("time");
      continue;
    }
    if (bytes === "missing") {
      leave("unreadable");
      continue;
    }
    const cost = zipEntryBytes(candidate.zipPath, bytes.length);
    if (used + cost > exportLimits.maxBytes) {
      leave("space");
      continue;
    }
    used += cost;
    audio.push({ name: candidate.zipPath, bytes });
    included.set(candidate.storagePath, candidate.zipPath);
  }

  // 5. The ZIP, built once. The downloaded files are let go before it is stored.
  const readme = buildReadme({ exportedAt, zone, entries: data.entries.length, included: included.size, leftOut });
  const json = buildJson(data, { exportedAt, zone, included });
  const zip = buildZip(
    [{ name: README_NAME, text: readme }, { name: JSON_NAME, text: json }, { name: MARKDOWN_NAME, text: markdown }],
    audio,
    zipTime(exportedAt, zone),
  );
  audio.length = 0;
  if (zip.length > exportLimits.maxBytes) throw new AppError("INTERNAL", "zip_over_cap");

  // 6. The older exports go, the new one is stored, and the link to it is made.
  const partial = leftOut.length > 0;
  const path = `${userId}/${crypto.randomUUID()}${partial ? "-partial" : ""}.zip`;
  await db(() => removeExports(admin, existing.map((file) => file.path)));
  await db(() => uploadExport(admin, path, zip));
  const url = await db(() => signExport(admin, path));
  context.account = "export:built";
  context.accountEntries = data.entries.length;
  context.accountFiles = included.size;
  context.accountLeftOut = leftOut.length;
  context.accountBytes = zip.length;
  return answer(url, partial, false, zip.length);
}

export async function handle(req: Request): Promise<Response> {
  const context: Context = {
    requestId: crypto.randomUUID(),
    startedAt: Date.now(),
    userHash: null,
    authMs: 0,
    dbMs: 0,
    account: null,
    accountEntries: null,
    accountFiles: null,
    accountLeftOut: null,
    accountBytes: null,
  };
  let status = 200;
  let failure: AppError | null = null;
  try {
    if (req.method === "OPTIONS") {
      status = 204;
      return preflightResponse();
    }
    const response = await run(req, context);
    status = response.status;
    return response;
  } catch (error) {
    failure = error instanceof AppError
      ? error
      : new AppError("INTERNAL", `unhandled:${error instanceof Error ? error.name : "unknown"}`);
    status = failure.status;
    // An export that a signed-in caller asked for and that did not finish; a refused request is no export.
    if (context.userHash !== null) context.account = `export:failed:${failure.reason}`;
    return errorResponse(failure, context.requestId, corsHeaders);
  } finally {
    // The same allow-list as the other functions: what happened as one word, and counts. Never an id, a path, a link or a word.
    writeLog(
      blankLogLine({
        requestId: context.requestId,
        status,
        code: failure?.code ?? null,
        reason: failure?.reason ?? null,
        user: context.userHash,
        authMs: context.authMs,
        dbMs: context.dbMs,
        totalMs: Date.now() - context.startedAt,
        account: context.account,
        accountEntries: context.accountEntries,
        accountFiles: context.accountFiles,
        accountLeftOut: context.accountLeftOut,
        accountBytes: context.accountBytes,
      }),
    );
  }
}
