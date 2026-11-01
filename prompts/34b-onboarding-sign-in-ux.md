# 34b-onboarding-sign-in-ux.md

Read AGENTS.md first and follow it strictly.

Status: vetted against the code on 2026-11-01, not implemented. Every code block below was applied to a scratch copy of the repo and proven there (typecheck and lint 0; profile-sync 90, analytics 34, notifications 48 and every other suite at its count; the three new or changed checks fail against the code as it is). Nothing in the repo changed.

A surgical pass over Onboarding's four steps and Sign In: copy, a progress indicator that accumulates, the three reminder times named on the Permissions card and on Sign In, and a Sign In that continues the flow instead of restarting it. Nothing structural, no new package, no server change. This is the user's own UX request (2026-11-01), vetted here against what the app really does; where the request's wording promised something the app does not do, the prompt says so and gives the honest line instead.

Sources read: `AGENTS.md`; `src/screens/onboarding/OnboardingScreen.tsx`, `src/screens/auth/SignInScreen.tsx`, `src/constants/copy.ts`, `src/store/onboardingStore.ts`, `src/navigation/RootNavigator.tsx`, `src/components/PrimaryButton.tsx`, `src/components/PrivacyNoteCard.tsx`, `src/utils/format.ts`, `src/db/fieldCrypto.ts`, `src/services/recordingFiles.ts`; `docs/legal-brief.md`, `docs/privacy-policy.md`; `supabase/tests/profile-sync/run.cjs`, `supabase/tests/analytics/run.cjs`; the measured timings in AGENTS.md's Step 22, 25, 30 and 32 entries; the bundled font files, read by a small TTF reader, for every wrapping row.

---

## What was checked when this was written (these shaped the prompt)

The request, instruction by instruction, against the code. "Kept" means the wording is in this prompt as the user wrote it.

| The request said                                                                                                                                                                                        | What the app does                                                                                                                                                                                                                                                                                                                                                                                                     | In this prompt                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A: completed steps stay filled in plum.                                                                                                                                                                 | Only the current pill is plum; the others are petal.                                                                                                                                                                                                                                                                                                                                                                  | **Kept.** A shared `StepProgress` component: plum dots behind, the long plum pill now, petal dots ahead.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| A, F: Sign In's "Step 1 of 1" becomes "FINAL STEP • SAVE YOUR SANCTUARY" (F says "LOCK IN YOUR SANCTUARY"), with every pill filled.                                                                     | Sign In shows "Step 1 of 1" to everyone: the person who just finished onboarding and the one who signed out last week.                                                                                                                                                                                                                                                                                                | **Changed.** Onboarding counts Sign In as its last step from the start ("1 OF 5", or "1 OF 4" without a PostHog token), so nothing resets; the Sign In that ends onboarding shows the same header with every pill filled and the label "FINAL STEP" (the two long labels differ from each other, run to about 260dp beside the pills, and the headline already says the rest). A returning sign-in (after a sign-out, or "I already have an account") keeps the chevron row with "Welcome back" instead of "Step 1 of 1". The screen tells them apart with a new persisted flag, `hasSignedIn` (section 1). |
| B: "In 20 seconds, receive a verified Berean Standard Bible passage and a 90-second spoken devotional".                                                                                                 | A written reflection took 17.7 to 25 s on the hosted project (steps 25, 30, 32); a spoken one takes longer (the screening transcribes it first); under a busy model the server retries for up to 90 s. The verse is shown only once the server has verified it, so "verified" is server jargon. The devotional measured 78 to 99 s (gen-v2.2).                                                                        | **Changed:** "In about half a minute, receive a word-for-word Berean Standard Bible passage and a 90-second spoken devotional made from your own words."                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| B: "Begin Your Quiet Time".                                                                                                                                                                             |                                                                                                                                                                                                                                                                                                                                                                                                                       | **Kept.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| C: "Three gentle reminders drawn from your own prayers—waiting on your lock screen when you need them most."                                                                                            | The app calls them affirmations everywhere else (the notification's title, Profile's switch, Journal's card); the house style spaces an em dash ("Speak freely — there is no wrong way to pray."); the screen's purpose is choosing the times.                                                                                                                                                                        | **Changed:** "Three gentle affirmations drawn from your own prayers — waiting on your lock screen at the times you choose."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| C: "Save My Daily Rhythm".                                                                                                                                                                              | The times are saved on the device at once and sync to the profile after sign-in.                                                                                                                                                                                                                                                                                                                                      | **Kept.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| D: eyebrow "YOUR VOICE & RHYTHM", headline "Let Gracehush hear you and remind you."                                                                                                                     |                                                                                                                                                                                                                                                                                                                                                                                                                       | **Kept** (the eyebrow is stored as "Your voice & rhythm"; the style uppercases it).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D: Microphone card "... Encrypted on your phone."                                                                                                                                                       | A recording is a plain `.m4a` in the app's document folder, and it is uploaded to the server to make the reflection (`docs/legal-brief.md` says so outright, in its note on the on-device copy and in its storage table). Only the written words in the local database are encrypted (step 24).                                                                                                                       | **Changed:** "So you can pray out loud in the car, on a walk or late at night. Your recording is used only to create your reflection."                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| D: Notifications card names the three times.                                                                                                                                                            | The times are in the onboarding store; `formatTime12` gives "8:00 AM".                                                                                                                                                                                                                                                                                                                                                | **Kept**, as a builder, each time joined by a no-break space so "8:00" and "AM" never split (the rule Profile's reminders summary already follows).                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| D: privacy line "Encrypted on your phone. Export or permanently delete your prayers anytime."                                                                                                           | Same as the microphone card: prayers also go to the server, Gemini and Text-to-Speech to be made into a reflection; the privacy-policy draft claims encryption in transit and private storage, not on-device encryption.                                                                                                                                                                                              | **Changed:** "Your words stay private. Export or permanently delete everything anytime."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| D: "Maybe later" becomes "I’ll type prayers & check manually".                                                                                                                                          | Skipping here locks nothing out: the microphone is asked for when the person first taps the orb (steps 10 and 23) and notifications when they turn Daily Affirmations on (step 28). The line states a trade-off that does not exist, and a permissions primer that shames the skip comes close to what Apple's guideline 5.1.1 (iv) forbids: manipulating people into consenting to data access. AGENTS.md: no guilt. | **Changed:** "Ask me later" (true: the app does).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| E: eyebrow "ALMOST INSIDE", headline "Keep your prayers 100% private.", subtitle "Your spoken words and prayers never leave your private sanctuary. ... anonymous crash & feature metrics".             | The words do leave the phone, to Gracehush's own server and its providers, to make the reflection (never to analytics). No crash data is collected: error and crash tracking are off and out of scope (step 34, decision 15). "Diagnostics" would say the same false thing.                                                                                                                                           | **Changed:** eyebrow "Almost there", headline "Your prayers stay private.", subtitle "Nothing you write or say is ever part of this. Would you like to share anonymous usage data, like which features you use, so we can keep improving Gracehush?" The two cards under it stay.                                                                                                                                                                                                                                                                                                                           |
| E: "Share usage data" becomes the filled plum primary; "Not now" the secondary.                                                                                                                         | Step 34 made them two equal ghost pills (its decision 11: "neither is pushed").                                                                                                                                                                                                                                                                                                                                       | **Kept, and it supersedes step 34's decision 11:** the share button is the filled `PrimaryButton` with the arrow, and "Not now" stays a ghost pill of the same size directly under it (never a small text link), so declining is one obvious tap. The button keeps the name "Share usage data": the privacy-policy draft quotes it.                                                                                                                                                                                                                                                                         |
| F: headline "Save your rhythm and sanctuary."                                                                                                                                                           |                                                                                                                                                                                                                                                                                                                                                                                                                       | **Kept**, for the sign-in that ends onboarding. A returning sign-in keeps "Your sanctuary is waiting."                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| F: subtitle "Lock in your ... affirmations and keep every spoken prayer and answered timeline safe."                                                                                                    | "Answered timeline" is the Prayers tab's internal name; "spoken prayer" leaves out written ones.                                                                                                                                                                                                                                                                                                                      | **Changed:** "Lock in your 8:00 AM, 1:00 PM and 8:00 PM affirmations, and keep every reflection and answered prayer safe across your devices." (the times from the store).                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| F: the three auth buttons unchanged.                                                                                                                                                                    |                                                                                                                                                                                                                                                                                                                                                                                                                       | **Kept.**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| F: privacy card "Encrypted on your phone. Verified Scripture." / "Your raw prayers are encrypted on your device. Scripture is never AI-generated—every passage is word-for-word Berean Standard Bible." | The encryption claim is wrong for recordings and overstates the written words (above). The card today discloses that AI writes the reflections; dropping that while keeping the app's AI devotionals would make the card less honest, not more.                                                                                                                                                                       | **Changed:** title "Private prayers, real Scripture", body "Scripture is never AI-generated: every passage is word-for-word Berean Standard Bible. AI writes your devotional from your own words; you can export or permanently delete everything at any time."                                                                                                                                                                                                                                                                                                                                             |
| Oxford commas throughout ("in the car, on a walk, or late at night").                                                                                                                                   | The house style has none ("Which features you use, your plan and the app version.").                                                                                                                                                                                                                                                                                                                                  | Dropped.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |

