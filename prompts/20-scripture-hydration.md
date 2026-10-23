# 20-scripture-hydration.md

Read AGENTS.md first and follow it strictly.

Put the exact Berean Standard Bible (BSB) text into `process-entry`, and add a small second function, `confirm-scripture`, that tries again when the text could not be read. Gemini says only **where** a passage is (a book id, a chapter, verses). The server checks that, reads the chapter from the HelloAO Free Use Bible API, joins the exact verse text and sets `scripture_verified`. Text that cannot be verified is never shown and never stored. Crisis screening is step 21, speech step 22, the app's wiring step 25. No screen changes, no migration, no new package.

**The code already exists.** The old text of this step was a specification written before step 19 was built (it talked about `index.ts`, `functions serve`, environment switches and a deploy by the implementer, and it described HelloAO's data wrongly). So the review of this step wrote the code and proved it offline with Deno: **171 tests pass** (38 for the Bible library, 19 for `confirm-scripture`, 114 for `process-entry`), the whole BSB (31,086 verses) was read through the real parser, 35 deliberate breakages of the code were each caught by a test (section 9), and the real model and the real Bible API were run together on made-up entries (section 4). Nothing is deployed. The work left is in three parts:

- **(a)** the implementer re-runs every check, then runs the real checks on this computer (sections 0, 4 and 9);
- **(b)** you deploy the two functions, two short commands (next section);
- **(c)** the developer panel on your phone checks both functions end to end, and compares the stored passage with the public Bible (next section and section 5).

Sources, read in the review on 2026-10-23:

- https://bible.helloao.org/docs/reference/translations/simplified.html and `/standard.html`, https://bible.helloao.org/api/BSB/books.json, and the whole translation downloaded as `/api/BSB/complete.json` and `/complete.simple.json` (8 MB each) and read verse by verse
- https://bible.helloao.org/ (what it says about keys, limits and caching)
- the code of step 19 (`supabase/functions/`), `ScriptureCard.tsx`, `src/types/index.ts` and `AGENTS.md`
- Deno 2.9.6 through `npx` (nothing is installed)

---

## What you do yourself (read this first)

The implementer cannot do this part: it is your Supabase login and your phone. It is two commands and one tap; if you would rather be walked through it one instruction at a time, say "guide me".

### Keys: nothing new is needed (checked in the review)

The Bible API has **no key, no account and no usage limit**. Both `.env.local` files were checked by name only, never by value:

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set |
| `supabase/functions/.env.local` | `GEMINI_API_KEY` (an `AQ.` key), `GEMINI_MODEL` (`gemini-3.1-flash-lite`), `CLERK_ISSUER` | all set, shapes right |

So there is **no `secrets set` to run** in this step: no secret changed. (The Gemini key is still the free-tier one from step 19: made-up text only, and a key from a billed project before step 25.)

### A. Deploy the two functions

After the implementer has finished sections 0 to 4 it gives you these two commands with your project reference filled in (it is the first part of your Supabase address; it is not a secret). Run them in a VS Code terminal (**Terminal, New Terminal**), from the repo's top folder, one at a time:

```
npx --yes supabase@2.121.0 functions deploy process-entry --project-ref <ref> --use-api
npx --yes supabase@2.121.0 functions deploy confirm-scripture --project-ref <ref> --use-api
```

Each ends with "Deployed Functions on project <ref>: …". `process-entry` is deployed again because its code changed; `confirm-scripture` is new. If a command says you are not logged in, run `npx --yes supabase@2.121.0 login` first, exactly as in step 19 D. If a command shows an error, send the whole message to the implementer. **Tell the implementer "deployed" when both have finished.**

### B. Run the check on your phone

1. Reload the app in Expo Go. In Profile, scroll to **Developer**. If you are signed in as yourself, tap **Sign out (dev)** and sign in as `gracehush17b+clerk_test@example.com` with code `424242` (the test account from step 17; this keeps your own account clean).
2. Tap **Process-entry check (dev)** and wait up to about two minutes. One line appears as each case finishes (`PASS`, `FAIL` or `SKIP`, with the HTTP status and the time). Send a screenshot of all of them.
3. Tap **Sign out (dev)** and sign back in as yourself.

The check leaves a few test entries under the test account (as in step 19). Its older reflections from step 19, which were saved with a Bible reference and no text, are fixed by the check itself, one per run: that is the retry path being proved on real data. Running the check more than twice within ten minutes hits the rate limit (429) on purpose.

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **The simplified chapter format, not the standard one.** HelloAO serves each chapter twice. The standard format splits a verse into parts (`string`, `{noteId}`, `{lineBreak}`, `{text, poem}`) with **no spaces between them**; the old text said to append them, which glues `shepherd;I shall` together and, where a quotation ends in a part of its own, puts the closing quote on its own line (Genesis 3:15 does). The simplified format (`GET /api/BSB/{ID}/{chapter}.simple.json`) gives each verse as one string with the lines of poetry separated by `\n`, and its docs say that is the point ("you don't have to build the text of a verse yourself, which can be non-trivial to get right - especially when it comes to spacing"). The old text also described `wordsOfJesus` and inline-heading parts: neither occurs anywhere in the BSB.
2. **A small whitespace repair on top of it, proven on the whole Bible.** The simplified text has the same letters and marks as the standard text in all 31,086 verses, but 363 of them (1.2%) have spacing defects: a word glued to the sentence before it (`forever.Selah`, `poor?”declares the LORD`, `Red Sea.His loving devotion`), a closing mark on its own line (`heel.\n”`) or after a space (`offspring. ”`). `tidyVerse` fixes exactly that and nothing else. `sweep_check.ts` proves, on every verse, that no letter or mark changes and no defect is left.
3. **A verse exists when the chapter lists it; `numberOfVerses` is not used.** The old text compared the verse numbers with `numberOfVerses`. In 15 chapters that number is the count of verses present, not the highest number (Matthew 17 says 26 and has a verse 27; Mark 9 says 48 and has a verse 50), so a real verse would have been refused. Verses the BSB leaves out (Matthew 17:21, Acts 8:37, …) are absent from the list, and a passage that spans one is invalid.
4. **The model returns only a USFM book id, from one list.** `schema.ts` builds the `book_id` enum from `USFM_BOOK_IDS` in `books.ts`, the same list the checking code uses. On the real model (`gemini-3.1-flash-lite`, made-up entries) all 14 passages came back as real ids that exist in the BSB and fit the entry; a name-and-id variant did no better, so the simpler one is used. The instruction (`gen-v1.1`) asks for a passage whose numbers the model is certain of. `output.ts` checks only the shape (an id from the list, whole numbers); whether the passage exists is for the Bible code, so a wrong verse costs one small request and not a second reflection.
5. **"Invalid" and "unavailable" are different, and only a proven miss is invalid.** Invalid means this passage does not exist: a chapter past the end of the book, a verse the chapter lacks, more than six verses, or more than 1,200 characters. Everything that goes wrong while reading the chapter (a 404, a server error, a timeout, a reply that is not that chapter) is **unavailable**: the old text called a 404 "invalid", which would delete a good reference because of an outage. An unavailable passage is saved as a reference with no text and `scripture_verified` false, and `confirm-scripture` tries again later.
6. **One follow-up request for another passage, and never more.** It sees the reflection's title and feeling and why the first choice failed, never the person's words; one attempt, at most 1,024 output tokens, inside the same 90-second deadline (it is skipped when under 8 seconds are left). In the real check it chose a real passage 5 times out of 5 for about $0.0003. If it fails or also misses, the reflection is saved with **no** passage. A reflection now costs at most three model calls: AGENTS.md says so.
7. **The log never holds the passage, not even the book.** The old text logged `bookId` and `chapter`; AGENTS.md (and the step 19 test) forbid scripture in the log. Two allow-listed fields were added instead: `scripture` (one word: verified, replaced, unverified or dropped) and `bibleMs`. The line has 18 fields now.
8. **No development switches.** `FORCE_SCRIPTURE_REF` and `HELLOAO_BASE_URL` are not built: code that reads an environment variable to change what scripture it serves does not belong in a function that carries prayers. The tests serve real chapters from `_shared/bible/fixtures/` through the same fake `fetch` as everything else, and `live_check.ts` forces a missing passage on the real model. `functions serve` cannot run here (no Docker) and is not used.
9. **`confirm-scripture`** takes `{ entryId }` and answers `{ scripture }`. It never calls the model, so it needs no Gemini secret. Another person's entry and an entry that does not exist both answer the same 404 (`NOT_FOUND`, new in `_shared/errors.ts` only: `process-entry` never answers it, so its contract and the app's 13 codes are unchanged; the new contract has its own five codes). An entry changed in the last minute, or looked up by this instance in the last minute, is answered as it is, because the app asks at most once a minute and the old text's "updated less than 60 seconds ago" alone would not stop a client that keeps asking while the Bible is down (nothing is written then, so nothing changes `updated_at`). A reference that cannot be read, or cannot exist, is removed; a crisis entry has nothing to confirm and is never written to.
10. **The user deploys both functions** (AGENTS.md: the implementer never holds a management token). The old section 10 had the implementer deploy after asking. `confirm-scripture` has its own `deno.json` and its own `[functions.confirm-scripture] verify_jwt = false` in `config.toml`.
11. **No change to any screen.** `ScriptureCard` already shows the text for verified scripture, the reference and "We’re confirming this passage." for unverified scripture, and `ReflectionScreen` draws no card at all when scripture is null (all three were driven in step 11), so the old text's `TODO(25): hide ScriptureCard` has nothing to mark. A psalm's text now has line breaks in it; the card draws them as lines (what the BSB prints), and the iPhone is the first place anyone will see it, in step 25.
12. **No new attribution marker.** The BSB is public domain and `books.json` says `attribution: not-required`; Profile's footer already reads "Scripture quotes from Berean Standard Bible (BSB)." (step 15). Naming the Bible API as well (a nonprofit that takes donations) would be a kindness and is yours to decide; the old text's `TODO(31)` is dropped.
13. **`PROMPT_VERSION` is `gen-v1.1`.** The instruction text changed, so the logs must tell the two apart; `gen-v2` is left for step 32, whose text already uses that name.
14. **The Deno test command names every folder.** Deno scopes test discovery to the folder of the `--config` file, so the old command (`… supabase/functions`) runs only `process-entry`'s tests; it would have skipped the 38 Bible tests without a word. AGENTS.md has the new command.

