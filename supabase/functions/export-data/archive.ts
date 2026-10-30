import { type Zippable, zipSync } from "fflate";

import type { UserData, UserEntry, UserRow } from "../_shared/account/userData.ts";

// The pure half of export-data (step 31): the README, the JSON and the Markdown, which audio goes first and under what name,
// how many bytes a ZIP will take, and the ZIP itself. Nothing here reads, writes or logs.
//
// A crisis entry is never labelled: in the Markdown it is its day and the person's own words, like an entry that never
// finished; the JSON keeps every column, `is_crisis` included, because it is the person's own data.

export const DOWNLOAD_NAME = "gracehush-journal.zip";
export const README_NAME = "README.txt";
export const JSON_NAME = "journal.json";
export const MARKDOWN_NAME = "journal.md";
export const SCHEMA_VERSION = 1;

// A ZIP as fflate's zipSync writes it, with no extra fields and no data descriptors: per file a local header of 30 bytes and a
// central directory record of 46 bytes, each followed by the file's name, and one end record of 22 bytes for the whole archive.
export const ZIP_END_BYTES = 22;
const LOCAL_HEADER_BYTES = 30;
const CENTRAL_HEADER_BYTES = 46;

export type AudioKind = "recording" | "devotional";
export type AudioCandidate = { kind: AudioKind; entryId: string; storagePath: string; zipPath: string };
export type LeftOutReason = "space" | "unreadable" | "time";
export type LeftOut = { zipPath: string; reason: LeftOutReason };
export type ZipText = { name: string; text: string };
export type ZipFile = { name: string; bytes: Uint8Array };

const encoder = new TextEncoder();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SLOT_NAMES: Record<string, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" };
const REASONS: Record<LeftOutReason, string> = {
  space: "there was no room for it",
  unreadable: "it could not be read",
  time: "there was not enough time",
};

// ---- dates ----------------------------------------------------------------------------------------------------------
// The profile's time zone, as AGENTS.md's free week reads it: a zone Intl does not know is UTC.
export function zoneOrUtc(zone: unknown): string {
  if (typeof zone !== "string" || zone === "") return "UTC";
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone });
    return zone;
  } catch {
    return "UTC";
  }
}

// Intl writes a narrow no-break space before AM and PM; the files use a plain one.
const plain = (text: string) => text.replace(/[  ]/g, " ");
const format = (date: Date, zone: string, options: Intl.DateTimeFormatOptions) =>
  plain(new Intl.DateTimeFormat("en-US", { timeZone: zone, ...options }).format(date));

// "2026-10-29": the calendar day of `iso` on the clock of `zone`.
export function calendarDay(iso: string, zone: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return "undated";
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(date);
  const part = (type: string) => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

// A ZIP file time has no zone, and every reader shows it as it is, so the files are stamped with the export time on the
// profile's clock. fflate reads a Date with its local getters, so the wall-clock parts in that zone are built as a local Date:
// the result is the same whatever zone the runtime has (UTC on Supabase).
export function zipTime(iso: string, zone: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(iso));
  const part = (type: string) => Number(parts.find((item) => item.type === type)?.value ?? "0");
  return new Date(part("year"), part("month") - 1, part("day"), part("hour"), part("minute"), part("second"));
}

