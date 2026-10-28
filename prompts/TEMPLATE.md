# NN · Feature name

Status: draft

## Goal

What the user can do when this is done, in one or two sentences. Name the screen(s) from the V1 list (Onboarding, Sign In, Journal, New Entry, Reflection, Prayers, Profile, Paywall) that this touches.

## Decisions

The choices this relies on, including answers to questions and defaults picked. One line each. Record the answer to every "ask first" item that applies:

- Dependencies installed or upgraded (library, why, approved by whom)
- Database migration or storage change (file name, what it adds)
- RLS or storage policy change
- Edge Function deploy
- Auth integration (JWT template vs. Third-Party Auth)
- RevenueCat products, entitlements, or pricing copy
- Design questions (for example, the Profile vs. Sanctuary tab label)

## Out of scope

What this plan deliberately leaves out. Include V2 items (Spiritual Memory, Insights, embeddings) and any Stitch preview-only controls that are not implemented.

## Steps

### 1. Step title

A full prompt for this step: the files and context it needs and what done looks like. Each step leaves the app working.

Include in each step, where relevant:

- Files to create or change, using the AGENTS.md architecture (screens, components, api, services, store, db, constants, supabase)
- Design reference and any artifacts to ignore
- States handled: loading, empty, error, offline
- Privacy, scripture accuracy, and crisis handling impact. If unsure whether crisis handling is affected, stop and ask.
- What done looks like, as something observable on a device

## Verification

The flows to run, the cases to try, and the checks to pass, ending with an end-to-end check of the feature.

- Checks: `npm run lint` and `npm run typecheck` pass with no errors
- Edge Function changes: `supabase functions serve process-entry`, tested with one text entry and one short audio entry
- Native changes (audio, notifications, purchases): tested on an iOS and an Android development build
- Offline: airplane mode shows the banner and "Waiting to sync" chips, and the entry syncs on reconnect
- Safety: a crisis-style entry shows the Crisis Support state, with no devotional, no affirmations, no autoplay, and working call/text actions
- Privacy: no transcript text in notifications, no secrets in the client, user data cleared on sign-out
- End-to-end: the full user flow from client to Edge Function to database and back to the client
- Phone walk-through: the checks of the section below, run as the guided walk-through in AGENTS.md

## Phone walk-through

Write one for every step that changes what the person sees or does on the phone, or what the app stores, and list only checks in it. It is a guided, human-in-the-loop test on the user's iPhone: the user does the physical actions and the dashboard actions, and the agent checks every result itself by reading the running app (through the dev server's inspector, read-only) and the database, then reports PASS or FAIL with evidence. The protocol, its project setup, and the rule that the implementing agent asks the user whether to start it when the step is done are under "Guided phone walk-through" in AGENTS.md: do not restate them in the prompt.

Say once, before B0:

- whether anything needs a restart or a fresh install (`npx expo start -c` and a force-quit of Expo Go when the step adds files or assets, or changes `app.json`, `metro.config.js`, `global.css` or `package.json`)
- which account, plan and test data the walk-through needs (for example a reflection with real audio, or a free account that has used its weekly devotionals)
- what it costs (Gemini and Text-to-Speech calls, emails sent, real charges), or that it costs nothing new
- that the app stays open and in front for the whole run (iOS pauses the app's JavaScript when Expo Go is minimized or the phone is locked, and the agent can read nothing then)

Number the checks B0, B1, and so on. B0 is always the starting state: signed in as the right account, the right data source, and the keys present. Each check has three lines:

- **Do** (the user): ONE action, with exact values: what to tap, what to type or say, which setting to change (Airplane mode on), or the exact SQL statement, or the table, row, column and value to change in the Table Editor.
- **Expect**: what must be true afterwards, as something that can be read: a store value, a count, a status, a column of a row, the text on screen, a log line, an HTTP status. Mark anything that can only be seen or heard (the sound, an animation, how a screen looks, haptics, what the lock screen or a notification shows, an OS dialog): for those the agent asks for a screenshot or a one-word answer.
- **Read** (the agent): exactly how it checks: which store value or repository function the inspector probe calls, which query or request it runs (or the SQL the user runs and sends back), or "ask the user".

A check that nothing can read and the user did not answer is "not verified" in the report, never PASS. Do not write a check for something that cannot work on this target (Siri on the user's iPhone, lock-screen or background audio in Expo Go, anything that needs the iOS development build of step 35): list it under "not verified", with where it can be tested.

## AGENTS.md updates

Any decision later features must respect, and the section it belongs in. Note rules this replaces. Write "None" if nothing.
