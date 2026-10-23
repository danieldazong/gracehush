// Generated from https://bible.helloao.org/api/BSB/books.json on 2026-10-23 (66 books, 1,189 chapters). Do not fetch it at
// runtime: the Berean Standard Bible has these books and these chapter counts. `id` is the USFM id exactly as books.json
// has it, `order` its position, `name` its commonName (books.json calls the Song of Solomon "Song" and gives that name as
// its commonName), `chapters` its numberOfChapters. `aliases` are the other spellings resolveBook() accepts, already
// normalized (lowercase, no dots, a numbered book written like "1 sam").

export type UsfmBookId =
  | "GEN"
  | "EXO"
  | "LEV"
  | "NUM"
  | "DEU"
  | "JOS"
  | "JDG"
  | "RUT"
  | "1SA"
  | "2SA"
  | "1KI"
  | "2KI"
  | "1CH"
  | "2CH"
  | "EZR"
  | "NEH"
  | "EST"
  | "JOB"
  | "PSA"
  | "PRO"
  | "ECC"
  | "SNG"
  | "ISA"
  | "JER"
  | "LAM"
  | "EZK"
  | "DAN"
  | "HOS"
  | "JOL"
  | "AMO"
  | "OBA"
  | "JON"
  | "MIC"
  | "NAM"
  | "HAB"
  | "ZEP"
  | "HAG"
  | "ZEC"
  | "MAL"
  | "MAT"
  | "MRK"
  | "LUK"
  | "JHN"
  | "ACT"
  | "ROM"
  | "1CO"
  | "2CO"
  | "GAL"
  | "EPH"
  | "PHP"
  | "COL"
  | "1TH"
  | "2TH"
  | "1TI"
  | "2TI"
  | "TIT"
  | "PHM"
  | "HEB"
  | "JAS"
  | "1PE"
  | "2PE"
  | "1JN"
  | "2JN"
  | "3JN"
  | "JUD"
  | "REV";

export type BibleBook = {
  id: UsfmBookId;
  order: number;
  name: string;
  chapters: number;
  aliases: readonly string[];
};