const longDay = (date: Date, zone: string) => format(date, zone, { year: "numeric", month: "long", day: "numeric" });
const weekdayDay = (date: Date, zone: string) =>
  format(date, zone, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
const clockTime = (date: Date, zone: string) => format(date, zone, { hour: "numeric", minute: "2-digit" });

// An answered prayer's day is the UTC date of answered_at, which is stored as 12:00 UTC on that calendar day (AGENTS.md, Prayer
// Rules): never a local date of it.
const answeredDay = (iso: string) => longDay(new Date(iso), "UTC");

// ---- audio ----------------------------------------------------------------------------------------------------------
const createdMs = (entry: UserRow) => {
  const ms = Date.parse(String(entry.created_at));
  return Number.isFinite(ms) ? ms : 0;
};

function newestFirst(entries: UserEntry[]): UserEntry[] {
  return [...entries].sort((a, b) => createdMs(b) - createdMs(a) || String(b.id).localeCompare(String(a.id)));
}

// A path of the person's own folder, or null: whatever a column holds, nothing outside it is ever read.
function ownPath(value: unknown, userId: string): string | null {
  return typeof value === "string" && value.startsWith(`${userId}/`) && !value.split("/").includes("..") ? value : null;
}

function extensionOf(path: string, fallback: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const dot = name.lastIndexOf(".");
  const extension = dot > 0 ? name.slice(dot).toLowerCase() : "";
  return /^\.[a-z0-9]{2,4}$/.test(extension) ? extension : fallback;
}

// The audio an export may hold, in the order it is added: the person's own recordings newest first, then the devotional audio
// newest first. Each is named by its day (on the profile's clock) and its entry: audio/recordings/2026-10-29-{entryId}.m4a.
export function audioCandidates(entries: UserEntry[], userId: string, zone: string): AudioCandidate[] {
  const ordered = newestFirst(entries).filter((entry) => typeof entry.id === "string" && UUID.test(entry.id));
  const pick = (kind: AudioKind, column: string, folder: string, fallback: string): AudioCandidate[] =>
    ordered.flatMap((entry) => {
      const storagePath = ownPath(entry[column], userId);
      if (storagePath === null) return [];
      const entryId = String(entry.id);
      const day = calendarDay(String(entry.created_at), zone);
      return [{
        kind,
        entryId,
        storagePath,
        zipPath: `audio/${folder}/${day}-${entryId}${extensionOf(storagePath, fallback)}`,
      }];
    });
  return [
    ...pick("recording", "audio_path", "recordings", ".m4a"),
    ...pick("devotional", "devotional_audio_path", "devotionals", ".wav"),
  ];
}

// ---- journal.json ---------------------------------------------------------------------------------------------------
// Every column but user_id, in the table's order, with the two storage paths replaced by the files' paths inside the ZIP (null
// when the file is not in it).
function exportRow(row: UserRow, included: ReadonlyMap<string, string>): UserRow {
  const out: UserRow = {};
  const file = (value: unknown) => (typeof value === "string" ? included.get(value) ?? null : null);
  for (const [key, value] of Object.entries(row)) {
    if (key === "user_id" || key === "affirmations") continue;
    if (key === "audio_path") out.recording_file = file(value);
    else if (key === "devotional_audio_path") out.devotional_audio_file = file(value);
    else out[key] = value;
  }
  return out;
}

export function buildJson(
  data: UserData,
  options: { exportedAt: string; zone: string; included: ReadonlyMap<string, string> },
): string {
  const entries = data.entries.map((entry) => ({
    ...exportRow(entry, options.included),
    affirmations: entry.affirmations.map((row) => exportRow(row, options.included)),
  }));
  const document = {
    exportedAt: options.exportedAt,
    schemaVersion: SCHEMA_VERSION,
    timeZone: options.zone,
    profile: data.profile,
    entries,
  };
  return `${JSON.stringify(document, null, 2)}\n`;
}

// ---- journal.md -----------------------------------------------------------------------------------------------------
const words = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const trimmed = value.replace(/\r\n/g, "\n").trim();
  return trimmed === "" ? null : trimmed;
};