Measured with the real font files (greedy wrapping, like React Native's): the Welcome subtitle is 5 lines at 390dp (8 at 320dp with font scale 1.3; the Welcome step has the room and scrolls); the Rhythm subtitle 3 lines; the Permissions headline 2 lines (3 at 320dp ×1.3); the notifications body 3 lines in its card (5 at 320dp ×1.3, with "12:00 PM" times too); the consent subtitle 4 lines; the Sign In headline 2 lines and its subtitle 4 lines inside the 290dp column (5 at 320dp ×1.3); the privacy card's title 1 line (2 at 320dp ×1.3) and its body 5 lines; every button label fits on one line even at 320dp ×1.3 (the widest, "Begin Your Quiet Time", is 208 of 214dp); five pills are 84dp wide and "FINAL STEP" 77dp (100 at ×1.3), so the header row never crowds.

---

## What you do yourself

Nothing before the build: no key, no dashboard, no package. `.env.local` is not read by this step (checked by names only: the PostHog token decides whether the consent step exists, as in step 34, and nothing else). The phone walk-through at the end needs your iPhone in Expo Go, a restart of the dev server with `npx expo start -c` (a new file), and your sign-in (code 424242): the implementer asks first, as always.

---

## Decisions (approved with this prompt by your go-ahead)

1. **No package, no native change, no migration, no deploy.** Copy, one new component, one store field, two screens, one navigator effect, and the checks.
2. **Progress accumulates and counts Sign In.** `StepProgress` (new, `src/components/StepProgress.tsx`) draws plum dots for the steps done, the long plum pill for the current one and petal dots ahead, with the counter beside it; it exports `ONBOARDING_STEPS` (4 with a PostHog token, 3 without) and `TOTAL_STEPS` (one more: Sign In). Onboarding reads "1 of 5" to "4 of 5" (or "1 of 4" to "3 of 4"); the Sign In that ends onboarding shows the same row with every pill filled and the label "Final step", spoken as "Step 5 of 5".
3. **Sign In has two variants, told apart by `hasSignedIn`** (persisted in the onboarding store, version 4; set by `RootNavigator`'s existing signed-in effect, so a session on this device marks it once). Fresh (`!hasSignedIn && !canGoBack()`): the filled progress row, "Save your rhythm and sanctuary." and the subtitle with the three times. Everyone else (a sign-out, "I already have an account"): the chevron row with "Welcome back", "Your sanctuary is waiting." and the subtitle as today. Persisted rather than in memory so that completing onboarding, killing the app and reopening it still shows the final step. A version 3 save migrates with `hasSignedIn` equal to `hasCompletedOnboarding` (the returning-user rule marks onboarding complete for any signed-in session, so a completed save has signed in); "Reset onboarding (dev)" clears it, which is how the fresh variant is reached again on a developer's phone.
4. **The copy** is the "In this prompt" column above, every string in `src/constants/copy.ts`, curly punctuation, sentence case for what the style uppercases, no Oxford comma. The two dynamic lines are builders (`copy.onboarding.permissions.notifications.body(morning, afternoon, evening)` and `copy.auth.fresh.subtitle(...)`) that join each clock time with a no-break space (`unbreakable`, a one-line helper at the top of the file). `copy.auth.stepLabel` ("Step 1 of 1") is removed; `finalStep` and `welcomeBack` replace it.
5. **The consent step's share button is the filled primary** with the arrow; "Not now" is a ghost pill of the same size right under it. This supersedes step 34's decision 11 and AGENTS.md's "two buttons that look the same" (section "AGENTS.md updates").
6. **"Ask me later" replaces "Maybe later"**, and no line on the Permissions step shames the skip (the request's "I’ll type prayers & check manually" is not built: see the table).
7. **No encryption claim in the UI.** The written words in the phone's database are encrypted (step 24); recordings are plain files and every prayer goes to the server to be made into a reflection, so "Encrypted on your phone" would be wrong on two of its three uses and new ground for the lawyer's drafts. The lines say what the app does: private, exportable, deletable, used only for the reflection.
8. **Design deviation, recorded:** the Stitch frames (`prompt_material/01-onboarding.html`, `02-sign-in.html`) keep their layout, tokens and controls; only the copy, the pills' fill and the Sign In header change, by the user's choice (2026-11-01).
9. **Haptics:** unchanged (the consent step's buttons make none; the Share Usage Data switch on Profile keeps its `selection` tick).
10. **Analytics:** unchanged. `onboarding_completed` is still sent only by "Share usage data"; no event for Sign In.

---

## Out of scope

- A consent dialog for people who answered "Not now" (step 34 decided against one); Profile's switch is the way back.
- Any change to the time pickers, the permission requests, the Clerk flows, the email sheet, the tokens, the fonts, radii or shadows.
- A night theme, animation changes, a different hero.
- The returning sign-in's copy beyond the label ("Your sanctuary is waiting." stays).

---

## 0. Before you write code

1. The baseline: `npm run typecheck` and `npm run lint` exit 0; profile-sync 88, analytics 34, notifications 48, journal-data 89, offline 44 of 44, prayers 33, deletion 32, billing 24, account 10, realtime 27, recording 68, playback 133, ambient 64, parity 7 of 7; the release gate prints 4.
2. Line endings: `src/store/onboardingStore.ts`, `src/constants/copy.ts`, `src/screens/onboarding/OnboardingScreen.tsx` and `src/navigation/RootNavigator.tsx` are CRLF; `src/screens/auth/SignInScreen.tsx` and the two test files are LF. Apply the edits with a script that matches on LF text and writes each file's own endings back (the step 24 to 34 way), or edit single lines with the Edit tool. The new file is LF.
3. The "Find" text of every edit below must occur exactly once in its file (dry-run first). The blocks are byte-identical to the proven draft: use them as they are.
4. Red first: apply section 7 (the checks) before sections 1 to 6 and run profile-sync and analytics: profile-sync must end `87 passed, 3 failed` (the version 4 check, the `hasSignedIn` check and the copy check) and analytics `33 checks passed, 1 FAILED` (the version 4 check). Then the code.

---

## 1. `src/store/onboardingStore.ts`: version 4, `hasSignedIn`

Edit 1. Find:

```ts
  analyticsConsent: AnalyticsConsent; // step 34
  setReminder: (slot: TimeSlot, hhmm: string) => void;
```

Replace with:

```ts
  analyticsConsent: AnalyticsConsent; // step 34
  hasSignedIn: boolean; // a session has been active on this device (step 34b): the Sign In screen reads it
  setReminder: (slot: TimeSlot, hhmm: string) => void;
```

Edit 2. Find:

```ts
  setAnalyticsConsent: (consent: "granted" | "declined") => void;
  resetOnboarding: () => void; // dev only
```

Replace with:

```ts
  setAnalyticsConsent: (consent: "granted" | "declined") => void;
  markSignedIn: () => void; // idempotent
  resetOnboarding: () => void; // dev only
```

Edit 3. Find:

```ts
  | "remindersDirty"
  | "analyticsConsent"
>;
```

Replace with:

```ts
  | "remindersDirty"
  | "analyticsConsent"
  | "hasSignedIn"
>;
```

Edit 4. Find:

```ts
    remindersDirty: false,
    analyticsConsent: "unset",
  };
}
```

Replace with:

```ts
    remindersDirty: false,
    analyticsConsent: "unset",
    hasSignedIn: false,
  };
}
```

Edit 5. Find:

```ts
      setAnalyticsConsent: (consent) => set({ analyticsConsent: consent }),
      resetOnboarding: () => set(getInitialData()),
```

Replace with:

```ts
      setAnalyticsConsent: (consent) => set({ analyticsConsent: consent }),
      markSignedIn: () => {
        if (get().hasSignedIn) {
          return;
        }
        set({ hasSignedIn: true });
      },
      resetOnboarding: () => set(getInitialData()),
```

Edit 6. Find:

```ts
      version: 3,
      storage: createJSONStorage(() => safeStorage),
```

Replace with:

```ts
      version: 4,
      storage: createJSONStorage(() => safeStorage),
```

Edit 7. Find:

```ts
        remindersDirty: state.remindersDirty,
        analyticsConsent: state.analyticsConsent,
      }),
```

Replace with:

```ts
        remindersDirty: state.remindersDirty,
        analyticsConsent: state.analyticsConsent,
        hasSignedIn: state.hasSignedIn,
      }),
```

Edit 8. Find:

```ts
      // added analyticsConsent: a save from before it has never been asked, so it is unset.
      migrate: (persisted: unknown, version: number) => {
        const saved: Record<string, unknown> = isRecord(persisted) ? persisted : {};
        if (version >= 3) return saved as OnboardingPersisted;
        if (version === 2) return { ...saved, analyticsConsent: "unset" } as OnboardingPersisted;
```

Replace with:

```ts
      // added analyticsConsent: a save from before it has never been asked, so it is unset. Version 4 (step 34b) added
      // hasSignedIn: the returning-user rule marks onboarding complete for any signed-in session, so a save from before it
      // that had completed onboarding counts as a device that has signed in.
      migrate: (persisted: unknown, version: number) => {
        const saved: Record<string, unknown> = isRecord(persisted) ? persisted : {};
        if (version >= 4) return saved as OnboardingPersisted;
        const hasSignedIn = saved.hasCompletedOnboarding === true;
        if (version === 3) return { ...saved, hasSignedIn } as OnboardingPersisted;
        if (version === 2) return { ...saved, analyticsConsent: "unset", hasSignedIn } as OnboardingPersisted;
```

Edit 9. Find:

```ts
          remindersDirty: changed && saved.remindersSyncedAt == null,
          analyticsConsent: "unset",
        } as OnboardingPersisted;
```

Replace with:

```ts
          remindersDirty: changed && saved.remindersSyncedAt == null,
          analyticsConsent: "unset",
          hasSignedIn,
        } as OnboardingPersisted;
```

Edit 10. Find:

```ts
          analyticsConsent:
            saved.analyticsConsent === "granted" || saved.analyticsConsent === "declined" ? saved.analyticsConsent : "unset",
        };
```

Replace with:

```ts
          analyticsConsent:
            saved.analyticsConsent === "granted" || saved.analyticsConsent === "declined" ? saved.analyticsConsent : "unset",
          hasSignedIn: saved.hasSignedIn === true,
        };
```

---

## 2. `src/components/StepProgress.tsx` (new, whole file)

```tsx
import { Text, View } from "react-native";

import { analyticsEnv } from "@/constants/env";

// The steps a new person walks through: Welcome, Rhythm, Permissions, the analytics choice (only when a PostHog token is
// set: step 34) and then Sign In, counted as the last step so the progress never resets between the two screens (step 34b).
export const ONBOARDING_STEPS = analyticsEnv.status === "ok" ? 4 : 3;
export const TOTAL_STEPS = ONBOARDING_STEPS + 1;

type StepProgressProps = {
  step: number; // 0-based: the step shown now
  total: number;
  label: string; // the counter ("1 of 5") or "Final step"; drawn uppercase
  accessibilityLabel: string; // "Step 1 of 5"
};

// The pills and the counter at the top of Onboarding and of the Sign In that ends it. Every step done stays filled (the
// goal-gradient effect, step 34b): plum dots behind, the long plum pill for the current step, petal dots ahead. The pills
// are decorative; the counter carries the spoken label.
export function StepProgress({
  step,
  total,
  label,
  accessibilityLabel,
}: StepProgressProps) {
  return (
    <View className="flex-row items-center justify-between pb-4 pt-3">
      <View className="flex-row items-center gap-1.5">
        {Array.from({ length: total }, (_, index) => (
          <View
            key={index}
            className={
              index === step
                ? "h-2 w-7 rounded-full bg-plum"
                : index < step
                  ? "size-2 rounded-full bg-plum"
                  : "size-2 rounded-full bg-petal"
            }
          />
        ))}
      </View>
      <Text
        accessibilityLabel={accessibilityLabel}
        className="font-dm-semibold text-[12px] uppercase leading-[16px] tracking-[1.2px] text-mauve"
      >
        {label}
      </Text>
    </View>
  );
}
```

---

## 3. `src/constants/copy.ts`

Edit 1. Find:

```ts
// "1 day", "7 days". The paywall's trial lines and disclosures share it.
const daysLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);
```

Replace with:

```ts
// "1 day", "7 days". The paywall's trial lines and disclosures share it.
const daysLabel = (days: number) => (days === 1 ? "1 day" : `${days} days`);

// A clock time ("8:00 AM") keeps its digits and its AM or PM on one line (step 34b: the Permissions card and the Sign In
// subtitle name the three reminder times).
const unbreakable = (time: string) => time.replace(" ", "\u00A0");
```

Edit 2. Find:

```ts
      subtitle:
        "Speak or write what you’re carrying. Receive scripture, a spoken devotional, and gentle reminders through your day.",
      primary: "Get Started",
      signIn: "I already have an account",
```

Replace with:

```ts
      subtitle:
        "Speak or write what you’re carrying. In about half a minute, receive a word-for-word Berean Standard Bible passage and a 90-second spoken devotional made from your own words.",
      primary: "Begin Your Quiet Time",
      signIn: "I already have an account",
```

Edit 3. Find:

```ts
      subtitle: "Three short affirmations, drawn from your own prayers, at the times you choose.",
```

Replace with:

```ts
      subtitle: "Three gentle affirmations drawn from your own prayers — waiting on your lock screen at the times you choose.",
```

Edit 4. Find:

```ts
      helper: "You can change these anytime in Settings.",
      primary: "Continue",
      back: "Back",
```

Replace with:

```ts
      helper: "You can change these anytime in Settings.",
      primary: "Save My Daily Rhythm",
      back: "Back",
```

Edit 5. Find:

```ts
    permissions: {
      eyebrow: "Before we begin",
      title: "Two small things to make Gracehush work",
      subtitle: "We’ll only ask once. You can change these in your device settings.",
      microphone: {
        title: "Microphone",
        body: "So you can pray out loud. Your recording is used only to create your reflection.",
      },
      notifications: {
        title: "Notifications",
        body: "For your three daily affirmations. Never ads or spam.",
      },
      privacy: "Your words stay private. You can export or delete everything anytime.",
      primary: "Allow & Continue",
      later: "Maybe later",
    },
    // The consent step (step 34), shown only when a PostHog token is set. Its two choices look the same.
    analytics: {
      eyebrow: "Your choice",
      title: "Help improve Gracehush?",
      subtitle: "Share anonymous usage data, like which features you use. The app works the same either way.",
```

Replace with:

```ts
    permissions: {
      eyebrow: "Your voice & rhythm",
      title: "Let Gracehush hear you and remind you.",
      subtitle: "We’ll only ask once. You can change these in your device settings.",
      microphone: {
        title: "Microphone",
        body: "So you can pray out loud in the car, on a walk or late at night. Your recording is used only to create your reflection.",
      },
      // The three times are the Rhythm step's, as "8:00 AM" (step 34b).
      notifications: {
        title: "Notifications",
        body: (morning: string, afternoon: string, evening: string) =>
          `Delivers your ${unbreakable(morning)}, ${unbreakable(afternoon)} and ${unbreakable(evening)} affirmations. Never ads or streak guilt.`,
      },
      privacy: "Your words stay private. Export or permanently delete everything anytime.",
      primary: "Allow & Continue",
      later: "Ask me later",
    },
    // The consent step (step 34), shown only when a PostHog token is set. Sharing is the filled choice and declining the
    // ghost one, the same size, right under it (step 34b).
    analytics: {
      eyebrow: "Almost there",
      title: "Your prayers stay private.",
      subtitle:
        "Nothing you write or say is ever part of this. Would you like to share anonymous usage data, like which features you use, so we can keep improving Gracehush?",
```

Edit 6. Find:

```ts
  auth: {
    back: "Go back",
    stepLabel: "Step 1 of 1",
    title: "Your sanctuary is waiting.",
    subtitle: "Sign in to keep your reflections safe and synced across your devices.",
```

Replace with:

```ts
  auth: {
    back: "Go back",
    // The sign-in that ends onboarding on a phone that has never signed in carries the flow's last step (step 34b); every
    // other sign-in (after a sign-out, or "I already have an account") is a return.
    finalStep: "Final step",
    welcomeBack: "Welcome back",
    title: "Your sanctuary is waiting.",
    subtitle: "Sign in to keep your reflections safe and synced across your devices.",
    fresh: {
      title: "Save your rhythm and sanctuary.",
      // The three reminder times of the Rhythm step, as "8:00 AM".
      subtitle: (morning: string, afternoon: string, evening: string) =>
        `Lock in your ${unbreakable(morning)}, ${unbreakable(afternoon)} and ${unbreakable(evening)} affirmations, and keep every reflection and answered prayer safe across your devices.`,
    },
```

Edit 7. Find:

```ts
    privacy: {
      title: "Your entries are private",
      body: "AI helps write and organize your reflections; you can export or permanently delete everything at any time.",
    },
    sheet: {
```

Replace with:

```ts
    privacy: {
      title: "Private prayers, real Scripture",
      body: "Scripture is never AI-generated: every passage is word-for-word Berean Standard Bible. AI writes your devotional from your own words; you can export or permanently delete everything at any time.",
    },
    sheet: {
```

---

## 4. `src/screens/onboarding/OnboardingScreen.tsx`

`STEP_COUNT` and the `analyticsEnv` import go (the component exports the counts); the header is the shared row; the Permissions cards are built from the times; the consent footer's first button is filled.

Edit 1. Find:

```tsx
import { PrimaryButton } from "@/components/PrimaryButton";
import {
  openAndroidTimeDialog,
  ReminderTimePicker,
} from "@/components/ReminderTimePicker";
import { copy } from "@/constants/copy";
import { analyticsEnv } from "@/constants/env";
import { images } from "@/constants/images";
```

Replace with:

```tsx
import { PrimaryButton } from "@/components/PrimaryButton";
import {
  openAndroidTimeDialog,
  ReminderTimePicker,
} from "@/components/ReminderTimePicker";
import {
  ONBOARDING_STEPS,
  StepProgress,
  TOTAL_STEPS,
} from "@/components/StepProgress";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
```

Edit 2. Find:

```tsx
// The consent step (step 34) exists only when a PostHog token is set: without one there is nothing to agree to.
const STEP_COUNT = analyticsEnv.status === "ok" ? 4 : 3;
const CONSENT_STEP = 3;
```

Replace with:

```tsx
// The consent step (step 34) exists only when a PostHog token is set (ONBOARDING_STEPS is then 4): without one there is
// nothing to agree to. The counter and the pills also count the Sign In that follows (TOTAL_STEPS, step 34b).
const CONSENT_STEP = 3;
```

Edit 3. Find:

```tsx
type StepCard = { icon: SymbolViewProps["name"]; title: string; body: string };

const permissionCards: readonly StepCard[] = [
  { icon: icons.microphone, ...permissions.microphone },
  { icon: icons.notifications, ...permissions.notifications },
];
```

Replace with:

```tsx
type StepCard = { icon: SymbolViewProps["name"]; title: string; body: string };

// The Permissions step's cards. The notifications one names the three times chosen on the Rhythm step (step 34b).
function permissionCardsFor(times: {
  morning: string;
  afternoon: string;
  evening: string;
}): readonly StepCard[] {
  return [
    { icon: icons.microphone, ...permissions.microphone },
    {
      icon: icons.notifications,
      title: permissions.notifications.title,
      body: permissions.notifications.body(
        times.morning,
        times.afternoon,
        times.evening,
      ),
    },
  ];
}
```

Edit 4. Find:

```tsx
function afterPermissions() {
  if (STEP_COUNT > CONSENT_STEP) goToStep(CONSENT_STEP);
  else completeOnboarding();
}

// The consent step's two equal choices. Either one finishes onboarding; only a yes sends the first event.
```

Replace with:

```tsx
function afterPermissions() {
  if (ONBOARDING_STEPS > CONSENT_STEP) goToStep(CONSENT_STEP);
  else completeOnboarding();
}

// The consent step's two choices, the filled one to share and the ghost one to decline (step 34b). Either one finishes
// onboarding; only a yes sends the first event.
```

Edit 5. Find:

```tsx
  // The consent step has its own footer (two buttons that look the same); the other steps take theirs from the list.
  const footer = footers[Math.min(step, CONSENT_STEP - 1)];

  return (
    <SafeAreaView style={styles.screen}>
      <View className="screen__content flex-row items-center justify-between pb-4 pt-3">
        <View className="flex-row items-center gap-1.5">
          {Array.from({ length: STEP_COUNT }, (_, index) => (
            <View
              key={index}
              className={index === step ? "h-2 w-7 rounded-full bg-plum" : "size-2 rounded-full bg-petal"}
            />
          ))}
        </View>
        <Text
          accessibilityLabel={stepLabel(step + 1, STEP_COUNT)}
          className="font-dm-semibold text-[12px] uppercase leading-[16px] tracking-[1.2px] text-mauve"
        >
          {stepCounter(step + 1, STEP_COUNT)}
        </Text>
      </View>
      <View className="divider" />
```

Replace with:

```tsx
  // The consent step has its own footer (a filled button over a ghost one); the other steps take theirs from the list.
  const footer = footers[Math.min(step, CONSENT_STEP - 1)];
  const times = {
    morning: formatTime12(reminders.morning),
    afternoon: formatTime12(reminders.afternoon),
    evening: formatTime12(reminders.evening),
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View className="screen__content">
        <StepProgress
          step={step}
          total={TOTAL_STEPS}
          label={stepCounter(step + 1, TOTAL_STEPS)}
          accessibilityLabel={stepLabel(step + 1, TOTAL_STEPS)}
        />
      </View>
      <View className="divider" />
```

Edit 6. Find:

```tsx
                <StepCards cards={permissionCards} />
                <PrivacyLine text={permissions.privacy} />
```

Replace with:

```tsx
                <StepCards cards={permissionCardsFor(times)} />
                <PrivacyLine text={permissions.privacy} />
```

Edit 7. Find:

```tsx
<View className="gap-3 pb-2 pt-6">
  <PrimaryButton
    label={consent.share}
    tone="ghost"
    onPress={() => chooseAnalytics("granted")}
  />
  <PrimaryButton
    label={consent.notNow}
    tone="ghost"
    onPress={() => chooseAnalytics("declined")}
  />
</View>
```

Replace with:

```tsx
<View className="gap-3 pb-2 pt-6">
  <PrimaryButton
    label={consent.share}
    iconRight={icons.arrow}
    onPress={() => chooseAnalytics("granted")}
  />
  <PrimaryButton
    label={consent.notNow}
    tone="ghost"
    onPress={() => chooseAnalytics("declined")}
  />
</View>
```

---

## 5. `src/screens/auth/SignInScreen.tsx`

Edit 1. Find:

```tsx
import { Icon } from "@/components/Icon";
import { PrivacyNoteCard } from "@/components/PrivacyNoteCard";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useAuthActions } from "@/hooks/useAuthActions";
import type { RootStackParamList } from "@/navigation/types";

import { EmailSheet } from "./EmailSheet";

const { back, stepLabel, title, subtitle, apple, google, email, or, privacy } =
  copy.auth;
```

Replace with:

```tsx
import { Icon } from "@/components/Icon";
import { PrivacyNoteCard } from "@/components/PrivacyNoteCard";
import { StepProgress, TOTAL_STEPS } from "@/components/StepProgress";
import { copy } from "@/constants/copy";
import { images } from "@/constants/images";
import { colors, shadows } from "@/constants/theme";
import { useAnnounce } from "@/hooks/useAnnounce";
import { useAuthActions } from "@/hooks/useAuthActions";
import type { RootStackParamList } from "@/navigation/types";
import { useOnboardingStore } from "@/store/onboardingStore";
import { formatTime12 } from "@/utils/format";

import { EmailSheet } from "./EmailSheet";

const {
  back,
  finalStep,
  welcomeBack,
  title,
  subtitle,
  fresh: freshCopy,
  apple,
  google,
  email,
  or,
  privacy,
} = copy.auth;
const { stepLabel } = copy.onboarding;
```

Edit 2. Find:

```tsx
const [emailOpen, setEmailOpen] = useState(false);

useAnnounce(error);
```

Replace with:

```tsx
const [emailOpen, setEmailOpen] = useState(false);
const hasSignedIn = useOnboardingStore((state) => state.hasSignedIn);
const reminders = useOnboardingStore((state) => state.reminders);
// The sign-in that ends onboarding on a phone that has never signed in is the flow's last step, with its progress
// carried over. Anyone else (after a sign-out, or "I already have an account") is welcomed back (step 34b).
const fresh = !hasSignedIn && !navigation.canGoBack();

useAnnounce(error);
```

Edit 3. Find:

```tsx
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View className="screen__content">
          <View className="h-14 flex-row items-center justify-between">
            {navigation.canGoBack() ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={back}
                onPress={() => navigation.goBack()}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <View className="size-11 items-center justify-center">
                  <Icon name={icons.back} size={24} color={colors.ink} />
                </View>
              </Pressable>
            ) : (
              <View className="size-11" />
            )}
            <Text className="text-label-md tracking-[0.3px] text-mauve">{stepLabel}</Text>
            <View className="size-11" />
          </View>

          <View className="items-center">
            <View
              className="icon-tile mt-2 size-16 border border-petal/60"
              style={shadows.card}
            >
              <Image
                source={images.logoMark}
                contentFit="contain"
                style={styles.logoMark}
              />
            </View>
            <Text className="mt-5 text-center text-title tracking-[-0.7px] text-ink">{title}</Text>
            <Text className="mt-2 max-w-[290px] text-center text-body text-mauve">{subtitle}</Text>
          </View>
```

Replace with:

```tsx
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {fresh ? (
          // The same header as Onboarding's, with every pill filled: the flow goes on, it does not start over.
          <>
            <View className="screen__content">
              <StepProgress
                step={TOTAL_STEPS - 1}
                total={TOTAL_STEPS}
                label={finalStep}
                accessibilityLabel={stepLabel(TOTAL_STEPS, TOTAL_STEPS)}
              />
            </View>
            <View className="divider" />
          </>
        ) : null}
        <View className="screen__content">
          {fresh ? null : (
            <View className="h-14 flex-row items-center justify-between">
              {navigation.canGoBack() ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={back}
                  onPress={() => navigation.goBack()}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <View className="size-11 items-center justify-center">
                    <Icon name={icons.back} size={24} color={colors.ink} />
                  </View>
                </Pressable>
              ) : (
                <View className="size-11" />
              )}
              <Text className="text-label-md tracking-[0.3px] text-mauve">{welcomeBack}</Text>
              <View className="size-11" />
            </View>
          )}

          <View className={fresh ? "mt-6 items-center" : "items-center"}>
            <View
              className="icon-tile mt-2 size-16 border border-petal/60"
              style={shadows.card}
            >
              <Image
                source={images.logoMark}
                contentFit="contain"
                style={styles.logoMark}
              />
            </View>
            <Text className="mt-5 text-center text-title tracking-[-0.7px] text-ink">
              {fresh ? freshCopy.title : title}
            </Text>
            <Text className="mt-2 max-w-[290px] text-center text-body text-mauve">
              {fresh
                ? freshCopy.subtitle(
                    formatTime12(reminders.morning),
                    formatTime12(reminders.afternoon),
                    formatTime12(reminders.evening),
                  )
                : subtitle}
            </Text>
          </View>
```

---

## 6. `src/navigation/RootNavigator.tsx`

Edit 1. Find:

```tsx
const hasCompletedOnboarding = useOnboardingStore(
  (state) => state.hasCompletedOnboarding,
);
const completeOnboarding = useOnboardingStore(
  (state) => state.completeOnboarding,
);

// A signed-in user has already been through the first screens (on another device, or before this
// flag existed). Marking it done keeps Welcome from showing after they sign out.
useEffect(() => {
  if (isLoaded && isSignedIn && !hasCompletedOnboarding) {
    completeOnboarding();
  }
}, [isLoaded, isSignedIn, hasCompletedOnboarding, completeOnboarding]);
```

Replace with:

```tsx
const hasCompletedOnboarding = useOnboardingStore(
  (state) => state.hasCompletedOnboarding,
);
const completeOnboarding = useOnboardingStore(
  (state) => state.completeOnboarding,
);
const markSignedIn = useOnboardingStore((state) => state.markSignedIn);

// A signed-in user has already been through the first screens (on another device, or before this
// flag existed). Marking it done keeps Welcome from showing after they sign out, and the device now
// counts as one that has signed in, so the next Sign In welcomes the person back (step 34b). Both
// actions are idempotent.
useEffect(() => {
  if (isLoaded && isSignedIn) {
    completeOnboarding();
    markSignedIn();
  }
}, [isLoaded, isSignedIn, completeOnboarding, markSignedIn]);
```

---

## 7. The checks

### 7.1 `supabase/tests/profile-sync/run.cjs` (88 to 90 checks)

Edit 1. Find:

```js
await test("onboarding: what is saved is version 3 and includes remindersDirty and the analytics choice", async () => {
  const { env, store } = await onboarding(undefined);
  store.getState().setReminder("afternoon", "14:00");
  await sleep(30);
  const saved = JSON.parse(env.storage.get("gracehush.onboarding"));
  assert.equal(saved.version, 3);
  assert.equal(saved.state.analyticsConsent, "unset");
  assert.equal(saved.state.remindersDirty, true);
  assert.equal(saved.state.reminders.afternoon, "14:00");
  assert.equal(typeof saved.state.setReminder, "undefined");
});
```

Replace with:

```js
await test("onboarding: what is saved is version 4 and includes remindersDirty, the analytics choice and hasSignedIn", async () => {
  const { env, store } = await onboarding(undefined);
  store.getState().setReminder("afternoon", "14:00");
  await sleep(30);
  const saved = JSON.parse(env.storage.get("gracehush.onboarding"));
  assert.equal(saved.version, 4);
  assert.equal(saved.state.analyticsConsent, "unset");
  assert.equal(saved.state.hasSignedIn, false);
  assert.equal(saved.state.remindersDirty, true);
  assert.equal(saved.state.reminders.afternoon, "14:00");
  assert.equal(typeof saved.state.setReminder, "undefined");
});
await test("onboarding: a session marks the device as signed in once, the dev reset clears it, and an older save counts a completed onboarding as signed in", async () => {
  const { store } = await onboarding(undefined);
  assert.equal(store.getState().hasSignedIn, false);
  store.getState().markSignedIn();
  store.getState().markSignedIn();
  assert.equal(store.getState().hasSignedIn, true);
  store.getState().resetOnboarding();
  assert.equal(store.getState().hasSignedIn, false);
  const v3 = (extra) => ({
    state: {
      ...v1().state,
      remindersDirty: false,
      analyticsConsent: "unset",
      ...extra,
    },
    version: 3,
  });
  const done = await onboarding(v3({ hasCompletedOnboarding: true }));
  assert.equal(
    done.store.getState().hasSignedIn,
    true,
    "a version 3 save that completed onboarding has signed in",
  );
  const fresh = await onboarding(v3({ hasCompletedOnboarding: false }));
  assert.equal(
    fresh.store.getState().hasSignedIn,
    false,
    "one that did not has not",
  );
  const bad = await onboarding({
    state: { ...v1().state, hasSignedIn: "yes" },
    version: 4,
  });
  assert.equal(
    bad.store.getState().hasSignedIn,
    false,
    "a value that is not true reads as false",
  );
});
await test("copy: the Permissions card and the Sign In subtitle name the three times with no-break spaces and curly punctuation", async () => {
  const { env } = await onboarding(undefined);
  const { copy } = env.use("@/constants/copy");
  const nb = String.fromCharCode(160);
  const texts = [
    copy.onboarding.permissions.notifications.body(
      "8:00 AM",
      "1:00 PM",
      "8:00 PM",
    ),
    copy.auth.fresh.subtitle("7:30 AM", "12:00 PM", "9:45 PM"),
  ];
  for (const text of texts) {
    assert.equal(
      text.split(nb).length - 1,
      3,
      "each clock time is joined by a no-break space",
    );
    assert.ok(
      !/[0-9] [AP]M/.test(text),
      "no clock time can break before its AM or PM",
    );
    assert.ok(
      !text.includes(String.fromCharCode(39)),
      "curly punctuation only",
    );
  }
  assert.ok(
    texts[0].includes("7:30") === false &&
      texts[1].includes("7:30" + nb + "AM"),
  );
});
```

### 7.2 `supabase/tests/analytics/run.cjs` (34 checks, one renamed)

Edit 1. Find:

```js
  await test("store: a fresh install is unset; the answer is saved as version 3; reset clears it", async () => {
```

Replace with:

```js
  await test("store: a fresh install is unset; the answer is saved as version 4; reset clears it", async () => {
```

Edit 2. Find:

```js
const saved = JSON.parse(w.env.storage.get("gracehush.onboarding"));
assert.equal(saved.version, 3);
assert.equal(saved.state.analyticsConsent, "granted");
```

Replace with:

```js
const saved = JSON.parse(w.env.storage.get("gracehush.onboarding"));
assert.equal(saved.version, 4);
assert.equal(saved.state.analyticsConsent, "granted");
```

---

## 8. Verification

### Part A: automated (offline)

1. `npm run typecheck` and `npm run lint` exit 0.
2. profile-sync 90, analytics 34, notifications 48; every other suite at its baseline count (none of them reads the changed strings or the store's version). Red first as section 0 says.
3. Breakages, in a scratch copy of the repo (a junction to `node_modules`, removed with `cmd //c rmdir`; never the repo, the user's dev server is running), each caught by a named check: (a) the version 3 migration sets `hasSignedIn` to false whatever the save (the `hasSignedIn` check); (b) `unbreakable` returns its input (the copy check); (c) `partialize` leaves `hasSignedIn` out (the version 4 check); (d) `markSignedIn` sets `hasSignedIn` only when `hasCompletedOnboarding` is true (the `hasSignedIn` check: a fresh store marks it).
4. Greps: `git grep -n "stepLabel" -- src` finds only `copy.onboarding.stepLabel` and its readers (`OnboardingScreen.tsx`, `SignInScreen.tsx`) and `ProcessingOverlay`'s own; no "Maybe later", "Get Started", "Step 1 of 1", "Before we begin" or "Help improve Gracehush?" is left in `src`; the release gate still prints 4; `git grep -n "Encrypted" -- src` finds nothing.
5. The bundle (the dev bundle of the running server, searched for strings, never printed): "Begin Your Quiet Time", "Save My Daily Rhythm", "Ask me later", "Almost there", "Final step", "Welcome back" and "Private prayers, real Scripture" present once each; `StepProgress` resolved.

### Part B: the phone walk-through (iPhone, Expo Go)

Before B0: `npx expo start -c` (a new file), then a force-quit and a reopen of Expo Go. The account is the one signed in on the phone now (free; it has one reflection). It costs nothing new: no reflection is made, and the sign-ins run only the profile sync. The walk-through resets onboarding on the phone (the developer button), which signs out; the user signs in again twice, with the implementer asking first each time. Keep Expo Go open and in front for the whole run. The implementer reads the stores and the rendered strings through the dev server's inspector (read-only) and asks for a screenshot where only a screenshot shows it (the pills' fill, the filled button).

- **B0.** Do: open the app on Journal. Expect: signed in; `hasCompletedOnboarding` true and `hasSignedIn` true (the version 3 save migrated, because the device had completed onboarding); analytics env `ok`, so `TOTAL_STEPS` is 5. Read: the onboarding store and `TOTAL_STEPS` through the inspector, and the three reminder times, written down: B1's reset puts the device's times back to the defaults, and B8 restores these.
- **B1.** Do: Profile, scroll to the developer panel, tap **Reset onboarding (dev)**. Expect: the Welcome step with "1 OF 5", one long plum pill and four petal dots, the new subtitle and "Begin Your Quiet Time"; `hasSignedIn` false. Read: the store; the rendered strings; a screenshot for the pills.
- **B2.** Do: tap **Begin Your Quiet Time**, then on Rhythm tap **Morning** and set **7:30 AM** on the wheel, then **Done**. Expect: "2 OF 5" with the first dot plum and the second the long pill; the new subtitle; the chip "7:30 AM"; "Save My Daily Rhythm". Read: `reminders.morning` is "07:30"; the strings; a screenshot.
- **B3.** Do: tap **Save My Daily Rhythm**. Expect: Permissions with "3 OF 5" (two plum dots, then the pill); "YOUR VOICE & RHYTHM"; "Let Gracehush hear you and remind you."; the microphone card's new body; the notifications card reads "Delivers your 7:30 AM, 1:00 PM and 8:00 PM affirmations. Never ads or streak guilt."; the privacy line "Your words stay private. Export or permanently delete everything anytime."; "Ask me later" under the button. Read: the rendered strings (the dynamic one holds "7:30"); a screenshot.
- **B4.** Do: tap **Ask me later**. Expect: no OS prompt; the consent step with "4 OF 5" (three plum dots, then the pill), "ALMOST THERE", "Your prayers stay private.", the new subtitle, the two cards, and a **filled plum "Share usage data"** with an arrow over a white "Not now" of the same height. Read: the microphone and notification permissions unchanged; the rendered strings and the two buttons' classes (`btn-primary` over `btn-ghost`); a screenshot.
- **B5.** Do: tap **Not now**. Expect: Sign In, the fresh variant: five plum pills (the last long) with "FINAL STEP" and no chevron; "Save your rhythm and sanctuary."; "Lock in your 7:30 AM, 1:00 PM and 8:00 PM affirmations, and keep every reflection and answered prayer safe across your devices."; Apple, Google, or, email; the privacy card "Private prayers, real Scripture" with the new body; `analyticsConsent` declined, `hasCompletedOnboarding` true, `hasSignedIn` false. Read: the store; the strings; the counter's accessibility label "Step 5 of 5"; a screenshot.
- **B6.** Do: force-quit Expo Go and reopen the project. Expect: still the fresh variant (the flag is persisted). Read: the store and the strings after the restart.
- **B7.** Do: sign in (**Continue with email**, the same address, **Send code**, **424242**). Expect: Journal; `hasSignedIn` true. Then Do: Profile, **Sign Out**, **Sign out**. Expect: the returning variant: no pills, "Welcome back" centered with the spacer (no chevron), "Your sanctuary is waiting." and the subtitle as before. Read: the store; the strings; a screenshot.
- **B8.** Do: sign in again, then on Profile open **Daily Reminders** and set each slot back to the time B0 read (Morning from 7:30 AM; the other two only if they were not the defaults). Expect: the store holds B0's three times and, within a few seconds, `remindersDirty` false (the profile sync sent them; at B7's sign-in it had sent the reset device's times, 07:30 and the two defaults, over the server's). Read: the store; the server's row through the app's own profile read.
- **B9 (optional).** Do: Reset onboarding (dev), then on Welcome tap **I already have an account**. Expect: Sign In with the chevron and "Welcome back" (the device has signed in before, and there is a screen to go back to); the chevron returns to Welcome. Then complete onboarding (Begin, Save My Daily Rhythm, Ask me later, Not now) and sign in again. Read: the strings; the store.

Not verified on this target, and where: VoiceOver's reading of "Step 5 of 5" and of the two consent buttons (the iPhone with VoiceOver on, by the user); Android (the emulator holds the user's own account: only with their yes); the iOS development build (nothing here needs it).

---

## 9. AGENTS.md updates

- **Screen Specifications, 1. Onboarding:** the header counts Sign In ("1 OF 5", or "1 OF 4" without a PostHog token) and every step done stays plum (`StepProgress`); step 1's subtitle and "Begin Your Quiet Time"; step 2's subtitle and "Save My Daily Rhythm"; step 3's eyebrow, headline, the microphone body, the notifications body that names the three times, the privacy line and "Ask me later"; step 4's eyebrow, headline and subtitle, and its footer: "Share usage data" is the filled primary with the arrow, "Not now" a same-size ghost pill under it (replace "two buttons that look the same, both ghost pills, so neither is pushed" and "There is no default"). Record that this supersedes step 34's decision 11.
- **Screen Specifications, 2. Sign In:** the two variants and `hasSignedIn`; the header label "Welcome back" (replace "Step 1 of 1" in the header bullet); the fresh headline and subtitle with the times; the privacy card's new title and body.
- **Navigation Map:** the Sign In chevron bullet ("keeps 'Step 1 of 1' centered" becomes "keeps 'Welcome back' centered"; the fresh variant has no chevron row).
- **Analytics Rules:** the consent bullet gains "the step's Share usage data is the filled button and Not now a same-size ghost pill under it (step 34b)".
- **State Management Rules, Onboarding store:** version 4, `hasSignedIn` and `markSignedIn`, the migration rule.
- **Components "Built so far" and the tree:** `StepProgress` (`ONBOARDING_STEPS`, `TOTAL_STEPS`); `copy.auth.finalStep`, `welcomeBack` and `fresh`; the `unbreakable` helper.
- **Copy & Tone Rules:** nothing new (the rules were applied).
- **Linting and Validation:** profile-sync is 90 checks.
- **Build Status & Decisions Log:** a "Step 34b — Onboarding and Sign In UX pass" entry in the form of the ones before it (decisions, files, differences from this prompt, measured results, red numbers, breakages, the walk-through line by line, known limits). Then copy AGENTS.md to `prompts/AGENTS.md`.

Known limits to record: "In about half a minute" is the typical time (18 to 25 s measured) and a busy model can take up to 90 s; the "90-second" devotional measured 78 to 99 s; the lock-screen line on the Rhythm step is true only once notifications are allowed and a reflection has finished; an existing install that completed onboarding without ever signing in (none is known) reads as returning after the migration.

---

## 10. Report

Lead with what changed and where, then how to test it. Include: the request's instructions and what each became (the table above, in short); the files created and changed; the test counts before and after, the red numbers and the breakages caught; the walk-through B0 to B9, one line each; what could not be checked and where it can be. End with the one line from AGENTS.md, "Guided phone walk-through": "Automated checks pass. Shall I start the guided walk-through now (B0 to B9)? Keep Expo Go open on the iPhone, in front and connected to the dev server."