---

## 0. Before you write code

1. `git status`: the new folders are `supabase/functions/_shared/bible/`, `supabase/functions/confirm-scripture/` and the new files named in section 1. There is no `deno.lock`, and `package.json` and the lockfile are untouched.
2. Read the files in section 1, and `AGENTS.md` (vendor note **HelloAO Free Use Bible API**, `process-entry` requirements 4 and 6, Edge Function Rules). Do not rewrite the review's files; if a check shows one to be wrong, fix it, say so in the report, and update the AGENTS.md text that describes it.
3. Run **Part A of section 9** before changing anything. It must be green.
4. Read `src/components/ScriptureCard.tsx` and the scripture branch of `ReflectionScreen.tsx` and confirm decision 11 (three states, null draws nothing). Report it; add no marker and change no screen.
5. `.env.local` (both files) was checked in the review. Re-check by name only if the user says they changed it.

---

## 1. What the review created (read these; do not rewrite them)

New files under `supabase/functions/`:

| file | what it does |
| --- | --- |
| `_shared/bible/books.ts` | The 66 books: `id` (USFM, from `books.json`), `order`, `name` (its `commonName`), `chapters`, `aliases`. `USFM_BOOK_IDS`, `bookById`, `isUsfmBookId`, `resolveBook` (exact match after lowercasing, dropping dots, and reading `I`/`First`/`1st`/`1john` as `1 john`; no fuzzy matching). Generated from the real `books.json` on 2026-10-23 |
| `_shared/bible/reference.ts` | `ScriptureRef`, `validateRefShape` (book, chapter against the book, verses, at most six), `formatReference` (`Philippians 4:6–7` with an en dash, `Psalm 23:1–3`, `Jude 1:24–25`), `parseReference` (reads that back, plus `Psalms 127:1-2`, `Phil. 4:6-7`) |
| `_shared/bible/helloao.ts` | The only code that talks to the Bible API. `fetchChapter` (the simplified endpoint for BSB only, a 5 s timeout, one retry after 0.5 s, a 2 MB cap, a 64-chapter cache of good chapters only), `parseChapter` (rejects another translation, book or chapter), `tidyVerse` |
| `_shared/bible/hydrate.ts` | `hydrateScripture(ref)`: `verified` (reference and exact text), `invalid` (with a plain note for the follow-up request) or `unavailable` |
| `_shared/bible/fixtures/*.simple.json` | Seven real chapters, trimmed to their verses: Philippians 4, Psalms 23, 46 and 127, Matthew 17 (verse 21 is missing), John 3, Isaiah 41 |
| `_shared/bible/{books,reference,helloao,hydrate}_test.ts` | 38 tests, with exact BSB text asserted for Philippians 4:6–7, John 3:16 and Psalm 23:1–3 |
| `_shared/bible/sweep_check.ts` | By hand: feeds all 31,086 verses through the real parser and the repair (section 4) |
| `process-entry/scripture.ts` | `resolveScripture`: verified, replaced, unverified or dropped; the follow-up request; the Bible time |
| `process-entry/scripture_test.ts` | 17 tests, unit and through the real handler |
| `confirm-scripture/{index,handler,lifecycle}.ts`, `deno.json` | The function (section 2) |
| `confirm-scripture/{handler,lifecycle}_test.ts` | 14 and 5 tests |