// "You are held." from "You are held", and "Rest is allowed!" stays as it is.
const sentence = (text: string) => (/[.!?…”’"]$/.test(text) ? text : `${text}.`);

function entrySection(entry: UserEntry, zone: string): string[] {
  const made = new Date(String(entry.created_at));
  const heading = `## ${weekdayDay(made, zone)}, ${clockTime(made, zone)}`;
  const shared = words(entry.transcript);
  // A crisis entry, and one that never finished: the day and the person's words, nothing else.
  if (entry.processing_status !== "ready" || entry.is_crisis === true) {
    return shared === null ? [heading] : [heading, "", shared];
  }
  const out = [heading, "", `### ${words(entry.devotional_title) ?? words(entry.prayer_title) ?? "Reflection"}`];
  if (shared !== null) out.push("", "**What you shared**", "", shared);
  const reference = words(entry.scripture_reference);
  if (reference !== null) {
    out.push("", `**${reference} (BSB)**`);
    const verse = words(entry.scripture_text);
    if (entry.scripture_verified === true && verse !== null) out.push("", verse);
  }
  const devotional = words(entry.devotional_script);
  if (devotional !== null) out.push("", "**Devotional**", "", devotional);
  // Stored without its "Amen" (the app adds it, as it does here).
  const prayer = words(entry.closing_prayer);
  if (prayer !== null) out.push("", "**Closing prayer**", "", `${prayer} Amen.`);
  if (entry.is_answered === true && typeof entry.answered_at === "string") {
    out.push("", `**Answered on ${answeredDay(entry.answered_at)}**`);
    const note = words(entry.answered_notes);
    if (note !== null) out.push("", note);
  } else if (entry.is_active_prayer === true) {
    out.push("", "**Prayer request**");
  }
  const affirmations = entry.affirmations.flatMap((row) => {
    const headline = words(row.headline);
    const text = words(row.affirmation_text);
    if (headline === null && text === null) return [];
    const slot = SLOT_NAMES[String(row.time_slot)] ?? "Affirmation";
    return [`- ${slot}: ${[headline === null ? null : sentence(headline), text].filter(Boolean).join(" ")}`];
  });
  if (affirmations.length > 0) out.push("", "**Affirmations**", "", ...affirmations);
  return out;
}

export function buildMarkdown(data: UserData, options: { exportedAt: string; zone: string }): string {
  const lines = [
    "# Your Gracehush journal",
    "",
    `Exported on ${longDay(new Date(options.exportedAt), options.zone)} (${options.zone}).`,
  ];
  for (const entry of newestFirst(data.entries)) lines.push("", ...entrySection(entry, options.zone));
  return `${lines.join("\n")}\n`;
}

// ---- README.txt -----------------------------------------------------------------------------------------------------
const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function buildReadme(options: {
  exportedAt: string;
  zone: string;
  entries: number;
  included: number;
  leftOut: LeftOut[];
}): string {
  const at = new Date(options.exportedAt);
  const lines = [
    "Your Gracehush journal",
    "",
    `Exported on ${longDay(at, options.zone)} at ${clockTime(at, options.zone)} (${options.zone}).`,
    "",
    "This file holds your private reflections and prayers. Keep it somewhere safe, and share it only with someone you trust.",
    "",
    "What is inside:",
    "- journal.md: your journal, newest first, to read in any text app.",
    "- journal.json: the same journal with every field, for another app.",
    "- audio/recordings: your spoken reflections, as you recorded them.",
    "- audio/devotionals: your spoken devotionals.",
    "",
    `This export holds ${count(options.entries, "entry", "entries")} and ${
      count(options.included, "audio file", "audio files")
    }.`,
  ];
  if (options.leftOut.length === 0) {
    lines.push("Every audio file is included.");
  } else {
    lines.push(
      "",
      "Left out:",
      "These audio files are not in this download. Exporting again later may take them.",
      ...options.leftOut.map((item) => `- ${item.zipPath} (${REASONS[item.reason]})`),
    );
  }
  return `${lines.join("\n")}\n`;
}

// The reason whose words are longest, for the README's worst case (handler.ts budgets the text before it knows what is left out).
export const LONGEST_REASON = (Object.keys(REASONS) as LeftOutReason[])
  .reduce((a, b) => (REASONS[a].length >= REASONS[b].length ? a : b));

// ---- the ZIP --------------------------------------------------------------------------------------------------------
// What one file takes in the ZIP: its two headers, its name twice and its stored (or deflated) bytes.
export function zipEntryBytes(name: string, dataBytes: number): number {
  return LOCAL_HEADER_BYTES + CENTRAL_HEADER_BYTES + 2 * encoder.encode(name).length + dataBytes;
}

// The most bytes deflate may write for `length` bytes: never more than the input in stored blocks of at least 1 KB (5 bytes
// of block header each) plus a little for the stream's end. Text compresses far below it.
export function deflateBound(length: number): number {
  return length + 5 * Math.ceil(length / 1024) + 64;
}

// What the text files will take, at most.
export function textCost(texts: ZipText[]): number {
  return texts.reduce((sum, { name, text }) => sum + zipEntryBytes(name, deflateBound(encoder.encode(text).length)), 0);
}

// The text deflated at level 6; the audio stored as it is (level 0: it is already compressed, or a WAV the person may want whole).
export function buildZip(texts: ZipText[], audio: ZipFile[], mtime: Date): Uint8Array {
  const files: Zippable = {};
  for (const { name, text } of texts) files[name] = [encoder.encode(text), { level: 6, mtime }];
  for (const { name, bytes } of audio) files[name] = [bytes, { level: 0, mtime }];
  return zipSync(files);
}
