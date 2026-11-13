import { type Zippable, zipSync } from "fflate";

import type { UserConversation, UserData, UserEntry, UserRow } from "../_shared/account/userData.ts";

// The pure half of export-data (step 31): the README, the JSON and the Markdown, which audio goes first and under what name,
// how many bytes a ZIP will take, and the ZIP itself. Nothing here reads, writes or logs.
//
// A heavy moment is never labelled. Since 2026-11-08 it is a whole reflection, exported like any other; one saved before then
// has no devotional, so in the Markdown it is its day and the person's own words, like an entry that never finished. The JSON
// keeps every column, `is_crisis` included, because it is the person's own data. A Scholar conversation (step 38) is the same:
// every column in the JSON, `is_heavy` included, and in the Markdown its title (or a plain one) and its messages, never a label.

export const DOWNLOAD_NAME = "gracehush-journal.zip";
export const README_NAME = "README.txt";
export const JSON_NAME = "journal.json";
export const MARKDOWN_NAME = "journal.md";
export const SCHEMA_VERSION = 2;

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
    if (key === "user_id" || key === "affirmations" || key === "messages") continue;
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
  // Step 38: every Scholar conversation, oldest first as read, with its messages under it (no file is named in either).
  const conversations = data.conversations.map((row) => ({
    ...exportRow(row, options.included),
    messages: row.messages.map((message) => exportRow(message, options.included)),
  }));
  const document = {
    exportedAt: options.exportedAt,
    schemaVersion: SCHEMA_VERSION,
    timeZone: options.zone,
    profile: data.profile,
    entries,
    conversations,
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
  // An entry with no reflection (one that never finished, or a heavy moment saved before 2026-11-08): the day and the
  // person's words, nothing else.
  if (entry.processing_status !== "ready" || words(entry.devotional_script) === null) {
    return shared === null ? [heading] : [heading, "", shared];
  }
  const out = [heading, "", `### ${words(entry.devotional_title) ?? words(entry.prayer_title) ?? "Reflection"}`];
  // The first line of the Reflection screen (step 36), when the reflection has one: a reflection made before it has none.
  const line = words(entry.validation_line);
  if (line !== null) out.push("", line);
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
    // Step 37: the verse under the affirmation, as one line, with its reference (both or neither are stored).
    const verseText = words(row.verse_text);
    const verseReference = words(row.verse_reference);
    const verse = verseText !== null && verseReference !== null
      ? `“${verseText.replace(/\s*\n\s*/g, " ")}” (${verseReference}, BSB)`
      : null;
    return [`- ${slot}: ${[headline === null ? null : sentence(headline), text, verse].filter(Boolean).join(" ")}`];
  });
  if (affirmations.length > 0) out.push("", "**Affirmations**", "", ...affirmations);
  return out;
}

// ---- Scholar conversations (step 38) ----------------------------------------------------------------------------------
// The saved blocks of one message, as the app shows them: a passage as its reference and the Bible's words, the answer's
// paragraphs, and a prayer under its own label with the "Amen" the app adds (it is stored without one). A block of another shape
// is left out.
function blockLines(content: unknown): string[] {
  const blocks =
    typeof content === "object" && content !== null && Array.isArray((content as { blocks?: unknown }).blocks)
      ? (content as { blocks: unknown[] }).blocks
      : [];
  const out: string[] = [];
  for (const block of blocks) {
    if (typeof block !== "object" || block === null) continue;
    const { type, text, reference } = block as { type?: unknown; text?: unknown; reference?: unknown };
    const body = words(text);
    if (body === null) continue;
    if (type === "passage") {
      const where = words(reference);
      if (where !== null) out.push("", `**${where} (BSB)**`, "", body);
    } else if (type === "text") {
      out.push("", body);
    } else if (type === "prayer") {
      out.push("", "**Prayer**", "", `${body} Amen.`);
    }
  }
  return out;
}

const lastMessageMs = (row: UserConversation) => {
  const ms = Date.parse(String(row.last_message_at ?? row.created_at));
  return Number.isFinite(ms) ? ms : 0;
};

// One conversation: its title (a heavy one has none), the day it began, and the messages in order. A message with no words (a
// recording that was never heard, or an answer that never finished) is left out. Nothing says a conversation was heavy.
function conversationSection(row: UserConversation, zone: string): string[] {
  const out = [
    `## ${words(row.title) ?? "A conversation with Scholar"}`,
    "",
    weekdayDay(new Date(String(row.created_at)), zone),
  ];
  for (const message of row.messages) {
    const said = blockLines(message.content);
    if (said.length === 0) continue;
    if (message.role === "scholar") out.push("", "**Scholar:**", ...said);
    else out.push("", `**You:** ${said.filter((line) => line !== "").join("\n\n")}`);
  }
  return out;
}

export function buildMarkdown(data: UserData, options: { exportedAt: string; zone: string }): string {
  const lines = [
    "# Your GraceHush journal",
    "",
    `Exported on ${longDay(new Date(options.exportedAt), options.zone)} (${options.zone}).`,
  ];
  for (const entry of newestFirst(data.entries)) lines.push("", ...entrySection(entry, options.zone));
  if (data.conversations.length > 0) {
    lines.push("", "# Scholar conversations");
    const newest = [...data.conversations].sort((a, b) =>
      lastMessageMs(b) - lastMessageMs(a) || String(b.id).localeCompare(String(a.id))
    );
    for (const row of newest) lines.push("", ...conversationSection(row, options.zone));
  }
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
    "Your GraceHush journal",
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
    "- Scholar conversations: your conversations with Scholar, at the end of journal.md and in journal.json.",
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