Changed:

| file | change |
| --- | --- |
| `_shared/errors.ts` | `NOT_FOUND`, 404, "We couldn’t find this reflection." (shared list only) |
| `_shared/log.ts` | `scripture` and `bibleMs` added (18 fields); the comment says no passage, not even the book |
| `_shared/auth.ts` | `readAuthConfig()` moved here from `process-entry/handler.ts` so both functions read the Clerk settings the same way |
| `process-entry/schema.ts` | `book_id` enum built from `USFM_BOOK_IDS`; `buildScriptureSchema()` for the follow-up |
| `process-entry/prompt.ts` | the passage rule (USFM id, numbers it is certain of), `PROMPT_VERSION = "gen-v1.1"`, `buildReplacementInstruction`, `buildReplacementTurn` |
| `process-entry/output.ts` | `ScriptureRef` with `bookId`; `readScripture` checks the shape only; `parseScripturePick`; `formatReference` now comes from `_shared/bible/reference.ts` |
| `process-entry/gemini.ts` | `generate` adds to the stats of an earlier call (attempts, time, tokens), takes `maxAttempts` and `maxOutputTokens` |
| `process-entry/lifecycle.ts` | `ReadyFields` carry `scripture_reference` (may be null), `scripture_text` and `scripture_verified`; the `TODO(20)` is gone; `dbFailure` is exported |
| `process-entry/handler.ts` | calls `resolveScripture` after a good, non-crisis reply; one stats object for the whole request; the two new log fields |
| `process-entry/response.ts` | `toScripture` exported |
| `process-entry/contracts.ts`, `src/types/index.ts`, `src/types/contractParity.ts` | `ConfirmScriptureRequest`, `ConfirmScriptureResponse`, `ConfirmScriptureErrorCode`, `ConfirmScriptureError`, compared at compile time like the rest |
| `process-entry/testing/fakes.ts` | a Bible host in the fake world that serves the real fixtures (404 for any other chapter) and can be told to fail; `readyOutput` uses `book_id` |
| `process-entry/live_check.ts` | looks up the model's passage in the real Bible, and one case forces a missing passage to see the follow-up request |
| `process-entry/{output,lifecycle,handler,gemini}_test.ts` | updated to the new shape; new cases for the passage |
| `supabase/config.toml` | `[functions.confirm-scripture] verify_jwt = false` |
| `src/components/dev/processEntryCheck.ts` | the phone check: the stored passage is compared with the public Bible API, three `confirm-scripture` cases, and the retry of an older reflection (section 5) |
| `AGENTS.md` | section 6 |

