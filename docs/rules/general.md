# General: overview, philosophy, decisions, communication and constraints

> Part of the GraceHush rules, moved out of `AGENTS.md` word for word on 2026-11-23. `AGENTS.md` is the short core that every session loads, and its "Rules index" says which file holds which section. The sections below keep their original `##` headings, so a reference such as "AGENTS.md, Crisis Safety Rules" finds them. A rule that changes is changed here, in its section, in a few lines; a step's history goes to `docs/build-log.md`. This file can be long: search it (`git grep -n "<words>" docs/rules/general.md`) and read only the part you need.

## Project Overview

Gracehush is a calm, private "audio sanctuary." Users speak or type a raw prayer or journal entry. The app then:

- transcribes the voice entry
- names and validates the user's emotion, with no toxic positivity
- selects one fitting, verified Bible passage (Berean Standard Bible)
- generates a personalized spoken devotional of about a minute and a half (gen-v2.2 measured 78 to 99 seconds read aloud) with lock-screen playback
- creates three affirmations (morning, afternoon, evening) delivered as local notifications
- tracks active and answered prayers over time
- works offline first and syncs when the device reconnects

Primary audience: practicing Christians aged 25–45, likely female-leaning, who are busy and carrying emotional weight (anxiety, stress, grief, weariness). They often pray out loud in the car or on walks. The app must feel safe, warm, dignified, and private.

Brand mood: **"Warm Strength."** Grounded, mature, feminist-friendly. It should never feel childish, bubblegum pink, or clinical.

---

## Development Philosophy

Build feature by feature.

For every feature:

1. Understand the user request.
2. Check this file before coding.
3. Keep the implementation simple.
4. Avoid overengineering.
5. Prefer readable code to clever code.
6. Build the smallest useful version first.
7. Refactor only when repetition or complexity appears.
8. Never trade user privacy, scripture accuracy, or crisis safety for speed.

---

## Decision Making & Clarifications

If something is unclear or could be improved:

- Proactively suggest better approaches.
- If a new library would significantly simplify or improve the implementation:
  - Recommend the library
  - Clearly explain why it is useful
  - Ask the user for permission before adding or installing it

Example:

> "The ambient soundscape needs a second audio channel that plays alongside the devotional. A second `expo-audio` player can loop it cleanly. Do you want me to add it?"

Do not install or use new libraries without user approval. That includes packages already in `package.json` that the stack above does not mention (for example `@expo/ui`): name the package and the reason before first use. Approved so far: the Expo UI date-time picker for iOS (step 03), and in step 05 `@clerk/expo`, `@clerk/expo-google-signin`, `expo-secure-store`, `expo-apple-authentication`, `expo-crypto` and `expo-constants` (to detect Expo Go), then `expo-auth-session` (the Expo Go Google fallback), and in step 07 `zustand`, `@react-native-async-storage/async-storage`, `expo-notifications`, `expo-audio` and its required peer `expo-asset`, and in step 08 `@react-navigation/bottom-tabs`, and in the step 11 follow-up `expo-haptics`, and in step 13 `expo-web-browser` (already installed, named by the step prompt: the in-app browser for the crisis web links), and in step 17 `@supabase/supabase-js` (named by the step prompt; it is the only package that step added), and in step 19 `jose` 6.2.13 (and `@supabase/supabase-js` 2.118.0 again) for the Edge Function only: Deno imports pinned in `supabase/functions/process-entry/deno.json`, named by the step prompt, with the app's `package.json` and lockfile untouched, and in step 23 `expo-file-system` and `expo-keep-awake` (named by the step prompt), and in step 24 `expo-sqlite` and `@react-native-community/netinfo` (named by the step prompt), and in the step 08b follow-up (2026-10-29) `expo-glass-effect` (installed since the first commit, first used there) and `expo-blur` (installed there), both for the floating tab bar's material, and in step 34 `posthog-react-native` 4.85.1 (named by the step prompt), and in step 35 `expo-dev-client` ~58.0.18 and every patch release `npx expo install --check` listed that day (named by the step prompt). In the step 39 test run (2026-11-12, the owner's "Go"): `@elevenlabs/react-native` 1.2.39, `@livekit/react-native` 2.12.0, `@livekit/react-native-webrtc` 144.1.2 and `livekit-client` 2.24.0, with the config plugins `@livekit/react-native-expo-plugin` 1.1.0 and `@config-plugins/react-native-webrtc` 15.0.2, all pinned exactly (they need a development build: Expo Go has no WebRTC). In step 39's Part Two (2026-11-13, the owner's word): `@elevenlabs/client` 1.36.0, pinned exactly, as a direct dependency, because the app imports its `internal` entry (it was already installed with `@elevenlabs/react-native`; the lockfile changed on one line). For the Talk screen's voice orb (2026-11-15, the owner's "Go"): `@shopify/react-native-skia` 2.14.0, pinned exactly, and the first use of `react-native-reanimated` 4.7.1 (installed since the template), with one development build. Skia's second use (2026-11-20, for the owner's request to share the Today tab's word card as a picture) installs nothing and needs no new build of its own: the card is drawn off the screen by `src/services/wordCardImage.ts`, on any build made since 2026-11-15. Deno 2.9.6 and the Supabase CLI 2.121.0 run through `npx --yes` and install nothing.

Always ask before:

- installing, upgrading, or removing any dependency (including `expo-router`)
- creating or changing a database migration
- changing RLS or storage policies
- deploying an Edge Function
- changing the auth integration (JWT template vs. Third-Party Auth)
- changing RevenueCat products, entitlements, or pricing copy

---

## Communication Style

Be concise.

After each feature, explain:

- what changed (files touched)
- how to test it (steps on device)
- any open questions, assumptions, or follow-ups
- what is still remaining before the App Store release, in order, with whose turn each item is (Instructional Memory, 2026-11-19)

Also:

- Lead with what changed and where, then how to test it.
- State what was verified and what could not be (for example iOS on this machine). Never claim a fix works on a platform you could not run.
- Flag every deviation from this file, and every place a design differs from a token, with the reason.
- End the report of a finished step with the one line of "Guided phone walk-through" (Linting and Validation): "Automated checks pass. Shall I start the guided walk-through now (B0 to Bn)? Keep Gracehush open on the iPhone, in front and connected to the dev server." (Instructional Memory, 2026-10-26 and 2026-10-27).

---

## Important Constraints

- V1 is 12 screens: Onboarding, Sign In, Journal, Scholar, New Entry, Reflection, Conversation, Conversations, Scholar Talk, Prayers, Profile, Paywall (Scholar and Conversation since step 38, Scholar Talk since step 39, Conversations since 2026-11-16).
- Do not build Spiritual Memory / Insights (V2).
- Scholar (step 38) keeps no memory across conversations: a conversation knows itself and, when it was opened from one, its reflection. Memory across conversations stays V2.
- English (en-US) only for V1.
- Scripture is Berean Standard Bible only, and must always be verified text.
- Never expose secrets. Never trust unverified tokens.
- Never show misquoted or unverified scripture.
- Never skip crisis handling.
- Do not add, upgrade, or remove dependencies without asking. Expo Router is not used.

---
