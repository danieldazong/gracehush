# 20-scripture-hydration.md

Read AGENTS.md first and follow it strictly.

Add exact Berean Standard Bible (BSB) text to process-entry using the
HelloAO Free Use Bible API. Gemini chooses the passage location; the
server validates it, fetches the chapter, joins the exact verse text,
formats the reference and sets scripture_verified. Unverifiable text is
never shown or stored. Also add a small confirm-scripture Edge Function
that retries hydration for one entry. Crisis screening comes in step 21,
TTS in step 22, client wiring in step 25. No UI changes.

AGENTS.md requires approval before deploying Edge Functions. Build and
test locally; deploy only after the user says yes (section 10). No new
dependencies. No migrations.

Docs (source of truth, follow exactly):

- https://bible.helloao.org/docs/reference/translations/standard.html
  (GET /api/{translation}/{book}/{chapter}.json and its TypeScript
  structure: ChapterVerse.content items are string | FormattedText
  {text, poem?, wordsOfJesus?} | InlineHeading {heading} |
  InlineLineBreak {lineBreak: true} | VerseFootnoteReference {noteId})
- https://bible.helloao.org/api/BSB/books.json (book ids, names,
  commonName, numberOfChapters)
- https://ubsicap.github.io/usfm/identification/books.html (USFM ids)

---

## 1. Before writing code

1. Read supabase/functions/process-entry/ (gemini.ts, prompt.ts,
   output.ts, lifecycle.ts, index.ts, contracts.ts), \_shared/,
   src/types/index.ts (Scripture model), src/components/ScriptureCard.tsx
   and src/data/mappers.ts.
2. Confirm how ScriptureCard (step 11) handles: verified text, unverified
   (reference only + "We're confirming this passage."), and scripture
   null. If the null case isn't handled (card should be hidden), report
   it and add // TODO(25): hide ScriptureCard when scripture is null.
   Do not change UI in this step.
3. Fetch https://bible.helloao.org/api/BSB/books.json once while
   building (curl). Use it to write the book table in section 2. Do not
   fetch it at runtime.

---

## 2. Book table: \_shared/bible/books.ts

export const BSB_BOOKS: readonly BibleBook[] = [...66 entries...]
type BibleBook = {
id: UsfmBookId; // 'GEN' ... 'REV', exactly as books.json
order: number; // 1..66
displayName: string; // see rules
chapters: number; // numberOfChapters from books.json
aliases: string[]; // lowercase, no punctuation
};
export type UsfmBookId = 'GEN' | 'EXO' | ... | 'REV';
export const USFM_BOOK_IDS: readonly UsfmBookId[]

Rules:

- ids, order and chapters copied exactly from books.json. Add a header
  comment: "Generated from https://bible.helloao.org/api/BSB/books.json
  on <date>."
- displayName = books.json `name`, except: SNG → "Song of Solomon"
  (books.json name is "Song"). Psalms stays "Psalms" here; the
  formatter handles the singular.
- aliases cover common forms: "phil", "philippians", "php",
  "song of songs", "song of solomon", "canticles", "1 john", "1john",
  "first john", "i john", "1 jn", "psalm", "psalms", "ps", "psa",
  "prov", "rev", "revelation", "revelations", and so on for every
  numbered book (1/2/3, I/II/III, First/Second/Third).
- resolveBook(input: string): BibleBook | null — normalize (lowercase,
  trim, remove dots, collapse spaces, roman numerals → digits) then
  match id or alias. No fuzzy matching.

Test (\_shared/bible/books_test.ts): 66 entries, ids unique, orders 1..66,
chapter totals sum to 1189 (BSB totalNumberOfChapters), every alias
resolves to exactly one book.

---

## 3. Reference model and formatter: \_shared/bible/reference.ts

type ScriptureRef = { bookId: UsfmBookId; chapter: number;
verseStart: number; verseEnd: number };

validateRefShape(ref): ok | { reason: 'UNKNOWN_BOOK' |
'CHAPTER_OUT_OF_RANGE' | 'BAD_VERSES' | 'RANGE_TOO_LONG' }
// chapter 1..book.chapters; verseStart >= 1;
// verseEnd >= verseStart; verseEnd - verseStart <= 5

formatReference(ref): string
// "Philippians 4:6–7" (en dash U+2013), "John 3:16"
// Psalms with one chapter → "Psalm 23:1–3" (singular)
// Single-chapter books still show chapter: "Jude 1:24–25"

parseReference(s: string): ScriptureRef | null
// reads formatReference output back exactly
// (book display name, chapter, start, optional –end or -end)
// also accepts aliases for old rows