---

## 2. How it works (reference)

**What process-entry stores for the passage** (after a good reply that is not a crisis; a crisis entry returns earlier and never reaches the Bible code):

| the model's passage | stored | log `scripture` | model calls added |
| --- | --- | --- | --- |
| exists | reference, exact text, `scripture_verified` true | `verified` | 0 |
| does not exist; the follow-up passage exists | the follow-up's reference and text, verified | `replaced` | 1 |
| does not exist; the follow-up fails, is blocked, has no time, or misses too | no passage (reference null), the reflection is still `ready` | `dropped` | 1, or 0 with under 8 s left |
| the chapter cannot be read | the reference, text null, verified false | `unverified` | 0 |
| the follow-up passage exists but its chapter cannot be read | that reference, text null | `unverified` | 1 |

Joining: a line break between two verses when either is poetry (the API lists `poem` ranges), a space otherwise; poetry keeps its own `\n` lines. The text is at most 1,200 characters. The devotional never quotes scripture and nothing in it is changed.

**confirm-scripture** (`POST { entryId }`, a lowercase UUID):

| the entry | answer | writes |
| --- | --- | --- |
| no valid token | 401 `UNAUTHORIZED` | none |
| body is not JSON, `entryId` missing or not a UUID | 400 `INVALID_REQUEST` | none |
| someone else's, or does not exist | 404 `NOT_FOUND` (the same body) | none |
| crisis, still being prepared, failed, or no reference | `{ scripture: null }` | none |
| already verified | `{ scripture }` as it is | none |
| changed less than 60 s ago, or looked up less than 60 s ago by this instance | `{ scripture }` as it is (unverified) | none |
| the reference cannot be read, or names a passage that cannot exist | `{ scripture: null }` | reference cleared |
| the Bible cannot be read | `{ scripture }` as it is | none |
| read and good | `{ scripture }` verified | text and flag, only while still ready, not crisis and unverified |

