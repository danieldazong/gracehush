# Step 37 — A Bible verse under each affirmation

Status: implemented 2026-11-08 on the owner's approval of the recommendation ("Implement your recommendation you recommended Below"), built on the heavy-moments change (gen-v2.4) of the same day. This file records the decisions, what was built and the phone walk-through. AGENTS.md is the source of truth for every rule below (Pastoral Tone Rules, "A verse under each affirmation"; Backend requirement 14; Notification Rules, "What is sent"; Database Rules, the tenth migration; the Step 37 log entry).

## Why

The affirmation notifications were a slot title ("Afternoon affirmation") over a headline the model wrote, and the headlines had become generic and repetitive ("You are sustained in the middle"). The owner asked for notifications like Bible.com's verse of the day: a short word rooted in scripture, powerfully prepared from the newest finished reflection, never generic or repeated.

## Decisions (approved)

1. The lock screen shows the affirmation's headline in bold (the notification's title) and, under it, one Bible verse in curly quotes as one line with its reference: “Because of the loving devotion of the LORD we are not consumed, for His mercies never fail.” — Lamentations 3:22 BSB.
2. One verse per affirmation, chosen first and for what the person shared; the headline is written from that verse (2 to 6 words, at most 38 characters, "you" or "your", a truth, never the verse's own phrases, never a generic line, three different first words).
3. The server reads every verse from the Berean Standard Bible and keeps it only when it is one verse, at most 140 characters read as one line, a whole sentence, about God (added after the live check: Philemon 1:7 got through), not inside the passage, not another affirmation's, not one of the person's recent passages or affirmation verses, and for a heavy moment not denied.
4. One small follow-up request for every verse that breaks a rule; a verse still unusable leaves its affirmation without one, and its notification keeps the older form. A chapter that cannot be read costs no follow-up.
5. The code capitalizes a headline's first letter; two soft checks ask again for a headline with a feeling word and for one the person already received.
6. A migration adds `verse_reference` and `verse_text` (both or neither, short) to `daily_affirmations`; only the server writes them.
7. The app shows the verse on the Journal's affirmation card, in Reflection's Affirmations tab and in the onboarding sample, and the notification uses it.
8. The export, the Privacy Policy and the Terms say so. The owner deploys.

## Phone walk-through

Before B0:

- **Order on the development project:** step 36's migration if it is not applied, `20261108120000_heavy_moments.sql`, then `20261108130000_affirmation_verses.sql`; `rls_selftest.sql` (69 of 69) and `selftest.sql` (11 of 11); the types download, which must leave `src/types/supabase.ts` unchanged; then `functions deploy process-entry` (and `confirm-scripture` and `export-data`, which the heavy-moments change touched). Until a project has the migration the app must not run against it: its affirmation query asks for the two new columns.
- **Restart:** `npx expo start -c --dev-client` (a new component and new class names) and a force-quit of the app. No new EAS build: no native change.
- **Account and data:** a signed-in test account on the development project, the data source `supabase`, notifications allowed and Daily Affirmations on. The reminder times are moved a few minutes ahead in B3 and put back at the end.
- **Cost:** two or three written reflections, about one cent of Gemini each, and their speech inside the free characters.
- The app stays open and in front, except where a check locks the phone.

**B0** — **Do:** nothing. **Expect:** signed in, data source `supabase`, the database open, the permission `granted`, the switch on. **Read:** the stores and `getAffirmationScheduleSummary()` through the inspector.

**B1** — **Do:** write a made-up reflection in New Entry (about a hard week at work and asking God for patience with a coworker) and submit it. **Expect:** ready; the server's three `daily_affirmations` rows each have `verse_reference` and `verse_text` (or, rarely, one row with neither); each headline at most 38 characters with three different first words; the request's log line has `affirmationVerses` 3 (or 2). **Read:** the app's own `selectAffirmations` through the inspector (references and lengths only), and the function log's line.

**B2** — **Do:** open the reflection's Affirmations tab, then go to Journal. **Expect:** under each headline a blush panel with the verse in curly quotes as one line and "Reference · BSB"; the Journal card shows the current slot's verse the same way; nothing cut off at the edges (screenshot). **Read:** the rendered tree (the panel's texts present) and the user's screenshot.

**B3** — **Do:** set the next reminder time two minutes ahead in Profile, lock the phone and wait. **Expect:** the notification's bold title is the headline and its body the verse in curly quotes with "— Reference BSB" (screenshot of the lock screen). **Read:** the planned notification's title and body through `planAffirmations` in the inspector before the lock, and the user's screenshot.

**B4** — **Do:** tap the notification. **Expect:** Reflection opens on Affirmations for that entry. **Read:** the navigation state.

**B5** — **Do:** write a second made-up reflection on a different worry. **Expect:** none of its verses is one of the first reflection's verses or passage, and none of its headlines repeats one of the first's. **Read:** both reflections' affirmation rows through the inspector.

**B6** (optional, it signs out) — **Do:** Profile, Reset onboarding (dev), then Begin Your Quiet Time to reach the Rhythm step. **Expect:** the sample card reads "GraceHush · Sample" and the time, "Your shepherd knows what you need" in bold, and the Psalm 23:1 line; note whether the step now scrolls. **Read:** the rendered tree and the card's height through `measureInWindow`, and the user's screenshot. Sign back in afterwards.

**B7** — **Do:** put the reminder times back. **Expect:** the times as they were. **Read:** the onboarding store.

Not verified on this target: Android (the emulator holds the owner's own account), VoiceOver reading the rows' labels, a reflection whose verses all fail (only the tests show it), production (the owner deploys there after development).
