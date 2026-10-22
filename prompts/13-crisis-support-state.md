# 13-crisis-support-state.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory" (the iOS developer account comes last, so my iPhone stays on Expo Go until then) and "Crisis Safety Rules (NON-NEGOTIABLE)". If you are unsure whether a change affects crisis handling, stop and ask.

Build the real Crisis Support state on the Reflection screen, and a Support Resources screen that Profile will open in step 15. This replaces the temporary crisis view from step 11 (`ReflectionCrisis` in `src/screens/journal/ReflectionStateViews.tsx`, marked `TEMP(13)`), which has no resources and no phone numbers, so it is **not shippable**: no build leaves my machines before this step is done. This step is UI and device actions only (phone, text, web links). Screening on the server is step 21. Nothing here needs a development build, an account, a key or a new package: the iPhone (Expo Go) and the Android emulator both run it. **Do not install anything** (not `expo-clipboard`, `expo-sms` or `expo-localization`).

Where things stand after step 12 (all read from the repo):

- `src/screens/journal/ReflectionScreen.tsx` renders its own header (back chevron and the entry date) and, under it, a body chosen in this order: loading, not found, error, **`state.entry.isCrisis`**, then the status checks, then the ready view. The crisis branch renders `ReflectionCrisis({ onReturn })`: a blush card with a 4dp crisis bar and `copy.reflection.crisis.title`, and a plum `PrimaryButton` "Return to my journal". Keep the order: a crisis entry is a finished one in the data, and it must win over the status.
- `RootStackParamList` ends with `Paywall`. `RootNavigator`'s signed-in group is `MainTabs`, `NewEntry`, `Reflection`, `NowPlaying`, `Paywall`, and a comment there says "The four screens above it".
- The mock crisis entry (`entry-crisis-six-days-ago`, in the `default` and `offline` scenarios) has `is_crisis: true`, `input_type: "text"`, a transcript ("I don’t know how much longer I can keep carrying all of this…") and no emotion, scripture, devotional or prayer. The repository returns no affirmations for it, `getPlaybackTrack` is null for it, the Journal card says "A heavy moment. Tap to see support." and shows no transcript. A `crisis` submit (`useDevStore.nextSubmitOutcome`, step 10) clones it as `entry-new-<id>` in every scenario, including `empty`, and New Entry opens Reflection for it with `replace` and fires no haptic.
- `PrimaryButton` has only `label`, `onPress`, `iconLeft`, `iconRight`, `disabled` and `loading` and always draws `btn-primary` (plum). **There is no critical or ghost variant and no `accessibilityHint`**, so this step adds them (section 5). `.btn-critical`, `.btn-ghost`, `.btn-text__label`, `.card`, `.card--blush` and `.eyebrow` exist in `global.css`. `BottomSheet` (blush, `visible` / `onClose`), `TranscriptRow({ title, transcript })`, `Icon`, `useDevStore` and `DevToolsPanel` exist.
- `expo-web-browser` 57.0.3 and `expo-linking` are installed. `expo-clipboard` is not, and this step does not need it (decision 5).
- `.env.local` holds only `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, which is all the app needs. **This step reads no environment variable and nothing has to be set up in Clerk, Supabase, Google or Apple.**
- The Android emulator image (`gracehush_test`, API 37, Google Play) has the Google Dialer, Google Messages, Chrome and TalkBack, so every device action and the screen-reader focus can be checked on this machine (resolved with `cmd package resolve-activity` in the review: `tel:`, `sms:` and `https:` each have a handler).

Design reference (read only). Take every size from the HTML, where 1 CSS px = 1dp, never from the PNG:

- `prompt_material/05-reflection.html`, the section `#view-crisis` (it starts at the comment "3. CRISIS SUPPORT VARIANT", about line 166), and `prompt_material/05-reflection.png`

**The first draft of this prompt said there is no mockup and pointed at `@prompt_material/05-reflection.png`. That was wrong.** The PNG shows only the Devotional view (`Images/5._reflection_now_playing.png` is the same file, despite its name), but the HTML holds the whole crisis view: an alert card with a crisis-red left bar, four tappable rows (988, Crisis Text Line, 911, outside the US), a red "Talk to someone now" pill and a "Return to my journal" link. Build from it. Ignore the Stitch artifacts around it: the sticky "Devotional View / Now Playing Sheet / Crisis Support" pill switcher and the header's bookmark and share icons (Reflection has its own header). The draft (written without the HTML) disagreed with the design and with AGENTS.md in the places listed under Decisions, and this prompt wins over it.

## Decisions (final)

