# 09-journal-home-ui.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory": the iOS developer account comes last, and my iPhone stays on Expo Go until then.

Implement the Journal Home (feed) screen exactly as shown in the attached design, replacing the step 08 placeholder: the greeting block, the affirmation card, the "Your Reflections" row with its filter sheet, one card per entry for every processing status, and the loading, empty, error and offline states. The greeting uses the signed-in Clerk user. Everything else loads through `journalRepository`, `selectors` and `format` from step 06, and the data stays mocked. Nothing here needs a development build or a new package: the iPhone (Expo Go) and the Android emulator both run this step.

Where things stand after step 08: `src/screens/journal/JournalFeedScreen.tsx` is a TEMP placeholder (a top-edge `SafeAreaView`, `ScreenHeader`, a `ScrollView` with `useScrollToTop` and `useTabScreenBottomPadding()`, and a `__DEV__` "Open sample reflection" button). `Reflection` and `NewEntry` are TEMP screens that already accept `{ entryId }` and `{ mode }`. The mock scenario is still the `TEMP(09)` module variable in `src/data/mock/scenario.ts`, and `DevToolsPanel` holds the scenario buttons and the step 06 data check. `.env.local` holds the Clerk development key, which is all this step needs (it reads no environment variable).

Design reference (read only). Take every size from the HTML, where 1 CSS px = 1dp, and never from the PNG (the PNGs are rendered at 1.25x):

- `prompt_material/03-journal-home.png` and `prompt_material/03-journal-home.html`

The PNG shows only the normal feed. The Offline and Empty views exist only in the HTML (`#view-offline` and `#view-empty`; the Stitch toggle switches between them), so read those two sections of the HTML as well. Ignore the Stitch toggle "Feed (Normal) / Offline Sync / Empty State": those states come from data and the mock scenario.

## What the design says (measured, final)

