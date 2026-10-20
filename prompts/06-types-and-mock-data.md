# 06-types-and-mock-data.md

Read AGENTS.md first and follow it strictly.

Create the Gracehush data layer: shared TypeScript types that match the Supabase schema, typed mock data covering every state the V1 screens must show, and a small async data-access module that screens will use from step 08 onward. No UI changes except the temporary dev check described at the end.

Where things stand after step 05: sign-in is real (Clerk), `HomePlaceholderScreen` shows the signed-in email and "Sign out (dev)", `src/types/index.ts` holds only `AuthErrorCode` and `AuthResult`, `copy.common` exists, and `expo-crypto` is installed. There is no Supabase client, no migration (step 18) and no Edge Function change (step 19) yet. There is also no `src/constants/app.ts`, no `zustand` and no test runner. Later prompts (07 onward) build on the names defined here, so use them exactly.

## Decisions (made, do not ask me again)

These settle conflicts between this step and the prompts that depend on it. If one turns out to be impossible, stop and tell me instead of picking another.

1. **Contracts match step 19.** The request uses `text` (not `textContent`), `mimeType` and `durationMs`. The error codes are step 19's list. Step 19 then only has to confirm them, not rewrite them.
2. **Durations are milliseconds everywhere** (`devotional_duration_ms`, `durationMs`), as steps 12, 18, 22 and 26 use. AGENTS.md "Known Schema Gaps" already says so.
3. **Audio is a storage path, never a URL.** Step 18 makes `journal_media` private, so the model has `audioPath`. Playback gets a short-lived signed URL in step 26.
4. **Gemini output types are server-only.** `GeminiJournalAnalysis` and `AffirmationItem` are not created on the client. Step 19 defines them next to the Edge Function.
5. **`onboarding_completed_at` and `devotional_voice` are not columns.** Onboarding completion stays on the device (step 07) and the voice is one server-side setting. Do not add them to the types.
6. **Active prayers are listed oldest first**, which is the order the Prayers design shows (24, 11, then 4 days).
7. **Unverified scripture has no text.** `Scripture.text` is `null` unless `verified` is true, so a screen cannot render an unverified verse by accident.
8. **`mockDb` holds the profile too.** Step 15 (`updateProfile`) and step 16 (the purchase mock changes the tier) mutate it, so the profile cannot be a constant beside it.
9. **A `pending` or `uploading` row is local-only.** The mock rows are DB-shaped and have no "local" column, and AGENTS.md says a new entry is saved on the device first (status `pending`). The mapper therefore sets `isLocalOnly` from the status. Step 24 builds local-only entries from its outbox and may replace this rule.
10. **`PlanUsage.limit` is `FREE_DEVOTIONALS_PER_WEEK` (3) for `free` and `null` for `trial` and `pro`**, because steps 22 and 25 treat both paid tiers as unlimited.
11. **Models are plain JSON.** Step 24 stores the mapped `JournalEntry` as JSON in SQLite, so: ISO strings for dates, `null` (never `undefined`) for missing values, no `Date`, `Map` or functions inside a model.
12. **`JournalEntry` carries `updatedAt`.** Step 24's cache keeps `updated_at` for each entry and step 33 compares it to decide which copy is newer, so the model needs it.

## Design references (copy, counts and durations only)

Take every string for the mocks from the Stitch HTML, which holds the exact text, and copy it character for character (the HTML uses curly apostrophes, for example "Mom’s"). The PNGs are 1.25x renders of the same screens (identical copies are in `Images/`) and are not used for measuring in this step. The Journal PNG shows card text already cut by the 2-line clamp, and the HTML holds the longer text, so never take a string from a PNG.

| What                                                                                                                                                                                                                  | Files                                                                         |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Journal entries 1–3 (timestamps, emotion, transcript opening, scripture reference, duration), the morning affirmation, the "5 days of reflection" chip                                                                | `prompt_material/03-journal-home.html`, `prompt_material/03-journal-home.png` |
| Devotional title "Peace in the Midst", its two script paragraphs, the three affirmation headlines, the closing prayer, the scripture card, "1 min"                                                                    | `prompt_material/05-reflection.html`, `prompt_material/05-reflection.png`     |
| The three active prayers (category, title, summary, reference, "24 / 11 / 4 days"), the three answered prayers (title, note, reference, "Answered on … / After N days"), "17 petitions recorded", Active 5, Answered 12 | `prompt_material/06-prayers.html`, `prompt_material/06-prayers.png`           |
| "Member since October 2026", "2 of 3 audio devotionals used this week", the reminder times, "Soft Rain, 50% Volume"                                                                                                   | `prompt_material/07-profile.html`, `prompt_material/07-profile.png`           |

If the HTML and this prompt disagree on a string, use this prompt and tell me.