Test: format → parse round-trips for all 66 books; "Song of Solomon
2:4", "1 John 4:18", "Psalm 34:18", "Philippians 4:6–7",
"Phil. 4:6-7" (alias, hyphen) parse; "Hezekiah 1:1", "John 99:1",
"John 3:" don't.

---

## 4. HelloAO client: \_shared/bible/helloao.ts

fetchChapter(bookId, chapter): Promise<ChapterResult>
type ChapterResult =
| { ok: true; verses: Map<number, VerseText>; numberOfVerses: number }
| { ok: false; kind: 'NOT_FOUND' | 'TRANSIENT' | 'INVALID' };
type VerseText = { text: string; poetic: boolean };

- URL: https://bible.helloao.org/api/BSB/{bookId}/{chapter}.json.
  Base URL and translation 'BSB' in constants; never hardcode another
  translation.
- AbortController timeout 5 seconds. Retry once after 500ms on network
  error, timeout or 5xx → still failing = TRANSIENT. 404 = NOT_FOUND.
  Response over 2 MB = INVALID.
- Validate before trusting: translation.id === 'BSB', book.id ===
  bookId, chapter.number === chapter. Mismatch = INVALID.
- Hand-written type guards for the documented structure. No `any`.
- Build each verse's text from chapter.content items with
  type === 'verse':
  string → append
  FormattedText → append .text; poem set → poetic = true
  InlineLineBreak → "\n" when poetic, otherwise " "
  InlineHeading → skip (never part of verse text)
  VerseFootnoteReference → skip
  Then collapse runs of spaces, trim each line, trim the verse. Never
  change letters, punctuation, quotes or capitalization.
- Ignore chapter-level 'heading', 'line_break' and 'hebrew_subtitle'
  items.
- In-memory LRU cache keyed "BSB/{bookId}/{chapter}", max 64 chapters,
  module scope (lives as long as the function instance). Cache only
  ok results. Chapters never change, so no expiry.
- Log only bookId, chapter, outcome kind, ms and cache hit. Never log
  verse text.

---

## 5. Hydration: \_shared/bible/hydrate.ts

hydrateScripture(ref): Promise<HydrateResult>
type HydrateResult =
| { status: 'verified'; ref; reference: string; text: string }
| { status: 'invalid'; reason: string } // definitive
| { status: 'unavailable'; ref; reference: string } // transient

Rules:

- validateRefShape fails → invalid.
- fetchChapter NOT_FOUND or INVALID → invalid when NOT_FOUND,
  unavailable when INVALID (could be a bad response, retry later).
- TRANSIENT → unavailable.
- Every verse verseStart..verseEnd must exist in the map and have
  non-empty text. verseEnd > numberOfVerses or any missing verse (some
  verse numbers are omitted in BSB) → invalid.
- Join verses: poetic verses with "\n", otherwise " ". Final text
  ≤ 1200 characters, else invalid.
- reference = formatReference(ref).

Test (hydrate_test.ts) with a stubbed fetch using fixture JSON copied
from the docs' Genesis 1 example plus one poetry fixture (fetch
https://bible.helloao.org/api/BSB/PSA/23.json once with curl and save it
under fixtures/): headings and footnote ids never appear in text; poetry
keeps line breaks; out-of-range verse → invalid; timeout → unavailable;
wrong translation id → unavailable.

---

## 6. Gemini schema change (process-entry)

Change the step 19 scripture schema field:
scripture: { book_id: enum USFM_BOOK_IDS, chapter: integer,
verse_start: integer, verse_end: integer } | null

- Build the enum from USFM_BOOK_IDS (one source of truth).
- prompt.ts: "Return the book as its 3-letter USFM id (e.g. PHP for
  Philippians, PSA for Psalms, SNG for Song of Solomon). Choose a
  passage of 1 to 4 verses that exists in the Berean Standard Bible."
- output.ts: keep the step 19 shape checks; the book is now an id.
- Update contracts.ts and src/types/index.ts only if the response shape
  changes (it shouldn't: the response still carries reference + text +
  verified).

---

## 7. Wire into process-entry (index.ts step 9)

After Gemini output passes validation and the entry is not crisis:

1. hydrateScripture(ref).
2. verified → scripture_reference = reference, scripture_text = text,
   scripture_verified = true.