Every size below comes from the HTML, never the PNG: a PNG measurement is 1.25x too large (it gives a 34/40 greeting against the HTML's 28/34, a 24 list padding against 20, a 22 heart against 18, a 12 card gap against 14 and a 30 tall pill against 26). Tokens win over the HTML (AGENTS.md "Standing Rulings"), and where the HTML copy differs from this prompt's copy, this prompt wins. List every difference you keep in your report.

Narrow screens and large text: React Native's default `flexShrink` is 0, so text beside a fixed element (a chip, badge, pill, icon or button) must be `flex-1` or `shrink` to wrap or truncate instead of pushing that element out. Two rows cannot fit on one line at 320dp or at font scale 1.3, so their wrapping is specified below (the greeting row and the section row). The card's top row fits (measured from the font files) and its bottom row truncates the reference.

### List

| Part | Build |
| --- | --- |
| List | `FlatList`. `contentContainerStyle`: side padding 20 (16 below 360dp: `width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding`, with `width` from `useWindowDimensions`), `paddingTop` 20 (in the HTML the Stitch toggle sits above the greeting with a 20 gap: the toggle is not built, the gap stays), `paddingBottom: useTabScreenBottomPadding()` (112, the dock clearance) |
| Spacing | 20 between the greeting, the offline banner (only when offline), the affirmation card, the section row and the first card (the HTML's `space-y-5`). The section row has its own 4 on top, so 24 above it. Cards are 14 apart (`space-y-3.5`) |

### Greeting block (`header` in the HTML)

| Part | Build |
| --- | --- |
| Row | `flex-row flex-wrap items-start justify-between gap-2 pt-1` |
| Greeting | `text-title tracking-[-0.7px] text-plum-deep` (28/34 SemiBold), `accessibilityRole="header"`. One `Text`: "Good {morning\|afternoon\|evening}, {name}", or "Good {period}" when there is no name. It wraps naturally: the chip takes the right side, so at 390dp the design breaks after "Good" and "morning,". Never insert line breaks. The greeting and the date form one block that is `flex-1` with `minWidth: 136 * fontScale` (`fontScale` from `useWindowDimensions`; 136 is the width of "afternoon," at 28dp, the longest greeting word, measured from the font file). Where the block cannot be that wide (320dp, or font scale 1.3 on a 390dp screen) the row wraps and the chip drops below the date, so the title never breaks inside a word. At 390dp and default text the chip stays on the right, as in the design |
| Period | `getGreeting(now)` from `src/data/selectors.ts` (step 06): 5 to 11 morning, 12 to 16 afternoon, otherwise evening, from the clock |
| Name | `getDisplayName({ firstName: user?.firstName, email: user?.primaryEmailAddress?.emailAddress })` from `src/utils/format.ts`: the Clerk first name, else the capitalized email local part up to the first dot, underscore, dash, plus or digit (`sarah.j92@…` gives "Sarah"), else `null`. Email-only sign-ups have no first name, so the fallback is common. Never show "null" or an email address |
| Date | `formatLongDate(now)`, `mt-0.5 text-body-sm text-mauve` |
| Chip | Only when `reflectionDays > 0`. `mt-1 shrink-0`. Classes `chip chip--terracotta gap-1.5 border border-terracotta/25` with a sun icon 15 in `terracotta` and the label `chip__label chip__label--terracotta` ("{n} days of reflection", "1 day of reflection" for one). Never any broken-streak wording. Not pressable |

### Affirmation card (`src/components/AffirmationCard.tsx`)

White `.card` with `p-5 gap-2.5` and `style={shadows.card}`.

| Part | Build |
| --- | --- |
| Top row | `flex-row items-center justify-between gap-2`: `eyebrow` (`flex-1`) "{Slot} affirmation" (stored in sentence case, `uppercase` does the casing; slot names from `copy.onboarding.rhythm.slots`). On the right the heart toggle: icon 18, `hitSlop` 13 so the touch area is 44, `mauve` when not saved and `plum-deep` when saved |
| Headline | `text-section tracking-[-0.5px] text-ink` (Fraunces Medium 20/28) |
| Body | `text-body text-ink/80` (15/22) |
| Footer | `pt-1`, clock icon 14 in `mauve` + `text-body-sm text-mauve`: "{formatTime12(profile.reminders[slot])} • Tied to {source}" |
| Source | From the entry the affirmation belongs to (`entries.find` by `affirmation.entryId` in the unfiltered list), by calendar days from `now`: "today's prayer", "yesterday's prayer" or "your {Mon D} prayer" (`formatShortDate`). If that entry is not in the list, show the time only. Put this in a pure `getAffirmationSource(createdAtIso, now)` in `format.ts`, with the three phrases in `copy.journal` (`format.ts` already imports `copy` for `formatEntryTimestamp`) |
| Which one | `getAffirmationForSlot(affirmations, currentSlot)`, where `currentSlot = getCurrentSlot(now, profile.reminders)`. The greeting follows the clock and the affirmation follows the user's reminder times, so between 17:00 and the evening reminder the greeting says "evening" while the card is still the afternoon one. That is intended |
| Favorite | `AffirmationCard` owns an optimistic `favorite` state, initialised from `affirmation.isFavorite`; the screen passes `key={affirmation.id}` so a new affirmation resets it. Accessibility label "Save affirmation" or "Remove from saved". `// TODO(25): persist is_favorite` |
| Hidden | When there is no affirmation (a new user with no finished entry, or no row for the current slot). `getLatestAffirmations()` skips crisis entries (step 06), so a crisis never feeds or hides the card. Never a placeholder affirmation |

### Section row

| Part | Build |
| --- | --- |
| Row | `pt-1 flex-row items-center gap-2` |
| Left | `flex-1 flex-row flex-wrap items-baseline gap-x-2`: "Your Reflections" in `text-section tracking-[-0.5px] text-ink` (`accessibilityRole="header"`) and the count in `text-label-md text-mauve` ("{n} entries", "1 entry"). When there is no room (320dp, or large text) the count wraps under the title: the one-line row needs about 294dp at default text and 371dp at font scale 1.3, measured from the font files |
| Right | "Filter" pressable: `shrink-0 flex-row items-center gap-1`, label `text-label-md text-plum-deep` then the sliders icon 16 in `plum-deep`, `hitSlop` so the touch area is at least 44 tall. With a filter on, the label reads "Filter · 1" in `font-dm-semibold` (a weight change, not only a color). Its accessibility label is "Filter reflections", plus ", showing {chip name}" while a filter is on, so the state is spoken |
| Count | Of the filtered list. The row is hidden in the full empty state, and shown in the filtered-empty state |

### Journal card (`src/components/JournalCard.tsx`)

White `.card` with `gap-2.5` (padding 16, radius 16, 1px Petal) and `style={shadows.card}`. The whole card is one pressable (the AGENTS.md pattern: the `Pressable` carries only the `style` function with scale 0.98, the classes go on an inner `View`) that opens `Reflection` with `{ entryId }`. No double-tap guard is needed: `navigate` to the route that is already on top reuses it instead of pushing a second one.

**Ready entry (the design):**

- Top row: the timestamp from `formatEntryTimestamp(entry.createdAt, now)` (`text-body-sm text-mauve`, one line, shrinks) on the left and the `EmotionBadge` (`shrink-0`) on the right.
- Transcript: wrapped in curly quotes, `text-body text-ink`, `numberOfLines={2}`, trimmed.
- Bottom row (`pt-0.5`): the scripture reference on the left (`font-fraunces-italic text-[15px] leading-[20px] text-rosewood`, one line, `flex-1`, 12 from the pill; the 400 italic is the only italic loaded, so the HTML's medium italic is not available) and the duration pill on the right. With no scripture (`entry.scripture` is `null`) the left side stays empty and the pill or chip keeps to the right (`ml-auto`).
- Duration pill: `flex-row items-center gap-1.5 rounded-full bg-plum-deep px-3 py-1`, a white play icon 14 and `formatDuration(devotional.durationMs)` in `font-dm-semibold text-[12px] leading-[18px] text-white` with `style={{ fontVariant: ["tabular-nums"] }}`. `durationMs` is nullable and audio can exist without one (step 18 leaves it `null` on old rows): when it is `null` or 0 the pill shows the play icon alone, never "0:00". It is a plain `View` for now, because the card's `Pressable` already opens Reflection (`// TODO(26): play in place`: step 26 turns it into its own `Pressable` with `hitSlop` so the touch area is 44).

**Every status has a card** (no mockup; same shell). A transcript can be `null`: audio entries have none until the server has processed them, so the `processing` and `failed` mock entries have no transcript. Where there is none, show "Voice reflection" (`text-body text-mauve`, no quotes) in its place.

| Status | Top-right | Body | Bottom row |
| --- | --- | --- | --- |
| `ready` | emotion badge | quoted transcript, 2 lines | reference + duration pill |
| `ready`, no `devotional?.audioPath` (`null`, or no devotional) | emotion badge | quoted transcript | reference + `.chip` "Text only" (`chip__label`) instead of the pill |
| `processing` | none | transcript, or "Voice reflection" | small plum `ActivityIndicator` + "Preparing your devotional…" (`text-body-sm text-mauve`) |
| `uploading` | none | transcript, or "Voice reflection" | the same, with "Saving your reflection…" |
| `pending` | none | transcript, or "Voice reflection" | `.chip` with an hourglass icon 12 + "Waiting to sync" |
| `failed` | none | transcript, or "Voice reflection" | `text-body-sm text-rosewood` "We couldn't finish this one." + a ghost mini pill "Try again" with a refresh icon 14. The pill does nothing yet (`// TODO(24): retry sync`) and carries `accessibilityState={{ disabled: true }}` |
| `isCrisis` | none | "A heavy moment. Tap to see support." in place of the transcript (the transcript is never shown) | `.chip` with a heart icon 12 + "Support resources". No emotion badge, no scripture, no crisis red |

Only ready and crisis cards open Reflection. The others are a plain `View` (not a button), still one accessibility element with a label.

Accessibility label per card, built from the parts that exist: ready "Reflection from Yesterday, 8:45 PM. Emotion: anxious. Philippians 4:6–7. Devotional 1 minute 15 seconds." (text only: "… Text only."; no measured duration: "… Devotional audio."; "Emotion:" reads right for all five emotions, "Feeling grieving" does not), processing "Reflection from {timestamp}. Preparing your devotional.", uploading "… Saving your reflection.", pending "… Waiting to sync.", failed "… We couldn't finish this one.", crisis "… Support resources are available." Add `formatDurationSpoken(ms)` to `src/utils/format.ts` ("1 minute 15 seconds", "58 seconds", "2 minutes"). The transcript is never part of a label.

### Emotion badge (`src/components/EmotionBadge.tsx`)

Props: only `emotion: string`. Steps 12, 13 and 14 reuse it. `rounded-full px-2.5 py-0.5`, colors from `getEmotionColors(emotion)` (dynamic, so `style`), label `font-dm-semibold text-[11px] leading-[16px] tracking-[0.3px]` with the first letter capitalized. Unknown emotions use the weary colors and still show their own label.

### Offline banner (`src/components/OfflineBanner.tsx`)

`.card card--blush flex-row items-start gap-3` (no shadow, as on the Sign In privacy card), directly under the greeting block, which is where the HTML's offline view puts it. That view swaps out the affirmation card and the section row, which a real offline user keeps, so the order is greeting, banner, affirmation card, section row. `accessibilityLiveRegion="polite"`. A `size-8 mt-0.5 rounded-full bg-petal` circle with a cloud-off icon 19 in `plum-deep`, then a `flex-1 gap-0.5` column: the title "Offline mode" (`font-dm-semibold text-[13px] leading-[18px] text-plum-deep`) and the body (`text-body-sm text-ink/80`): "You're offline. {n} reflections are saved and will be prepared when you reconnect." with `n` = the number of `isLocalOnly` entries ("1 reflection is saved and will be prepared…"). With `n` = 0: "You're offline. New reflections will be saved on this device."

### Synced toast (`src/components/Toast.tsx`)

Props: `message` and `visible` only. A pill: `rounded-full border border-sage/30 bg-grateful-bg px-4 py-2.5`, a check icon 14 and the label `text-label-md text-grateful-fg` (the token pair is 5.07:1). It fades in over 200ms when `visible` turns true and out over 200ms when it turns false; the screen owns the 2.5s timer that keeps `visible` true. It sits centered with its bottom edge `layout.dockOffset + layout.dockOrb + 12` above the bar, so it clears the dock. `pointerEvents="none"`. The screen shows "All reflections synced" when `isOffline` changes from true to false. Because it disappears, `Toast` announces itself: `accessibilityLiveRegion="polite"` on Android and `useAnnounce(visible ? message : null)` (the existing hook) on iOS. An Android live region announces content that appears or changes, not an opacity change, so mount the pill only while it is visible (through the fade-out) and render nothing otherwise. The HTML shows this pill inline under the banner with a "Refresh" action: the floating form without an action is a difference to report.

### Empty, filtered-empty, loading and error

- **Empty (no entries at all):** centered in the remaining space (`flexGrow: 1` on the content container). A `size-24 rounded-full border border-petal bg-blush` circle with `images.logoMark` 44 tinted `rosewood`, then "No reflections yet" (`text-section text-ink`), "Tap the mic to voice your heart, or the pen to write." (`text-body text-mauve`, centered, `max-w-[320px]`) and a `PrimaryButton` "Record your first prayer" with the HTML's mic icon before the label (`PrimaryButton` has only `iconRight`, so it gets one optional prop, `iconLeft`, rendered the same way: 18, white, 8 gap; pass `{ ios: "mic.fill", android: "mic" }`, the dock's pair) that opens `NewEntry` with `{ mode: "speak" }`. 16 between the parts. The greeting stays; the affirmation card and the section row are hidden. No arrow pointing at the dock.
- **Filtered-empty:** "No reflections match this filter." (`text-body text-mauve`, centered) and a text button "Clear filter" (`btn-text__label btn-text__label--rosewood`).
- **Loading (first load, or data loaded for another scenario):** skeletons in place of the greeting block and the cards: two bars (60% × 28 and 40% × 14, radius 8), one 180-tall card, three 130-tall cards, all `petal` blocks with radius 16 for the cards, the same 20 and 14 gaps. Create `src/components/Skeleton.tsx` (props `height`, `width`, `radius`; an `Animated.View`, opacity pulsing between 1 and 0.5, 600ms each way, `useNativeDriver: true`, the value created with `useState` (see the lint rules below); step 11 reuses it) and `src/hooks/useReduceMotion.ts` (reads `AccessibilityInfo.isReduceMotionEnabled()` and listens to `reduceMotionChanged`; steps 10, 11, 12, 14 and 23 reuse it). With Reduce Motion on the blocks are static. The skeleton container is one element: label "Loading your reflections", `accessibilityState={{ busy: true }}`, children hidden.
- **Error (the first load failed):** a centered calm `.card`: "We couldn't load your reflections." (`text-body text-ink`) and a `PrimaryButton` "Try again". The error state is that card alone, with no greeting: it has no loaded entries and carries no `now`. A failed refresh when data is already shown keeps the data on screen.

### Filter sheet (`src/screens/journal/JournalFilterSheet.tsx`)

Built on `BottomSheet` (AGENTS.md "Bottom Sheets"). Title "Filter reflections" in `text-headline text-ink`, as the Sign In sheet titles. Single-select chips that wrap with 8 between them: All, Anxious, Weary, Grateful, Grieving, Hopeful, Prayer requests (entries whose `prayer` is not `null`). Every chip's touch area is at least 44 tall (`hitSlop`). The selected chip has a 1.5px `plum` border and a `plum` label, the others use `.chip`; every chip carries the 1.5px border (`border-transparent` when not selected), so selecting one never changes its size. Each chip is a button labelled with its name and `accessibilityState={{ selected }}`. A chip applies at once (the list behind the sheet updates), the `PrimaryButton` "Show {n} reflections" ("Show 1 reflection") has a live count and closes the sheet, and the text button "Reset" selects All. Spacing as in the email sheet: `mt-6` from the title to the chips and from the chips to the button, then "Reset" (`btn-text__label btn-text__label--rosewood`) in a `mt-2 min-h-11 items-center justify-center` row. The filter is screen state, reset when the screen unmounts. Any filter except All hides crisis, pending, uploading, processing and failed entries (they have no emotion). Put the pure part in `src/data/selectors.ts` as `type JournalFilter = "all" | EmotionKey | "prayers"` and `filterEntries(entries, filter)`.

### Icons (render every one through `Icon`, with both names; all exist in the installed typings)

| Use | iOS (SF Symbol) | Android (Material Symbol) |
| --- | --- | --- |
| Sun (chip) | `sun.max.fill` | `wb_sunny` |
| Heart, not saved / saved | `heart` / `heart.fill` | `favorite` / `heart_check` |
| Clock | `clock` | `schedule` |
| Filter | `slider.horizontal.3` | `tune` |
| Play | `play.fill` | `play_arrow` |
| Cloud off | `icloud.slash` | `cloud_off` |
| Hourglass | `hourglass` | `hourglass_top` |
| Refresh | `arrow.clockwise` | `refresh` |
| Check | `checkmark` | `check` |
| Support chip | `heart` | `favorite` |
| Empty-state button | `mic.fill` | `mic` |

Android's symbols are outline only, and `favorite` and `favorite_border` draw the same outline heart (checked on the emulator), so the saved heart there is `heart_check` (a heart with a check mark, which also fits "Save affirmation") plus the color change. iOS shows the filled heart. The sun is a plain outline on Android.

## Decisions (made, do not ask me again)

These settle everything this step would otherwise stop and ask about. If one turns out to be impossible, stop and tell me instead of picking another.

1. **No new packages.** The step uses `zustand`, React Native `Animated`, `Icon`, `@clerk/expo` (`useUser`) and `@react-navigation/native`, all installed. Install nothing.
2. **Greeting and slot.** The greeting uses `getGreeting(now)` (the clock), the affirmation uses `getCurrentSlot` (the reminder times), as above.
3. **The empty state has the "Record your first prayer" button.** The HTML has it, with a mic icon before the label, and a first-time user needs it. `PrimaryButton` gains the optional `iconLeft` for that icon (the second of this step's two shared-file edits). The copy "Tap the mic to voice your heart, or the pen to write." stays. Strike this decision if you prefer the dock alone.
4. **Chip label color.** The consistency chip's label uses `hopeful-fg` (`#9A4F31`, the HTML's own color) instead of `terracotta`: terracotta on its 12% tint (over the linen screen) is 3.0:1, and `hopeful-fg` on the same tint is 4.9:1. The first of this step's two shared-file edits: in `global.css`, `.chip__label--terracotta` becomes `@apply text-hopeful-fg;` with a one-line comment giving the reason. Nothing else in `src/` or in a later prompt uses that class.
5. **The toast is single-purpose.** Only `message` and `visible` props (no `tone`: no later step uses a toast, and steps 13 and 24 avoid timed toasts). It is announced to screen readers because it disappears.
6. **Dev store.** `src/store/devStore.ts` is a non-persisted Zustand store (state plus actions, flat) that later steps extend (10, 14, 16, 17, 24, 25 add dev-only fields). This step puts `scenario: MockScenario`, `setScenario` and the one-shot `nextHomeLoadFails: boolean` with its setter in it.
7. **Shared pieces created here:** `useReduceMotion`, `Skeleton`, `EmotionBadge` and `OfflineBanner`. Steps 10 to 14 and 23 reuse them.
8. **States the design does not show** follow the table above. `uploading` has its own line (it is not "Waiting to sync", because it is syncing now). A null transcript shows "Voice reflection".
9. **Pagination** is not built (step 25 adds `onEndReached`); the list is a `FlatList` so that step needs no rewrite.
10. **Contrast.** `mauve` text on white, linen and linen-deep is 3.3 to 3.8:1, below 4.5:1 for 13px text. The token stays as specified (the step 03 open item, decision pending). List every text and background pair you ship that is below 4.5:1 in your report; change no token.
11. **Numbers come from the HTML, and tokens win.** Differences you keep go in your report. Expected ones: the HTML's semibold section title where the token is Medium; the 15 medium italic reference where the loaded face is the 400 italic; the empty title 22 semibold against `text-section`; `shadow-sm` on the chip, pill and banner left out; the small labels (chip, count, timestamp, affirmation footer) at the type scale's 13 where the HTML has 12 or 11, and body text at 15 where the HTML has 14 or 14.5; "Offline mode" where the HTML says "Offline Mode"; the synced pill floating above the dock, without the HTML's "Refresh" action, where the HTML shows it inline under the banner; and the empty-state illustration replaced by the logo mark, without its small lotus badge.

## What you do yourself (manual setup)

Nothing here blocks the implementation. Do each item when the report asks for it.

1. **Environment keys: nothing to add.** `.env.local` already has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (a development key). The four Google values from `.env.example` are not in `.env.local`, which is fine until the Android development build (step 05b). Keep `.env` free of real values.
2. **Metro: no restart is needed.** This step installs nothing, so Fast Refresh picks everything up. If Expo Go shows a red screen after a refresh, reload it (shake, then Reload). The step also edits one class in `global.css` (the consistency chip's label color): if the "days of reflection" label still looks terracotta after a reload, stop Metro (Ctrl+C in its terminal) and start it again with `npx expo start -c`.
3. **Confirm the result on your iPhone in Expo Go.** The implementer cannot run an iPhone, so the report will list these checks for you:
   1. Sign in (or reopen the app while signed in). Journal shows the greeting with your name, the date, the "days of reflection" chip, the affirmation card, "Your Reflections" with a count, and the cards. If Expo Go's floating "Tools" button covers the avatar, drag it aside.
   2. Tap a card with a play pill: the Reflection placeholder opens with an id, and back returns to the same scroll position. Tap the "Waiting to sync", "Voice reflection" and failed cards: nothing happens.
   3. The scenario buttons are on the Profile tab, in the developer card at the bottom, so switch there and then open the Journal tab each time. `empty`: the empty state appears, and "Record your first prayer" opens New Entry in speak mode (close it with the X). `offline`: the "Offline mode" banner appears right under the greeting, with "Waiting to sync" chips on the saved cards. `default` again: the "All reflections synced" pill appears above the dock for a couple of seconds.
   4. Filter → Anxious: only anxious cards, "Filter · 1", the count updates. Reset clears it.
   5. Pull down to refresh (plum spinner). Tap the heart: it fills. Tap the Journal tab while scrolled: it returns to the top. The last card scrolls clear of the dock.
   6. Optional, VoiceOver: each card reads as one summary ("Reflection from Yesterday, 8:45 PM. Emotion: anxious…").
4. **Optional: test the greeting name with real accounts.**
   - *An account with no first name:* sign out and sign in with a fresh `yourname+clerk_test@example.com` (code `424242`). The greeting shows the name taken from the email ("Yourname") or none, never the address.
   - *An account with a first name:* open the Clerk Dashboard, choose the Gracehush application and its development instance, then Users, click the user, edit the profile, set First name and Save. Sign out and sign in again in the app: the greeting uses that name. Or use "Continue with Google" on the iPhone (Clerk's browser flow): your Google first name appears.
5. **Optional: test the time of day on the iPhone.** Settings → General → Date & Time → turn off Set Automatically and set 8:05 AM: the greeting says "Good morning" and the card is "Morning affirmation". Press Home, set 2:05 PM, return to the app: the greeting and the card switch to afternoon without a restart. At 7:05 PM the greeting says "Good evening" while the card is still "Afternoon affirmation", because the card follows your reminder times (evening from 8:00 PM): that is intended. The mock cards were stamped when the app first loaded them, so one may show a time later than your changed clock; that is only the mock. Then turn Set Automatically back on.
6. **Later, not now:** tell me whether to darken the `mauve` token (decision 10), and what the lotus icon in the header should do.

## Before writing code

1. Read-only checks: `JournalFeedScreen.tsx` is the step 08 placeholder; `src/data/mock/scenario.ts` still has `TEMP(09)`; `getGreeting` exists in `src/data/selectors.ts`; the only users of `getMockScenario` and `setMockScenario` are `scenario.ts`, `src/data/mock/db.ts` and `DevToolsPanel.tsx`; `.env.local` has the Clerk key (the app does not launch without it; never print it). Search the repo (the Grep tool) for `TODO(09)`, `TEMP(09)` and `step 09` and close every one.
2. Start your own Metro on 8082 (`npx expo start --port 8082`, never 8081, which is mine) and open the app in Expo Go on the emulator as AGENTS.md "Verifying on this machine" describes.

## 1. Dev store and the scenario (small refactor of step 06)

- Create `src/store/devStore.ts` (see decision 6). Import the `MockScenario` type with `import type` so there is no runtime cycle.
- In `src/data/mock/scenario.ts` keep the `MockScenario` type and `getMockScenario()`, which now returns `__DEV__ ? useDevStore.getState().scenario : "default"`. Delete `setMockScenario` and the module variable (and the `TEMP(09)` comment). `db.ts` still rebuilds the fixtures when the scenario changes.
- `DevToolsPanel`: the scenario buttons read `scenario` and call `setScenario` from `useDevStore` (drop the local `useState(getMockScenario)` and its React Compiler comment, and keep the data check reloading when `scenario` changes). Add a button "Fail next Journal load (dev)" that sets `nextHomeLoadFails`. Strings stay inline there.
- Screens subscribe to `scenario` with `useDevStore((state) => state.scenario)`, so they refetch when it changes.

## 2. Strings, formatters and selectors

- `src/constants/copy.ts`: a `journal` group with every string in this prompt, grouped (greeting, chip, affirmation, section, card, offline, synced, empty, filtered-empty, error, filter sheet, accessibility labels), with singular and plural helpers (`entryCount`, `reflectionDays`, offline body, "Show {n} reflections"). Eyebrows are stored in sentence case. No emojis, no inline prose in components.
- `src/utils/format.ts`: `formatDurationSpoken(ms)` and `getAffirmationSource(createdAtIso, now)`. `src/data/selectors.ts`: `JournalFilter` and `filterEntries`. All pure, no React.

## 3. The data hook (`src/hooks/useJournalHome.ts`)

Load `getProfile()`, `listEntries()` and `getLatestAffirmations()` in parallel with `Promise.all`.

```ts
type HomeState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      profile: UserProfile;
      entries: JournalEntry[];
      affirmations: Affirmation[];
      reflectionDays: number;
      currentSlot: TimeSlot;
      isOffline: boolean;
      refresh: () => Promise<void>;
      refreshing: boolean;
    };
```

- Fetch once on mount through the focus effect (not twice), again on every focus (`useFocusEffect`), when the scenario changes, and on pull-to-refresh.
- Keep only the latest request: a request counter that is touched only in callbacks and effects, so an older response, or one that arrives after unmount, never sets state.
- Data loaded for another scenario is not shown (treat it as not loaded): switching scenarios shows the skeleton, then the new data, or the error state when the load failed. A failed refresh with data already shown keeps the data.
- `nextHomeLoadFails` (dev only): the next load throws before calling the repository and clears the flag, so "Try again" then succeeds.
- `isOffline` = the scenario is `'offline'`, with `// TODO(24): NetInfo` (step 24 looks for exactly this marker).
- `now` is state (`useState(() => new Date())`): refreshed on focus and when the app returns to the foreground (`AppState` `change` to `active`, which also refetches), so "Good morning" never lingers into the evening. `reflectionDays = getReflectionDays(entries, now)` and `currentSlot = getCurrentSlot(now, profile.reminders)` follow it. Pass `extraData={now}` to the `FlatList` so the card timestamps follow too.
- Pull-to-refresh: `refresh()` sets `refreshing` before it awaits and clears it after.

### Lint rules that apply here (checked on this machine; `expo lint` runs eslint-plugin-react-hooks 7.1.1 with the React Compiler rules as errors)

- `react-hooks/set-state-in-effect`: no `setState` synchronously in an effect, or in a local function the effect calls before its first `await`. `setState` inside a promise callback, a listener callback or an event handler is fine, and so is `useFocusEffect`.
- `react-hooks/refs`: never read or write `ref.current` during render; effects, callbacks and handlers are fine. This includes the usual `useRef(new Animated.Value(1)).current`, which fails: create every animated value (`Skeleton`, `Toast`) with `useState(() => new Animated.Value(1))`, as `GracehushTabBar` does, and start the animation from an effect.
- `new Date()` in render passes lint but is impure (the compiler memoizes the render): keep `now` in state as above.
- Detecting the true-to-false `isOffline` change for the toast: either keep the previous value in state and compare it during render (call `setState` inside that same `if`), or keep it in a ref that only an effect writes. Both pass. Update the remembered value only while the state is `ready`: a scenario switch shows the skeleton in between, and it must still count as true to false. Hide the toast from a timer: an effect that returns early when the toast is not visible, otherwise starts a `setTimeout` whose callback sets the state and clears it in the cleanup.
- Define components at module level. Pass `ListHeaderComponent` as an element, not as a component defined inside the screen.

## 4. The screen (`src/screens/journal/JournalFeedScreen.tsx`)

Replace the placeholder. Remove `// TEMP: replaced in step 09` and the dev "Open sample reflection" button. Cards now open Reflection.

`SafeAreaView` (top edge only, linen, inline style; the tab bar handles the bottom) → `ScreenHeader` with `copy.tabs.journal` (unchanged) → one `FlatList` that stays mounted in every state (`data` is `[]` until the data is ready, and the header and empty components switch with `status`):

- `ListHeaderComponent`, in this order (the HTML's): the greeting block, the offline banner (only when offline), the affirmation card (when there is one), the section row (not in the full empty state). Nothing in the loading and error states: the skeleton and the error card stand alone.
- `ListEmptyComponent`: the skeleton layout (loading), the error card, the empty state or the filtered-empty state. `FlatList` clones this element with a `style` prop and an `onLayout` (AGENTS.md "SDK and Vendor Version Notes"), so make its root a `View` that takes `style`, with `flex: 1`, so that the empty state, the filtered-empty message and the error card center in the space below the header (the content container has `flexGrow: 1`); the skeleton starts at the top. A module-level component used here must forward `style` to its root.
- `ItemSeparatorComponent`: a 14 gap, defined at module level.
- `refreshControl`: `RefreshControl` with `tintColor={colors.plum}` and `colors={[colors.plum]}` (attached only when ready). `useScrollToTop(ref)` on the list.
- The toast and the filter sheet are siblings of the list.

Keep small helper components (greeting block, section row, empty state, skeleton layout) at module level in the screen file unless it passes about 400 lines. Components take data through props and do not fetch.

## Rules

- Do not build New Entry, Reflection, Prayers or Profile UI. Do not change `ScreenHeader`, the tab bar or the dock. Shared files change only as decided: one class in `global.css` (decision 4) and the optional `iconLeft` on `PrimaryButton` (decision 3).
- Do not add playback, NetInfo, real sync, pagination or favorite persistence. Leave exactly these markers: `// TODO(24): NetInfo`, `// TODO(24): retry sync`, `// TODO(25): persist is_favorite`, `// TODO(26): play in place`.
- Never log transcripts. Never show unverified scripture: if `scripture.verified` is false, show the reference only (no verse text appears on this screen anyway).
- Crisis Red must not appear on this screen. Raw hex does not appear in a component: use `colors.*` where a prop needs a color and the Tailwind classes everywhere else.
- No library, no `any`, no emojis. Run your own Metro on 8082 and never stop mine on 8081.

## Verify

```bash
npm run lint
npm run typecheck
npx expo install --check
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Run the pure functions (`getGreeting`, `filterEntries`, `getAffirmationSource`, `formatDurationSpoken` and the plural helpers) in Node from a scratch folder outside the repo (a scratch tsconfig with `paths` for `@/*`, `module: commonjs` and a `declare const __DEV__`; set `process.env.TZ` inside the script), in at least three time zones, around midnight and at the greeting boundaries (04:59, 05:00, 11:59, 12:00, 16:59, 17:00). Then check on the Android emulator in Expo Go (AGENTS.md "Verifying on this machine"; sign in with an address like `yourname+clerk_test@example.com` and the code `424242`), at about 411dp wide and at 320dp wide with font scale 1.3:

1. **The default scenario matches the design:** the greeting with the Clerk name, the date, "5 days of reflection", the affirmation for the current slot, "Your Reflections" with a count, and the cards with badges, references and duration pills. Compare crops of your screenshots with `prompt_material/03-journal-home.png` at the design's own width, 390dp (`adb shell wm size 1080x2340` with `wm density 443`; reset both afterwards with `wm size reset` and `wm density reset`). The PNG is 1.25x, so compare proportions, not pixels, and note whether the greeting breaks after "Good" and "morning," as the design does (it wraps naturally either way). Measure with `uiautomator dump` and report: the side padding (20), the gap between cards (14), the card padding (16), the chip and pill heights.
2. **Every status card renders:** pending (text), processing and failed (audio, so "Voice reflection"), text only, and crisis. Ready and crisis cards open Reflection and back returns to the same scroll position. The others do nothing and are not buttons (`uiautomator dump --compressed`). No mock entry is `uploading`, so see that card by temporarily changing one `pending` mock row (a `TEMP-EXPERIMENT`, reverted afterwards).
3. **Scenarios:** `empty` shows the empty state and its button (mic icon before the label) opens New Entry in speak mode. `offline` shows the banner directly under the greeting, and the chips. Back to `default` (switch on Profile, then open Journal) shows the toast above the dock for about 2.5s.
4. **Filter:** Anxious shows only anxious cards, "Filter · 1" and an updated count; Reset clears it; Prayer requests works; any other filter hides the unfinished and crisis cards. No emotion in the default data has zero entries, so prove the empty result with `filterEntries` in the harness, and see the filtered-empty UI by temporarily making one filter match nothing (a `TEMP-EXPERIMENT`, reverted afterwards).
5. **Loading and error:** switching scenarios shows the skeleton. To see it, temporarily raise `simulateLatency` to 4000ms on Android only (a `TEMP-EXPERIMENT`, reverted afterwards). With Reduce Motion on (`adb shell settings put global transition_animation_scale 0`, back to `1.0` afterwards) the blocks are static. "Fail next Journal load (dev)" then a scenario switch shows the error card, and "Try again" loads normally.
6. **Refresh and scrolling:** pull to refresh shows the plum spinner; tapping the active Journal tab while scrolled returns to the top; at the end of the scroll the last card ends at least 36dp above the dock's top.
7. **The heart** toggles (Android: heart to heart with a check, mauve to plum-deep) and its label switches between "Save affirmation" and "Remove from saved".
8. **Time of day** with the clock recipe in AGENTS.md (08:05, 13:05, 19:05 and 20:05; a time-zone change does not reach a running app, so set the clock): after the app goes to the background and returns, the greeting and the affirmation slot update. Expected with the default reminders (08:00, 13:00, 20:00): morning and "Morning affirmation", afternoon and "Afternoon affirmation", "Good evening" with "Afternoon affirmation" (intended: the card follows the reminder times), then "Good evening" with "Evening affirmation". Restore the clock, auto time and the zone afterwards, and confirm it.
9. **The name:** with an email-only account the greeting uses the email-derived name or none, never the address.
10. **320dp and font scale 1.3:** nothing is clipped, the greeting row wraps instead of overflowing, the chip, badges and pills fit, and the filter sheet scrolls.
11. **Accessibility:** the compressed dump shows each pressable card as a button with its summary label, the heart and Filter as buttons, and the skeleton as one "Loading" element. TalkBack and VoiceOver are not run here: say so.

Fix every error before finishing. Then ask me to confirm the iPhone checks (manual setup item 3), and remind me of manual setup items 2, 4, 5 and 6. Say plainly what was not verified: the iPhone until I confirm, TalkBack and VoiceOver.

Report: each file created or changed, the icon names used on each platform, the dp values you measured, every difference between the design and what you built, every `// TODO(NN)` left for later steps, every text and background pair below 4.5:1, the AGENTS.md lines you updated, and confirmation that nothing was installed.

## AGENTS.md updates

These changes were already written when this prompt was reviewed, so only check that they are there (do not write them again): the rewritten "3. Journal Home (Feed)" spec (with the offline banner directly under the greeting) and the Standing Ruling about Stitch state views; the two recipes under "Verifying on this machine" (setting the clock, Reduce Motion); in "SDK and Vendor Version Notes" the React Compiler lint note (with the `Animated.Value` ref trap), the note that `FlatList` clones `ListEmptyComponent` with a `style`, and the note that `navigate` reuses the route already on top; the `flexShrink` and `flex-wrap` rule under "UI Quality Bar"; and the "Android symbols are outline only" note under "Icons & Imagery". In this step, record the decisions and the new state, replacing the text they supersede:

- Architecture tree: add `store/devStore.ts`, the `hooks/` entries (`useJournalHome`, `useReduceMotion`), the `components/` entries (`AffirmationCard`, `JournalCard`, `EmotionBadge`, `OfflineBanner`, `Toast`, `Skeleton`), `screens/journal/JournalFilterSheet.tsx`, and mark `JournalFeedScreen` as built. Update the "Built so far" component list (and say that `PrimaryButton` now has `iconLeft`), and the `constants/` and `utils/` lines (the `journal` strings, `formatDurationSpoken`, `getAffirmationSource`, `filterEntries`).
- Navigation Map, "Current state (step 08)": in the sentence about `DevToolsPanel`, the scenario buttons now go through the dev store and the panel has "Fail next Journal load (dev)"; say that the Journal feed is built on the shared tab layout.
- State Management Rules, "Data layer (step 06)": replace the sentence about the TEMP data check importing `setMockScenario` with the dev store (`getMockScenario()` reads it, `setMockScenario` is gone, `nextHomeLoadFails`). Add a "Dev store (step 09)" paragraph: non-persisted, flat, development only, later steps add their `next…` flags to it.
- Styling Rules: the `.chip__label--terracotta` change and why (contrast).
- Build Status & Decisions Log: a Step 09 entry with the decisions above, the files, the measured dp values, every difference from the design, what was verified and what was not, and the open items (the mauve contrast decision, the lotus action, the `TODO(24)`, `TODO(25)` and `TODO(26)` markers).

Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.
