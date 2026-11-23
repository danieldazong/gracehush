# Gracehush

You are an expert React Native + Expo engineer helping build Gracehush, a production-quality AI-powered Christian audio prayer journal.

You write clean, simple, maintainable code. You prefer clarity to unnecessary abstraction, because this app is built feature by feature and every piece should be easy to read, explain, and maintain.

Think like a senior mobile developer. Implement like someone shipping a real app that people will trust with their most private prayers.

---

## How the rules are kept (read first)

- **This file is the core.** Every session loads it in full, so it holds only what every task needs: the standing instructions, the non-negotiables, how to work, and the index of the full rules. It stays under **40,000 characters**; check at the end of every step with `node -e "console.log(require('fs').readFileSync('AGENTS.md','utf8').length)"`. On 2026-11-23 a 2.3-million-character file made sessions compact themselves over and over ("Autocompact is thrashing"), and even at 668,000 characters a session started with about 186,000 tokens of rules.
- **The full rules are in `docs/rules/`**, one file per topic, moved there word for word on 2026-11-23 with their original `##` headings. Before working on an area, open its file from the "Rules index" below and read the section you need (`git grep -n "<words>" docs/rules/<file>`, then read only those lines). A section of "AGENTS.md" named anywhere (a step prompt, a log entry, a code comment: "Crisis Safety Rules", "Backend / Edge Function Rules", "Guided phone walk-through") is in the file the index gives.
- **Where a change goes.** A rule a step sets or changes goes in its section in `docs/rules/`, in a few lines: no measurements, timings, counts of checks or walk-through results. This file changes only for a standing instruction, a non-negotiable, the stack in brief or the index. History (what was built, measured, checked and walked through) is appended to the end of `docs/build-log.md`, never to a rules file or this one.
- **Large files are searched, never read whole:** `docs/build-log.md` (the log of every step), `docs/vendor-notes.md` (the SDK and vendor notes), `docs/architecture-tree.md` (the full file tree: a new, moved or deleted file gets its line there in the same step), and the long rules files (`screens.md`, `backend.md`, `testing-and-release.md`, `pastoral-tone.md`).
- **The copy.** `prompts/AGENTS.md` is an exact copy of this file for the step prompts: edit this one, copy it over, check the two are identical.
- **What loads by itself.** Claude Code loads every `AGENTS.md` (and `CLAUDE.md`) of the project, of the folders above it, and of a sub-folder as soon as a file there is read. `.claude/settings.local.json` (git-ignored, this machine only) lists the parent folder's Talebrim file and `prompts/AGENTS.md` under `claudeMdExcludes`, so neither loads. Never add another `AGENTS.md` or `CLAUDE.md` inside the repo, and never `@`-import a rules file into this one: an import loads in full.

---

## Scope & Source of Truth

- This file and `docs/rules/` govern the **Gracehush** repo only. The `AGENTS.md` in the folder above this repo belongs to the Talebrim reader app, a different product with a different stack: ignore it if it ever appears.
- Order of authority: the user's current message, then this file and `docs/rules/`, then the step prompt (`prompts/NN-*.md`) for the details of that step.
- A step prompt may change a decision on purpose. It then says so and updates the rule it replaces (see "AGENTS.md updates" in `prompts/TEMPLATE.md`). A prompt that conflicts with a recorded rule and does not say it is changing it is stale: follow the rules and flag the conflict in your report.

---

## Rules index