3. invalid → ONE corrective Gemini call (gemini.ts
   requestReplacementScripture): same model, small schema with only the
   scripture object, prompt: "The passage {reference or ids} does not
   exist in the Berean Standard Bible ({reason}). Choose a different
   passage of 1 to 4 verses that fits this reflection." plus the
   reflection title and dominant emotion only (never the transcript
   again). Hydrate the replacement once.
   - verified → as 2.
   - still invalid → scripture_reference, scripture_text null,
     scripture_verified false. The entry is still ready. Log
     "scripture_dropped" with reason only.
4. unavailable → scripture_reference = reference, scripture_text =
   null, scripture_verified = false. The entry is ready; the app shows
   "We're confirming this passage."
5. The devotional never quotes scripture (step 19 rule). Do not insert
   verse text into devotional_script.
   // TODO(22): TTS may read the verse aloud only when
   // scripture_verified is true.
6. Gemini's replacement call counts toward the step 19 timeout budget;
   if total Gemini time already exceeds 60 seconds, skip the replacement
   and go to step 3's "still invalid" branch.

Delete any remaining fallback verse, hardcoded verse text or chapter
truncation (the old 300-character slice). grep for "Be still" and
"slice(0, 300)" and report results.

---

## 8. confirm-scripture Edge Function

supabase/functions/confirm-scripture/index.ts, reusing \_shared (cors,
errors, auth, admin, log, bible/\*):

- POST { entryId: string } (UUID). verifyClerkRequest; userId only from
  the token.
- Load the entry with .eq('id', entryId).eq('user_id', userId). Not
  found → 404 NOT_FOUND (add to the error map, message "We couldn't
  find this reflection.").
- Return the current scripture unchanged (200) when: is_crisis, already
  verified, scripture_reference null, or updated_at less than 60 seconds
  ago (simple per-entry throttle).
- parseReference(scripture_reference) → null: set scripture_reference
  null (it can never be verified) and return 200 with scripture null.
- hydrate: verified → update text + verified, return it; unavailable →
  return unverified (200, unchanged); invalid → set reference null,
  return scripture null.
- Response: { scripture: { reference, text, verified } | null }.
- config.toml: same verify_jwt choice as process-entry (step 19).
- // TODO(25): client calls confirm-scripture when a ready entry has an
  // unverified reference, on Reflection focus, at most once per minute.

---

## 9. Local testing

1. `deno test` for books, reference and hydrate tests (no network
   except the fixture download done once).
2. `npx supabase functions serve` both functions; then:
   a. text entry about anxiety → verified, text matches
   https://bible.helloao.org/api/BSB/{id}/{ch}.json exactly for the
   chosen verses (compare by hand and show both).
   b. temporarily force the Gemini ref to PSA 151:1 (dev-only env
   FORCE_SCRIPTURE_REF, never deployed) → replacement chosen and
   verified, or scripture null.
   c. FORCE_SCRIPTURE_REF=JHN 3:99 → invalid → replacement path.
   d. HELLOAO_BASE_URL pointed at an unreachable host (dev-only env) →
   entry ready, reference kept, verified false; then restore the URL
   and call confirm-scripture after 60s → verified.
   e. confirm-scripture with another user's entryId → 404.
   f. Poetic passage (e.g. PSA 23:1–3) keeps line breaks.
   g. Second request for the same chapter → cache hit in logs.
3. Remove both dev-only env switches from code before deploy, or guard
   them so they are ignored unless SUPABASE_URL is local. Report which.

---

## 10. Deploy (approval gate)

Show test results and ask: "Deploy process-entry and confirm-scripture?"
Only on yes: `npx supabase functions deploy process-entry` and
`npx supabase functions deploy confirm-scripture`; re-run case a against
the hosted URL.

---

## 11. AGENTS.md updates

- Scripture Rules: BSB only via HelloAO; Gemini returns USFM ids;
  server validates and hydrates; scripture_text only when
  scripture_verified; no fallback or hardcoded verses; reference format
  "Book C:V–V" (en dash, "Psalm" singular); confirm-scripture retries
  unverified references.
- Legal/credits: BSB is public domain (attribution not required);
  recommend "Scripture from the Berean Standard Bible (public domain),
  provided by the Free Use Bible API." in Profile → Legal.
  // TODO(31): add this line to Profile Legal.
- Remove the "scripture hydration broken" item from Known Schema Gaps.

---

## 12. Rules

- No new dependencies, no migrations, no UI changes. No `any`.
- Never log verse text, transcript or model output.
- Only BSB. Never call another translation or another Bible API.

Report: books.json date; files created and changed; test results a–g;
grep results; how dev switches are guarded; whether deployed; and every
TODO left for steps 21, 22, 25 and 31.
