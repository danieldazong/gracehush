# 14-prayers-ui.md

Read AGENTS.md first and follow it strictly.

Build the Prayers tab for Gracehush: the "Sanctuary Prayers" header, the Active and Answered tabs with counts, the Active prayer cards, the Answered timeline, and the Mark Answered bottom sheet (which also edits a gratitude note). It replaces the step 08 placeholder in `src/screens/prayers/PrayersScreen.tsx` (remove `// TEMP: replaced in step 14`). This step is UI plus mocked data. Real persistence (SQLite and Supabase) comes in step 29.

Design: `prompt_material/06-prayers.html` is the design source, and it holds all three views: `#view-active`, `#view-answered` (the Answered tab) and `#answer-modal` (the Mark Answered sheet). `prompt_material/06-prayers.png` shows only the Active view and is rendered at 1.25x, so never measure dp from it. (`Images/6._prayers_active_answered.png` is the same file, byte for byte.) In the HTML 1 CSS px = 1dp.

Ignore the Stitch preview artifacts: the "Preview Mark Answered Sheet" link, the `Sanctuary` label and church icon on the third tab (it is Profile), the lotus button in the header (removed in step 09), the fixed header and tab bar, and the quick-action pen and mic (step 08's dock, already built). Do not add colors, fonts, radii or shadows: use the tokens, the utilities in `global.css` and the existing components. If something needs a new token, stop and ask.

This prompt replaces an earlier draft that said "there is no mockup for the Mark Answered sheet" and that was written without the Answered view. Both are in the HTML. Where this prompt differs from the old draft, the HTML copy and AGENTS.md "Screen Specifications, 6. Prayers" win, and this prompt is the result.

---

## What you do yourself

Nothing to install, configure or sign up for. No new package, no migration, no native change, and no new key: `.env.local` holds only `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (set), which is all this step uses.

1. After the code is pulled, restart Metro with a cleared cache: `npx expo start -c`, then reopen Expo Go. This step adds class names in new files, and a hot reload does not recompile the stylesheet for them (the step 13 screenshot that looked "plain" was exactly this).
2. To test on your iPhone, use the Profile tab's developer panel (the "Fail next prayer change (dev)" button, below) and the three scenario buttons. The iPhone checks only you can do are listed at the end of "Verify".

---

## Decisions (made in the review; each one has its reason)

1. **The HTML is the design source** (all three views). Copy comes from the HTML and AGENTS.md; the old draft's chips, titles and button labels that the HTML replaces are gone.
2. **No month groups.** The HTML's Answered view is one continuous timeline, newest first, with no month headers. The old draft's `groupByMonth`, `countLabel`, sticky headers and `SectionList` are dropped. Both tabs are one `FlatList`. The year is added to a date label only when it is not the current year.
3. **Counts come from `getPrayerCounts` (it exists since step 06) and `copy.prayers` builder functions** (`recorded(n)`, `activeA11y(n)`, ...), the pattern the Journal uses for plurals. Never hardcode a count.
4. **`SegmentedControl` gets count badges and an adaptive large-text layout** (section 3). This is the step 11 follow-up's decision (5): at font scale 1.3 the three Reflection tabs break inside a word at 360dp and 320dp, and the Prayers control reuses the component. It is a shared-component edit the user approved there.
5. **The answered day is a calendar day**, `answeredDate: "YYYY-MM-DD"` in the user's local time, and the mock stores 12:00 local on that day. Step 29 (section 4) asks for exactly this input, `answeredDate` as `YYYY-MM-DD`, and tells step 14's input type to follow it, so it starts that way here. It also avoids the `new Date("YYYY-MM-DD")` UTC trap.
6. **The sheet's date control is the HTML's date row**, not the old draft's Today / Yesterday / Pick a date chips. The row shows the day and a "Today" or "Yesterday" chip when it is one of them, and opens the picker.
7. **Date picker**: Android uses the imperative `DateTimePickerAndroid.open({ mode: "date", minimumDate, maximumDate })` dialog. On iOS the spinner is shown **inline under the date row inside the sheet** (the Expo UI `DateTimePicker`, `display="spinner"`, `themeVariant="light"`), not in a second `Modal`, because a Modal opened from inside the sheet's Modal is the fragile case on iOS. This is a deliberate exception to AGENTS.md "Date & Time Pickers" (which is updated to say so). Not verified on iOS.
8. **Changes wait for the repository, they are not optimistic.** The sheet must keep what the user typed when a save fails, and a card that leaves the list behind an open sheet would snap back. The mock takes about 500ms and the sheet's button shows its spinner. Step 29's cache-first repository returns at once, so the wait disappears there. The hook replaces the prayer by id from what the repository returns.
9. **The Mark Answered sheet is a `BottomSheet`** (blush, 24 top radius, `shadows.sheet`, petal top border, 48×6 handle: all the HTML's `#F5ECE8` sheet), never a new `Modal`. It is not a white sheet.
10. **A `ConfirmDialog` opened from inside the sheet is rendered as a child of the sheet's content**, not beside it. A Modal presented while another Modal is up works on iOS only from inside the first one's tree. Not verified on iOS.
11. **The overflow menu**: `ActionSheetIOS` on iOS (native, and it does not collide with the next Modal), and a `BottomSheet` list on Android (not a custom Modal). No destructive (red) option: crisis red is not used on this screen.
12. **Loading is a skeleton in the shape of the screen** (`Skeleton`, like the Journal), not a spinner on a blank screen.
13. **After "Mark Answered" the user stays on Active** and a persistent banner offers "View in Answered" (kept from the old draft; the HTML jumps to the Answered tab after 250ms, and a surprise tab change would also move a user who is marking several prayers). The banner never dismisses on a timer.
14. **No new haptic.** The tab control already ticks on a change (AGENTS.md "Haptics" lists the only moments). Marking a prayer answered adds none.
15. **Copy rules**: every string in `copy.prayers`, with curly apostrophes and quotes; "Mark Answered" in Title Case on the card (the HTML), sentence case for labels.
16. **No offline UI here.** The Journal's offline banner is a mock scenario; Prayers has nothing to sync until step 29 (which adds its own "Changes will sync when you’re back online." line).

---

## 1. Before writing code

1. Read `src/screens/prayers/PrayersScreen.tsx` (the placeholder; the path is NOT `src/screens/PrayersScreen.tsx`), `src/data/journalRepository.ts`, `src/data/selectors.ts`, `src/data/mappers.ts` (`toPrayer`), `src/data/mock/db.ts`, `src/data/mock/entries.ts`, `src/data/mock/scenario.ts`, `src/types/index.ts`, `src/utils/format.ts`, `src/constants/copy.ts`, `src/constants/app.ts`, `src/store/devStore.ts`, `src/components/dev/DevToolsPanel.tsx`, `src/components/SegmentedControl.tsx`, `src/components/BottomSheet.tsx`, `src/components/ConfirmDialog.tsx`, `src/components/PrimaryButton.tsx`, `src/components/Skeleton.tsx`, `src/hooks/useJournalHome.ts` (the loading pattern to copy), `src/hooks/useAnnounce.ts`, `src/screens/journal/JournalFeedScreen.tsx` (the list, empty and error states to copy), `src/screens/onboarding/OnboardingScreen.tsx` (the date-time picker usage), and `prompt_material/06-prayers.html`.
2. The `Prayer` model exists (step 06, `src/types/index.ts`). Use these fields exactly: `id` (the journal entry id: a prayer lives on its entry), `title` (may be `""`: nothing upstream produces a prayer title yet, see the open conflicts), `category` (`PrayerCategory | null`), `summary` (a short summary, may be `""`; there is no transcript on a `Prayer`, and the screen must never read `entry.transcript`), `scriptureReference` (`string | null`), `createdAt`, `isAnswered`, `answeredAt` (ISO or null), `answeredNote` (`string | null`). If a field you need is missing, stop and ask.
3. `@react-native-community/datetimepicker` 9.1.0 and `@expo/ui` ~57.0.25 are installed (step 03; the Onboarding time picker uses both). Do not install anything. Never build a custom date wheel, and never render the community picker as a component.
4. Every icon below goes through `Icon` with both names (all were checked against `sf-symbols-typescript` and `expo-symbols/build/android/symbols.json`):

| Use | iOS | Android |
| --- | --- | --- |
| days chip | `hourglass` | `hourglass_top` |
| scripture reference | `book` | `menu_book` |
| Mark Answered button | `checkmark.circle` | `check_circle` |
| timeline node | `checkmark` | `check` |
| "Answered" label, save button | `heart.fill` | `favorite` |
| Answered banner, answered empty state | `leaf` | `eco` |
| date row | `calendar` | `calendar_today` |
| overflow | `ellipsis` | `more_horiz` |
| move back to Active | `arrow.uturn.backward` | `undo` |
| edit note | `pencil` | `edit` |
| sheet close | `xmark` | `close` |
| context pill, Active empty state | `hands.sparkles` | `volunteer_activism` |

Android's symbols are outline only, so "Answered" and the save button show an outline heart there (as the Journal's heart does).