1. **The headline is the design's copy, from AGENTS.md "Crisis Safety Rules"**: "It sounds like you’re going through something really heavy. You don’t have to carry this alone." It is already `copy.reflection.crisis.title`. The draft's "Thank you for telling us…" title and its "You’re not alone" eyebrow are dropped (the eyebrow would repeat the headline's last sentence). AGENTS.md outranks a step prompt.
2. **Layout and sizes come from the HTML; tokens win where they differ** (AGENTS.md "Standing Rulings"). The draft's sizes (padding 24, a 56 tile, a 56 button, 26/32 title) were guesses with no source. **Crisis red appears where the HTML uses it**: the alert card's left bar, the heart tile, the 988 and 911 tiles, the 911 detail line and the primary button, and nowhere else (no red body text, no red borders on other cards). The draft limited it to two elements; the HTML uses six, and AGENTS.md's colour table allows `crisis` for "crisis support".
3. **The app never promises confidentiality, cost or what a service will do in its own words** (AGENTS.md: "Never make claims about confidentiality or what a hotline will do"). The HTML's "gentle, confidential, human presence without judgment" and "Free, confidential, 24/7" are not built. Crisis Text Line's own page says "Message & data rates may apply" next to "free", so the app says availability only ("24/7") and the Support Resources footer says that rates may apply when you text.
4. **One flat list, one row component.** The draft's `CrisisResource` with an `actions[]` array, `EmergencyRow` and `CrisisResourceCard` became one `CrisisResource` per way to reach help (a call, a text or a web link) and one `CrisisContactRow` that draws it. The Reflection crisis view shows the four the HTML shows; Support Resources shows all six. Nothing outside this step uses the old names (the later prompts read only `CrisisSupportPanel`, the route name `CrisisResources` and `src/constants/crisisResources.ts`).
5. **No `expo-clipboard`, no "Copy" button.** The draft said to stop and ask before adding it. The numbers are 3 to 6 digits, and the fallback sheet shows them large and `selectable` (long-press copies on both platforms). A dependency and a "Copied" state for that is not worth it. (A Copy button can be added later with one `npx expo install expo-clipboard`, once approved.)
6. **Screen-reader focus uses `AccessibilityInfo.sendAccessibilityEvent(ref.current, "focus")`.** The draft said `AccessibilityInfo.setAccessibilityFocus(findNodeHandle(...))`, which React Native 0.86.3 marks `@deprecated` ("Use `sendAccessibilityEvent` with eventType `focus` instead", read in `AccessibilityInfo.js`). The new call takes the host ref directly (typechecks with a `useRef<Text>`), and the snippet in section 4 passes `npm run lint` (both checked in the review).
7. **A new `formatCalendarDate(isoDate)` in `src/utils/format.ts`.** The draft calls `formatLongDate(CRISIS_RESOURCES_LAST_VERIFIED)` with the string `'2026-10-16'`, but `formatLongDate(now: Date)` takes a `Date` and prints no year ("Thursday, October 24"). Fixing the call alone is not enough: `new Date("2026-10-20")` is UTC midnight, which prints **"October 19, 2026" in every US zone** (shown in the review in America/Los_Angeles, America/New_York and Pacific/Pago_Pago, and "September 30" for "2026-10-01"). The helper builds a local date from the parts (section 3).
8. **`CRISIS_RESOURCES_LAST_VERIFIED` is `"2026-10-20"`**, not the draft's `"2026-10-16"`, because the numbers and URLs were re-checked on 2026-10-20 against the official pages (the comment in section 2 says which). The date changes only when someone re-checks every entry again.
9. **The 988 chat URL is `https://chat.988lifeline.org/`**. The draft's `https://988lifeline.org/chat/` answers `301 Moved Permanently` to it, and the official 988lifeline.org home page links the chat button straight to it. Texting 988 is official too (the home page's Text button is `sms:988`, and an FCC notice dated 2026-06-18 says the Lifeline keeps receiving SMS).
10. **`PrimaryButton` gets `tone` and `accessibilityHint`** (section 5). The draft says "PrimaryButton in the critical variant" and "ghost button", which do not exist yet.
11. **The fallback sheet is built on `BottomSheet`**, not a new `Modal` (AGENTS.md "Bottom Sheets": every sheet is a `BottomSheet`).
12. **A dev switch makes the fallback reachable on any device**: `useDevStore.nextCrisisLinkFails`, a one-shot flag with a "Fail next crisis link (dev)" button, the same pattern as `nextReflectionLoadFails`. The draft only said to test on a simulator, and there is no iOS simulator here.
13. **No analytics and no marker for it.** The draft leaves `// TODO(34): track crisis_resources_viewed`, but step 34 says "no crisis events, no Support Resources events" and "Close each TODO(34) with a `track()` call that matches the catalog", so that marker could never be closed. Leave none. The draft's `// TODO(28)` is dropped too: nothing in this step schedules a notification, and step 28's planner already returns nothing when the newest entry is a crisis entry.
14. **`CrisisResources: { source: "reflection" | "profile" }` keeps its `source` param** because step 15 calls `navigate('CrisisResources', { source: 'profile' })`. Nothing reads it in V1 (no analytics). Say so in a comment.
15. **Region.** "Talk to someone now" calls 988, which is a United States number. V1 is en-US only (AGENTS.md "Important Constraints"), and the "Outside the US? Find a local helpline" row is on the Reflection crisis view itself, one tap from a person anywhere else, so nobody has to open a second screen to find it. A region-aware primary action is a later decision, not built here. **The primary button calls 988 wherever the phone is, so when you test it, cancel the call.**
16. **The transcript row stays, titled "What you shared", collapsed, never expanded by the app.** Step 21 saves a crisis entry's transcript, step 31's export shows it, and the row is the existing `TranscriptRow`. It is rendered only when the trimmed transcript is not empty.
17. **`CrisisResources` is a `modal` with `animation: "slide_from_bottom"`** (Android's default modal fades in with a slight slide from the right, AGENTS.md vendor note; an iOS `modal` can be swiped down).
18. **Nothing on the crisis view animates in or makes a haptic or a sound.** The calm views never animate in (no `FadeIn` here). `TranscriptRow`'s own user-triggered 200 ms chevron turn is fine (it respects Reduce Motion). `haptics` is never imported in this step.

## What the design says (final)

### Reflection crisis view (`CrisisSupportPanel`)

Reflection's header stays as it is (the screen renders it above the body). The panel is a `ScrollView` whose content container (StyleSheet) has the numeric side padding rule (`width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding`, `width` from `useWindowDimensions`, as `ReadyView`), `gap: 16`, `paddingTop: 16` and `paddingBottom: 32` (the HTML's `gap-4`, `pt-3` and `pb-10`). It scrolls, so large text never clips. No tab bar, no dock, no `FadeIn`.