**Time:** a chapter read is at most 5 s plus 0.5 s plus 5 s when the API is down (then the passage is unavailable and no second request is made); with the 90-second model deadline the worst case stays well inside the platform's 150 s. A healthy chapter took 0.5 to 0.8 s from this computer on the first fetch and none after that.

---

## 3. Edits to the existing files

None are left for the implementer: the review made them, and `DevToolsPanel.tsx` needs no change (its "Process-entry check (dev)" button already exists and calls the updated check).

---

## 4. The real checks (the Gemini key from step 19; nothing new)

1. **The model and the Bible together**, on made-up entries only (about $0.006):

```bash
npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json \
  --allow-net --allow-env --allow-read --env-file=supabase/functions/.env.local \
  supabase/functions/process-entry/live_check.ts --show
```

   Each of the three reflections must end `passage verified` with a character count and the verse text printed; the crisis sentence prints no passage; the last case must read `replaced`. In the review: Psalm 127:2 (101 characters), Colossians 3:12 (140), Psalm 34:18 (71), and Philippians 4:24–25, which does not exist, was replaced by Philippians 4:6–7 (227). Keep the lines for the report. A model that stops choosing real passages, or a Bible API that changed, shows up here first.
2. **The whole Bible through the real parser** (a one-time 8.6 MB download; `<scratch>` is any folder outside the repo, written `C:/…` for Deno on this machine):