export const BSB_BOOKS: readonly BibleBook[] = [
  { id: "GEN", order: 1, name: "Genesis", chapters: 50, aliases: ["gen", "genesis", "ge", "gn"] },
  { id: "EXO", order: 2, name: "Exodus", chapters: 40, aliases: ["exo", "exodus", "ex", "exod"] },
  { id: "LEV", order: 3, name: "Leviticus", chapters: 27, aliases: ["lev", "leviticus", "le", "lv"] },
  { id: "NUM", order: 4, name: "Numbers", chapters: 36, aliases: ["num", "numbers", "nu", "nm", "nb"] },
  { id: "DEU", order: 5, name: "Deuteronomy", chapters: 34, aliases: ["deu", "deuteronomy", "deut", "dt", "de"] },
  { id: "JOS", order: 6, name: "Joshua", chapters: 24, aliases: ["jos", "joshua", "josh", "jsh"] },
  { id: "JDG", order: 7, name: "Judges", chapters: 21, aliases: ["jdg", "judges", "judg", "jg"] },
  { id: "RUT", order: 8, name: "Ruth", chapters: 4, aliases: ["rut", "ruth", "ru", "rth"] },
  { id: "1SA", order: 9, name: "1 Samuel", chapters: 31, aliases: ["1 sa", "1 samuel", "1 sam", "1 sm"] },
  { id: "2SA", order: 10, name: "2 Samuel", chapters: 24, aliases: ["2 sa", "2 samuel", "2 sam", "2 sm"] },
  { id: "1KI", order: 11, name: "1 Kings", chapters: 22, aliases: ["1 ki", "1 kings", "1 kgs", "1 kin"] },
  { id: "2KI", order: 12, name: "2 Kings", chapters: 25, aliases: ["2 ki", "2 kings", "2 kgs", "2 kin"] },
  { id: "1CH", order: 13, name: "1 Chronicles", chapters: 29, aliases: ["1 ch", "1 chronicles", "1 chr", "1 chron"] },
  { id: "2CH", order: 14, name: "2 Chronicles", chapters: 36, aliases: ["2 ch", "2 chronicles", "2 chr", "2 chron"] },
  { id: "EZR", order: 15, name: "Ezra", chapters: 10, aliases: ["ezr", "ezra"] },
  { id: "NEH", order: 16, name: "Nehemiah", chapters: 13, aliases: ["neh", "nehemiah", "ne"] },
  { id: "EST", order: 17, name: "Esther", chapters: 10, aliases: ["est", "esther", "esth"] },
  { id: "JOB", order: 18, name: "Job", chapters: 42, aliases: ["job", "jb"] },
  { id: "PSA", order: 19, name: "Psalms", chapters: 150, aliases: ["psa", "psalms", "ps", "psalm", "pss", "psm"] },
  { id: "PRO", order: 20, name: "Proverbs", chapters: 31, aliases: ["pro", "proverbs", "prov", "prv", "pr"] },
  {
    id: "ECC",
    order: 21,
    name: "Ecclesiastes",
    chapters: 12,
    aliases: ["ecc", "ecclesiastes", "eccl", "eccles", "qoh", "qoheleth"],
  },
  {
    id: "SNG",
    order: 22,
    name: "Song of Solomon",
    chapters: 8,
    aliases: [
      "sng",
      "song of solomon",
      "song",
      "song of songs",
      "sos",
      "ss",
      "cant",
      "canticles",
      "canticle of canticles",
    ],
  },
  { id: "ISA", order: 23, name: "Isaiah", chapters: 66, aliases: ["isa", "isaiah", "is"] },
  { id: "JER", order: 24, name: "Jeremiah", chapters: 52, aliases: ["jer", "jeremiah", "je"] },
  { id: "LAM", order: 25, name: "Lamentations", chapters: 5, aliases: ["lam", "lamentations", "la"] },
  { id: "EZK", order: 26, name: "Ezekiel", chapters: 48, aliases: ["ezk", "ezekiel", "eze", "ezek"] },
  { id: "DAN", order: 27, name: "Daniel", chapters: 12, aliases: ["dan", "daniel", "da", "dn"] },
  { id: "HOS", order: 28, name: "Hosea", chapters: 14, aliases: ["hos", "hosea", "ho"] },
  { id: "JOL", order: 29, name: "Joel", chapters: 3, aliases: ["jol", "joel", "joe", "jl"] },
  { id: "AMO", order: 30, name: "Amos", chapters: 9, aliases: ["amo", "amos", "am"] },
  { id: "OBA", order: 31, name: "Obadiah", chapters: 1, aliases: ["oba", "obadiah", "obad", "ob"] },
  { id: "JON", order: 32, name: "Jonah", chapters: 4, aliases: ["jon", "jonah", "jnh"] },
  { id: "MIC", order: 33, name: "Micah", chapters: 7, aliases: ["mic", "micah", "mc"] },
  { id: "NAM", order: 34, name: "Nahum", chapters: 3, aliases: ["nam", "nahum", "nah", "na"] },
  { id: "HAB", order: 35, name: "Habakkuk", chapters: 3, aliases: ["hab", "habakkuk", "hb"] },
  { id: "ZEP", order: 36, name: "Zephaniah", chapters: 3, aliases: ["zep", "zephaniah", "zeph", "zp"] },
  { id: "HAG", order: 37, name: "Haggai", chapters: 2, aliases: ["hag", "haggai", "hg"] },
  { id: "ZEC", order: 38, name: "Zechariah", chapters: 14, aliases: ["zec", "zechariah", "zech", "zc"] },
  { id: "MAL", order: 39, name: "Malachi", chapters: 4, aliases: ["mal", "malachi", "ml"] },
  { id: "MAT", order: 40, name: "Matthew", chapters: 28, aliases: ["mat", "matthew", "matt", "mt"] },
  { id: "MRK", order: 41, name: "Mark", chapters: 16, aliases: ["mrk", "mark", "mar", "mk", "mr"] },
  { id: "LUK", order: 42, name: "Luke", chapters: 24, aliases: ["luk", "luke", "lk"] },
  { id: "JHN", order: 43, name: "John", chapters: 21, aliases: ["jhn", "john", "jn"] },
  { id: "ACT", order: 44, name: "Acts", chapters: 28, aliases: ["act", "acts", "ac"] },
  { id: "ROM", order: 45, name: "Romans", chapters: 16, aliases: ["rom", "romans", "ro", "rm"] },
  { id: "1CO", order: 46, name: "1 Corinthians", chapters: 16, aliases: ["1 co", "1 corinthians", "1 cor"] },
  { id: "2CO", order: 47, name: "2 Corinthians", chapters: 13, aliases: ["2 co", "2 corinthians", "2 cor"] },
  { id: "GAL", order: 48, name: "Galatians", chapters: 6, aliases: ["gal", "galatians", "ga"] },
  { id: "EPH", order: 49, name: "Ephesians", chapters: 6, aliases: ["eph", "ephesians", "ephes"] },
  { id: "PHP", order: 50, name: "Philippians", chapters: 4, aliases: ["php", "philippians", "phil"] },
  { id: "COL", order: 51, name: "Colossians", chapters: 4, aliases: ["col", "colossians"] },
  {
    id: "1TH",
    order: 52,
    name: "1 Thessalonians",
    chapters: 5,
    aliases: ["1 th", "1 thessalonians", "1 thes", "1 thess"],
  },
  {
    id: "2TH",
    order: 53,
    name: "2 Thessalonians",
    chapters: 3,
    aliases: ["2 th", "2 thessalonians", "2 thes", "2 thess"],
  },
  { id: "1TI", order: 54, name: "1 Timothy", chapters: 6, aliases: ["1 ti", "1 timothy", "1 tim", "1 tm"] },
  { id: "2TI", order: 55, name: "2 Timothy", chapters: 4, aliases: ["2 ti", "2 timothy", "2 tim", "2 tm"] },
  { id: "TIT", order: 56, name: "Titus", chapters: 3, aliases: ["tit", "titus"] },
  { id: "PHM", order: 57, name: "Philemon", chapters: 1, aliases: ["phm", "philemon", "phlm", "philem"] },
  { id: "HEB", order: 58, name: "Hebrews", chapters: 13, aliases: ["heb", "hebrews"] },
  { id: "JAS", order: 59, name: "James", chapters: 5, aliases: ["jas", "james", "jm"] },
  { id: "1PE", order: 60, name: "1 Peter", chapters: 5, aliases: ["1 pe", "1 peter", "1 pet", "1 pt"] },
  { id: "2PE", order: 61, name: "2 Peter", chapters: 3, aliases: ["2 pe", "2 peter", "2 pet", "2 pt"] },
  { id: "1JN", order: 62, name: "1 John", chapters: 5, aliases: ["1 jn", "1 john", "1 jhn"] },
  { id: "2JN", order: 63, name: "2 John", chapters: 1, aliases: ["2 jn", "2 john", "2 jhn"] },
  { id: "3JN", order: 64, name: "3 John", chapters: 1, aliases: ["3 jn", "3 john", "3 jhn"] },
  { id: "JUD", order: 65, name: "Jude", chapters: 1, aliases: ["jud", "jude"] },
  { id: "REV", order: 66, name: "Revelation", chapters: 22, aliases: ["rev", "revelation", "revelations"] },
];