## 0. Get the real schema first

Do this before anything else in this step. The mirror must match the live tables, so do not guess a column.

1. Look for `supabase/schema.sql`. It does not exist in this repo today.
2. If it is missing and I have not already pasted the result of the query below in this conversation, **stop and ask me** to run it in the Supabase SQL editor and paste the result. If I did paste it, use it and do not stop:

   ```sql
   select table_name, column_name, data_type, udt_name, is_nullable, column_default
   from information_schema.columns
   where table_schema = 'public'
     and table_name in ('users_profile', 'journal_entries', 'daily_affirmations')
   order by table_name, ordinal_position;
   ```

   A text column is typed `string`. If `udt_name` shows a Postgres enum (anything other than a built-in type such as `text`, `uuid`, `timestamptz`, `time`, `bool`, `int4`, `float4` or `vector`), ask me for its values before typing that column.

3. Names other prompts expect to exist already (verify each, the real schema wins and you report every difference):
   - `journal_entries`: `id`, `user_id`, `created_at`, `input_type`, `transcript`, `dominant_emotion`, `scripture_reference`, `scripture_text`, `devotional_script`, `devotional_audio_url`, `is_active_prayer`, `is_answered`, `answered_at`, `embedding`. The answered-prayer note may already exist as `answered_notes` or `answered_note`.
   - `daily_affirmations`: `id`, `user_id`, a link to the entry (`entry_id` or `journal_id`), `time_slot`, `headline`, `affirmation_text`, `created_at` (steps 19 and 25 use these names). Step 28 also mentions `is_delivered`.
   - `users_profile`: `id` (a Clerk user id, type `text`), `created_at`, `subscription_tier`, `reminder_morning`, `reminder_afternoon`, `reminder_evening`, `last_active_at`.

   Mirror every real column, including ones this prompt does not name (such as `is_delivered`). If a planned column from section 1 already exists under another name, use the real name in the row type and the mapper, keep the model field name, and report it.

## Folder additions

AGENTS.md does not list these folders or files. Add them to its Architecture tree (see "AGENTS.md updates").

```txt
src/data/
  mock/            # typed mock rows (DB shape), the mutable mockDb, dates.ts and the scenario switch. Dev/preview only
  mappers.ts       # DB row (snake_case) → app model (camelCase)
  journalRepository.ts  # async data access used by screens (mock now, real later)
  selectors.ts     # pure derived values (counts, streak, current slot)
src/utils/
  format.ts        # pure date/time/duration/name formatters
src/constants/
  app.ts           # FREE_DEVOTIONALS_PER_WEEK and WEEK_STARTS_ON (later steps add more)
```

`src/constants/app.ts` starts with exactly this (step 22 mirrors it on the server, and later steps append their own constants to the file):

```ts
// Keep in sync with supabase/functions/_shared/limits/constants.ts (step 22).
export const FREE_DEVOTIONALS_PER_WEEK = 3;
export const WEEK_STARTS_ON = 1; // Monday
```

## 1. Database row types (`src/types/database.ts`)

Hand-write row types that mirror the schema from step 0 **exactly** (snake_case, nullable where the column is nullable, ISO strings for `TIMESTAMPTZ`, `"HH:mm:ss"` strings for `TIME`). Columns that hold a known set of values (`processing_status`, `subscription_tier`, `ambient_sound`, …) stay `string` in the row type, like the types step 18 generates, and the mappers narrow them. Put this at the top: `// Hand-written until step 18. Step 18 generates src/types/supabase.ts and this file then re-exports the row types from it.`

- `UserProfileRow`, `JournalEntryRow` (every column except `embedding`, which is V2: omit it entirely) and `DailyAffirmationRow`.

Then add the **planned columns** as optional nullable fields, each group under a `// planned: migration in step 18` comment. These are AGENTS.md "Known Schema Gaps" plus what step 18 adds. Skip any that step 0 shows already exist.

- `JournalEntryRow`: `client_entry_id`, `processing_status`, `error_code`, `is_crisis`, `audio_path`, `devotional_audio_path`, `devotional_duration_ms`, `scripture_verified`, `devotional_title`, `closing_prayer`, `prayer_title`, `prayer_category`, `prayer_summary`, `answered_notes`, `updated_at`
- `UserProfileRow`: `timezone`, `ambient_sound`, `ambient_volume`, `affirmations_enabled`, `updated_at`
- `DailyAffirmationRow`: `is_favorite`, `scheduled_for`

`devotional_audio_url` is the old public URL column. Keep it in the row type as nullable and mark it `// DEPRECATED: use devotional_audio_path (step 22)`.

Do not create any migration. Do not touch the `supabase/` folder.

## 2. App models and contracts (`src/types/index.ts`)