---

## 2. Data layer (mocked)

### 2.1 Constants and the dev flag

`src/constants/app.ts`: `MAX_GRATITUDE_NOTE_LENGTH = 1000` and `GRATITUDE_COUNTER_FROM = 900` (the counter shows from this many characters).

`src/store/devStore.ts`: `nextPrayerMutationFails: boolean` (default `false`) with `setNextPrayerMutationFails`, the one-shot flag of the other `next…` flags: the next prayer change fails once and clears the flag. Step 15 reuses this one flag for the profile and creates no third. `src/data/mock/scenario.ts`: `takeMockPrayerMutationFailure(): boolean`, written like `takeMockSubmitOutcome` (reads and resets in the same call, always `false` outside `__DEV__`).

### 2.2 `src/utils/prayerDates.ts` (new, pure; tested in 11 time zones)

```ts
import { calendarDaysBetween } from "@/utils/format";

// A calendar day is "YYYY-MM-DD" in the device's local time. It is never built with `new Date("YYYY-MM-DD")`,
// which is UTC midnight and prints the day before in the Americas.

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

// The local calendar day of a Date: "2026-10-24".
export function toCalendarDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

// "2026-10-24" as a local Date at 12:00, or null when it is not a real day ("2026-02-30" is null).
export function parseCalendarDate(calendarDate: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(calendarDate);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day, 12);
  const real = date.getFullYear() === year && date.getMonth() === month && date.getDate() === day;
  return real ? date : null;
}

// What is stored for an answered day: 12:00 local on it, as an ISO string. Noon keeps the day the same when it
// is read back in any zone from UTC-11 to UTC+12 and across a daylight-saving change.
export function answeredDateToTimestamp(calendarDate: string): string | null {
  return parseCalendarDate(calendarDate)?.toISOString() ?? null;
}

// Between the day the prayer was created and today, both included.
export function isValidAnsweredDate(calendarDate: string, createdAtIso: string, now: Date): boolean {
  const date = parseCalendarDate(calendarDate);
  if (date === null) return false;
  return (
    calendarDaysBetween(new Date(createdAtIso), date) >= 0 && calendarDaysBetween(date, now) >= 0
  );
}
```