```bash
curl -o <scratch>/complete.simple.json https://bible.helloao.org/api/BSB/complete.simple.json
npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --allow-read \
  supabase/functions/_shared/bible/sweep_check.ts <scratch>/complete.simple.json
```

   Expected (the review's result): `66 books, 1189 chapters, 31086 verses read`, `363 verses had whitespace repaired; the longest verse is 400 characters`, the 15 chapters that leave verse numbers out, and `every check passed`. If the count of repaired verses or the list of chapters differs, HelloAO changed its data: report it before going on.
3. Report the timings you see (the Bible time per passage, the follow-up request's time and tokens).

---

## 5. Deploy and the hosted check (the user deploys)

1. Print the project reference (the first label of the host in `EXPO_PUBLIC_SUPABASE_URL`; read-only, not a secret), write the two commands of step A with it filled in, and ask: **"Ready for you to deploy process-entry and confirm-scripture?"** The user runs them.
2. After "deployed", prove from this computer that both functions are live and that the platform's JWT check is off (the publishable key is read from `.env.local` and never printed):

```bash
KEY=$(grep '^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' .env.local | cut -d= -f2- | tr -d '\r"')
for FN in process-entry confirm-scripture; do
  URL="https://<ref>.supabase.co/functions/v1/$FN"
  curl -s -i -X POST "$URL" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}'
  curl -s -i -X POST "$URL" -H "apikey: $KEY" -H "Authorization: Bearer aaa.bbb.ccc" -H "Content-Type: application/json" -d '{}'
done
```

   All four must answer **401 with the function's own body** `{"error":{"code":"UNAUTHORIZED","message":"Please sign in again.","requestId":"…"}}`. A body like `{"code":401,"message":"Invalid JWT"}` is the platform's, which means `verify_jwt` is still on for that function: ask the user to deploy again with `--no-verify-jwt` added and report it.
3. The user does step B. Read the screenshot line by line. Expected, in order (the first run; a later run shows `SKIP` for the waiting reflection):
   - `PASS written entry`: ready, 80 to 260 words, 3 affirmations, a reference such as `Psalm 127:1–2` and "verified, N characters"
   - `PASS passage matches the public Bible`: the phone read the same verses from bible.helloao.org and the letters and marks are identical
   - `PASS same id again`
   - `PASS confirm-scripture on a verified reflection`, `PASS confirm-scripture, an entry that does not exist` (404 `NOT_FOUND`), `PASS confirm-scripture, a malformed id` (400 `INVALID_REQUEST`)
   - `PASS confirm-scripture on a reflection waiting for its passage` and `PASS that passage matches the public Bible` (one of the three older reflections from step 19, now verified; the fourth test entry was the crisis one, which has no passage; `SKIP … none is waiting` once all three are done)
   - then the step 19 cases: `PASS text too short`, `text too long`, `someone else's recording`, `audio sent in the body`, `made-up crisis sentence`, `instructions inside the entry`, and `your recording`
4. Ask for a screenshot of the Supabase dashboard, **Edge Functions, process-entry, Logs**, and the same for **confirm-scripture**. Check each line is one JSON line with only the 18 fields in `_shared/log.ts`: `scripture` is one word, and there is no passage, no book, no entry id, no token and no key. Note `bibleMs` from the hosted region.
5. Optional, and only if the user wants to see the "Bible unreachable" path: it cannot be forced on the hosted function (that is why it is proved offline). Say so rather than inventing a test.
6. Troubleshooting:

| what you see | likely cause | what to do |
| --- | --- | --- |
| every line `no answer` | not deployed, the phone is offline, or the wrong project | the dashboard's Edge Functions list must show both functions |
| `FAIL written entry … NOT verified` | the Bible API could not be read from the hosted region, or the chapter changed | the log line: `scripture` `unverified` and a large `bibleMs`; try again in a minute; send both |
| `FAIL … differs from bible.helloao.org` | the stored text is not the API's | report it with the reference; this must never happen |
| `confirm-scripture` `404` for an entry that exists | the entry belongs to another account than the signed-in one | check the account on the phone |
| `500 INTERNAL` | a secret missing, or a table refused a write | the log `reason`: `missing_config:NAME`, `db:<operation>:<code>` |
| `503 AI_UNAVAILABLE` | as in step 19 | see the step 19 table |
| `deploy` fails to resolve `../process-entry/…` from `confirm-scripture` | server-side bundling of imports outside the function's folder | send the whole message; process-entry bundles `../_shared` the same way, so this is unexpected |
| `deploy` fails with a size error | the 5 MB limit of server-side bundling | send the message; a local `deno bundle` was 0.84 MB for `confirm-scripture` (107 modules) and 0.88 MB for `process-entry` |

---

## 6. AGENTS.md updates

**Done in the review** (the code exists, so the document already describes it): the Tech Stack lines (Edge Functions, HelloAO); a vendor note **HelloAO Free Use Bible API** with the facts above (format, defects, `numberOfVerses`, the licence, the real model result, the Deno test-discovery trap); the architecture tree (`confirm-scripture/`, `scripture.ts`, `_shared/bible/`, the dev check); `process-entry` requirements 4 (three model calls), 6 (how scripture is hydrated) and 11 (`NOT_FOUND`); Edge Function Rules (the log fields and the rule about the passage, the `confirm-scripture` rule, deploying each function); and the Linting and Validation commands (the test folders, the second `check`, the sweep).

**Left for the implementer:**

- A **"Step 20 — Scripture hydration"** entry in the Build Status & Decisions Log, newest last: the decisions above, what was built, the measured numbers (the real check per case, the Bible time, the follow-up request, the sweep result, the mutation result), the hosted results (the phone check lines, the logs), what was **not** verified and the open items.
- Correct any line of the review's text that a real check showed to be wrong, in AGENTS.md and in the code together.
- Then copy AGENTS.md to `prompts/AGENTS.md` (identical: `cmp`).

---

## 7. Rules

- No new dependency (the function folders use the two pins already in their `deno.json`), no migration, no policy change, no UI change. No `any`.
- Never log verse text, a reference, a book or a chapter, a transcript or model output. Never store text that did not come from the Bible API for that exact passage. No fallback verse, no hardcoded verse, no text recalled by the model.
- Only the BSB, only the Free Use Bible API; the translation id is a constant and is checked in every reply.
- No environment variable changes what scripture is served.
- **Crisis handling is not changed**: a crisis entry returns before any Bible code runs (a test proves it), and `confirm-scripture` never writes to one. If you are unsure whether a change touches crisis handling, stop and ask.
- The implementer never deploys, never logs in to Supabase and never uses the user's token.

---

## 8. Notes for later steps (reported, not edited: reconcile each at its own review)

- **Step 21** keeps `saveCrisisEntry` clearing the scripture columns (it already does). Screening comes before generation, so nothing here moves.
- **Step 22** puts `spokenReference` in `_shared/bible/reference.ts` (the file exists). A poetry verse has single line breaks inside it: the speech script must read them as a pause or a space, and must not split a verse where its paragraph rule splits on `\n\n`. It reads scripture only when `scripture_verified`, as it says. The `TODO(22)` markers stay (the weekly limit in `handler.ts`, speech in `lifecycle.ts`).
- **Step 25**: `confirmScriptureIfNeeded` matches the function: `{ entryId }` in, `{ scripture: Scripture | null }` out, verified updates the cache, null hides the card, unchanged leaves it. The types exist in `src/types/index.ts`. Its "close the step 20 TODO: ScriptureCard renders nothing for null" has nothing to close (already true, no marker). Its 15 s timeout fits, but not by much when the Bible is down: that case is the API's two tries (about 10.5 s) plus the function's two database reads, so about 13 s; 20 s would be the safer default. A psalm's text has line breaks: look at it on the iPhone then.
- **Step 32**: its text sets `PROMPT_VERSION = 'gen-v2'`, free because this step used `gen-v1.1`; its new instruction must keep the passage rule (a USFM id, one to four verses, numbers it is certain of). Its banned-phrase list can use `BSB_BOOKS[].name` and `.aliases` from `books.ts`. In the review's 14 entries the model chose Philippians 4:6–7 twice and Psalm 127 twice: variety across recent reflections is a step 32 matter.
- **Step 34**: `scripture_verified` in `reflection_ready` is the stored flag; unchanged.
- Still open from step 19: a key from a billed project before step 25, the production Clerk issuer, and `TODO(21)`, `TODO(22)` and `TODO(28)` in the function.

---

## 9. Verify

### Part A: always (no key, no download)

From the repo root. Every command must exit 0.

```bash
D="npx --yes deno@2.9.6"; C="--config supabase/functions/process-entry/deno.json"
$D check --no-lock --node-modules-dir=none $C supabase/functions/process-entry/index.ts supabase/functions/confirm-scripture/index.ts
$D check --no-lock --node-modules-dir=none --config supabase/functions/confirm-scripture/deno.json supabase/functions/confirm-scripture/index.ts
$D lint $C supabase/functions
$D fmt --check --line-width=120 supabase/functions
$D test --no-lock --node-modules-dir=none $C --allow-net --allow-env --allow-read supabase/functions/process-entry supabase/functions/confirm-scripture supabase/functions/_shared
node supabase/tests/process-entry/parity.cjs
node supabase/tests/profile-sync/run.cjs
npm run typecheck
npm run lint
grep -rnE "TEMP\(|TODO: real" src
```

Expected: **171 tests pass**, parity 7 of 7, profile-sync 88 of 88, the release gate still 17 lines (14 `TEMP(` and 3 `TODO: real`), `package.json` and the lockfile unchanged. Then check that the contract comparison still bites: add a field to `ConfirmScriptureResponse` in `contracts.ts` only, see `npm run typecheck` fail in `contractParity.ts`, and restore the file (`cmp`).

Also bundle the new function the way the server will, to see the size (the review measured it):

```bash
$D bundle --no-lock --node-modules-dir=none --config supabase/functions/confirm-scripture/deno.json supabase/functions/confirm-scripture/index.ts -o <scratch>/confirm.js
```

### Part B: the real checks (section 4)

`live_check.ts --show` and `sweep_check.ts`, with the numbers in the report.

### Part C: after the deploy (section 5)

The four curl answers, the phone check line by line, and the two log screenshots.

### Mutation check (the review ran it; re-run it if you change the code)

The review broke the code 35 ways in a scratch copy, one at a time, and demanded that a test fail each time (the whitespace repair, the missing-verse rule, the unavailable-versus-invalid rule, the cache, the retry, the translation and book checks, the en dash, "Psalm", the six-verse limit, the id guard, one attempt for the follow-up, a dropped passage keeping no reference, the title wrapper, the saved flag and text, the stats, the user filter, both one-minute rules, the removal of a missing passage, the update guard, the status code and the log). **Every one is caught by a failing test.** Two things the run taught, worth repeating if you extend it: a breakage that only the type checker notices proves nothing about the tests (four were first caught that way and were redone in a form that compiles), and one survived the first pass, the "only while still unverified" guard of `saveScripture`, which no end-to-end test races: it now has its own tests in `confirm-scripture/lifecycle_test.ts`. The harness is a scratch script of the review (not in the repo); to repeat the idea by hand, copy `supabase/functions` somewhere, change one line, run the Part A test command against the copy, and expect a failure.

### Not verified, and said so

- Any screen with real BSB text (the app shows mock data until step 25), and how a multi-line psalm looks on the iPhone and the emulator.
- The Bible API being down in production (proved offline only; the hosted function cannot be made to fail it).
- How well the model's passages fit over many entries (step 32), and the hosted function's Bible time from its own region (read it from the logs).
- iOS and TalkBack: no UI changed.

---

## 10. Report

Reply with: what changed and where (the files in section 1, and anything you had to fix in the review's text, with the reason); the Part A results with the real test count; the real checks (section 4) with their numbers; the hosted results (section 5): the curl answers, each phone line, the logs; the grep results (`TEMP(` and `TODO: real` count; and `grep -rnE "book_name|Be still|slice\(0, 300\)|FORCE_SCRIPTURE_REF|HELLOAO_BASE_URL" supabase src`, which must find only the one line in `output_test.ts` that proves the old free-text `book_name` shape is refused); what was not verified; the open items; and every `TODO` marker left (`TODO(21)`, `TODO(22)`, `TODO(28)` in the function; none new). Then update AGENTS.md as section 6 says.