| Part | Build |
| --- | --- |
| Alert card | `View className="card relative overflow-hidden"` (white, petal border, radius 16, padding 16; the HTML's `shadow-xs` is skipped, as on every white card since step 11). Inside: a bar `View className="absolute inset-y-0 left-0 w-1.5 bg-crisis"` (the HTML's `w-1.5` is 6dp; its comment says 4px, the class wins), then a `View className="pl-2"` with: the heart tile `View className="mb-2.5 size-8 items-center justify-center rounded-full bg-crisis/10"` holding `Icon` `heart.fill` / `favorite` 18 in `colors.crisis` (decorative: `accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`), the headline `Text` (ref `titleRef`, `accessibilityRole="header"`, `className="font-fraunces text-[19px] leading-[26px] text-ink"`) and under it `Text className="mt-2 text-body text-mauve"` with `copy.crisis.body`. The headline is a one-off size because no token fits and the line count matters (measured with the real font files: 3 lines, 78dp, at 390dp; `text-section` 20/28 Medium needs 307.7 of the 308dp available and breaks to 4 lines at the first pixel of difference; `text-headline` 24/32 makes 4). The HTML's 12px body becomes the `text-body` token (AGENTS.md "Standing Rulings") |
| Rows | `View className="gap-2.5"` (the HTML's `gap-2.5`) holding one `CrisisContactRow` for each `CRISIS_RESOURCES` entry with `onReflection: true`, in list order: 988 call, Crisis Text Line, 911, outside the US |
| Primary action | `PrimaryButton tone="critical"` with `iconLeft={{ ios: "phone.fill", android: "call" }}`, label `copy.crisis.talkNow`, `accessibilityHint={copy.crisis.talkNowHint}`; it runs `PRIMARY_CRISIS_RESOURCE`. 48 tall (`btn-critical`; the HTML's `h-12`), full width, `shadow-md` skipped. Directly under it a text button "More ways to get help" (`Pressable`, `accessibilityRole="button"`, inner `View className="min-h-11 items-center justify-center"`, label `text-label-lg text-plum`) that calls `onOpenResources`. The two sit in one `View className="gap-2"` |
| Note card | `View className="card card--blush gap-1.5"`: `Text className="eyebrow"` with `copy.crisis.note.eyebrow`, then `Text className="text-body text-ink"` with `copy.crisis.note.body`. No Bible verse here, verified or not |
| Words | `TranscriptRow title={copy.crisis.words} transcript={...}`, only when `transcript?.trim()` is not empty. Collapsed by default, never expanded by the app |
| Return | `PrimaryButton tone="ghost" label={copy.reflection.footer.returnToJournal} onPress={onReturn}`. The HTML has an underlined "Return to my journal" link; a 48dp ghost button is the app's pattern and "Return to Journal" is the string every Reflection view uses. `onReturn` is the screen's `popTo("MainTabs", { screen: "Journal" })`, which already exists |

Props: `{ transcript: string | null; onOpenResources: () => void; onReturn: () => void }`. **It takes the transcript and nothing else, so it cannot render a player, a verse, tabs, an emotion badge, a prayer toggle or a share button even if the data holds them.** Run the actions through `useCrisisActions` (section 4) and render `<CrisisFallbackSheet fallback={…} visible={…} onClose={…} />` once at the end.

Focus: when the panel opens, the headline takes screen-reader focus once the push transition is over:

```tsx
const titleRef = useRef<Text>(null);

useEffect(() => {
  // The push transition is still running at mount, and iOS moves focus itself when it ends.
  const timer = setTimeout(() => {
    if (titleRef.current) AccessibilityInfo.sendAccessibilityEvent(titleRef.current, "focus");
  }, 500);
  return () => clearTimeout(timer);
}, []);
```

### Row (`CrisisContactRow`)

Props `{ resource: CrisisResource; onPress: () => void }`. A `Pressable` (style function only: pressed opacity 0.7, as `TranscriptRow`) with `accessibilityRole="button"` and `accessibilityLabel={resource.accessibilityLabel}`, and one inner `View className="card flex-row items-center gap-3 p-3.5"` (the same shape as `PrayerRequestRow`; the HTML's `p-3.5`, radius 16, 10dp between rows). The row is 68dp tall with one line of text and grows when the text wraps: **do not truncate** (the HTML's `truncate` hides words at large text). Parts: a tile `View className="size-10 items-center justify-center rounded-full"` (the HTML's `w-10 h-10`) that is `bg-crisis/10` when `resource.urgent` and `bg-linen` otherwise, with the icon 20 (below) in `colors.crisis` when urgent, `colors.rosewood` for `web` and `colors.plum` otherwise; a `View className="flex-1"` with the title (`text-label-lg text-ink`) and under it the detail (`text-label-md text-mauve`, and `text-label-md text-crisis` for the `emergency` row, as the HTML's red 911 line); and on the right a 20 icon in `colors.mauve` (`chevron.right` / `chevron_right`, or `arrow.up.right.square` / `open_in_new` for `web`). The tile and the right icon are decorative (`accessibilityElementsHidden`, `importantForAccessibility="no-hide-descendants"`). The HTML's 14/12 text becomes the 15 and 13 tokens.

| Icon key | iOS | Android |
| --- | --- | --- |
| `call` | `phone.fill` | `phone_in_talk` |
| `text` | `message.fill` | `chat_bubble_outline` |
| `emergency` | `staroflife.fill` | `emergency` |
| `web` | `globe` | `public` |

(Every pair, and `heart.fill` / `favorite`, `xmark` / `close`, `chevron.right` / `chevron_right`, `arrow.up.right.square` / `open_in_new` and `phone.fill` / `call`, was checked in the review against `sf-symbols-typescript` and the keys of `expo-symbols`'s `symbols.json`. Render each through `Icon`, with `satisfies Record<string, SymbolViewProps["name"]>` like the other screens.)

### Support Resources (`CrisisResourcesScreen`)

`src/screens/journal/CrisisResourcesScreen.tsx`, `RootStackScreenProps<"CrisisResources">`. `SafeAreaView` (top and bottom edges, linen, inline style) with: a header over a petal divider (`View className="border-b border-petal"` holding `View className="screen__content min-h-14 flex-row items-center"`): left a 44×44 close `Pressable` (`xmark` / `close` 22 in `colors.ink`, `accessibilityRole="button"`, label `copy.crisis.resources.close`, calls `navigation.goBack()`), a centered title (`flex-1 text-center text-section text-plum-deep`, `accessibilityRole="header"`) and a 44×44 empty spacer. Under it a `ScrollView` (the same numeric padding rule, `gap: 12`, `paddingTop: 16`, `paddingBottom: 32`) with: the intro (`text-body text-mauve`, `copy.crisis.resources.intro`), **every** `CRISIS_RESOURCES` entry as a `CrisisContactRow` in a `View className="gap-2.5"`, and the footer (`text-body-sm text-mauve text-center`, `copy.crisis.resources.footer(formatCalendarDate(CRISIS_RESOURCES_LAST_VERIFIED))`). Then `<CrisisFallbackSheet … />`. It works fully offline: it fetches nothing (only a web row needs a connection). It has no design of its own: it is the same rows as the Reflection view, so the three 988 ways (call, text, chat) sit together.

### Fallback sheet (`CrisisFallbackSheet`)

Shown when a link cannot open (an iPad or an emulator with no phone app, a phone with no messaging app). Built on `BottomSheet` (`visible`, `onClose`). Props `{ fallback: CrisisFallback | null; visible: boolean; onClose: () => void }`: the component returns `null` while `fallback` is `null` (nothing has failed yet) and otherwise renders `<BottomSheet visible={visible} onClose={onClose}>`. `useCrisisActions` keeps the last value after the sheet closes (it only flips `fallbackVisible`), so the slide-out (about 300 ms) never draws an empty sheet. Children, top to bottom: the title (`text-section text-plum-deep`, `accessibilityRole="header"`, `copy.crisis.fallback.title`), the value (`Text selectable className="mt-3 text-title text-ink"` for a number, `text-section` for a web address so it fits), the instruction (`mt-2 text-body text-mauve`: `copy.crisis.fallback.call`, `.text` or `.textWithBody(body)`, `.web`) and `<View className="mt-5"><PrimaryButton tone="ghost" label={copy.crisis.fallback.close} onPress={onClose} /></View>`. No Copy button (decision 5): long-press on the number copies it.

### Contrast (computed with a script)

White on `crisis` 5.49 (the button label and icon), `crisis` on white 5.49 (the 911 detail line), `crisis` on its 10% tint 4.75 (the heart, 988 and 911 icons: graphics, above the 3:1 they need; the tint is `#F8ECEB`, the HTML's `#FDEDEB`), `ink` on white 14.05, `mauve` on white 5.72, `ink` on blush 12.07, `mauve` on blush 4.92, `plum` on linen 8.90, `rosewood` on linen 5.24, `plum-deep` on linen 12.53, `mauve` on linen 5.37. Nothing ships below its threshold.

### Measured (real font files, 390 / 360 / 320dp, font scale 1 / 1.3)

Headline 3 / 4 / 4 lines at 1x and 4 / 5 / 6 at 1.3x; row titles wrap to 2 lines (3 for "Outside the US? Find a local helpline" at 320dp and 1.3x); the note is 5 to 8 lines; "Talk to someone now" (153dp at 1x, 199dp at 1.3x) and "More ways to get help" (160 and 208dp) fit one line in the 212dp a 320dp button leaves. At 390dp and 1x the header, the alert card, the four rows and the red button add up to about 730dp of an 844dp screen (arithmetic from these line counts, not a device measurement), so the first row and the button should be on screen without scrolling; at 320dp and 1.3x they are reached by scrolling and nothing clips. Measure the real heights on the emulator and report them; do not shrink anything to force a fit.

## 1. Before writing code

1. Read `src/screens/journal/ReflectionScreen.tsx`, `src/screens/journal/ReflectionStateViews.tsx` (the `ReflectionCrisis` view), `src/hooks/useReflection.ts`, `src/navigation/types.ts`, `src/navigation/RootNavigator.tsx`, `src/constants/copy.ts` (`reflection.crisis`), `src/types/index.ts`, `src/components/PrimaryButton.tsx`, `BottomSheet.tsx`, `TranscriptRow.tsx`, `src/store/devStore.ts`, `src/components/dev/DevToolsPanel.tsx` and the crisis entry in `src/data/mock/entries.ts`.
2. Confirm the crisis rule with the real mock: `entry-crisis-six-days-ago` has `scripture`, `devotional` and `prayer` null, no emotion and no affirmations, in `default` and `offline`. If a mock breaks the rule, fix the mock, not the screen.
3. Take a baseline screenshot of a **ready** Reflection (the "Ready" dev button) and of the Journal feed before editing, so check 12 can compare.
4. Do not install anything. `npx expo install --check` must stay "up to date" and `package.json` and `package-lock.json` must not change.

## 2. Resources data: `src/constants/crisisResources.ts`

Add the types to `src/types/index.ts`:

```ts
export type CrisisActionKind = "call" | "text" | "web";
export type CrisisIcon = "call" | "text" | "emergency" | "web";

// One way to reach help: a row on the Reflection crisis view and on Support Resources.
export type CrisisResource = {
  id: string;
  title: string; // the service
  detail: string; // what a tap does, one short line
  icon: CrisisIcon;
  kind: CrisisActionKind;
  value: string; // the number or the URL
  body?: string; // SMS prefill, text only
  urgent: boolean; // the crisis-red tile: only the lifeline call and 911
  onReflection: boolean; // on the Reflection crisis view (all of them are on Support Resources)
  accessibilityLabel: string; // says what the tap does
};

export type CrisisAction = Pick<CrisisResource, "kind" | "value" | "body">;
```

Then the data. Titles and details are written here, not in `copy.ts`, because they carry the numbers:

```ts
// Re-check every number and URL in this file before each App Store and Play release, then change this date.
// Checked 2026-10-20 on the official pages: 988lifeline.org (call, text and chat, "24/7/365"; its Text button is
// sms:988 and its Chat button is chat.988lifeline.org), crisistextline.org ("Text HOME to 741741 ... 24/7") and
// findahelpline.com (ThroughLine's directory of helplines). The app states availability only: no cost,
// confidentiality or outcome claim (AGENTS.md Crisis Safety Rules).
export const CRISIS_RESOURCES_LAST_VERIFIED = "2026-10-20";

const lifelineCall: CrisisResource = {
  id: "lifeline-call",
  title: "988 Suicide & Crisis Lifeline",
  detail: "Call 988 • 24/7",
  icon: "call",
  kind: "call",
  value: "988",
  urgent: true,
  onReflection: true,
  accessibilityLabel: "Call the 988 Suicide and Crisis Lifeline",
};

// The order is the Reflection crisis view's order (the HTML's): 988, Crisis Text Line, 911, outside the US.
export const CRISIS_RESOURCES: CrisisResource[] = [
  lifelineCall,
  {
    id: "lifeline-text",
    title: "988 Suicide & Crisis Lifeline",
    detail: "Text 988 • 24/7",
    icon: "text",
    kind: "text",
    value: "988",
    urgent: false,
    onReflection: false,
    accessibilityLabel: "Text the 988 Suicide and Crisis Lifeline",
  },
  {
    id: "lifeline-chat",
    title: "988 Suicide & Crisis Lifeline",
    detail: "Chat online • 24/7",
    icon: "web",
    kind: "web",
    value: "https://chat.988lifeline.org/",
    urgent: false,
    onReflection: false,
    accessibilityLabel: "Open the 988 Suicide and Crisis Lifeline online chat",
  },
  {
    id: "crisis-text-line",
    title: "Crisis Text Line",
    detail: "Text HOME to 741741 • 24/7",
    icon: "text",
    kind: "text",
    value: "741741",
    body: "HOME",
    urgent: false,
    onReflection: true,
    accessibilityLabel: "Text HOME to 741741, Crisis Text Line",
  },
  {
    id: "emergency",
    title: "In immediate danger? Call 911",
    detail: "Immediate emergency assistance",
    icon: "emergency",
    kind: "call",
    value: "911",
    urgent: true,
    onReflection: true,
    accessibilityLabel: "Call 911",
  },
  {
    id: "find-a-helpline",
    title: "Outside the US? Find a local helpline",
    detail: "Helplines in countries around the world",
    icon: "web",
    kind: "web",
    value: "https://findahelpline.com",
    urgent: false,
    onReflection: true,
    accessibilityLabel: "Open Find a Helpline, a directory of helplines worldwide",
  },
];

// "Talk to someone now".
export const PRIMARY_CRISIS_RESOURCE = lifelineCall;
```

Rules:

- Screens read only this file for numbers and URLs. Never put a number or a URL in a component or in `copy.ts`.
- Do not add other hotlines, religious counseling lines or church-finder links without asking (AGENTS.md).
- The strings above say "24/7" and nothing about cost or privacy. Do not add "free" or "confidential" (decision 3).
- The Reflection crisis view's rows are `CRISIS_RESOURCES.filter((resource) => resource.onReflection)`. The data never depends on the network.

## 3. Date helper: `src/utils/format.ts`

```ts
// "October 20, 2026" from a calendar date "2026-10-20". The date is read as a local one: new Date("2026-10-20")
// is UTC midnight, which is the day before in the Americas. Anything that is not YYYY-MM-DD comes back unchanged.
export function formatCalendarDate(isoDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDate);
  if (!match) return isoDate;
  const local = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return local.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}
```

Leave `formatLongDate` as it is. (The helper was run in the review in nine zones: UTC, Los_Angeles, New_York, London, Lagos, Kolkata, Auckland, Kiritimati and Pago_Pago, for "2026-10-20", "2026-10-01", "2027-01-01", "2026-12-31", "2028-02-29" and five malformed strings: 0 failures. The naive version printed the day before in three of the nine.)

## 4. Device actions: `src/services/crisisLinks.ts` and `src/hooks/useCrisisActions.ts`

The service (typechecked and linted in the review):

```ts
import * as WebBrowser from "expo-web-browser";
import { Linking, Platform } from "react-native";

export type CrisisLinkResult = { ok: true } | { ok: false; fallback: string };

// No Linking.canOpenURL: without declared query schemes it answers false for links that would open.
async function open(url: string, fallback: string): Promise<CrisisLinkResult> {
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch {
    if (__DEV__) console.warn("[crisis] a link could not be opened");
    return { ok: false, fallback };
  }
}

export function openCall(number: string): Promise<CrisisLinkResult> {
  return open(`tel:${number}`, number);
}

export function openText(number: string, body?: string): Promise<CrisisLinkResult> {
  const separator = Platform.OS === "ios" ? "&" : "?";
  const url =
    body === undefined ? `sms:${number}` : `sms:${number}${separator}body=${encodeURIComponent(body)}`;
  return open(url, number);
}

export async function openWeb(url: string): Promise<CrisisLinkResult> {
  try {
    await WebBrowser.openBrowserAsync(url);
    return { ok: true };
  } catch {
    if (__DEV__) console.warn("[crisis] a web link could not be opened");
    return { ok: false, fallback: url };
  }
}
```

Rules: never log anything from an entry, and nothing at all except those two `__DEV__` warnings (no number, no URL, no id, no text). Web links open in the in-app browser (`expo-web-browser`, installed). A failed result is shown by the fallback sheet.

The hook (the two screens' one place for "run an action, show the sheet when it fails"; typechecked and linted in the review with a stand-in store):

```ts
export type CrisisFallback = { kind: CrisisActionKind; value: string; body?: string };

export function useCrisisActions() {
  // The value stays after the sheet closes, so the sheet's slide-out never draws an empty sheet.
  const [fallback, setFallback] = useState<CrisisFallback | null>(null);
  const [fallbackVisible, setFallbackVisible] = useState(false);

  const run = useCallback(async (action: CrisisAction) => {
    let result: CrisisLinkResult;
    const dev = useDevStore.getState();
    if (__DEV__ && dev.nextCrisisLinkFails) {
      dev.setNextCrisisLinkFails(false); // one-shot, like nextReflectionLoadFails
      result = { ok: false, fallback: action.value };
    } else if (action.kind === "call") {
      result = await openCall(action.value);
    } else if (action.kind === "text") {
      result = await openText(action.value, action.body);
    } else {
      result = await openWeb(action.value);
    }
    if (!result.ok) {
      setFallback({ kind: action.kind, value: result.fallback, body: action.body });
      setFallbackVisible(true);
    }
  }, []);

  const closeFallback = useCallback(() => setFallbackVisible(false), []);

  return { fallback, fallbackVisible, run, closeFallback };
}
```

`useDevStore` gets `nextCrisisLinkFails: boolean` and `setNextCrisisLinkFails(value)` (default `false`; nothing in a release build sets it). `DevToolsPanel` gets `DevButton label="Fail next crisis link (dev)" selected={nextCrisisLinkFails} onPress={() => setNextCrisisLinkFails(true)}` beside "Fail next Reflection load (dev)". A row's `onPress` is `() => run(resource)` (a `CrisisResource` is a `CrisisAction`).

## 5. `PrimaryButton`: `tone` and `accessibilityHint`

Two optional props, default unchanged (every existing call keeps its look):

```ts
// "critical" is the crisis-red call to action (the crisis view's only one), "ghost" a quiet bordered button.
tone?: "default" | "critical" | "ghost";
accessibilityHint?: string;
```

Use literal class names (NativeWind finds them by scanning the source): `default` is `btn-primary` / `btn-primary__label` with white icons, `critical` is `btn-critical` / `btn-critical__label` with white icons, `ghost` is `btn-ghost` / `btn-ghost__label` with the icons and the loading spinner in `colors.ink`. The pressed and disabled styles are the same for all three, and `accessibilityHint` goes to the `Pressable`. Do not change `ConfirmDialog`, `DevButton` or `AuthButton` (they keep their own markup).

## 6. Wiring

- **`src/navigation/types.ts`**: add `CrisisResources: { source: "reflection" | "profile" };` after `NowPlaying` (decision 14: nothing reads `source` in V1, it stays because step 15 passes it).
- **`src/navigation/RootNavigator.tsx`**: register `<Stack.Screen name="CrisisResources" component={CrisisResourcesScreen} options={{ presentation: "modal", animation: "slide_from_bottom" }} />` after `NowPlaying`, and change the comment to "The five screens above it hide the tab bar and the dock by covering them".
- **`src/screens/journal/ReflectionScreen.tsx`**: in the crisis branch (keep it where it is, before the status checks) render `<CrisisSupportPanel transcript={state.entry.transcript} onOpenResources={() => navigation.navigate("CrisisResources", { source: "reflection" })} onReturn={returnToJournal} />`. Import it from `@/components/crisis/CrisisSupportPanel`, drop `ReflectionCrisis` from the imports, and keep the comment that the order matters.
- **`src/screens/journal/ReflectionStateViews.tsx`**: delete `ReflectionCrisis` and its `TEMP(13)` comment, and `crisis` from the destructuring of `copy.reflection` (the rest of the file stays; `PrimaryButton` is still used there).
- **`src/screens/profile/ProfileScreen.tsx`** (a placeholder until step 15): add the marker `{/* TODO(15): "Get support now" row → navigate("CrisisResources", { source: "profile" }) */}` where the row will go. Step 15 removes it.
- **Delete** `copy.reflection.crisis` (the `TEMP(13)` block) and add the `crisis` group below.

## 7. Copy: `src/constants/copy.ts`

A new top-level group `crisis` (curly apostrophes and quotes everywhere; the eyebrow is stored in sentence case). No number and no URL in it:

```ts
crisis: {
  // The design’s words (AGENTS.md Crisis Safety Rules). It moved here from reflection.crisis.
  title: "It sounds like you’re going through something really heavy. You don’t have to carry this alone.",
  body: "You can reach a trained counselor any time, day or night.",
  talkNow: "Talk to someone now",
  talkNowHint: "Calls the 988 Suicide and Crisis Lifeline",
  moreWays: "More ways to get help",
  note: {
    eyebrow: "About this reflection",
    body: "We’ve paused the devotional and affirmations for this entry so you can focus on getting support. Reaching out for help is not a lack of faith. God often meets us through the people around us.",
  },
  words: "What you shared",
  resources: {
    title: "Support Resources",
    close: "Close support resources",
    intro: "Ways to reach a real person, any time of day.",
    footer: (date: string) =>
      `Gracehush is not a crisis service. Resources last checked ${date}. Message and data rates may apply when you text.`,
  },
  fallback: {
    title: "Your phone couldn’t open this.",
    call: "Dial this number from your phone app.",
    text: "Send a text to this number from your messaging app.",
    textWithBody: (body: string) => `Send “${body}” to this number from your messaging app.`,
    web: "Open this address in your browser.",
    close: "Close",
  },
},
```

Never on this screen: a question about safety or risk ("Are you safe?", a scale, a checkbox), anything about methods or means, a promise about confidentiality, police involvement or what a counselor will do, or an urgency animation, pulsing, a sound or a haptic. The crisis outcome of a submit still opens Reflection with `navigation.replace('Reflection', { entryId })` (step 10): do not change it. Never log the transcript or any entry text.

## 8. Files

Create: `src/constants/crisisResources.ts`, `src/services/crisisLinks.ts`, `src/hooks/useCrisisActions.ts`, `src/components/crisis/CrisisSupportPanel.tsx`, `src/components/crisis/CrisisContactRow.tsx`, `src/components/crisis/CrisisFallbackSheet.tsx`, `src/screens/journal/CrisisResourcesScreen.tsx`. Change: `src/types/index.ts`, `src/utils/format.ts`, `src/constants/copy.ts`, `src/components/PrimaryButton.tsx`, `src/store/devStore.ts`, `src/components/dev/DevToolsPanel.tsx`, `src/navigation/types.ts`, `src/navigation/RootNavigator.tsx`, `src/screens/journal/ReflectionScreen.tsx`, `src/screens/journal/ReflectionStateViews.tsx`, `src/screens/profile/ProfileScreen.tsx`, `AGENTS.md` and `prompts/AGENTS.md`. Delete: `ReflectionCrisis` (a function, not a file). Do not touch `global.css`, `theme.ts`, `package.json` or the lockfile (no new token, class or package).

Components take data through props and do not fetch. The panel and the Support Resources screen are the only two that call `useCrisisActions`.

## 9. Verify

Run `npm run lint`, `npm run typecheck`, `npx expo install --check` (up to date) and `npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>` (once with `--no-bytecode --no-minify` to search the bundle for the new classes: `bg-crisis/10`, `w-1.5`, `size-8`, `size-10`, `text-crisis`, `text-[19px]`, `leading-[26px]`, `text-label-md`, `gap-2.5`, `p-3.5`, `card--blush`, `btn-critical`, `btn-ghost`). Then, on the Android emulator (Expo Go 57, Metro on 8082, the recipes in AGENTS.md "Verifying on this machine"; 390dp is `wm size 1080x2340` with `wm density 443`):

1. **Reach the view three ways.** (a) Journal feed, the crisis card ("A heavy moment. Tap to see support."). (b) Profile → dev panel → "Open reflection (dev)" → Crisis. (c) `Next submit` = `crisis`, then New Entry with typed text, in `default` **and** `empty`. Each shows the same panel, with no player, verse, tabs, emotion badge, prayer toggle or share button: a `uiautomator dump --compressed` has none of those labels.
2. **The panel.** Header (back, date), the alert card (heart tile, the headline, the body), four rows in this order (988, Crisis Text Line, 911, outside the US), the red "Talk to someone now", "More ways to get help", the note card, "What you shared" collapsed (the transcript text is **not** in the dump), "Return to Journal". Measure and report the card, a row, the button and the headline's lines at 390dp.
3. **Phone.** Tap "Talk to someone now": the dialer opens with 988 typed in and nothing is dialed (`adb shell dumpsys activity activities | grep topResumedActivity` shows `com.google.android.dialer`; read the digits from a screenshot, because the review's `uiautomator dump` did not return the dialer's text, and dismiss a first-boot "Allow … notifications?" dialog if one covers it); Back returns to the crisis view. Same for the 911 row (never press call).
4. **Text.** Tap Crisis Text Line: Google Messages (`com.google.android.apps.messaging`, seen in the review as the app that opens for `sms:741741?body=HOME`) opens a conversation to 741741 with "HOME" in the compose box (read it from a screenshot; Messages may ask first to set itself as the default SMS app: dismiss it). Back returns.
5. **Web.** Tap the outside-the-US row: Chrome opens a Custom Tab on findahelpline.com (a fresh emulator shows Chrome's first-run screen: "Stay signed out", AGENTS.md). Close returns to the crisis view.
6. **Fallback, two ways.** (a) Dev panel → "Fail next crisis link (dev)", then tap any row: the sheet shows "Your phone couldn’t open this.", the number large and selectable, the right instruction (for Crisis Text Line: "Send “HOME” to this number…", for a web row the address), and Close; Android back also closes it; the flag is spent (the next tap opens the dialer). (b) Remove every phone handler for real: `adb shell pm disable-user --user 0 com.google.android.dialer` **and** `adb shell pm disable-user --user 0 com.google.android.contacts` (the dialer alone is not enough: Contacts' `NonPhoneActivity` then takes `tel:` at priority -1; with both disabled the review's `cmd package resolve-activity` said "No activity found" and `am start` said "unable to resolve Intent"). Tap "Talk to someone now": the same sheet appears from the real `catch`. **Then enable both again** (`adb shell pm enable com.google.android.dialer`, same for `com.google.android.contacts`) and confirm `adb shell "cmd package resolve-activity --brief -a android.intent.action.VIEW -d tel:988"` names the dialer again.
7. **Support Resources.** "More ways to get help" slides the modal up from the bottom (a screen recording shows it, per AGENTS.md); six rows (988 call, 988 text, 988 chat, Crisis Text Line, 911, outside the US) and the footer with the date as the constant says it ("October 20, 2026"); X closes it, Android back closes it and returns to the crisis view (not to Journal), and three quick taps on "More ways to get help" open one modal. The actions work from here too, and the fallback sheet shows over this modal.
8. **Large text and small screens.** 320dp wide (`wm size 720x1280`, `wm density 360`) and font scale 1.3, and 411dp: nothing is clipped, every touch target is at least 44dp (read the bounds from the dump), the primary button and "Return to Journal" are reached by scrolling, no row text is cut.
9. **TalkBack** (the emulator has it; the binding was checked in the review): `adb shell settings put secure enabled_accessibility_services com.google.android.marvin.talkback/com.google.android.marvin.talkback.TalkBackService` then `adb shell settings put secure accessibility_enabled 1`. Open the crisis view: about half a second after it opens the focus rectangle is on the headline (screenshot), swiping right visits each row once with its full label ("Call the 988 Suicide and Crisis Lifeline", "Text HOME to 741741, Crisis Text Line", "Call 911", "Open Find a Helpline…"), the tiles and chevrons are not stops, and the button reads its hint. If TalkBack shows its first-run tutorial, dismiss it with Back, and tap "Don’t allow" on "Allow Android Accessibility Suite to send you notifications?" (it covered the dialer in the review). **Turn it off afterwards**: `adb shell settings delete secure enabled_accessibility_services` and `adb shell settings put secure accessibility_enabled 0`. If the focus does not land on the headline, report it with the delay you tried; do not add retries.
10. **Offline.** With airplane mode on (`adb shell cmd connectivity airplane-mode enable`, then `disable`; the review saw `settings get global airplane_mode_on` go 1 and 0), the crisis view and Support Resources still open and the call and text rows still open the dialer and Messages; only the web rows need the network (Chrome shows its own offline page).
11. **Privacy.** `adb logcat -d -s ReactNativeJS:V` after the checks above holds no transcript, entry id or number (only the `[crisis] …` warnings from a failed link, and only in development). `grep -rnE "haptics|FadeIn|Animated" src/components/crisis src/screens/journal/CrisisResourcesScreen.tsx src/hooks/useCrisisActions.ts src/services/crisisLinks.ts` finds nothing; `grep -rn "console\." src/components/crisis src/screens/journal/CrisisResourcesScreen.tsx src/hooks/useCrisisActions.ts src/services/crisisLinks.ts` finds only the two `__DEV__` warnings.
12. **Nothing else changed.** A ready Reflection and the Journal feed look exactly as in the baselines from section 1 (compare the screenshots with `pngjs`, ignoring the status bar); the failed, pending, not-found and error views are unchanged; `PrimaryButton`'s other uses (Reflection "Return to Journal", the empty state button, the Onboarding buttons) look the same.
13. **Navigation.** From the crisis view, "Return to Journal" lands on the Journal tab and Android back then leaves the app (one `MainTabs`, as step 11); the chevron returns to where you came from.
14. **Cleanup.** Every temporary change is reverted and compared with `cmp`, no `TEMP-EXPERIMENT` is left, the dialer and Contacts are enabled, TalkBack and airplane mode are off, the display overrides are reset, the emulator is shut down (`adb emu kill`), and only your own Metro is stopped.

What cannot be verified here and is reported as **not verified on iOS**: the iPhone entirely (the "Call 988?" confirmation, `sms:` with `&body=` on the current iOS, the in-app Safari sheet, swipe-down on the modal, VoiceOver focus and the long-press copy on `selectable` text). The iPhone checks are mine, listed below.

## What I do myself after you report (nothing needs setting up first)

No account, key, ID, dashboard setting or install is needed for this step (`.env.local` already has everything the app uses, and `package.json` does not change). **Copy the numbered steps below into your report, word for word, so I can follow them.** After step 13 is reported:

1. Restart Metro (`npx expo start -c`) and open the app on the iPhone in Expo Go.
2. Profile tab → "Open reflection (dev)" → **Crisis**. You should see the heart card, four rows, a red "Talk to someone now" button, the note and "Return to Journal".
3. Tap **Talk to someone now**. iOS asks "Call 988?". **Tap Cancel.** (988 is a United States number; if you are elsewhere it would not connect.) Do the same for the **911** row: tap Cancel.
4. Tap **Crisis Text Line**. Messages opens to 741741 with "HOME" already typed. **Do not send it**; go back. If "HOME" is not typed in, tell the implementer which iOS version you have (it is reported, not worked around).
5. Tap **Outside the US? Find a local helpline**: a Safari sheet opens; tap Done.
6. Tap **More ways to get help**: a sheet slides up with six rows. Swipe it down (it closes), open it again and tap the X.
7. Profile → tap "Fail next crisis link (dev)", open the Crisis reflection again and tap any call row: a sheet says "Your phone couldn’t open this." with a large number. Long-press the number: iOS offers Copy.
8. Turn VoiceOver on (Settings → Accessibility): when the crisis screen opens, focus should land on the headline, and each row should read as one button.
9. Report what looked wrong, if anything. Nothing here sends a message or places a call unless you confirm it.

Before each store release (a standing task, not part of this step): open the three official pages again (988lifeline.org, crisistextline.org, findahelpline.com), check every number and URL in `src/constants/crisisResources.ts`, and only then change `CRISIS_RESOURCES_LAST_VERIFIED`.

## Out of scope

The Profile row (step 15 adds it: `// TODO(15)` stays in `ProfileScreen.tsx`); server-side screening (step 21); notifications (step 28 never schedules affirmations for a crisis entry); analytics (step 34 sends nothing for crisis); a region-aware primary action; other hotlines or languages; a Copy button and `expo-clipboard`; any claim about confidentiality, cost or outcomes; a "your reflection is ready" style prompt; deleting a crisis entry (step 31's account actions); the Stitch preview pill switcher and the header's bookmark and share icons.

## AGENTS.md updates

Edit the root `AGENTS.md` first, then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them. Replace a superseded rule instead of adding a second one.

- **Navigation Map**: add `CrisisResources (modal sheet)` to the tree under the signed-in stack; the tab bar is also hidden on it; the "Current state" paragraph's signed-in group and its "four screens above" become five (`NewEntry`, `Reflection`, `NowPlaying`, `CrisisResources`, `Paywall`); add a bullet: `CrisisResources` takes `{ source }` (not read in V1), is a `modal` with `animation: "slide_from_bottom"`, is opened from the Reflection crisis view's "More ways to get help" and from Profile (step 15), and closes with `goBack()`.
- **Screen Specifications, 5 (Reflection)**: replace the "Crisis Support state" bullet (it still says step 11 shows a temporary view with no resources) with the built view: the alert card, the four rows, the red button, "More ways to get help", the note, "What you shared" (collapsed), "Return to Journal"; no player, verse, tabs, badge, toggle or share; no animation, haptic or sound.
- **Architecture tree and component list**: `components/crisis/` (`CrisisSupportPanel`, `CrisisContactRow`, `CrisisFallbackSheet`), `constants/crisisResources.ts`, `services/crisisLinks.ts`, `hooks/useCrisisActions.ts`, `screens/journal/CrisisResourcesScreen.tsx`; `PrimaryButton` now has `tone` and `accessibilityHint`; the dev store has `nextCrisisLinkFails`; `copy.crisis` replaces `copy.reflection.crisis`.
- **Crisis Safety Rules**: the review already refined the bullets for resources, claims, logging and the verified date. Check they still read true and fix any detail that changed while building.
- **SDK and Vendor Version Notes**: add (1) `AccessibilityInfo.setAccessibilityFocus` is deprecated in React Native 0.86.3: use `sendAccessibilityEvent(ref.current, "focus")`, after a delay on a pushed screen, with what the emulator and TalkBack showed; (2) `Linking.canOpenURL` is not used for `tel:` and `sms:` (it needs declared query schemes), `Linking.openURL` inside `try/catch` is, and the SMS prefill separator is `&` on iOS and `?` on Android, with what each platform did; (3) a `new Date("YYYY-MM-DD")` is UTC midnight, so a calendar date is parsed with `formatCalendarDate`.
- **Build Status & Decisions Log**: add "Step 13 — Crisis Support state and Support Resources (date)" with the decisions above, the files, the icons, the measurements, what was verified and what was not, and the open items.
- **Audio Rules / Notification Rules**: no change (a crisis entry never loads a track and never schedules affirmations, already written).

## Report

Files created, changed and deleted; that no package was added (`expo install --check` output); the icons used; the copy keys added and removed; the measured sizes (headline lines, a row, the button) at 390dp and at 320dp with font scale 1.3; what each check above showed, including the real `catch` path with the dialer disabled and the TalkBack result; every difference from the HTML you kept and why; what is **not verified on iOS**; and every TODO left (only `TODO(15)` in `ProfileScreen.tsx`).