This draft was run in 11 zones (UTC, Los_Angeles, New_York, London, Lagos, Kolkata, Auckland, Kiritimati, Pago_Pago, Sao_Paulo, Apia), 34 checks each, 0 failures (the day round-trips at 12:00, a created day, today and the days between are valid, the day before creation, tomorrow, "2026-02-30" and "" are not, daylight-saving days included). Step 29 later adds a time-zone parameter to these functions and the 29 prompt lists the file as new: it extends this one.

### 2.3 Selectors, `src/data/selectors.ts` (pure)

```ts
// Open prayers, the one that has waited longest first (the design shows 24, 11, then 4 days).
export function selectActivePrayers(prayers: Prayer[]): Prayer[]   // !isAnswered, createdAt ascending
// Answered prayers, the latest answer first. An answered prayer with no answeredAt sorts by createdAt.
export function selectAnsweredPrayers(prayers: Prayer[]): Prayer[] // isAnswered, answeredAt descending
```

Do not sort in place (`[...prayers].filter(...).sort(...)`). Counts are `getPrayerCounts(prayers)` (already there), not a new selector. Whole days since a date is the existing `getDaysSince(iso, now)`. The days between creation and the answer is `calendarDaysBetween(new Date(createdAt), new Date(answeredAt))`, clamped at 0.

### 2.4 Repository, `src/data/journalRepository.ts`

Add these three, each marked `// TEMP(29): replace internals with SQLite + Supabase, keep signatures`. `listPrayers()` already exists (every prayer, newest first, no crisis entry and no entry without a prayer, because `toPrayer` returns null for them): do not redefine it.

```ts
markPrayerAnswered(input: { prayerId: string; answeredDate: string; note: string | null }): Promise<RepoResult<Prayer>>
unmarkPrayerAnswered(prayerId: string): Promise<RepoResult<Prayer>>
updateAnsweredNote(prayerId: string, note: string | null): Promise<RepoResult<Prayer>>
```

`RepoResult` is in `src/types/index.ts` (`NOT_FOUND | INVALID | NETWORK | UNKNOWN`). Rules, in this order for each call:

1. Wait about 500ms (a plain `setTimeout`; the other reads use `simulateLatency`, which is 300ms in development).
2. If `takeMockPrayerMutationFailure()` is true, answer `{ ok: false, code: "NETWORK", message }`. The change is not applied.
3. Find the row in `getMockDb().entries` by id. A missing row, a crisis row, a row that is not `ready` or a row whose `toPrayer(row)` is `null` answers `NOT_FOUND`. Never mutate those.
4. Validate. `markPrayerAnswered`: `isValidAnsweredDate(answeredDate, row.created_at, new Date())` and the note. The note is trimmed, an empty note becomes `null`, and a note longer than `MAX_GRATITUDE_NOTE_LENGTH` is `INVALID`. `updateAnsweredNote` has the same note rule and is `INVALID` for a prayer that is not answered.
5. Mutate the mock row and set its `updated_at`. Mark: `is_active_prayer: true, is_answered: true, answered_at: answeredDateToTimestamp(...), answered_notes: note`. Unmark: `is_answered: false, answered_at: null, answered_notes: null` and **`is_active_prayer: true`** (the prayer must stay a prayer, or `toPrayer` returns null and it vanishes from both tabs). Editing a note changes only `answered_notes`. Unmarking an active prayer is a no-op that answers `ok`.
6. Answer `{ ok: true, data: toPrayer(row) }`, and never log an id, a title, a summary or a note.

The mock database lives for the session, so changes show on Prayers, on the Journal's prayer filter and on Reflection. A scenario switch rebuilds the fixtures and drops the changes. Journal Home's counts and its "Prayer requests" filter count `entry.prayer !== null`, which marking or unmarking does not change.

---

## 3. `SegmentedControl`: count badges and the adaptive large-text layout

Edit `src/components/SegmentedControl.tsx`. Additive: New Entry's compact toggle and the Reflection tabs keep working with no change at their call sites.