Keep the existing `AuthResult` / `AuthErrorCode`. Add these camelCase types (no `any`, prefer unions over `string` where the values are known):

```ts
type TimeSlot = "morning" | "afternoon" | "evening";
type InputType = "text" | "audio";
type SubscriptionTier = "free" | "trial" | "pro";
type ProcessingStatus = "pending" | "uploading" | "processing" | "ready" | "failed";
type EmotionKey = "anxious" | "weary" | "grateful" | "grieving" | "hopeful";
type AmbientSound = "off" | "soft-rain" | "gentle-piano" | "morning-birds";
type PrayerCategory =
  | "FAMILY & HEALING"
  | "VOCATION & CALLING"
  | "INNER PEACE"
  | "RELATIONSHIPS"
  | "PROVISION"
  | "GUIDANCE";

// Used by every repository write added in steps 14, 15, 17, 25 and 29. Step 17 adds "UNAUTHORIZED".
type RepoResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: "NOT_FOUND" | "INVALID" | "NETWORK" | "UNKNOWN"; message: string };
```

Models:

- `UserProfile`: `id`, `createdAt`, `subscriptionTier`, `reminders: Record<TimeSlot, string>` (`"HH:mm"`), `timezone`, `ambientSound`, `ambientVolume` (0–1), `affirmationsEnabled`. The display name and email stay in Clerk.
- `Scripture`: `reference` (e.g. "Philippians 4:6–7"), `text: string | null`, `translation: "BSB"`, `verified: boolean`. When `verified` is false, `text` is `null`.
- `Devotional`: `title: string`, `script: string` (plain text, paragraphs separated by a blank line), `closingPrayer: string | null` (stored without the final "Amen", step 11 shows it), `audioPath: string | null` (a storage path, never a URL), `durationMs: number | null`
- `Affirmation`: `id`, `entryId`, `slot`, `headline`, `text`, `isFavorite`
- `Prayer`: `id` (the journal entry id: a prayer lives on its entry), `title`, `category: PrayerCategory | null`, `summary`, `scriptureReference: string | null`, `createdAt` (the entry's `created_at`), `isAnswered`, `answeredAt: string | null`, `answeredNote: string | null`
- `JournalEntry`: `id`, `clientEntryId: string | null`, `createdAt`, `updatedAt`, `inputType`, `transcript: string | null` (null while an audio entry has not been transcribed), `dominantEmotion: string | null` (the raw lowercase AI string, null for crisis, pending, processing and failed entries), `status: ProcessingStatus`, `isCrisis`, `scripture: Scripture | null`, `devotional: Devotional | null`, `prayer: Prayer | null`, `failureCode: StoredErrorCode | null`, `isLocalOnly: boolean`
- `PlanUsage`: `tier`, `used`, `limit: number | null` (null for unlimited), `resetsAt` (ISO string)

Rules: `scripture`, `devotional` and `prayer` are `null` for crisis, pending, uploading, processing and failed entries. A crisis entry never has affirmations. Models are plain JSON (decision 11).

Edge Function contracts. Put `// Keep in sync with supabase/functions/process-entry/contracts.ts (step 19)` above them:

```ts
type AudioMimeType = "audio/mp4" | "audio/m4a" | "audio/x-m4a" | "audio/aac";

type ProcessEntryRequest =
  | { clientEntryId: string; inputType: "text"; text: string }
  | {
      clientEntryId: string;
      inputType: "audio";
      audioPath: string;
      durationMs: number;
      mimeType: AudioMimeType;
    };

// HTTP statuses for these are defined in step 19.
type ProcessEntryErrorCode =
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "LIMIT_REACHED" // opens the Paywall (step 22)
  | "METHOD_NOT_ALLOWED"
  | "ALREADY_PROCESSING"
  | "PAYLOAD_TOO_LARGE"
  | "TOO_SHORT"
  | "AUDIO_NOT_FOUND"
  | "NO_SPEECH"
  | "CONTENT_BLOCKED"
  | "RATE_LIMITED"
  | "INTERNAL"
  | "AI_UNAVAILABLE";

// What `error_code` can hold. TTS_FAILED is stored only: the entry is still ready as text (step 22).
type StoredErrorCode = ProcessEntryErrorCode | "TTS_FAILED";

interface ProcessEntryError {
  error: { code: ProcessEntryErrorCode; message: string; requestId: string };
}

// A crisis entry comes back with `affirmations: []`. Steps 19, 21 and 22 add fields (the 402 body, signed audio URL).
type ProcessEntryResponse = { entry: JournalEntry; affirmations: Affirmation[] };
```

**Recommendation (apply it):** audio is sent as an uploaded storage path, not base64 in the request body (AGENTS.md fix #8, save raw audio first). `clientEntryId` makes retries idempotent, so an offline entry that syncs twice never creates two rows.

## 3. Mappers (`src/data/mappers.ts`)

Pure, typed functions: `toUserProfile(row)`, `toJournalEntry(row)`, `toAffirmation(row)`, `toPrayer(row)`. They never throw on a missing optional field or an unrecognised value: they fall back to the safe default.

- Trim `"HH:mm:ss"` to `"HH:mm"`.
- `scripture`, `devotional` and `prayer` exist only when the row is `ready` and not a crisis. Otherwise they are `null`, whatever the row holds.
- `scripture`: only when `scripture_reference` is set. `verified` is `row.scripture_verified === true`, and `text` is `row.scripture_text` only when `verified`, otherwise `null`. This also covers old rows from before step 18, which have no verified flag.
- `devotional`: only with a `devotional_script`. `audioPath` is `devotional_audio_path`, else the part of `devotional_audio_url` after `/storage/v1/object/public/journal_media/` (only when the URL has that prefix: the same backfill step 18 does), else `null`. `durationMs` is `devotional_duration_ms` or `null`. `closingPrayer` is `closing_prayer` or `null`. If `devotional_title` is missing, use `copy.common.defaultDevotionalTitle`.
- `prayer` (via `toPrayer`): when `is_active_prayer` or `is_answered` is true (`is_active_prayer` means "tracked as a prayer", and an answered prayer may or may not keep it). `title` and `summary` fall back to `''`, and `category` (an unrecognised string becomes `null`) and `scriptureReference` to `null`. `isAnswered` is `row.is_answered === true`, and the answered fields are `null` while it is unanswered.
- `dominantEmotion` is `null` for a crisis row even if the row holds a value (step 19's safety net writes one, step 21 clears it).
- `failureCode` is `error_code`. A ready entry can carry `TTS_FAILED`.
- `isLocalOnly` is true when the status is `pending` or `uploading` (decision 9). `updatedAt` is `updated_at`, else `created_at`.
- Planned columns may be missing. Use safe defaults: `is_crisis` → `false`, `processing_status` → `'ready'`, `ambient_sound` → `'off'`, `ambient_volume` → `0.5`, `affirmations_enabled` → `true`, `timezone` → the device timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone` (`'UTC'` if that is undefined). An unrecognised `subscription_tier` becomes `'free'` and an unrecognised `input_type` becomes `'text'`.

## 4. Mock data (`src/data/mock/`)

Author mocks as **row types** (DB shape), then expose them through the mappers. That proves the mappers work before real data arrives. Rows must respect the rules step 18 will enforce: a crisis row has no `devotional_script`, no `devotional_audio_path` and no `scripture_reference` (step 21 also nulls its emotion, title, closing prayer, scripture text, duration and prayer fields, and sets `scripture_verified` and `is_active_prayer` to false); `prayer_summary` is at most 200 characters; `prayer_category` is one of the union values; `devotional_duration_ms` is never negative; `client_entry_id` is a UUID or null. Every entry and affirmation row has `user_id` `user_mock_sarah`. Ids are stable, readable strings (for example `entry-anxious-yesterday`), so a later step can open a known entry. `dominant_emotion` holds the lowercase `EmotionKey` (`anxious`), and screens capitalize it. Every profile and entry row has `updated_at` (its `created_at` or later).

**Dates:** all timestamps are generated relative to "now", so labels like "Yesterday" stay correct every day, with two helpers in `mock/dates.ts`: `daysAgo(days, hour, minute)` and `minutesAgo(minutes)`. Use local calendar arithmetic (`new Date(year, month, date - days, hour, minute)`), not 24-hour blocks, so a daylight-saving change cannot move an entry to another day. Entries from today (4, 5 and the offline extras) use `minutesAgo` (for example 40, 12, 3 and 1), so they are never in the future. Never hardcode calendar dates.

**Mutable store (`mock/db.ts`):** keep the rows in one module-level `mockDb` with three parts: `profile` (one `UserProfileRow`), `entries` and `affirmations`. It is built by `buildFixtures(now)`, never at import time. `getMockDb()` returns it and rebuilds it whenever `getMockScenario()` differs from the scenario it was built for, so it keeps working when step 09 moves the scenario setting into a Zustand store. The repository always reads through `getMockDb()`, and only code inside `src/data/` imports it. Steps 14 (Mark Answered), 15 (`updateProfile`) and 16 (the purchase mock changes the tier) mutate it, so changes show across screens for the rest of the session.

**User** (`users.ts`): id `user_mock_sarah` (Clerk-style), `created_at` `2026-10-01T12:00:00.000Z` (the one fixed date allowed, at noon UTC so the month reads "October" in every time zone), tier `free`, reminders 08:00:00 / 13:00:00 / 20:00:00 (`TIME` strings), ambient `soft-rain` at 0.5, affirmations enabled, timezone the device's. There is no mock Clerk user: Journal Home and Profile read the real one (steps 09 and 15). Some mock entries are older than this account. The design has the same mismatch ("Member since October 2026" beside a prayer answered on Aug 29), so do not reconcile it.

**Journal entries** (`entries.ts`). Include these, with the copy from the design HTML. Write every transcript in full: the HTML gives only its opening (drop the trailing "…", then add one or two sentences), so the card's 2-line clamp truncates for real. Audio entries that did not finish (4 and 6) have `transcript: null`, because audio is transcribed only on success.

1. Yesterday 8:45 PM, audio, **Anxious**, Philippians 4:6–7, devotional "Peace in the Midst", `devotional_duration_ms` 75000, active prayer. Transcript: "Lord, work has been so overwhelming lately and I feel like I'm dropping every ball. Help me remember where my peace comes from. I woke up with my heart pounding and I just need to breathe." (The Journal card and the Reflection snippet continue the first sentence differently, so this uses both.) Devotional script: the two paragraphs from the Reflection HTML, separated by a blank line. Closing prayer: the Reflection HTML's, without the final "Amen." (step 11 adds it). Give it its own prayer title, category and summary.
2. 3 days ago 7:15 AM, audio, **Weary**, Matthew 11:28–30, 88000 ms. Opening: "Just feeling exhausted down to my bones this morning. Give me strength for the tasks today and quiet my restless thoughts."
3. 5 days ago 9:20 PM, text, **Grateful**, Psalm 103:1–5, 58000 ms. Opening: "Thank you for the unexpected kindness from my sister today. It felt like cool water in the desert after such a dry week."
4. Today, audio, status `processing`, `transcript: null` (no scripture, devotional or prayer)
5. Today, text, status `pending`, with its transcript (the offline "Waiting to sync" card)
6. 2 days ago, audio, status `failed`, `error_code: 'AI_UNAVAILABLE'`, `transcript: null`
7. 4 days ago, audio, **Hopeful**, a fitting passage, devotional present but `devotional_audio_path: null`, `devotional_duration_ms: null` and `error_code: 'TTS_FAILED'` (status stays `ready`; the text still shows)
8. 6 days ago, **crisis** entry: `is_crisis: true`, `dominant_emotion: null`, no scripture, devotional, prayer or affirmations. The transcript is gentle and non-graphic, for example "I don't know how much longer I can keep carrying all of this. Everything feels too heavy." Never mention methods or self-harm details.

Entries 4, 5, 6 and the offline extras have a `client_entry_id` (fixed UUID v4 strings, as step 19 requires). The other rows leave it null, like rows from before step 18. Ready entries with audio use a mock path in step 18's layout, `user_mock_sarah/devotionals/<entry id>.mp3`. Playback is mocked in steps 11 and 12, so no file needs to exist.

**Reflection days.** The count must be exactly 5, counting local calendar days. Ready, non-crisis entries must exist on each of days −1 to −5 and on **none** of day −6 (the crisis entry is the only entry on that day, which is what stops the count at 5). Today has only the processing and pending entries, so the chain ends yesterday:

| Day | Counts as a ready day because                                                                        |
| --- | ---------------------------------------------------------------------------------------------------- |
| −1  | entry 1                                                                                              |
| −2  | one extra ready active-prayer entry (the `failed` entry 6 also falls on this day and does not count) |
| −3  | entry 2                                                                                              |
| −4  | entry 7, plus the INNER PEACE prayer below                                                           |
| −5  | entry 3                                                                                              |

**Prayers.** Prayer data lives on journal entries (`is_active_prayer` plus the prayer fields). A tracked prayer has `is_active_prayer: true`, and an answered one also has `is_answered: true`, `answered_at` and a note in the answered-note column (the real name from step 0). Add prayer-only entries so that exactly **5 active** and **12 answered** prayers exist, matching the Prayers design ("17 petitions recorded"). Together with entries 1–8 that makes exactly **24 entries** in the default scenario: add no others. Entry 1 is one of the five active prayers. A prayer-only entry is a complete ready entry, because it also appears in the Journal feed and opens Reflection: an emotion, a one or two sentence transcript, a scripture reference with verified BSB text, a short devotional title, a devotional of two short paragraphs (about 50 words in all), a one-sentence closing prayer, a `devotional_audio_path` and a duration between 45000 and 90000 ms. The three active prayers from the design come first (take each summary, the text under the title, from the HTML):

- FAMILY & HEALING, "Mom’s recovery and peaceful transition", Psalm 91:4, started 24 days ago
- VOCATION & CALLING, "Patience in daily work responsibilities", Colossians 3:12, 11 days ago
- INNER PEACE, "Restful sleep through anxious evenings", Proverbs 3:24, 4 days ago

The fifth active prayer is the day −2 entry above.

The 12 answered prayers are entries created 8 to 120 days ago (never within the last 7, so they cannot change the 5-day count). Each has `answered_at` after its `created_at`, a category (vary them), a scripture reference and a one-sentence gratitude note (warm, no emojis). The first three are the design's: take the title, note and reference from the HTML and use these ages, so "Answered on …" and "After N days" come out as in the design.

| Title                                | Reference        | Created     | Answered                     |
| ------------------------------------ | ---------------- | ----------- | ---------------------------- |
| Clarity on family caregiving choices | Philippians 4:19 | 40 days ago | 22 days ago (after 18 days)  |
| Peace during quarterly review        | Isaiah 26:3      | 68 days ago | 36 days ago (after 32 days)  |
| Healing from season of exhaustion    | Psalm 23:2       | 63 days ago | 56 days ago (after 7 days)   |

Write the other nine yourself, answered between 3 and 90 days ago.

**Affirmations** (`affirmations.ts`): three rows tied to entry 1 ("Tied to yesterday's prayer"), created with that entry:

- morning (Journal and Reflection HTML): headline "You are held, not hurried" / text "Give yourself permission to breathe slowly today. The burden you carry is already witnessed and held with gentle hands." `is_favorite: false`
- afternoon: headline "Cast your cares like pebbles into quiet water" (Reflection HTML, Affirmations tab)
- evening: headline "Sleep is an act of trust" (Reflection HTML, Affirmations tab)

Store the headlines without a trailing period (the Journal card has none). Write the afternoon and evening texts yourself, 12 to 30 words each, in the same calm voice. Keep all three general: affirmations appear on the lock screen (AGENTS.md Notification Rules), so they never mention the entry's specifics, such as work.

**Plan usage** (`getUsage()`): free tier, `used` 2 and `limit` `FREE_DEVOTIONALS_PER_WEEK`, the design's "2 of 3 audio devotionals used this week". This is fixed mock data, not counted from the entries, because the entries would give a different number on each weekday. `resetsAt` is next Monday 00:00 local (`WEEK_STARTS_ON`; when today is Monday it is the Monday a week away). When the mock profile's tier is `trial` or `pro`, return `{ used: 0, limit: null }` (decision 10).

### Scripture text (non-negotiable)

Do **not** write verse text from memory. For every reference in the mocks, fetch the exact BSB text from HelloAO: `https://bible.helloao.org/api/BSB/{BOOK_ID}/{chapter}.json`, with three-character USFM book IDs such as `PHP`, `MAT`, `PSA`, `COL`, `PRO`, `ISA` and `1PE` (this pattern was checked and returns 200; the 66 IDs are listed at `https://bible.helloao.org/api/BSB/books.json`). The JSON has a `chapter.content` array. Its `type: "verse"` items have a `number` and a `content` array, and each item of that array is **either a plain string or an object**:

- a plain string is verse text: keep it.
- `{ "text": "...", "poem": 1 }` is one line of poetry (all of the Psalms and Proverbs, and some of Matthew): keep its `text`.
- `{ "noteId": 3 }` is a footnote marker and `{ "lineBreak": true }` is a line break: drop both.
- any other shape: stop and show it to me instead of guessing.

Keep the pieces of the requested verse range, join them with single spaces, and trim. Never keep only the plain strings: that returns an empty verse for the poetry. Never save an empty `scripture_text` as verified. Keep the text exactly as the BSB gives it, including a quote mark that opens or closes outside the range (Matthew 11:30 ends with a closing curly quote). Write ranges with an en dash ("Philippians 4:6–7"), as the HTML does. Paste the exact text with `scripture_verified: true` and add a comment with the source URL. Keep the download script and the fetched JSON in a temp folder outside the repo.

If you cannot fetch a reference, set `scripture_text: null` and `scripture_verified: false`, and tell me which references. Never put placeholder text in `scripture_text`, and never mix wording from other translations.

Known checks (taken from the API): Philippians 4:6–7 ends "…the peace of God, which surpasses all understanding, will guard your hearts and your minds in Christ Jesus." The Reflection design says "comprehension", but the design is placeholder, so the real BSB text wins: confirm it from your fetch and report it. Psalm 91:4 reads "He will cover you with His feathers; under His wings you will find refuge; His faithfulness is a shield and rampart." If yours comes out empty, you dropped the `poem` objects.

### Scenario switch (`mock/scenario.ts`)

**Recommendation (apply it):** export `type MockScenario = 'default' | 'empty' | 'offline'`, `getMockScenario()` and `setMockScenario(scenario)`, backed by an in-memory dev setting (default `'default'`). Step 09 moves the setting into a Zustand dev store and keeps both function names, so mark them `// TEMP(09): moves to src/store/devStore.ts, keep the signatures`.

- `'empty'`: no entries, prayers or affirmations.
- `'offline'`: all the default entries, plus two extra `pending` text entries from today (the newest), each with its transcript. The mapper marks them local-only. Screens read this scenario as the signal to show the offline banner until real connectivity arrives in step 24. Pending entries never count toward the reflection days.
- Gate both functions with `__DEV__`, so production builds always use `'default'` until real data replaces the mocks.

## 5. Data access (`src/data/journalRepository.ts`)

Async functions only, each returning app models and resolving after about 300ms in dev (`__DEV__`) to simulate loading. They read through `getMockDb()` and always return freshly mapped objects, never the rows, so a screen cannot change `mockDb` by accident:

```ts
getProfile(): Promise<UserProfile>
getUsage(): Promise<PlanUsage>
listEntries(): Promise<JournalEntry[]>             // newest first, every status included
getEntry(id: string): Promise<JournalEntry | null>
listPrayers(): Promise<Prayer[]>                   // the `prayer` of every mapped entry that has one (so a prayer never disagrees with its entry), newest first. Step 14 selectors filter and sort
listAffirmationsForEntry(entryId: string): Promise<Affirmation[]>  // ordered morning, afternoon, evening
getLatestAffirmations(): Promise<Affirmation[]>    // from the newest ready, non-crisis entry, same order
```

Mark the file `// TEMP(17/24/25/29): internals move to Supabase and the SQLite cache. Keep the names and argument order; those steps widen some return types to RepoResult.` Do not add write functions yet. Each feature step adds its own.

## 6. Selectors and formatters

`src/data/selectors.ts` (pure, take `now: Date` as a parameter for testability; "days" are local calendar days, never 24-hour blocks):

- `getCurrentSlot(now, reminders)`: the most recent slot whose time has passed. Before the morning time, use the evening slot.
- `getAffirmationForSlot(affirmations, slot)` → `Affirmation | null`
- `getReflectionDays(entries, now)`: consecutive local days with at least one `ready`, non-crisis entry, ending today or yesterday, otherwise `0`. Crisis, failed, processing and pending entries do not count, and nothing negative is ever surfaced.
- `getPrayerCounts(prayers)` → `{ active, answered, total }`
- `getDaysSince(iso, now)`: whole days, never negative (a prayer started yesterday at 11 PM is 1 day old at 1 AM)
- `getGreeting(now)` → `'morning' | 'afternoon' | 'evening'` (5–11, 12–16, otherwise evening)

`src/utils/format.ts`:

- `formatEntryTimestamp(iso, now)` → "Yesterday, 8:45 PM", "Today, 7:02 AM", or "Oct 21, 7:15 AM" (with the year, "Oct 21, 2025, 7:15 AM", when it is not now's year)
- `formatDuration(ms)` → "1:15" for 75000, "0:58" for 58000 (milliseconds, matching `durationMs`; rounds to the nearest second, does not cap the minutes, and gives "0:00" for zero, negative or non-finite input)
- `formatTime12(hhmm)` → "8:00 AM" (accepts "HH:mm" and "HH:mm:ss")
- `formatLongDate(now)` → "Thursday, October 24"
- `formatShortDate(iso)` → "Oct 21" (`formatEntryTimestamp` builds on it, and steps 09 and 14 reuse it)
- `formatMonthYear(iso)` → "October 2026" (used for "Member since", and for the Prayers month groups in step 14)
- `getDisplayName({ firstName, email })` → `string | null`. Use `firstName` when it has text. Otherwise take the email's local part up to the first `.`, `_`, `-`, `+` or digit, capitalize it, and accept it only if it has at least two letters (`sarah.j92@x.com` → "Sarah", `x92@x.com` → `null`). It never returns an email address. Callers pick their own fallback (Journal Home shows no name, Profile shows "Friend"). Email-only sign-ups have no first name, so this matters.
- `getInitials({ firstName, lastName, email })` → `string | null`: "SJ" from first and last name, one letter from the first name, otherwise the first letter of `getDisplayName`, otherwise `null`.

Use `Intl.DateTimeFormat` / `toLocaleString` with `en-US` for month and weekday names, but build the clock part by hand, as `formatTime12` does, instead of using `toLocaleTimeString`: some devices' ICU versions put a narrow no-break space (U+202F) before AM/PM, and the two formatters would then disagree. Do not install a date library. If you believe one is necessary, ask me first. The words "Today" and "Yesterday" come from `copy.common` (`today`, `yesterday`), and the fallback devotional title from `copy.common.defaultDevotionalTitle` ("Your devotional"). Add those three strings.

**Recommendation (apply it):** replace the onboarding step's local time formatting from step 03 (the `formatTime` function in `src/screens/onboarding/OnboardingScreen.tsx`) with `formatTime12` so formatting lives in one place. Do not change its look.

## Privacy rules

- Never `console.log` transcripts, prayers or devotional text, even in mocks. Log only ids and statuses in `__DEV__`.
- Mock content stays gentle and non-graphic. Use no real people's names other than the fictional Sarah.

## Rules

- No UI work besides the dev check below. No Zustand, SQLite, Supabase or network calls except the one-time HelloAO lookup while authoring mocks.
- No new libraries.
- No `any`. Every mock array is typed against its row type, so a missing column is a type error.
- Screens never import from `src/data/mock/`. They go through `journalRepository`.

## Verify

Temporarily render a small dev summary on `HomePlaceholderScreen`, below the signed-in email, marked `// TEMP: data check — moves into DevToolsPanel in 08`. Load it through `journalRepository` in an effect that depends on the scenario, which you keep in local state, initialised once from `getMockScenario()` (do not read it again during render: the React Compiler memoizes render). Make the screen scrollable (a `ScrollView` with `contentContainerStyle`, per AGENTS.md) so the summary stays reachable at 320dp and font scale 1.3. It shows these lines, and the numbers are what the default scenario must produce:

```txt
scenario: default
entries: 24 (ready 20, processing 1, pending 1, failed 1, crisis 1)
reflection days: 5
prayers: active 5 · answered 12 · total 17
current slot: <slot> → "<headline>"
plan: 2 of 3 (free)
scripture verified: 20/20
first card: Yesterday, 8:45 PM · anxious · Philippians 4:6–7 · 1:15
format: 1:15 · 0:58 · 8:00 AM · 1:00 PM · October 2026
names: Sarah | SJ, Sarah (from sarah.j92@example.com), none (from x92@example.com)
```

`first card` is the newest ready entry run through the repository and the formatters (the same values as the first card in the Journal design). `format` runs fixed inputs (75000, 58000, "08:00", "13:00" and the mock user's `created_at`) through the formatters. `names` runs fixed sample inputs, never the signed-in email. `current slot` shows `none` when there is no affirmation. Never show transcripts.

Add three small dev buttons to switch the scenario (`default`, `empty`, `offline`), styled like the existing "Sign out (dev)" button (a `Pressable` with the classes on an inner `View`). Confirm that the numbers change accordingly: `empty` shows `entries: 0`, prayers `0 · 0 · 0`, `reflection days: 0` and `current slot … → none`, and `offline` shows `entries: 26` with pending 3 while the reflection days stay 5.

```bash
npm run lint
npm run typecheck
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Then run the dev check on the Android emulator in Expo Go as AGENTS.md "Verifying on this machine" describes (sign in with an address like `yourname+clerk_test@example.com` and the code `424242`), also at 320dp, and ask me to confirm it on my iPhone, where my own Metro hot-reloads your changes.

Fix every error before finishing. When done, list each file created or changed, every scripture reference with its verified status and source URL, any field in the screenshots the types could not represent, and any schema mismatch you noticed against step 0. Do not report these known gaps, they are decided: the raw recording length ("0:45") and the emotion chip on the Journal's offline card (step 09 drops both), "Offline Reflections: 2 synced, 0 pending" on Profile (step 15 replaces it), "Devotional Voice" on Profile (decision 5), and the 1:28 total on the Reflection player against 1:15 on the Journal card (the Journal's value is used).

## AGENTS.md updates

Two corrections were already made before this step, so do not redo them: "Known Schema Gaps" (in milliseconds, without `onboarding_completed_at` and `devotional_voice`) and the shared-contracts sentence under "TypeScript Rules".

Make these changes, replacing any text they supersede:

- Architecture tree: add `src/data/`, `src/utils/` and `src/constants/app.ts` as in "Folder additions" above (and add `app.ts` to the `src/constants/` line), and update the `src/types/` line to say it holds `index.ts` (models and contracts) and `database.ts` (row types, hand-written until step 18).
- State Management Rules: add a short "Data layer" paragraph. Screens read data only through `src/data/journalRepository.ts` (directly or through a hook), never from `src/data/mock/`. Mock rows are DB-shaped, live in `mockDb` (profile, entries, affirmations) and go through the mappers. `getMockScenario()` returns `'default'` outside `__DEV__`. Models are plain JSON (ISO strings, `null` rather than `undefined`) because step 24 caches them as JSON. A `pending` or `uploading` row is local-only, and a crisis entry never carries an emotion, devotional, scripture or prayer. Formatting lives in `src/utils/format.ts`. `Scripture.text` is `null` unless the verse is verified.
- Build Status & Decisions Log: a Step 06 entry with the decisions above, the file list, the scripture references with their verified status, what was verified and what was not, and any open items.

Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.