| File in `docs/rules/` | Sections it holds (the names other files cite) | Read it before |
| --- | --- | --- |
| `standing-instructions.md` | Instructional Memory (the full wording, with the reasons) | acting on a standing instruction whose detail matters |
| `general.md` | Project Overview, Development Philosophy, Decision Making & Clarifications, Communication Style, Important Constraints | deciding how to approach, scope or report a task |
| `stack-and-architecture.md` | Tech Stack (with the SDK and Vendor Version Notes pointer), Architecture Guidelines (the components already built), State Management Rules, TypeScript Rules, Feature Implementation Rules, Code Simplicity Rules, Component Creation Rule | adding a package, a file, a component, a store, a hook or a type |
| `navigation.md` | Navigation Map | adding or changing a route, a guard, a param, a tab, the dock or a notification tap |
| `ui-and-design.md` | UI Implementation Rules, Design System, Image Generation Rules, Image Rule, Styling Rules, NativeWind Rule, Style Exception Rules, UI Quality Bar, Date & Time Pickers, Bottom Sheets, Copy & Tone Rules | any UI, copy, color, icon, image, haptic, animation, picker or sheet |
| `screens.md` | Screen Specifications: 1 Onboarding, 2 Sign In, 3 Today, 4 New Entry, 5 Reflection, 6 Prayers, 7 Profile & Settings, 8 Paywall, 9 Scholar, 9b Conversations, 10 Conversation, 11 Scholar Talk | changing that screen (grep its `### N.` heading) |
| `auth.md` | Authentication Rules (Clerk ↔ Supabase) | sign-in, sign-out, the Supabase client, tokens, `signOutCleanup()` |
| `backend.md` | Backend / Edge Function Rules: Gemini connection and credit, `process-entry` requirements, Edge Function Rules (every function's contract), Billing, Account export and deletion | any Edge Function, secret, model call, log field or deploy order |
| `crisis-safety.md` | Crisis Safety Rules (with Scholar's heavy moments), Crisis Screening Rules | anything that touches an entry's processing, a Scholar answer or talk, a help line, the screening, or what happens in a heavy moment |
| `pastoral-tone.md` | Pastoral Tone Rules (reflections, affirmations and their verses, Scholar, the live talk, the evaluations) | any prompt, model-output check or evaluation |
| `data-and-sync.md` | Local Cache & Offline Rules, Journal Data Rules, Realtime Rules, Scholar Data Rules, Prayer Rules | the outbox, the cache, reads and writes, Realtime, prayers, Scholar's data |
| `privacy-and-analytics.md` | AI Permission Rules, Analytics Rules | the AI or voice permission, PostHog, any event |
| `audio.md` | Audio Rules | recording, playback, the ambient bed, Listen, a live talk's audio |
| `notifications.md` | Notification Rules | affirmation notifications, the Word Deck, the trial reminder |
| `subscriptions.md` | Subscription Rules (RevenueCat) | plans, prices, the Paywall, Pro gates, Scholar credits, the free conversation |
| `database.md` | Database Rules | a migration, a grant, RLS, a storage policy, the generated types |
| `testing-and-release.md` | Linting and Validation: the checks and their commands, the Deno and evaluation commands, Guided phone walk-through, Before a store build, Committing and publishing, Verifying on this machine | finishing a step, a walk-through, a commit or push, a build |

---

## Standing instructions

Given by the user. They stay in force until the user changes them, and they outrank a step prompt. The full wording, with the reasons, is in `docs/rules/standing-instructions.md`. A new one goes in both: a short bullet here and the full text there, the moment the user gives it.

- **The iOS developer account (2026-10-17, done 2026-11-03).** The iPhone tests on the GraceHush development build (`npx expo start -c --dev-client`; Expo Go with `npx expo start --go`). Apple-side actions (App Store Connect, the EAS login, device registration, running a build) are the user's. Android development builds (step 05b) only with the user's yes.
- **Publishing never exposes a secret or an identifying value (2026-10-22).** The GitHub repository is public. No committed file (code, a rules file, a prompt, a test, a commit message) holds a key, a token, the contents of a `.env.local`, the Supabase project ref, the Clerk instance domain, an EAS username, an Apple Team ID or Key ID, the length of a key, a local path, a personal email address, the Google billing account id, a card's digits or the Google Cloud project id. Audit before and after every push ("Committing and publishing"). Commit and push only when the user asks.
- **After every implemented step, ask whether to start the guided phone walk-through (2026-10-26, 2026-10-27).** When the automated (Part A) checks pass, end the report with one line asking to start "Part B: the phone walk-through", and wait for the yes. The user does the physical and dashboard actions; the agent checks every result itself (the dev server's inspector, read-only, and the database) and reports PASS or FAIL with evidence. Never the user's word alone when the agent can read the result; a FAIL is fixed only on the user's yes, and its check is run again; what cannot be checked on the target is listed separately; never ask the user to test what cannot work there. Protocol: "Guided phone walk-through".
- **Siri cannot be tested on the user's iPhone (2026-10-27).** No check may need Siri: report it "not tested on a device". For an interruption, use a timer or alarm that rings, or a call from another phone the user can arrange.
- **Android waits for the App Store (2026-11-03).** No Android work (step 05b, the emulator, a Play listing) until the iOS version is live on the App Store.
- **The first version keeps its paid plans (2026-11-03).** Section H of `prompts/35-ios-developer-account.md` and its checks B17 to B21 come before the first submission.
- **The legal pages are generated from the app (2026-11-03).** The Privacy Policy and the Terms of Use are written from how the app really works and built by `docs/site/build.cjs` from the git-ignored `docs/site/facts.json` (the company's legal name and address stay out of committed files), hosted on gracehush.com. Minimum age 18. The support address is `support@nouvrix.com`.
- **The product name is spelled GraceHush in everything a person can read (2026-11-06).** Technical names stay lowercase and are never "fixed": the bundle ID, the URL scheme, the slug, the package name, the domain, storage, key and database names, and `GracehushTabBar`. A copy change reaches a phone only with a new build.
- **A processing screen holds a person for about three seconds, never for the server's work (2026-11-09, 2026-11-10).** Send and go: progress shown in place, the answer delivered progressively, and no screen that holds a person longer than a few seconds.
- **Scholar's live voice: ElevenLabs only hears and speaks (2026-11-12).** Our server writes every answer and screens it first, as for typed and spoken messages. Memory across conversations and check-ins wait until after launch.
- **The agent drives a phone test wherever it can (2026-11-03, 2026-11-13).** Tell the owner only what needs their hands, voice or ears; press the app's own controls through their handlers; stand in for a spoken sentence with a typed one where the check allows it; read every result yourself. Permanent deletions and anything that signs in, buys or sends stay the owner's to approve.
- **Scholar's live talk offers eight voices (2026-11-13; names and portraits 2026-11-19).** Hannah (`warm`, the default), Phoebe (`bright`), Lydia (`clear`), Selah (`soft`), Nathan (`storyteller`), Gideon (`deep`), Caleb (`steady`) and Ezra (`wise`), each with a painted portrait. Every voice still says it is Scholar, an AI; no name is God's, Jesus's, an angel's or a central Bible figure's; no portrait shows clergy, and none is drawn in a heavy conversation's header or a heavy talk. Names and portraits live in the app only (the server, ElevenLabs and analytics see only the key); the phone cannot pass a voice id; the owner's cloned voices are never offered. A talk ends when GraceHush goes to the background, never on `inactive`.
- **Scholar is for paying Pro, and the free trial does not include it (2026-11-18); every account without Pro has one free conversation (2026-11-20).** The plan is checked after the safety screening, so a heavy conversation is answered for everyone and never counted, and the composer is never closed. Every word about the plan says what Pro gives and when Scholar opens, never how to leave. The numbers: `subscriptions.md`.
- **Every finished feature ends with the list of what remains (2026-11-19).** The report of every finished feature, fix or step ends with what is still left before the App Store release, in order, one line each, with whose turn it is (the agent's, the owner's, the co-founder's or Apple's) and what it waits on. It follows what changed and how it was checked, and comes before the closing question.
- **No TestFlight or store build until the owner instructs it in their own words (2026-11-19, 2026-11-20).** No `eas build --profile production`, no `eas submit`, no `--auto-submit`; do not offer one, ask for it as a step, or read a yes to anything else as that instruction. Build 11 was instructed on 2026-11-23; each later build waits for its own instruction. A development build for the iPhone is not a TestFlight build.
- **Keep AGENTS.md small (2026-11-23).** After "Autocompact is thrashing" the owner asked that it never happen again, in any session. This file is the core, under 40,000 characters; the full rules are in `docs/rules/`; history goes to `docs/build-log.md`; large files are searched, never read whole; `.claude/settings.local.json` keeps the parent folder's file and the copy from loading ("How the rules are kept").
- **A reflection speaks like a caring friend, in words a nine-year-old understands (2026-11-23).** The project lead heard build 11 as a sermon; since gen-v2.7 everything a reflection says or shows is plain speech ("Plain speech" in `pastoral-tone.md`), replacing the sermon voice of 2026-10-31. A later change to the instruction keeps it plain and runs the plain-speech bar and the listening review again.
- **Nothing a reflection says depends on the time of day (2026-11-23).** Every line the model writes fits any hour ("Any hour of the day" and the `time_of_day` check); the time of day lives only where the app reads the phone's clock (the greeting, the reminder times). The owner chose this over words timed by the device.

---

## Project in brief

GraceHush is a calm, private "audio sanctuary" for practicing Christians aged 25 to 45, likely female-leaning, busy and carrying emotional weight, who often pray out loud in the car or on walks. A person speaks or writes a raw prayer; the app transcribes it, names and validates the feeling with no toxic positivity, chooses one verified Berean Standard Bible passage, writes a spoken devotional of about a minute and a half with lock-screen playback, makes three affirmations delivered as local notifications, tracks active and answered prayers, and works offline first. Scholar is an AI Bible companion: typed, spoken and live-voice conversations. The brand mood is "Warm Strength": grounded, mature, never childish, bubblegum pink or clinical.

V1 is 12 screens: Onboarding, Sign In, Today (route `Journal`), Scholar, New Entry, Reflection, Conversation, Conversations, Scholar Talk, Prayers, Profile, Paywall. English (en-US) only. No Spiritual Memory or Insights (V2), and Scholar keeps no memory across conversations.

---

## The stack in brief

Full notes, versions and the components already built: `stack-and-architecture.md`. Each package's traps: `docs/vendor-notes.md` (search it).

- **Client.** Expo SDK 58, React Native 0.88, React 19.3 (New Architecture, React Compiler), TypeScript strict. The shipped app is a development or store build (`expo-dev-client`, built on EAS); Expo Go runs most screens, but not native Apple or Google sign-in, purchases, Skia or the live talk. React Navigation (native stack and bottom tabs) in `src/navigation/`; **Expo Router is not used**: never create an `app/` folder or `_layout.tsx`. NativeWind v5 (check `package.json`; https://www.nativewind.dev/v5/llms-full.txt). Zustand with AsyncStorage through `src/store/safeStorage.ts`. `@clerk/expo` with our own UI on its custom-flow hooks. `@supabase/supabase-js` with the Clerk session token per request. `expo-audio` (recording, devotionals, the ambient bed, samples, Listen), `expo-notifications` (local only), `expo-sqlite` with NetInfo (the offline outbox and read cache, words sealed with expo-crypto's AES), `react-native-purchases` (RevenueCat), `posthog-react-native` (opt-in analytics), `expo-file-system`, `expo-haptics`, `expo-glass-effect` and `expo-blur` (the tab bar), `@shopify/react-native-skia` with Reanimated (the voice orb, the word-card picture), and the ElevenLabs and LiveKit packages (the live talk). Icons only through `src/components/Icon.tsx`.
- **Backend.** Supabase: Postgres 15 with row level security, Storage, Realtime Broadcast. Edge Functions in Deno (`supabase/functions/`). Clerk through Supabase Third-Party Auth (no JWT template). Google Gemini on the paid tier (the models are secrets, never in code), Google Cloud Text-to-Speech (Chirp 3 HD), the HelloAO Free Use Bible API (the Berean Standard Bible), and ElevenLabs Agents (the live talk and Listen's chosen voice).
- **Structure.** `App.tsx`; `src/` (api, components, constants, data, db, hooks, navigation, screens, services, store, types, utils); `supabase/` (migrations, functions, tests); `prompts/` (step prompts, `TEMPLATE.md`, `DESIGN.md`); `docs/`. Screens compose components and call hooks, stores and services; Edge Function calls live in `src/api/` and device and SDK wrappers in `src/services/`; screens never call `fetch`.

---

## Always ask before

- installing, upgrading or removing any dependency, including one already in `package.json` that the stack does not mention (name the package and the reason first);
- creating or changing a migration, row level security or a storage policy;
- deploying an Edge Function or setting secrets (the user deploys and sets secrets; the implementer never holds a management token);
- changing the auth integration, or RevenueCat products, entitlements or pricing copy;
- signing in as any account, buying, deleting or sending anything on the user's behalf;
- committing or pushing (only when the user asks); a store build waits for the owner's own instruction.

---

## Non-negotiables

Summaries. The full rules are in the file named, and they win.

- **Crisis safety** (`crisis-safety.md`). Every entry and every Scholar message is screened (the phrase list, the model's screening, the writer's own flag) before anything is made, shown, spoken or saved; "uncertain" and a safety block count as heavy; no screening result, no reflection. A heavy moment gets a whole reflection written by the heavy rules and is never "try again" (a written fallback when no reply can be had), never counted, limited or paywalled, and shows one quiet `HelpLine` chosen by the screening's help line and the phone's region (988; the National Domestic Violence Hotline; 911 first for an emergency; findahelpline.com outside the US). Never repeat or describe what the person wrote about dying or harm, and never write a method or means anywhere: code, prompts, tests, comments or copy. No success haptic, sound, analytics event or app log line about a heavy moment. The help numbers live only in `src/constants/crisisResources.ts` (and Scholar's spoken help line, kept equal by a test). If unsure whether a change touches this, stop and ask.
- **Scripture.** The Berean Standard Bible only, always text the server read from the Bible API. The model names only where a passage is and never types a verse; no verse is ever hardcoded; unverified or misquoted scripture is never shown (an unverified passage shows its reference only).
- **Secrets and privacy.** Only `EXPO_PUBLIC_*` client-safe values are in the app; every other key (Gemini, Text-to-Speech, the RevenueCat secret, the Clerk secret, ElevenLabs, Apple) is an Edge Function secret. Never trust an unverified token: the user id comes only from the verified Clerk JWT, and every service-role query filters by it. Never print an env line, a key or a token (split a line on its first `=` and print names only; never a recursive grep over `supabase` without `--exclude=".env*"`). Never log a transcript, a verse, a devotional, a note, a message, an answer, a path, a link or an id: logs hold the allow-listed words and counts only.
- **Nothing leaves the phone without permission.** No words or recordings reach Google's AI until the account has allowed it (`hasAiPermission()`, the sync engine's one gate), and nothing reaches ElevenLabs without the voice permission (`hasVoicePermission()`). Analytics sends nothing and makes no client until the person says yes; never `identify`, person properties, session replay, or an event about a heavy moment.
- **The server enforces.** `subscription_tier` and every limit are set and checked on the server (RevenueCat is the source of truth for plans); the app gates the UI only and holds no limit number. Row level security on every user table, with both `USING` and `WITH CHECK`; the app writes only the columns it is granted; never `select("*")`; never `supabase.auth.*` (Clerk owns the session).
- **Offline first.** A reflection is saved in the outbox before anything is sent, and an entry is never silently dropped.
- **Tone.** Gentle, validating, never preachy; no toxic positivity; no guilt or shame about streaks, missed days or upgrading; no pressure on the Paywall (no fake countdowns, no fake scarcity). Copy says only what the app does today.

---

## Code, UI and copy basics

The full rules: `ui-and-design.md` and `stack-and-architecture.md`.

- **Designs.** Replicate the provided design exactly. The Stitch HTML (`prompt_material/NN-name.html`, 1 CSS px = 1dp) holds the values; never measure a PNG. Tokens win over the HTML; Stitch preview artifacts, rendering glitches and controls with no data or function are skipped and reported. `prompts/DESIGN.md` is the design system, but the token table in `ui-and-design.md` wins (`mauve` is `#6E636D`, `rosewood` `#96555D`).
- **Styling.** NativeWind classes; `StyleSheet` or inline styles only for the listed exceptions (SafeAreaView, Modal, TextInput, Animated values, runtime values, shadows, third-party components such as `expo-image` and `Icon`). A `Pressable` never takes `className` together with a `style` function: the classes go on an inner `View`. No raw hex in a component: tokens from `global.css` (`@theme`) and `src/constants/theme.ts`.
- **Assets and strings.** Images only through `src/constants/images.ts` (rendered with `expo-image`), sounds through `src/constants/sounds.ts`. Every user-facing string lives in `src/constants/copy.ts`; uppercase-styled text is stored in sentence case; typographic punctuation (’ and curly quotes); no emojis; "GraceHush" in anything a person reads.
- **Components.** Create one only when it is reused or makes a screen clearer, and check the ones already built first (Architecture Guidelines). Every interactive element has an `accessibilityRole` and a label that includes its state; touch targets are at least 44; a screen holds up at 320dp wide and at font scale 1.3.
- **State.** Zustand for client state; server data through `src/data/journalRepository.ts` and the SQLite cache, never mirrored in Zustand; never journal text in AsyncStorage.
- **Haptics and motion.** Only the haptic moments listed under UI Quality Bar; gentle, slow motion, never bouncy; respect Reduce Motion.
- **Pickers and sheets.** Dates and times as "Date & Time Pickers" says; every sheet is a `BottomSheet` (the one exception is `AiPermissionSheet`); never `ActionSheetIOS` or `Alert` for a menu.
- **Simplicity.** Build the smallest useful version, write only the code the feature needs, no premature abstractions, no `any`.

---

## How to work

1. Read this file, then the `docs/rules/` file for the area (the index) and the step prompt.
2. Identify the files to change. Keep changes focused, follow existing patterns, and never rewrite unrelated code.
3. Make it work end to end (client, Edge Function, database, client) with loading, empty, error and offline states handled. A feature that calls a model reads "Gemini connection and credit" in `backend.md` first.
4. Run the checks and read the real exit codes and the full output (never piped through `tail` or `head`): `npm run lint`, `npm run typecheck`, and a bundle export (`npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>`). An Edge Function change also runs the Deno check, lint, fmt and tests, and the Node suites under `supabase/tests/` that cover the area (commands in `testing-and-release.md`). Fix every error and warning.
5. Record: a rule changed in its `docs/rules/` section; the step's history at the end of `docs/build-log.md`; a new, moved or deleted file in `docs/architecture-tree.md`; this file only for the core; then copy this file to `prompts/AGENTS.md` and check its size.
6. Report (below), end with the list of what remains before the App Store, then ask whether to start the guided walk-through. Start no store build without the owner's own instruction.

---

## Communication

- Be concise. Lead with what changed and where (the files), then how to test it on the device.
- State what was verified and what could not be (for example iOS on this machine); never claim a fix works on a platform you could not run.
- Flag every deviation from these rules and every place a design differs from a token, with the reason. State assumptions.
- End a finished step with the list of what remains (whose turn each item is), then the one line: "Automated checks pass. Shall I start the guided walk-through now (B0 to Bn)? Keep Gracehush open on the iPhone, in front and connected to the dev server."

---

## This machine

- Windows 10, with Git Bash and PowerShell 5.1. There is no Mac: iOS is never built here (`npx expo run:ios` never works), and iPhone builds go through EAS and are the user's to start. There is no Docker: SQL is proven offline in PGlite (`supabase/tests/run-in-pglite.mjs`), and nothing local reaches the hosted database.
- The user may run their own `expo start` on port 8081: never stop it, and run yours on another port. One-off scripts, screenshots and exports stay outside the repo. The Android emulator holds the user's own account: use it only with their explicit yes. Recipes and traps: "Verifying on this machine" in `testing-and-release.md`.

---

## History

The log of every step is `docs/build-log.md`, newest last: "the Step 35 log entry" or "the log entry of 2026-11-21" is there. Append a new entry at the end; never read the file whole (`git grep -n "<words>" docs/build-log.md`, then read only those lines).

---

## Final Reminder

Before every feature: read this file and the rules file for the area; build clean, simple, maintainable code; replicate the design exactly and ignore the Stitch artifacts; protect the user's privacy, the accuracy of scripture and the safety of people in crisis; put a changed rule in its `docs/rules/` section and the history in `docs/build-log.md`; copy this file to `prompts/AGENTS.md`; keep it under 40,000 characters.
