import { copy } from "@/constants/copy";
import { calendarDaysBetween, formatClock, formatMonthYear, formatShortDate } from "@/utils/format";
import type { ScholarConversation } from "@/types";

// The Conversations screen's pure parts (2026-11-16): how a title search becomes the pattern the server matches, how the
// loaded conversations are grouped under Today, Yesterday, Previous 7 days and a heading for each older month, and how a
// refreshed first page is merged into the pages already loaded, so coming back to the list neither jumps nor keeps a
// conversation that was deleted meanwhile. No React and no I/O.

// A title is at most 60 characters, so a longer search can match nothing more.
const SEARCH_MAX_LENGTH = 60;

// The search as an ILIKE pattern: the typed words between wildcards, with the pattern's own characters (% _ and the escape
// character) made literal. Null when there is nothing to search for.
export function likePattern(query: string): string | null {
  const words = query.trim().slice(0, SEARCH_MAX_LENGTH).trim();
  if (words === "") return null;
  return `%${words.replace(/[\\%_]/g, (character) => `\\${character}`)}%`;
}

export type HistoryItem =
  | { kind: "header"; key: string; title: string }
  | { kind: "row"; key: string; conversation: ScholarConversation; time: string; label: string };

type Bucket = { key: string; title: string; daysAgo: number };

function bucketOf(iso: string, now: Date): Bucket {
  const date = new Date(iso);
  const daysAgo = calendarDaysBetween(date, now);
  const { sections } = copy.scholar.history;
  if (daysAgo <= 0) return { key: "today", title: sections.today, daysAgo };
  if (daysAgo === 1) return { key: "yesterday", title: sections.yesterday, daysAgo };
  if (daysAgo <= 7) return { key: "week", title: sections.week, daysAgo };
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return { key: `month-${date.getFullYear()}-${month}`, title: formatMonthYear(iso), daysAgo };
}

// The time on a row: the heading already says the day for Today and Yesterday, so a row shows the clock alone; under
// "Previous 7 days" the weekday and the clock; under a month the date and the clock (the heading carries the year).
function rowTime(iso: string, bucket: Bucket): string {
  const clock = formatClock(iso);
  if (bucket.key === "today" || bucket.key === "yesterday") return clock;
  if (bucket.key === "week") {
    return `${new Date(iso).toLocaleDateString("en-US", { weekday: "short" })}, ${clock}`;
  }
  return `${formatShortDate(iso)}, ${clock}`;
}

// The conversations (newest first, as the server gives them) as one flat list of headings and rows, so a single virtualised
// list draws it and the headings can stick. `fullDay` words the day for a screen reader ("Today, 6:02 PM").
export function groupConversations(
  conversations: ScholarConversation[],
  now: Date,
  fullDay: (iso: string) => string,
): HistoryItem[] {
  const items: HistoryItem[] = [];
  let current: string | null = null;
  for (const conversation of conversations) {
    const bucket = bucketOf(conversation.lastMessageAt, now);
    if (bucket.key !== current) {
      current = bucket.key;
      items.push({ kind: "header", key: `header-${bucket.key}`, title: bucket.title });
    }
    const title = conversation.title ?? copy.scholar.untitled;
    items.push({
      kind: "row",
      key: conversation.id,
      conversation,
      time: rowTime(conversation.lastMessageAt, bucket),
      label: copy.scholar.a11y.conversation(title, fullDay(conversation.lastMessageAt)),
    });
  }
  return items;
}

export type HistoryPages = { conversations: ScholarConversation[]; nextCursor: string | null };

// A refreshed first page against the pages already loaded: the page replaces what it covers, and the older pages the person
// had already scrolled to are kept below it, so the list does not jump back to the top. A conversation the page covers but
// does not hold is gone (deleted, or its title no longer matches) and drops out. When the page is the whole list there is
// nothing older to keep.
export function mergeFirstPage(previous: HistoryPages, page: HistoryPages): HistoryPages {
  if (page.nextCursor === null) return page;
  const oldest = page.conversations[page.conversations.length - 1]?.lastMessageAt;
  if (oldest === undefined) return page;
  const inPage = new Set(page.conversations.map((conversation) => conversation.id));
  const older = previous.conversations.filter(
    (conversation) => !inPage.has(conversation.id) && conversation.lastMessageAt < oldest,
  );
  if (older.length === 0) return page;
  return { conversations: [...page.conversations, ...older], nextCursor: previous.nextCursor };
}

// Older conversations that came with a later page, appended to the list with any already there left out.
export function appendPage(previous: HistoryPages, page: HistoryPages): HistoryPages {
  const known = new Set(previous.conversations.map((conversation) => conversation.id));
  return {
    conversations: [...previous.conversations, ...page.conversations.filter((conversation) => !known.has(conversation.id))],
    nextCursor: page.nextCursor,
  };
}