- Each item may carry `count?: number` (a badge after the label) and `accessibilityLabel?: string` (default: the label). The caller builds the spoken label with the count, "Active, 5 prayers".
- The badge is `shrink-0 rounded-full px-2 py-0.5` with DM Sans Semibold 11/16: on the selected item `bg-linen-deep` (plum variant: `bg-white/20`) with `text-ink` (plum variant: `text-white`); on an unselected item no background and `text-mauve` (the HTML: the unselected badge has the track's own color). The label and badge share a row, `gap-1`, centered, and the label is `shrink`.
- **Adaptive layout.** If any label of a non-compact control does not fit on one line (a label `Text`'s `onTextLayout` reports more than one line), the control stacks: the track becomes `flex-col` and each item is full width and at least 44 tall. The stacked state is remembered for the window width and font scale that caused it (`${width}x${fontScale}`, compared during render), so a different size is measured again as a row. A stacked item's `Pressable` must not use the `flex: 1` style (a numeric basis of 0 collapses in an auto-height column). `compact` controls never stack.

Reference code, linted (`npx eslint`) and type-checked in a scratch folder before this prompt was written (the module is as in the repo plus these edits):

```tsx
const { width, fontScale } = useWindowDimensions();
// The window width and font scale at which a label did not fit on one line. The control is stacked (one
// item under another) only at that size, so a different size is measured again from a row.
const sizeKey = `${width}x${fontScale}`;
const [overflowedAt, setOverflowedAt] = useState<string | null>(null);
const stacked = !compact && overflowedAt === sizeKey;
// track:  className={compact ? "segmented self-center" : stacked ? "segmented flex-col" : "segmented"}
// pressable style: [!compact && !stacked && styles.fill, pressed && styles.pressed]
// label:  <Text className={`shrink ${labelClass}`} onTextLayout={(event) => {
//           if (!stacked && !compact && event.nativeEvent.lines.length > 1) setOverflowedAt(sizeKey);
//         }}>
```

Why this and not a font-scale rule: measured with the real font files (DM Sans Medium 13), the two Prayers tabs with counts fit a row at every width from 320dp through font scale 1.5 (320dp stops fitting between 1.5 and 1.7, 360dp between 1.7 and 2, and 390dp not before 2), while the three Reflection tabs stop fitting at 1.1 on 320dp, 1.2 on 360dp and 1.3 on 390dp, so no single font-scale threshold fits both. Measuring the label is exact. The cost is one frame of the row before the stack at a large size.

Check on the emulator that both controls are right: the Reflection tabs at 320dp and 360dp with font scale 1.3 are three full-width 44dp rows with whole labels, at normal text they are unchanged (three tabs in a row), the Prayers tabs at font scale 1.3 stay a row (113 of 156dp at 360dp), and at 320dp with font scale 2.0 (`adb shell settings put system font_scale 2.0`, reset it afterwards) they stack. Re-check the New Entry toggle and the selected pill's round corners.

---

## 4. `src/hooks/usePrayers.ts`

Copy the structure of `useJournalHome` (same loading pattern: the focus-effect load, the `latestRequest` counter, data of another scenario is not shown, a failed refresh keeps the data on screen). The state:

```ts
type PrayersState =
  | { status: "loading" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      now: Date;
      active: Prayer[];       // selectActivePrayers
      answered: Prayer[];     // selectAnsweredPrayers
      refresh: () => Promise<void>;
      refreshing: boolean;
      markAnswered: (input: { prayerId: string; answeredDate: string; note: string | null }) => Promise<RepoResult<Prayer>>;
      unmarkAnswered: (prayerId: string) => Promise<RepoResult<Prayer>>;
      saveNote: (prayerId: string, note: string | null) => Promise<RepoResult<Prayer>>;
    };
```

Each mutation awaits the repository and, when it is `ok`, replaces that prayer by id in the loaded list (so two changes that finish in any order cannot undo each other), then returns the `RepoResult` unchanged. A failure changes nothing and returns the result. The hook never logs.

A draft of this hook was linted with `npx eslint` and type-checked: the only errors were the five names it imports that this step creates. It passes `react-hooks/set-state-in-effect` and `react-hooks/refs` (every `setState` is in a callback or after an `await`; the request counter is touched only in callbacks).

---

## 5. Screen: `src/screens/prayers/PrayersScreen.tsx`

Same layout as the other tabs (AGENTS.md Navigation Map): a top-edge `SafeAreaView` (linen), `ScreenHeader` with `copy.tabs.prayers` (the step 08 header, unchanged), then **one `FlatList`** (never a list inside a `ScrollView`), kept mounted in every state, and `useScrollToTop` on it. Side padding is numeric from `useWindowDimensions` (`layout.screenPaddingNarrow` under `layout.narrowBreakpoint`, else `layout.screenPadding`: the HTML's 20, not the old draft's 24). `paddingBottom: useTabScreenBottomPadding()` so the dock never covers the last card, `paddingTop` 8. `RefreshControl` with `tintColor` and `colors` `colors.plum`. `ListHeaderComponent` is an element (not a component) so it stays mounted when the tab changes.

The selected tab (`"active" | "answered"`) is local state. The screen stays mounted across focus changes, so it persists for the session. A tab change scrolls the list to the top without animation.

**Header element**, top to bottom, with the HTML's spacing:

1. A row `flex-row flex-wrap items-baseline justify-between gap-x-3 gap-y-1`: "Sanctuary Prayers" (`text-headline text-plum-deep`, header role) and the caption `copy.prayers.recorded(total)` ("17 petitions recorded", `eyebrow` class: DM Sans bold 11 uppercase, which the `uppercase` style produces from the sentence-case string). The two do not fit one line at 390dp (211.5 + 146.5 + gap against 350), so the caption wraps under the title: the HTML's two-line "Sanctuary / Prayers" is a rendering glitch, do not copy it. Hide the caption when `total` is 0.
2. 8 below: `SegmentedControl` (`accessibilityLabel` "Prayer lists") with `items` `active` (label "Active", `count`, spoken "Active, 5 prayers") and `answered` ("Answered", spoken "Answered, 12 prayers"), `value` the selected tab.
3. The **notice banner**, when there is one (section 8), 16 below the tabs.
4. On the Answered tab with at least one answered prayer, the **Answered banner** (below).
5. A 24 bottom gap before the first card (the HTML's `mb-space-lg`). The cards are 16 apart on Active. The Stitch preview link and its spacing are not built.

**Answered banner** (the HTML's header card): `card card--blush flex-row items-center gap-3 p-6`. A 40dp circle `bg-grateful-bg` with the `leaf` / `eco` icon (20, `emotionColors.grateful.fg` from `theme.ts`; the HTML's `#E5ECE4` and `#4A6B56` map to the nearest tokens). Beside it: "Look how faithful He has been — " then `copy.prayers.banner.count(n)` ("12 answered prayers.", singular "1 answered prayer."), one `Text` in `font-fraunces text-[18px] leading-[25px] text-plum-deep` with the count in `font-fraunces-medium text-hopeful-fg` (the terracotta text, darkened for contrast: 5.10:1 on blush). The size is a one-off class: the type scale has no 18, and the nearest token (`text-section` 20/28 Medium) is three lines at 390dp where the HTML's 18 Regular is two (measured with the font files). Under it, "Recorded in your sanctuary journey" in `eyebrow`. The row text is `flex-1`.

**States** (all inside the list, under the header):

- Loading: `Skeleton`s in the shape of the screen (a title bar, the tab control 52 tall with radius full, three cards 190 tall), the whole thing one element labelled `copy.prayers.loading` with `busy`, children hidden from accessibility (copy `LoadingState` from `JournalFeedScreen`). When the state is `loading` the header is not rendered.
- Error: `card` with "We couldn’t load your prayers." and a `PrimaryButton` "Try again" (copy `ErrorState`).
- Active empty: `icon-tile` with `hands.sparkles`, title "No open prayers right now.", body "When you pray about something, you can keep it here and watch for God’s answer." (`// TODO(29)` in copy.ts: the Reflection toggle that puts a prayer here persists in step 29).
- Answered empty: `icon-tile` with `leaf`, title "Answered prayers will gather here.", body "When a prayer is answered, mark it so you can remember His faithfulness."
- A `ListEmptyComponent` must be an element whose root forwards the `style` and `onLayout` that `FlatList` clones into it (copy `CenteredState` from `JournalFeedScreen`). No illustrations or stock photos.

Navigation: `PrayerCard`'s `onOpen` calls `navigation.navigate("Reflection", { entryId })` (type `useNavigation`/props with `MainTabScreenProps<"Prayers">`). Back returns to Prayers.

---

## 6. `src/components/prayers/PrayerCard.tsx` (new, reused by both tabs)

A discriminated union, so the answered variant cannot be given an Active handler:

```ts
type PrayerCardProps =
  | { variant: "active"; prayer: Prayer; now: Date; onOpen: (prayerId: string) => void; onMarkAnswered: (prayer: Prayer) => void }
  | { variant: "answered"; prayer: Prayer; onOpen: (prayerId: string) => void; onOpenMenu: (prayer: Prayer) => void; onAddNote: (prayer: Prayer) => void };
```

Common: `card p-6 gap-4` with `style={shadows.card}` (the Petal border stays, the HTML's soft shadow is `shadows.card`; the card radius is the token 16, not the HTML's 12). Titles are `text-section text-plum-deep`. An empty `title` shows `copy.prayers.card.untitled(formatShortDate(createdAt))` ("Prayer from Oct 2"): never invent text from the transcript. An empty `summary` or a null `category` or `scriptureReference` hides that line.

**Accessibility structure (do not nest accessible elements):** a `Pressable` is accessible and groups its children (AGENTS.md, the vendor note on step 11's card). So the card itself is a plain `View`. One `Pressable` (`accessibilityRole="button"`, `accessibilityHint` "Opens the reflection", an explicit `accessibilityLabel` from a `copy.prayers.card.a11y(...)` builder that reads category, title, days or answered date, and summary) wraps the text block, and every other control sits outside it as its own button.

**Active:** the pressable block holds a header row (`flex-row flex-wrap items-start justify-between gap-x-2 gap-y-2`) and the summary. Header left, a column `min-w-[170px] flex-1`: the category in `eyebrow` (rosewood; the HTML's mix of terracotta-brown and brown eyebrows is one token) and the title 4 below. Header right: the days chip, `chip shrink-0 gap-1` with `hourglass` 15 in `colors.mauve` and `chip__label` `copy.prayers.card.days(getDaysSince(createdAt, now))` ("24 days", "1 day", "Today"). The `min-w-[170px]` makes the chip drop under the title when the title would get under 170dp (measured with the font files: it is beside the title at 390dp and 360dp at normal text, and under it at 320dp and at font scale 1.3 on 360dp and below, so the title is never squeezed into a one-word column). Summary: `text-body text-ink/80` (7.32:1). Under the pressable block, the footer row `flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2`: on the left the `book` icon (16, `colors.rosewood`) and the reference in `font-fraunces-italic text-[13px] leading-[19px] text-rosewood` (DM Sans has no italic loaded; the Journal card uses Fraunces italic for the same reference); on the right the **Mark Answered** button with `ml-auto`, so it stays right-aligned when the row wraps (it wraps at 360dp and below, and at font scale 1.3 everywhere: 285 against 300, 270 and 238dp). The button is a `Pressable` with the classes on an inner `View`: `min-h-11 flex-row items-center gap-1.5 rounded-full border border-petal px-4`, the `checkmark.circle` icon (16, `colors.terracotta`) and `text-label-md text-plum-deep` "Mark Answered", label `copy.prayers.card.markAnsweredA11y(title)`. Pressed state: the app's `opacity` or `scale 0.98` press feedback. 44 high at least.

**Answered:** layout from `#view-answered`. Pressable block: the title (with `pr-11` so it never runs under the overflow button) and, when `answeredNote` is not empty, the note box: `rounded bg-linen border border-petal p-2` with `font-fraunces-italic text-[15px] leading-[23px] text-ink/80` and `copy.prayers.card.note(text)` (curly quotes; the user's own words, so not `quoteVerse`). Fraunces italic is the only italic loaded, which is why the note is not DM Sans italic as in the HTML. With no note, a text button "Add a gratitude note" (`btn-text__label` in `text-plum`, `min-h-11`, left aligned, outside the pressable block) that calls `onAddNote`. The **overflow button** is `absolute right-2 top-2`, 44×44, `ellipsis` icon 20 in `colors.mauve`, label `copy.prayers.card.more(title)`, `onPress` `onOpenMenu`. The footer row: on the left the reference like the Active footer, on the right the `heart.fill` icon (15, `colors.terracotta`) and "Answered" in `text-label-md text-mauve` (the HTML's label; the `ml-auto` wrap rule applies). The answered date and "After N days" are not in the card: they are the timeline row above it (section 7).

Every string and every accessibility label comes from `copy.prayers`.

---

## 7. The Answered timeline (inside `PrayersScreen`, not a new component)

A private `TimelineItem` wraps each answered `PrayerCard`; `ItemSeparatorComponent` is `TimelineSeparator` on Answered and a 16dp gap on Active (both module-level components, chosen by the tab). Drawn with `View`s, no SVG:

- Each item is `pl-6` (24). Above the card a row `flex-row flex-wrap items-center justify-between gap-x-3 gap-y-1` with 8 below it: on the left `copy.prayers.card.answeredOn(date)` in `font-dm-bold text-[11px] leading-[16px] uppercase tracking-[0.8px] text-hopeful-fg` (not the `eyebrow` class: a second color utility does not reliably override it; 5.57:1 on linen), on the right `copy.prayers.card.afterDays(n)` in `text-body-sm text-mauve` ("After 18 days", "After 1 day", "The same day"). The date is `formatShortDate(answeredAt)`, with the year (`formatEntryDate`) when it is not this year.
- The node: absolutely placed, a 28dp circle with a 4dp `linen` border (the HTML's `ring-4 ring-surface`) over `bg-terracotta`, so the colored disc is 20, with a white `checkmark` icon 12 centered. Its center is 10dp from the item's left edge and 16dp from its top (`-left-1 top-0.5` on a `size-7`). Terracotta on linen is 3.41:1 and white on terracotta 3.63:1: both are graphics (3:1).
- The rail: a 2dp `bg-petal` line centered on the node (`absolute left-[9px] w-0.5`), starting at the node's center (`top-4`) and running to the item's bottom; the separator draws the same line through the 40dp gap (`h-10`, the HTML's `gap-space-xl`), and the last item's line ends `bottom-6` above its bottom (use the `index` from `renderItem`).
- Node, rail and their wrappers are decoration: `pointerEvents="none"` and hidden from accessibility (`accessibilityElementsHidden` and `importantForAccessibility="no-hide-descendants"`).

---

## 8. Menu, dialogs, notice

- **Overflow menu** (Answered cards). iOS: `ActionSheetIOS.showActionSheetWithOptions({ title: prayer title, options: [edit, moveBack, cancel], cancelButtonIndex: 2, userInterfaceStyle: "light" }, ...)`, no `destructiveButtonIndex`. Android: a private `BottomSheet` with two 56dp `list-row`s (icon, label). Rows: "Edit gratitude note" (opens the sheet in `editNote` mode) and "Move back to Active". The scrim closes it ("Close").
- **"Move back to Active"** opens `ConfirmDialog` (default tone, never destructive red): title "Move this prayer back to Active?", body "Its answered date and note will be removed.", confirm "Move back", cancel "Keep as answered", `loading` while the call runs. On `ok` the dialog closes and the card is in Active on the next render; on failure it closes and the notice banner shows the failure line.
- **Notice banner** (in the header, below the tabs): `card card--blush flex-row flex-wrap items-center gap-x-3 gap-y-2` with `accessibilityLiveRegion="polite"` and `useAnnounce(message)` (iOS has no live regions). Two kinds: after a successful Mark Answered, "Marked as answered." with a text button "View in Answered" (`btn-text__label`, `text-plum`, `min-h-11`; it switches to the Answered tab and clears the notice); after any failed change, "We couldn’t save that change." (calm, no red). It stays until the next tab change or refresh and **never dismisses on a timer**; Active shows the marked notice, and a failure shows on whichever tab it happened on. Keep it in the screen, not a component.
- The note is never logged or sent anywhere, and no analytics call exists yet: `// TODO(34): prayer_marked_answered { has_note: boolean }` next to the success path (step 34's catalog has only `has_note`; the old draft's `days_to_answer` is not in it, so do not add it).

---

## 9. `src/components/prayers/MarkAnsweredSheet.tsx` (new)

Props: `prayer: Prayer`, `mode: "mark" | "editNote"`, `visible: boolean`, `onClose: () => void`, `onSubmit: (values: { answeredDate: string; note: string | null }) => Promise<RepoResult<Prayer>>`. Built on `BottomSheet` (decision 9). The screen keeps the sheet's `prayer`, `mode` and `visible` as separate state and a counter `key`, so closing only flips `visible` (a sheet whose content is cleared on close draws an empty slide-out) and opening gives a fresh form.

Content, top to bottom (sizes from `#answer-modal`; tokens win):

1. Header row: a column with the eyebrow "Testimony of grace" (`eyebrow`) and the title (`text-section text-plum-deep`: "How was this prayer answered?" in `mark` mode, "Your gratitude note" in `editNote`; the HTML's 22 has no token, the 20/28 token is used), and a 44×44 close button on the right (`xmark` 20, label "Close", the HTML's 36dp circle is the visible part).
2. The context pill: `self-start max-w-full flex-row items-center gap-2 rounded-full border border-petal bg-white/70 px-3 py-2` with `hands.sparkles` 16 (`colors.plum`) and the prayer's title on one line (`numberOfLines={1}`, `text-body-sm text-plum-deep`, `font-dm-medium`). It replaces the old draft's two-line summary.
3. `mark` mode only: "Date answered" (`text-label-md text-ink`) and the **date row**: a `Pressable` (button, label `copy.prayers.sheet.dateA11y(date, relative)`, hint "Opens a date picker") with the classes on an inner `View`: `min-h-12 flex-row items-center gap-2 rounded-input border border-petal bg-card px-3`, the `calendar` icon 20 in `colors.terracotta`, the day as `formatCalendarDate(answeredDate)` ("October 24, 2026", `text-body text-ink flex-1`), and a `chip chip--terracotta` with `chip__label chip__label--terracotta` "Today" or "Yesterday" when it is one of them. State `answeredDate` starts as `toCalendarDate(new Date())` taken when the sheet opens (not at import). Minimum is the prayer's creation day, maximum is today; keep `value` inside them. Android: `DateTimePickerAndroid.open({ value, mode: "date", minimumDate, maximumDate, onValueChange: (_event, date) => ... })`. iOS: tapping toggles the inline `DateTimePicker` (`@expo/ui/community/datetime-picker`, the named export, `mode="date"`, `display="spinner"`, `themeVariant="light"`, `minimumDate`, `maximumDate`, `onValueChange`) under the row. Dismiss the keyboard first (`Keyboard.dismiss()`).
4. "Note of gratitude (optional)" (`text-label-md text-ink`) and the `TextInput`: multiline, `className` from `.input` plus `min-h-[120px] py-3`, `textAlignVertical="top"`, `maxLength={MAX_GRATITUDE_NOTE_LENGTH}`, `keyboardAppearance="light"`, `placeholderTextColor={colors.mauve}`, placeholder "Write a note of gratitude… How did you see God’s faithfulness in this situation?", an accessibility label, and a counter `{n} / 1000` under it, right aligned, `text-body-sm text-mauve`, shown from `GRATITUDE_COUNTER_FROM`. The field keeps its text on a failed save.
5. A `PrimaryButton` (`loading` while saving, disabled while saving): "Save Answered Prayer" with `heart.fill` / `favorite` (`mark`), "Save note" (`editNote`). Under it a text button: "Not yet — keep in active prayers" (`mark`) or "Cancel" (`editNote`), `min-h-11`, `text-body text-mauve`, centered.
6. On error, an inline line under the buttons in `text-body-sm text-ink` (calm, never red): "We couldn’t save this. Please try again." for `NETWORK` and `UNKNOWN`, "Choose a day between when you prayed and today." for `INVALID` on the date. The sheet stays open with the text intact.

Behavior:

- The sheet validates before it calls `onSubmit` (the date is within range, the note is trimmed, empty becomes `null`, at most 1000) and the repository validates again.
- **Closing with unsaved text** (the scrim, the X, "Not yet" or "Cancel", Android back) opens `ConfirmDialog` "Discard this note?" (body "What you’ve written won’t be saved.", confirm "Discard", cancel "Keep writing", default tone). Unsaved means a note that differs from the starting one (empty in `mark`, the saved note in `editNote`). A changed date alone does not ask. **Render this `ConfirmDialog` inside the sheet's children** (decision 10). While saving, every way to close does nothing.
- On `ok` the sheet closes (`onClose`). In `mark` mode the screen then shows the notice "Marked as answered." with "View in Answered". Nothing else navigates.
- Do not add `autoFocus` (AGENTS.md Bottom Sheets). `BottomSheet`'s `ScrollView` has `keyboardShouldPersistTaps="handled"` and a `KeyboardAvoidingView`, so a tall sheet scrolls above the keyboard (the same as `EmailSheet`).

---

## 10. Copy and dev panel

- `src/constants/copy.ts` gets `copy.prayers` (strings above, builders for plurals and the accessibility labels). Every apostrophe and quote is curly; "Mark Answered" is Title Case on the card button; sentence-case strings that render uppercase (the caption, the eyebrows) stay sentence case. `// TODO(29)` on the Active empty body (it points at a toggle that persists in step 29).
- `DevToolsPanel`: a "Fail next prayer change (dev)" button for `nextPrayerMutationFails`, shown as selected while armed (copy `nextReflectionLoadFails`' button). Dev UI keeps inline strings.

---

## 11. Connections to other screens and the rules

- Reflection's "Mark as Prayer Request" toggle is still local state with `// TODO(29)`. **Do not wire it here.** The old draft's check "prayers toggled in the mock appear in Active" cannot pass: the toggle writes nothing, and a new entry from New Entry is cloned as a non-prayer (`addMockEntry`), so the Prayers counts do not change after a submit. That is expected until step 29.
- Journal Home's counts and its "Prayer requests" filter must be unchanged after marking and unmarking (they count `entry.prayer !== null`).
- No new dependencies, no `any`, NativeWind classes first, `StyleSheet` only for the cases AGENTS.md allows. No crisis red anywhere on this screen. No tab bar, dock, header or other screen changes (the only shared files that change are `SegmentedControl` and the dev panel). Only `PrayerCard` and `MarkAnsweredSheet` are new reusable components; the timeline item, the banners, the empty states, the Android menu sheet and the loading state stay in the screen.
- Never log summaries, titles, notes, transcripts or ids. Only `console.warn` in `__DEV__` for something a developer must fix.
- Contrast was computed for every new pair; nothing is under 4.5:1 for text (the lowest: `mauve` on `linen-deep` 4.91, `rosewood` on blush 4.81) or 3:1 for a graphic (the lowest: the node, 3.41).

---

## 12. AGENTS.md updates (do these in the same step, then copy the file to `prompts/AGENTS.md`)

- Add the "Step 14" entry to the Build Status log: the decisions above, files created and changed, the measured sizes, what was verified and what was not, and the open items.
- Architecture: `components/prayers/` (`PrayerCard`, `MarkAnsweredSheet`), `usePrayers`, `utils/prayerDates.ts`; replace "Planned: PrayerCard"; list `SegmentedControl`'s new `count` and `accessibilityLabel` item fields and the stacking.
- Close the "large-text tab wrap stays open for step 14" item (the step 11 follow-up), with what was measured on the emulator.
- Record `nextPrayerMutationFails` in the Dev store paragraph and the dev panel list, and the `TEMP(29)` / `TODO(29)` / `TODO(34)` markers.
- If a vendor fact is learned on a device (the iOS inline picker, `ActionSheetIOS`, the nested `ConfirmDialog`, the first-frame row before the stack), add it to the vendor notes, and say what was not verified on iOS.

---

## 13. Verify

Run `npx expo start -c` (Metro on 8082 for the emulator; never stop the user's 8081), `npm run lint` and `npm run typecheck` (read the real exit codes), and `npx expo export` once per platform (one platform at a time on this machine). Then, on the Android emulator (Expo Go 57), at 390dp (`wm size 1080x2340`, `wm density 443`), 411dp and 320dp with font scale 1.3:

1. Default scenario: the header says "Sanctuary Prayers" and "17 petitions recorded" (it wraps under the title at 390dp); the tabs read "Active 5" and "Answered 12" with their spoken labels; Active lists the prayers oldest first with "24 days", "11 days", "4 days", "2 days" and "1 day"; the cards match the HTML (category eyebrow, chip beside the title at 390dp, summary, reference, outlined Mark Answered). Compare with `prompt_material/06-prayers.png` in proportions only.
2. The Answered tab shows the banner "Look how faithful He has been — 12 answered prayers." in two lines at 390dp, then the timeline: terracotta nodes on a petal rail, "Answered on …" and "After N days" above each card, the gratitude note in italic Fraunces, the reference and "Answered". The rail is continuous through the gaps and ends above the last card's bottom.
3. Mark one prayer answered with today's date and a note: the sheet shows the spinner on its button for about 500ms, closes, the card leaves Active, the banner "Marked as answered. View in Answered" appears, the tabs read "Active 4" and "Answered 13", and "View in Answered" switches tabs, clears the banner and shows the new prayer first with its note. Switching tabs or pulling to refresh clears the banner; nothing clears it by itself.
4. Mark another with an earlier date through the picker: dates before its creation and in the future cannot be chosen (the Android dialog greys them). Mark one with no note: "Add a gratitude note" shows on its Answered card, opens the sheet in `editNote` mode, and saving puts the note in.
5. Edit a note. Then "Move back to Active": the dialog asks, "Move back" returns the prayer to Active with no date and no note, and it is still a prayer (it is in the Journal's "Prayer requests" filter count both before and after).
6. Failure path: tap "Fail next prayer change (dev)", then save in the sheet: the sheet stays open, the typed note is intact, "We couldn’t save this. Please try again." shows, and the next save works. Do the same for "Move back": the dialog closes, "We couldn’t save that change." shows on the Answered tab, and the prayer stays answered.
7. Cancel with typed text asks "Discard this note?" (the dialog is above the sheet); "Keep writing" returns to the text; "Discard" closes. The scrim and Android back do the same. With no typed text everything closes at once.
8. Scenarios: `empty` shows both empty states and hides the caption; no crisis entry appears on either tab in any scenario; the `offline` scenario looks the same as default. A temporary experiment (reverted, marked `TEMP-EXPERIMENT`) with a prayer that has an empty title, an empty summary and a null category shows "Prayer from {date}" and no empty lines.
9. Font scale 1.3 at 320dp and 360dp: the cards wrap without clipping (the chip drops under the title, the footer's Mark Answered goes under the reference at the right), every control is at least 44, the Prayers tabs stay a row; at 320dp with font scale 2.0 they stack. The Reflection tabs at 320dp and 360dp, font scale 1.3: three full-width rows with whole labels; at normal text, unchanged. New Entry's Speak/Write toggle is unchanged and its selected pill is round.
10. With TalkBack: each tab is read with its count, each card as one button with its hint, Mark Answered and the overflow button as their own labelled buttons (a `--compressed` dump shows no nested clickable inside the card's button), the banner is announced, and the sheet's fields and buttons are labelled.
11. A Node check of `prayerDates.ts` in a few zones (copy the harness approach: set `process.env.TZ` inside the script) and of the `copy.prayers` plural builders for 0, 1 and 2.
12. The log holds no title, summary, note or id from this screen.

Not verifiable here, so for the user's iPhone in Expo Go: the iOS inline date spinner inside the sheet, `ActionSheetIOS`, the "Discard this note?" and "Move back" dialogs opening above the sheet, swipe-down on the sheet, VoiceOver on the cards, and that the two count badges and the timeline look right. Say plainly that none of it was verified on iOS.

Report: files created and changed; the `Prayer` fields used; that `@react-native-community/datetimepicker` and `@expo/ui` were present and nothing was installed; icons used; copy keys added; the measured sizes; what was verified and what was not; every `TEMP(29)`, `TODO(29)` and `TODO(34)` left; and any difference from the HTML with its reason.