export const USFM_BOOK_IDS: readonly UsfmBookId[] = BSB_BOOKS.map((book) => book.id);

const BY_ID = new Map<string, BibleBook>(BSB_BOOKS.map((book) => [book.id, book]));

export function bookById(id: string): BibleBook | null {
  return BY_ID.get(id) ?? null;
}

export function isUsfmBookId(value: unknown): value is UsfmBookId {
  return typeof value === "string" && BY_ID.has(value);
}

// "1 John", "1john", "First John", "I John", "1st John" all read as "1 john"; dots and extra spaces are dropped. Exported
// for the test that checks every alias is already in this form.
export function normalizeBookName(input: string): string {
  const spaced = input.toLowerCase().replace(/[.,]/g, " ").replace(/\s+/g, " ").trim();
  const numbered = spaced
    .replace(/^(?:first|1st|i)\s+/, "1 ")
    .replace(/^(?:second|2nd|ii)\s+/, "2 ")
    .replace(/^(?:third|3rd|iii)\s+/, "3 ");
  return numbered.replace(/^([123])(?=[a-z])/, "$1 ");
}

const BY_ALIAS = new Map<string, BibleBook>();
for (const book of BSB_BOOKS) {
  for (const alias of book.aliases) BY_ALIAS.set(normalizeBookName(alias), book);
}

// The book a name or abbreviation stands for, or null. An exact match after normalizing: nothing is guessed.
export function resolveBook(input: string): BibleBook | null {
  return BY_ALIAS.get(normalizeBookName(input)) ?? null;
}
