# 11-reflection-ui.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory": the iOS developer account comes last, and my iPhone stays on Expo Go until then.

Implement the Reflection screen as shown in the design, replacing the step 08 placeholder: the header, the validation headline, the mini player card (mocked playback), the scripture card, the carousel (devotional, affirmations, closing prayer), the collapsible "Your words" row, the "Mark as Prayer Request" row, the footer (return to Journal and share), and the calm views for loading, still preparing, failed, not found, error and a temporary crisis view. The Now Playing sheet (step 12) and the full Crisis Support state (step 13) are not built here. Nothing here needs a development build or a new package: the iPhone (Expo Go) and the Android emulator both run this step.

Where things stand after step 10: `src/screens/journal/ReflectionScreen.tsx` is a TEMP placeholder (a back button and one line of text) that receives `route.params.entryId`, and `RootNavigator` registers it as a plain push above `MainTabs`. Journal cards open it with `navigate("Reflection", { entryId })` (only ready and crisis cards are tappable), and New Entry opens it with `replace("Reflection", { entryId })` (a submit gives an id like `entry-new-{uuid}`: the mock clones the anxious fixture with its three affirmations, or the crisis fixture). `journalRepository` already has `getEntry`, `listAffirmationsForEntry` and `getProfile`. `Skeleton`, `useReduceMotion`, `SegmentedControl` (full width, `light`), `PrimaryButton`, `Icon` and the dev store exist. `.env.local` holds the Clerk development key, which is all the app needs; this step reads no environment variable.

Design reference (read only). Take every size from the HTML, where 1 CSS px = 1dp, and never from the PNG:

- `prompt_material/05-reflection.png` and `prompt_material/05-reflection.html`

The PNG is 487px wide for a 390dp frame (1.25x). It shows only the Devotional view, with its icons failed to render and three layout glitches. The HTML has three views: Devotional (`#view-devotional`), Now Playing (`#view-nowplaying`, step 12) and Crisis (`#view-crisis`, step 13). It also holds what the PNG does not show: the Affirmations and Closing Prayer panes (`#tab-pane-affirmations`, `#tab-pane-prayer`) and the expanded "Your words" box (`#accordion-content`). Build the Devotional view with its three panes. Ignore the Stitch artifacts: the sticky "Devotional View / Now Playing Sheet / Crisis Support" pill switcher, and the header's bookmark and share icons (there is no bookmark feature, and share lives in the footer). Do not replicate the PNG's glitches: the reference overlapping the verse, the placeholder text where icons failed to render, and the wrapped "0:34 / 1:28", "Private to you" and "Save to Journal".

## What the design says (measured, final)

Every size below comes from the HTML, never the PNG. The first draft of this prompt used PNG-derived numbers (24 side padding, radius 20 and padding 20 on the cards, a 52 play circle, 56 buttons, a 17/28 devotional text, a 4 tall progress track, a 30/38 headline); the HTML gives a 20 margin (it uses 16, and the app's margin is 20 on every screen), radius 16 and padding 16, a 48 circle, 48 buttons, 14 text, a 6 tall track and a 27/34 headline. Tokens win over the HTML (AGENTS.md "Standing Rulings"), and where the HTML copy differs from this prompt's copy, this prompt wins. List every difference you keep in your report.

Measured from the font files (cmap and hmtx of the real `.ttf` files), because React Native gives text beside a fixed element no room to shrink: the anxious headline needs 3 lines in `text-headline-lg` (30/38) or `text-title` (28 SemiBold) on a 390dp phone and 2 lines at the HTML's 27/34 Regular; "Philippians 4:6–7" (142dp) and the "Berean Standard Bible" pill (172dp) do not fit side by side in the scripture card's 316dp at 390dp (the pill drops under the reference, which is what the HTML's `flex-wrap` does too); "Your spoken prayer" (141dp), the chip (106dp with `px-2.5`), the lock, the chevron and the gaps need about 314dp of the words row's 316dp at 390dp, so the chip drops under the title on any narrower phone; the tab labels "Devotional", "Affirmations" and "Closing Prayer" are 66, 76 and 88dp wide against tabs of 103dp at 390dp, 93dp at 360dp and 82dp at 320dp; the player card's time row ("0:34 / 1:28" 62dp, "Tap to open player" 116dp, an icon and the gaps) needs 208dp of the card's 256dp at 320dp and 261dp at font scale 1.3, where the link wraps under the time.

### Frame

`SafeAreaView` (top and bottom edges, linen, inline style) → the header → the body of the current state. Side padding everywhere is the screen margin, 20 (16 below 360dp): the `screen__content` class on views, and for the ready view's `ScrollView` a `contentContainerStyle` (StyleSheet) with the numeric rule (`width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding`, `width` from `useWindowDimensions`), `paddingTop: 16`, `paddingBottom: 32` and `gap: 16`. No tab bar and no dock (a stack screen above `MainTabs`). The status bar is already dark app-wide (`StatusBar style="dark"` in `App.tsx`): add nothing.

### Header (the HTML's fixed header; it stays above the scrolling content in every state)

| Part | Build |
| --- | --- |
| Row | An outer `View className="border-b border-petal"` (full width, like `ScreenHeader`) with `View className="screen__content min-h-14 flex-row items-center gap-1"` inside. It is `min-h`, not a fixed height, so it grows at large text |
| Back | `Pressable` (style function only, pressed opacity 0.6) with an inner `size-11 items-center justify-center` box (a 44 touch area) and the chevron icon 24 in `ink`; `accessibilityRole="button"`, label "Go back". It calls `navigation.goBack()` when `navigation.canGoBack()`, else `navigation.popTo("MainTabs", { screen: "Journal" })` (a notification can open Reflection first, step 28). The HTML's `arrow_back` is a chevron here, because Sign In's back control is a chevron and the app keeps one |
| Date | Only when an entry is loaded (ready, crisis, preparing, failed): `flex-row items-center gap-1.5` with the calendar icon 18 in `rosewood` and `formatEntryDate(entry.createdAt)` in `text-label-lg text-rosewood`, for example "Oct 24, 2026" (the HTML has 14 Medium). Not pressable. Nothing on the right: the HTML's bookmark and share icons are not built |

### Headline block (first in the scroll content)

| Part | Build |
| --- | --- |
| Headline | A `Text` with `accessibilityRole="header"` and `font-fraunces text-[27px] leading-[34px] tracking-[-0.675px] text-plum-deep`: the HTML's 27/34 Regular with `tracking-tight`. No type-scale token matches, and the two nearest break the anxious headline into three lines at 390dp where the HTML has two (measured above), so this one-off is deliberate. The HTML colour is `plum`; titles on light surfaces are `plum-deep`. The text is `getValidationHeadline(entry.dominantEmotion)` |
| Subline | `mt-1.5 text-body-sm text-mauve`: "A sanctuary moment curated from your voice journal." for an audio entry, "A sanctuary moment curated from your written journal." for a typed one (the HTML has 12 muted with wide tracking) |

### Mini player card (`src/components/MiniPlayerCard.tsx`)

Props: `devotional: Devotional` and `onOpen: () => void`. `hasAudio` is `devotional.audioPath !== null && devotional.durationMs !== null && devotional.durationMs > 0` (an unmeasured length is never invented; AGENTS.md "Audio Rules"). The file holds two local components, `AudioCard` and `NoAudioCard`, so `useMockPlayback` is only called where there is audio, and only that card re-renders on a tick.

| Part (`AudioCard`) | Build |
| --- | --- |
| Frame | An outer `Pressable` with **`accessible={false}`**, `onPress={onOpen}` and a style function (pressed: scale 0.98), around `View className="rounded-card bg-plum p-4"` with `style={shadows.card}`. The HTML's radius is `rounded-2xl` = 16 and its padding 16 (the draft said 20 and 20). A `Pressable` is accessible by default and groups its children into one element, which hides the buttons inside it from VoiceOver (AGENTS.md vendor notes), so the card takes touches but is not an accessibility element; the labels sit on the controls |
| Top row | `flex-row items-center gap-3.5`: the play button, then a `flex-1 flex-row items-center gap-3` group holding the text column (`flex-1`) and the chevron-up icon 22 in `rose` (the HTML's `expand_less`; decorative) |
| Play | A `Pressable` (style function only) with an inner `size-12 items-center justify-center rounded-full bg-rose` (48, the HTML's; the draft said 52) and the play or pause icon 28 in `plum-deep`. `accessibilityRole="button"`, label "Play devotional, {title}" and, while playing, "Pause devotional". It only toggles the mock playback and never opens the player |
| Text | Title `text-section text-white` with `numberOfLines={2}` (the HTML has 18 Medium, one line), and below it `text-body-sm text-white/70` (wraps): "{n} min • Personalized devotional", with `n = Math.max(1, Math.round(durationMs / 60000))` |
| Progress | `mt-3.5`: a `h-1.5 overflow-hidden rounded-full bg-plum-deep/60` track (the HTML's `plum-dark` at 60%, 6 tall; the draft said white 20% and 4) with a `h-full rounded-full bg-rose` fill whose `width` is an inline `${percent}%`. Hidden from screen readers (the time row speaks the position) |
| Time row | `mt-2 flex-row flex-wrap items-center justify-between gap-x-3`. Left: "0:34 / 1:28" in `text-label-md text-white/70` with tabular figures (`fontVariant: ["tabular-nums"]`, as `JournalCard` does), both values from `formatDuration` (not `formatTimer`, which pads to "00:34"); it is one accessible element labelled "34 seconds of 1 minute 15 seconds" (`formatDurationSpoken`). Right: a `Pressable` (style function only, `hitSlop` 13 above and below, `accessibilityRole="button"`, label "Open full player") with `flex-row items-center gap-1`, "Tap to open player" in `text-label-md text-white` and the arrow-right icon 14 in white |

`NoAudioCard` is a plain `View className="flex-row items-center gap-3.5 rounded-card bg-plum p-4"` with `style={shadows.card}`: the same 48 `rose` circle with the book icon 24 in `plum-deep` (not pressable), then a `flex-1` column with the title (`text-section text-white`, 2 lines) and `text-body-sm text-white/70` "Your devotional is ready to read below.". No progress, time row, link or chevron, and it is not pressable.

`onOpen` is passed by the screen. Step 12 has no route yet, so it is `// TODO(12): navigate('NowPlaying', { entryId })` plus a `console.info("[reflection] open player (step 12)")` that runs only in `__DEV__` and logs no text.

### Scripture card (`src/components/ScriptureCard.tsx`)

Props: `scripture: Scripture`. The screen renders it only when `entry.scripture !== null`.

| Part | Build |
| --- | --- |
| Card | `card card--blush` (radius 16, padding 16, a petal border: the HTML's `rounded-2xl p-4 border-petal`; the draft said 20 and 20), no shadow (the HTML's `shadow-xs`). One accessible element: `accessible` and the label "{reference}, Berean Standard Bible. {verse}" (unverified: "…Berean Standard Bible. We're confirming this passage.") |
| Top row | `flex-row flex-wrap items-center justify-between gap-x-3 gap-y-2` (the HTML's `gap-2`). The reference in `text-scripture-ref` (17/24 SemiBold rosewood, the scripture-reference token; the HTML has 18 Medium) with **no** `flex-1`, so the pill drops under it when they do not fit, as in the HTML. The pill: `shrink-0 rounded-full border border-petal bg-card/70 px-2 py-0.5` holding `Text className="eyebrow"` "Berean Standard Bible" (stored in sentence case, `eyebrow` uppercases it; the HTML has 10 semibold and the draft said mauve). The reference never overlaps anything |
| Verse | `mt-2.5 text-scripture text-ink/90`, in curly quotes (the HTML's 16/26 italic is the token's 17/26) |
| Unverified | `scripture.verified === false` (so `text` is `null`): the top row only, then `mt-2.5 text-body-sm text-mauve` "We're confirming this passage." The text never renders |

### Carousel (`src/components/ReflectionCarousel.tsx`)

Props: `devotional: Devotional`, `affirmations: Affirmation[]`, `reminders: Record<TimeSlot, string>`, `currentSlot: TimeSlot`. State: the selected tab, `"devotional" | "affirmations" | "prayer"` (exactly these values: step 28 opens the carousel on one of them), initially `"devotional"`.

| Part | Build |
| --- | --- |
| Card | `card gap-3.5` (the HTML's `p-4`, radius 16, `mb-3.5` under the control), no shadow |
| Control | `SegmentedControl` (`variant="light"`, full width, `accessibilityLabel` "Reflection sections") with the items "Devotional", "Affirmations" and "Closing Prayer" (the last is left out when `closingPrayer` is null or blank; two items then). The HTML's labels "Devotional Text" and "Today's Affirmations" wrap to two lines at 390dp in its 11px grid; the short labels fit one line at 390dp and 360dp (tabs of 103 and 93dp, longest label 88dp) and wrap only at 320dp or with large text. The HTML's tabs are 26dp tall and would miss the 44dp touch minimum, so the control keeps `SegmentedControl`'s 44dp items (a 52dp track), its pill shape and its `linen-deep` track. Known limit, report it and do not fix it here: at font scale 1.3 on a 360dp phone "Affirmations" (98dp) is wider than a tab (93dp) and breaks inside the word; the fix would live in `SegmentedControl`, which step 14 reuses |
| Pane | `<FadeIn key={tab}>` around the pane (the `FadeIn` component below), so a tab change fades the new pane in over 150ms; no swipe paging; only the selected pane is rendered |
| Devotional | `devotional.script` split on blank lines (`/\n{2,}/`, trimmed, empty parts dropped) into paragraphs: `gap-2.5`, each `text-body text-ink` (the HTML's 14/22.75 with a 10 gap; the draft's 17/28 was the PNG's 1.25x; `text-body` is the scale's 15/22) |
| Affirmations | `gap-2.5`, one row per affirmation (the repository orders them morning, afternoon, evening). Row: `flex-row items-start gap-3 overflow-hidden rounded-xl border border-petal bg-linen/80 p-3` (the HTML's) with a `size-8 items-center justify-center rounded-full border border-petal bg-blush` circle holding the slot icon 17 in `rosewood`, then a `flex-1` column: `Text className="eyebrow"` "Morning • 8:00 AM" (slot name `copy.onboarding.rhythm.slots[slot].name`, time `formatTime12(reminders[slot])`, stored in sentence case), `mt-0.5 text-section text-ink` for the headline (the Journal affirmation card's headline style) and `mt-1 text-body text-ink/80` for the text (as that card). The `currentSlot` row also has `absolute inset-y-0 left-0 w-[3px] bg-plum` inside it (the row's `overflow-hidden` rounds it). One accessible element per row, children hidden, label "{slot}, {time}, current. {headline}. {text}" (without ", current" on the others). No affirmations: `text-body-sm text-mauve` "No affirmations were created for this reflection." (the draft's "will appear after your next reflection" promised something no step builds) |
| Closing prayer | `rounded-xl border border-petal bg-blush/60 p-3` with `text-scripture text-ink/90`: “{closingPrayer} Amen.” in curly quotes. The stored prayer has no "Amen" (step 06 and step 32), and the HTML ends its quote with "Amen." inside the quotes (the draft put it on its own line) |

### `FadeIn` (`src/components/FadeIn.tsx`, used by the carousel pane and the transcript box)

Wraps its children in an `Animated.View` whose opacity starts at 0 (`useState(() => new Animated.Value(0))`) and goes to 1 over 150ms with the native driver from an effect; with Reduce Motion (`useReduceMotion`) it sets 1 at once. It is used by remounting (`key`), so there is no "first run" to skip. The effect touches only the animated value, never React state.

### Your words (`src/components/TranscriptRow.tsx`, step 13 reuses it with another title)

Props: `title: string`, `transcript: string`. The screen passes "Your spoken prayer" for an audio entry and "Your written prayer" for a typed one, and renders the row only when the transcript is not blank.

| Part | Build |
| --- | --- |
| Card | `card overflow-hidden p-0` (the HTML puts `p-3.5` on the row) |
| Row | A `Pressable` (style function only, pressed opacity 0.7), `accessibilityRole="button"`, `accessibilityState={{ expanded }}`, label "{title}, private to you". Inner `flex-row items-center gap-2.5 p-3.5`: the lock icon 19 in `mauve` (the HTML's lock; the draft moved it into the chip), then a `flex-1 flex-row flex-wrap items-center gap-x-2.5 gap-y-1` group with the title (`text-label-lg text-ink`) and the chip (`chip px-2.5` with `chip__label` "Private to you"), then the chevron-down icon 18 in `mauve` inside an `Animated.View` that rotates 0 to 180° over 200ms when expanded (set directly under Reduce Motion). The group wraps, so the chip drops under the title on any phone narrower than about 390dp (measured above). The chip is `linen-deep` with `mauve` (4.91:1), not the HTML's blush with rosewood (4.41:1) |
| Expanded | Collapsed by default. Below the row, `px-3.5 pb-3.5` holding `<FadeIn>` and `rounded-xl border border-petal bg-linen p-3` with the transcript in curly quotes, `text-scripture text-ink/80` (the HTML's italic Fraunces). Plain conditional rendering, no `LayoutAnimation` |

### Mark as Prayer Request (a private component in `ReflectionScreen.tsx`)

| Part | Build |
| --- | --- |
| Row | A `Pressable` (style function only) around `card flex-row items-center gap-3 p-3.5`, so the whole row is the touch target (the native `Switch` alone is 31dp tall on iOS). It has `accessibilityRole="switch"`, `accessibilityState={{ checked }}`, label "Mark as Prayer Request" and the helper as `accessibilityHint` |
| Icon | A `size-9 items-center justify-center rounded-full bg-blush` circle (36, the HTML's; the draft said 40) with the Prayers tab icon 20 in `plum` |
| Text | A `flex-1` column: "Mark as Prayer Request" (`text-label-lg text-ink`) and `mt-0.5 text-body-sm text-mauve` "Keep it in your Prayers to return to." (corrected from "Keep in your weekly prayer sanctuary": nothing is weekly) |
| Switch | RN `Switch` inside a `View pointerEvents="none"` that is hidden from accessibility (`importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`): `value={checked}`, `trackColor={{ false: colors.petal, true: colors.plum }}`, `thumbColor={colors.card}` (no raw hex), `ios_backgroundColor={colors.petal}` |
| State | Local state, initially `entry.prayer !== null`, toggled optimistically: `// TODO(29): persist is_active_prayer + prayer fields`. Turning it off shows nothing destructive. The ready view has `key={entry.id}`, so another entry starts from its own value |

### Footer (inside the same `gap-3 pt-1` group as the prayer row, as in the HTML)

A `flex-row items-center gap-2` row (the HTML's `gap-2`; the draft said 12):

- A `flex-1` view holding `PrimaryButton` "Return to Journal" (`.btn-primary`, 48; the draft said 56). The design's "Save to Journal" is wrong, because the entry is already saved. It calls `navigation.popTo("MainTabs", { screen: "Journal" })` (decision 5).
- The share circle: a `Pressable` (style function only) with an inner `size-12 items-center justify-center rounded-full border border-petal bg-card` (48; the draft said 56) and the share icon 20 in `plum` (the HTML's colour). `accessibilityRole="button"`, label "Share scripture". It shows **only when the scripture is verified** (`scripture.verified && scripture.text !== null`). It calls `Share.share({ message })` from React Native, in `try/catch`, with the message below, and shows nothing when the user cancels or the sheet cannot open. Never share the transcript, the emotion, the devotional or the affirmations.

```txt
“{verse}”
— {reference} (BSB)

Shared from Gracehush
```

### Other views (`src/screens/journal/ReflectionStateViews.tsx`; the design has none of them)

`ReflectionScreen` renders them under the header. Crisis is checked **first**, before status (step 13 relies on that order).

| Entry or state | Render |
| --- | --- |
| `loading` | Skeleton blocks (the existing `Skeleton`, `gap-4`): two headline bars (30 tall, 90% and 65% wide, radius 8), a subline bar (14 tall, 55%), then blocks of 126 (the player card), 200 (the scripture card) and 280 (the carousel). One accessible element `accessible`, label "Loading your reflection", `accessibilityState={{ busy: true }}`, children hidden, like Journal's loading state. Respects Reduce Motion through `Skeleton`. No plum tint: `Skeleton` is petal |
| `isCrisis` | **Temporary crisis view** (`// TEMP(13): replaced by CrisisSupportPanel`). A centered column: `View className="w-full overflow-hidden rounded-card border border-petal bg-blush p-5"` with an `absolute inset-y-0 left-0 w-1 bg-crisis` bar and `pl-2 text-headline text-ink` "It sounds like you're going through something really heavy. You don't have to carry this alone.", then `mt-6` a `PrimaryButton` "Return to my journal" that does the same as "Return to Journal". No devotional, scripture, affirmations, mini player, transcript, share, prayer toggle or audio, and nothing plays by itself. It has no resources and no phone numbers by design (step 13 adds them): it is not shippable as it is |
| `pending`, `uploading`, `processing` | **Still preparing:** a centered small plum `ActivityIndicator`, then "Your devotional is still being prepared." (`text-headline text-plum-deep text-center`, header role), "It will be waiting in your Journal when it's ready." (`text-body text-mauve text-center`; the draft's "We'll let you know when it's ready" promised a notification no step builds) and the "Return to Journal" button. Nothing polls (step 25 adds polling) |
| `failed`, or `ready` with `devotional === null` | **Failed:** "We couldn't finish this reflection." and "Your words are safe. You can try again from your journal." and the "Return to Journal" button. No crisis red. A ready entry without a devotional cannot happen with real data; it lands here so the screen never crashes. `// TODO(25): "Try again" on this view` |
| `not-found` | "This reflection couldn't be found." and the "Return to Journal" button |
| `error` | "We couldn't load this reflection.", a `PrimaryButton` "Try again" (`state.retry`) and under it a text button "Return to Journal" (`min-h-11`, `btn-text__label`) |
| `ready` | The full devotional view, in this order inside the `ScrollView` (the gap is 16): headline block; mini player card (when `devotional` exists); scripture card (when `scripture` exists); carousel; "Your words" row (when the transcript is not blank); then one `gap-3 pt-1` group holding the prayer row and the footer row |

A shared private `MessageView` (a `ScrollView` with `flexGrow: 1` and `justifyContent: "center"`, the numeric side padding, `paddingVertical: 24`, content `items-center gap-3`, the button in a `w-full max-w-[320px]` view with `mt-3`) serves "still preparing", "failed", "not found" and "error", so only the strings and buttons differ. A button that returns uses the same `popTo` call as the header.

### Icons (render every one through `Icon`, with both names; all exist in the installed typings, checked against `sf-symbols-typescript` and `expo-symbols`'s `symbols.json`)

| Use | iOS | Android |
| --- | --- | --- |
| Back | `chevron.left` | `chevron_left` |
| Date | `calendar` | `calendar_today` |
| Play / pause | `play.fill` / `pause.fill` | `play_arrow` / `pause` |
| Open player chevron | `chevron.up` | `keyboard_arrow_up` |
| "Tap to open player" arrow | `arrow.right` | `arrow_forward` |
| No-audio card | `book` | `menu_book` |
| Morning / afternoon / evening | `sunrise.fill` / `sun.max.fill` / `moon.fill` | `wb_twilight` / `wb_sunny` / `bedtime` |
| Words row lock | `lock.fill` | `lock` |
| Words row chevron | `chevron.down` | `keyboard_arrow_down` |
| Prayer request (the Prayers tab pair) | `hands.sparkles` | `volunteer_activism` |
| Share | `square.and.arrow.up` | `share` |

Android's symbols are outline only (AGENTS.md), so play and pause are outlines there; iOS shows the filled glyphs.

## Decisions (made, do not ask me again)

These settle everything this step would otherwise stop and ask about. If one turns out to be impossible, stop and tell me instead of picking another.

1. **No new packages.** The step uses React Native `Share`, `Switch` and `Animated`, `Icon`, `expo-symbols`, `Skeleton`, `useReduceMotion`, `SegmentedControl`, `PrimaryButton` and `@react-navigation/native`. Nothing is installed, and `package.json` and the lockfile stay untouched.
2. **The HTML is the design source, and it holds panes the PNG does not show.** The first draft invented the Affirmations and Closing Prayer layouts from AGENTS.md alone; the HTML has them (icon circles in rounded rows, a closing prayer box with its quote). Both are built from it, with the draft's behaviors kept: the affirmation text under each headline (the Journal card shows it too), the current-slot marker and an empty message (reworded).
3. **Skipped from the HTML on purpose** (report them): the pill switcher; the header's bookmark and share icons; the Now Playing and Crisis views; the `shadow-xs` on the white and blush cards; the header's blur; the HTML's custom 44 by 24 toggle (the native `Switch` instead). The mini player's `expand_less` chevron and the header's calendar icon are built, though the draft left them out.
4. **`rose` is never text** (AGENTS.md colour table). The HTML sets the player card's subtitle and times in `dusty-rose` at 90%, which is 3.88:1 on `plum`; they are white at 70% (5.61:1) and "Tap to open player" is white at 90% (8.06:1). `rose` stays for the circle, the fill and the chevron (graphics, 4.40:1).
5. **"Return to Journal" and the back fallback use `popTo`, not `navigate`.** React Navigation 7's `navigate` only reuses the route on top; from `[MainTabs, Reflection]`, `navigate("MainTabs", { screen: "Journal" })` pushes a second `MainTabs`: the stack becomes `[MainTabs, Reflection, MainTabs]`, and Android back then shows Reflection again. Proved by running the repo's own `StackRouter` (`@react-navigation/routers` 7.6.5) in the review: `popTo("MainTabs", { screen: "Journal" })` gives `[MainTabs]` (also after New Entry's `replace`, and when Reflection is the only route), and the tab navigator reads the new `screen` param when its route's params change (`useNavigationBuilder`, `@react-navigation/core` 7.24). The draft's `navigate` call was wrong.
6. **Copy says only what the app does** (AGENTS.md "Copy & Tone Rules"). "Return to Journal" replaces "Save to Journal" (the entry is already saved). The prayer row says "Keep it in your Prayers to return to." The still-preparing view promises "waiting in your Journal", not a notification (no step sends one; step 28 could, and I decide there). "Your words are safe" and "try again from your journal" are true once steps 24 and 25 land, so they carry `// TODO` markers in `copy.ts`: `TODO(24)` on "Your words are safe", `TODO(25)` on "waiting in your Journal" and on "try again from your journal".
7. **Playback is mocked** (`useMockPlayback`, section 3) and nothing plays: no audio file is opened, and the real length comes from the entry, never a hardcoded 60. The draft's `reset` is dropped, because nothing calls it. Step 12 deletes the hook and moves the state to a store.
8. **The prayer toggle is local state** (`// TODO(29)`); nothing is saved.
9. **Crisis is a data state, checked first.** The temporary view is for step 11 only and carries `// TEMP(13): replaced by CrisisSupportPanel` (the draft said `CrisisSupportView`; step 13 builds `CrisisSupportPanel`). Do not ship a build between this step and step 13.
10. **Pieces later steps rely on.** `TranscriptRow` and the header's back control (step 13 reuses both); `MiniPlayerCard`'s name and `useMockPlayback.ts` (step 12 edits and deletes them); the tab values `devotional`, `affirmations` and `prayer` (step 28); `useReflection` and its `ReflectionState` (steps 13, 25, 29 and 33); the order crisis, then status (step 13).
11. **Accessibility structure.** Nothing is an accessible element inside another one: the mini player card is `accessible={false}`, the transcript row, the prayer row, the affirmation rows and the scripture card are each one element with a label, and the decorative icons are hidden.
12. **Contrast** (computed). Shipped text pairs at 4.5:1 or more: white on `plum` 9.50, white at 90% 8.06 and at 70% 5.61, `ink` at 90% on blush 9.05, `ink` at 80% on white 7.36, `mauve` on white 5.72, linen 5.37, `linen-deep` 4.91 and blush 4.92, `plum-deep` on linen 12.53, `rosewood` on linen 4.81 and on the pill 4.91 and on the affirmation rows 4.87. **Below 4.5:1: `rosewood` on blush 4.41, the scripture reference (17 SemiBold).** It is the same open item as the email sheet's two error messages (a proposal to move the `rosewood` token to `#9B5860`, 4.56 on blush, waits for my approval); do not change the token, and list it. Graphics: the `Switch`'s off track (`petal` on white 1.31:1) is the HTML's own and the thumb position and the label carry the state; the crisis bar on blush is 5.49:1.
13. **Numbers come from the HTML, and tokens win.** Differences you keep go in your report. Expected ones: the 27/34 Regular headline as a one-off (see the headline table) in `plum-deep`; the player title at `text-section` 20/28 where the HTML has 18; the small labels at 13 where the HTML has 11 and 12; the scripture reference at 17 SemiBold and the verse at 17/26 where the HTML has 18 Medium and 16/26; the devotional text at `text-body` 15/22 where the HTML has 14; the tab control's 44dp items, pill shape and `linen-deep` track with shorter labels; the affirmation headline and text at the Journal card's styles; the closing prayer and the transcript at `text-scripture` 17/26 where the HTML has 15 and 12; the words row's shortened title and the `linen-deep` chip; the native `Switch`; the `shadows.card` on the plum card where the HTML has `shadow-md`; the chevron for `arrow_back`; no bookmark icon on the footer button.

## What you do yourself (manual setup)

Nothing here blocks the implementation. Do each item when the report asks for it.

1. **Environment keys: nothing to add.** `.env.local` already has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (a development key); this step uses no other key. The four Google values from `.env.example` are not needed until the Android development build (step 05b). Keep `.env` free of real values.
2. **Metro: no restart is needed.** This step installs nothing and edits no CSS, so Fast Refresh picks everything up. If Expo Go shows a red screen after a refresh, reload it (shake, then Reload). The "Tools" button of Expo Go sits top right and covers nothing on this screen's header.
3. **Confirm the result on your iPhone in Expo Go.** The implementer cannot run an iPhone, so the report will list these checks for you:
   1. On Journal, tap the "Philippians 4:6–7" card (yesterday, anxious). Reflection matches the screenshot: the date in the header, the headline on two lines, the plum player card, the blush scripture card, the tabs, "Your spoken prayer", the prayer row with its switch on, "Return to Journal" and the round share button. The icons are real icons, nothing overlaps and no label wraps.
   2. Tap the round play button: the bar fills and the time counts up (nothing is heard: playback is mocked until step 26). Tap again: it pauses. Press play, then swipe the app away to the home screen and come back: it is paused. Tap "Tap to open player": nothing opens yet (step 12).
   3. Tap "Affirmations": three rows with 8:00 AM, 1:00 PM and 8:00 PM and a plum bar on the left of the current one. Tap "Closing Prayer": it ends with "Amen." inside the quote.
   4. Tap "Your spoken prayer": your words open in quotes and the arrow turns. Tap it again to close.
   5. Tap anywhere on the "Mark as Prayer Request" row: the switch flips. It starts on for this entry and off for the "Matthew 11:28–30" card (3 days ago, weary).
   6. Tap the round share button: the iOS share sheet opens with the verse, "— Philippians 4:6–7 (BSB)" and "Shared from Gracehush". Cancel it: nothing else happens.
   7. Tap "Return to Journal": you land on Journal. Swipe from the left edge: nothing happens (you are at the root). Open the same entry again and use the chevron: you return to Journal at the same scroll position.
   8. Open the "Romans 15:13" card (4 days ago, its chip says "Text only"): the plum card shows a book icon and "Your devotional is ready to read below.", with no bar. Open the "Psalm 103:1–5" card (5 days ago, grateful, a typed entry): it says "written journal" and "Your written prayer".
   9. On the Profile tab, in the developer card, "Open reflection (dev)": Crisis shows only the calm message and "Return to my journal"; Processing and Pending show "still being prepared"; Failed shows "We couldn't finish this reflection."; Not found shows its message. From Profile, "Return to Journal" must land on Journal, not on Profile.
   10. With "Next submit" set to `crisis` on Profile, submit a short reflection from New Entry: Reflection shows only the crisis view. Set it back to `ready` and submit again: the full devotional opens with the new entry.
   11. Optional, VoiceOver: the headline is read as a heading, the scripture card as one item, the tabs as tabs with the selected one announced, the switch as a switch, and the player card gives you "Play devotional", the title, the time and "Open full player" as separate items.
4. **Later, not now:** at step 28 tell me whether to add a "your reflection is ready" notification; at step 12 I will review the Now Playing prompt against the names this step creates.

## Before writing code

1. Read-only checks: `ReflectionScreen.tsx` is the step 08 placeholder (`// TEMP: replaced in step 11`); `getEntry`, `listAffirmationsForEntry` and `getProfile` exist in `journalRepository.ts`; `Devotional.closingPrayer` is stored without "Amen"; only the anxious entry and its `entry-new-*` clones have affirmations in the mock, and the crisis entry never does; the mock has one entry with no audio (`entry-hopeful-four-days-ago`), typed entries with audio (for example `entry-grateful-five-days-ago`), and one entry each that is processing, pending, failed and crisis; `devStore.ts` has `scenario`, `nextHomeLoadFails` and `nextSubmitOutcome`; `.env.local` has the Clerk key (never print it). Search the repo (the Grep tool) for `TODO(11)`, `TEMP(11)` and `step 11` and close every one.
2. Start your own Metro on 8082 (`npx expo start --port 8082`, never 8081, which is mine) and open the app in Expo Go on the emulator as AGENTS.md "Verifying on this machine" describes.
3. Files: new `src/components/MiniPlayerCard.tsx`, `ScriptureCard.tsx`, `ReflectionCarousel.tsx`, `TranscriptRow.tsx`, `FadeIn.tsx`, `src/hooks/useReflection.ts`, `useMockPlayback.ts`, `src/screens/journal/ReflectionStateViews.tsx`; changed `src/screens/journal/ReflectionScreen.tsx`, `src/constants/copy.ts`, `src/utils/format.ts`, `src/store/devStore.ts`, `src/components/dev/DevToolsPanel.tsx`. The state views are private to this screen, so they live in `src/screens/journal/`; the prayer row is a private component inside `ReflectionScreen.tsx`.

## 1. Copy, formatters and the dev store

- `src/utils/format.ts`: `formatEntryDate(iso)` → "Oct 24, 2026" (`toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })`, the local date) and `getValidationHeadline(emotion: string | null)`, next to `getAffirmationSource` (which also maps data to `copy`): it trims and lowercases the emotion and returns `copy.reflection.headlines` for `anxious`, `weary`, `grieving`, `grateful` and `hopeful`, and the `unknown` line for anything else (null, empty, `"overwhelmed"`). It never echoes the raw AI string.
- `src/constants/copy.ts`, a new `reflection` group (no prose inline in components, no emojis, accessibility labels built from values are functions): `back` "Go back"; `headlines` (the six lines in the table below); `subline` (`audio`, `text`); `player` (`subtitle(minutes)`, `noAudio`, `play(title)`, `pause`, `open` "Open full player", `openLink` "Tap to open player", `position(elapsed, total)` for the spoken label); `scripture` (`translation`, `confirming`, `a11y(reference, body)`); `quote(text)` → “text”; `closingPrayer(prayer)` → “prayer Amen.”; `tabs` (`label`, `devotional`, `affirmations`, `prayer`); `affirmations` (`eyebrow(slotName, time)`, `rowLabel(...)`, `empty`); `words` (`titleAudio`, `titleText`, `private`, `label(title)`); `request` (`title`, `helper`); `footer` (`returnToJournal`, `share`); `share.message(verse, reference)`; `states` (`loading`, `preparing`, `failed`, `notFound`, `error`); `crisis` (`title`, `return`). Eyebrows are stored in sentence case. The `// TODO(24)` and `// TODO(25)` markers of decision 6 go on the strings they name.

| Emotion | Headline |
| --- | --- |
| anxious | It sounds like you're feeling anxious, and that's okay. |
| weary | It sounds like you're feeling weary, and that's okay. |
| grieving | It sounds like you're grieving, and that's okay. |
| grateful | It sounds like your heart is full of gratitude today. |
| hopeful | It sounds like hope is stirring in you today. |
| unknown | It sounds like you're carrying a lot right now, and that's okay. |

- `src/store/devStore.ts`: `nextReflectionLoadFails: boolean` (default `false`) with `setNextReflectionLoadFails`, the one-shot flag that makes the next Reflection load fail once, like `nextHomeLoadFails`.
- `DevToolsPanel`: a "Fail next Reflection load (dev)" button (selected while armed), and an "Open reflection (dev)" row of `DevButton`s: Ready, No audio, Typed, Processing, Pending, Failed, Crisis and Not found, each calling `navigation.navigate("Reflection", { entryId })`. Take the ids from `listEntries()` for the current scenario (the first entry of each kind: ready with audio, ready without audio, ready and typed, processing, pending, failed, crisis), not from hardcoded ids; disable a button when the scenario has no such entry (`empty` has none); "Not found" uses an id no entry has. Strings stay inline there.

## 2. The data hook (`src/hooks/useReflection.ts`)

```ts
type ReflectionState =
  | { status: "loading" }
  | { status: "not-found" }
  | { status: "error"; retry: () => void }
  | {
      status: "ready";
      entry: JournalEntry;
      affirmations: Affirmation[];
      profile: UserProfile;
      currentSlot: TimeSlot;
    };
```

Load `getEntry(entryId)`, `listAffirmationsForEntry(entryId)` and `getProfile()` in parallel, in the same shape as `useJournalHome`: one `useFocusEffect` (so it refetches whenever the screen takes focus) whose callback depends on `entryId`; a request counter in a ref that is touched only in callbacks and effects, so a late response after unmount or after the `entryId` changed is ignored (leaving the screen bumps it); a stored result tagged with its `entryId`, so another id shows `loading` and not stale data; a `null` entry is `not-found`; any rejection is `error`, but a failed refetch keeps the data that is already on screen. `now` is kept in the stored result and `currentSlot` is `getCurrentSlot(now, profile.reminders)` (never `new Date()` in render). The one-shot `nextReflectionLoadFails` flag throws once. `retry` clears the result and loads again. This pattern was linted through stdin and passed. Log nothing but ids and states in `__DEV__`.

## 3. Mock playback (`src/hooks/useMockPlayback.ts`)

Marked `// TEMP(26): replaced by track-player state`. `useMockPlayback(durationSec: number)` returns `{ isPlaying, positionSec, toggle }`; the card passes `Math.round(durationMs / 1000)`. While playing, one 250ms interval advances the position by the real elapsed time (`Date.now()` deltas: JS timers run late on this machine, so never count ticks), sets the state, and stops at the end (`isPlaying` false, the position equals the duration). `toggle` pauses while playing; from the end it restarts from 0. It pauses when the screen loses focus (a `useFocusEffect` cleanup), when the app leaves the foreground (an `AppState` listener) and on unmount (the interval is cleared). The latest position lives in a ref that only callbacks and effects touch, so a tick never reads a stale closure. This pattern was linted through stdin and passed (see "Lint rules").

## 4. The screen (`src/screens/journal/ReflectionScreen.tsx`)

Remove `// TEMP: replaced in step 11`. Call `useReflection(route.params.entryId)`. The render order is the table in "Other views": loading, then not-found and error, then for a ready state crisis first, then pending, uploading and processing, then failed (or a ready entry without a devotional), then the full view. The header shows the date whenever an entry is loaded. The ready view is `key={entry.id}`, has the share handler (see "Footer") and the exits (`goBack` and `popTo`), and passes `onOpen` to `MiniPlayerCard` with the `TODO(12)`. Components take data by props and do not fetch.

## Rules

- Do not build Now Playing, real audio, real crisis resources or prayer persistence. Do not change `JournalCard`, the tabs, the dock, New Entry, `SegmentedControl`, `Skeleton` or `PrimaryButton`. The shared files that change are the ones listed in "Before writing code".
- Leave exactly these markers: `// TODO(12): navigate('NowPlaying', { entryId })`, `// TEMP(26): replaced by track-player state` (`useMockPlayback.ts`), `// TODO(29): persist is_active_prayer + prayer fields`, `// TEMP(13): replaced by CrisisSupportPanel`, `// TODO(25): "Try again" on this view` (the failed view), and the `TODO(24)` and `TODO(25)` strings of decision 6.
- Never log or persist a transcript, a devotional, a prayer, a verse or an affirmation; log only ids and states in `__DEV__`. Never put them in navigation params.
- Crisis red appears only in the temporary crisis view's bar. A crisis entry never shows a devotional, scripture, affirmations, audio, share, a prayer toggle or a transcript. Unverified scripture text never renders and is never shared.
- Raw hex does not appear in a component: use `colors.*` where a prop needs a colour and the Tailwind classes everywhere else. No library, no `any`, no emojis. Run your own Metro on 8082 and never stop mine on 8081.

### Lint rules that apply here (checked on this machine; `expo lint` runs eslint-plugin-react-hooks 7.1.1 with the React Compiler rules as errors)

Candidates with these patterns were linted through stdin and passed:

- `useFocusEffect(useCallback(() => { load(); return () => { latestRequest.current += 1; }; }, [load]))` with `setResult` inside the awaited code and a ref counter that only callbacks touch (the `useJournalHome` shape).
- `useMockPlayback`: a `setInterval` in an effect that sets state and a ref from its callback and clears itself, `useFocusEffect(useCallback(() => () => setIsPlaying(false), []))`, and an `AppState` listener that calls `setIsPlaying(false)`.
- `useState(() => new Animated.Value(0))` with an effect that only calls `Animated.timing(...).start()` or `setValue` and returns `() => animation.stop()`.
- Do not call `setState` directly in an effect body (`react-hooks/set-state-in-effect`); do not read or write `ref.current` during render; define components at module level.

## Verify

```bash
npm run lint
npm run typecheck
npx expo install --check
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Run the pure parts in Node from a scratch folder outside the repo (a scratch tsconfig with `paths` for `@/*`, `module: commonjs` and a `declare const __DEV__`): `formatEntryDate` (a date at noon, 23:30 and 00:30 local on 31 December and 1 January, in two time zones through `process.env.TZ` set first), `getValidationHeadline` (the five emotions, "Anxious", " WEARY ", null, "" and "overwhelmed"), `share.message`, and the mock database through the repository (`getEntry` for the anxious, weary, grateful, hopeful, processing, pending, failed and crisis ids and for a bad id; `listAffirmationsForEntry` gives three ordered rows for the anxious entry, none for the weary entry and none for the crisis entry; a `ready` submit's clone has three). To confirm the classes compile, export with `--no-bytecode --no-minify` and search the Android bundle for `text-[27px]`, `tracking-[-0.675px]`, `bg-linen/80`, `text-white/70`, `bg-plum-deep/60`, `bg-card/70` and `w-[3px]`. Then check on the Android emulator in Expo Go (AGENTS.md "Verifying on this machine"; sign in with an address like `yourname+clerk_test@example.com` and the code `424242`), at 390dp wide (`adb shell wm size 1080x2340` with `wm density 443`; reset both afterwards), at about 411dp, and at 320dp wide with font scale 1.3:

1. **The ready view matches the design:** compare crops of your screenshots with `prompt_material/05-reflection.png` at the design's own width, 390dp. The PNG is 1.25x, so compare proportions, not pixels. Measure with `uiautomator dump` and report: the side padding (20), the header (57 with its divider), the headline lines (2 at 390dp), the player card (about 126 tall, the 48 circle, the 6dp track), the footer button (48) and the share circle (48), and each card's radius and padding (16). Real icons, no overlap, no wrapped label.
2. **Mock playback:** play advances the bar and "0:34 / 1:15" from the real duration (the anxious entry is 75 seconds), pause holds, the end stops and play restarts from 0:00; Home (background) pauses; leaving the screen pauses; the card body and "Tap to open player" log the step 12 line in the Metro output and the play button does not. `uiautomator dump` fails while the progress ticks (AGENTS.md): pause before you dump.
3. **Tabs:** Affirmations shows the three rows with the mock profile's reminder times (8:00 AM, 1:00 PM, 8:00 PM) and a plum bar on the current one. Move the emulator clock (AGENTS.md "Setting the clock") to 08:30, 13:30, 20:30 and 07:30 (before the first reminder the evening slot is the current one), reopen the screen each time, and report that the bar follows (morning, afternoon, evening, evening); restore the clock. The weary entry (no affirmations) shows the empty message. Closing Prayer ends with "Amen." inside the quote. The pane fades in (catch it by comparing pixel samples across frames or by slowing the fade in a `TEMP-EXPERIMENT`, reverted and compared with `cmp`); with Reduce Motion it does not. With a `TEMP-EXPERIMENT` that blanks one entry's `closing_prayer`, only two tabs show.
4. **Your words:** collapsed by default, the title is "Your spoken prayer" for audio and "Your written prayer" for the grateful (typed) entry, tapping expands the quoted transcript and turns the chevron, and at 360dp the chip drops under the title without clipping.
5. **Prayer request:** on for the anxious entry, off for the weary one; a tap anywhere on the row flips it; the dump shows one `switch` element with `checked`.
6. **Scripture and share:** verified: the card, the verse and the share circle; the share sheet opens (Android's system sheet) and cancelling shows nothing. With `TEMP-EXPERIMENT`s (copy the file to the scratchpad first, revert and `cmp` after): one entry with `scripture_verified: false` shows the reference, "We're confirming this passage.", no verse and no share circle; one with a null scripture hides the card.
7. **No audio and typed:** the hopeful entry shows the book icon and "Your devotional is ready to read below." with no bar, time row or link; the grateful entry says "written journal". An `entry-new-*` entry from a New Entry submit opens with its typed text as the transcript.
8. **The calm views:** through the "Open reflection (dev)" row: processing and pending show "Your devotional is still being prepared." with a spinner; failed shows its message; a bad id shows not found; crisis shows only the temporary view (no player, verse, tabs, share, toggle or transcript anywhere in a `--compressed` dump), also when it comes from New Entry with "Next submit" set to `crisis`. Error: arm "Fail next Reflection load (dev)", open an entry: the error view, and "Try again" loads it. Loading: with `simulateLatency` at 30s on Android only (a `TEMP-EXPERIMENT`, reverted) the skeleton is one "Loading your reflection, busy" element; with Reduce Motion it does not pulse.
9. **Navigation:** from the Profile tab, "Open reflection (dev)" then "Return to Journal" lands on the Journal tab, and Android back then leaves the app (one `MainTabs`; with `navigate` it would reopen Reflection). From a Journal card, the chevron returns to the same scroll position. After a New Entry `ready` submit, "Return to Journal" shows Journal with the new card on top.
10. **Reduce Motion** (`adb shell settings put global transition_animation_scale 0`, back to `1.0`): no fade, no chevron turn, a static skeleton.
11. **320dp (`wm size 720x1280`, `wm density 360`) and font scale 1.3 (`adb shell settings put system font_scale 1.3`, back to `1.0`):** the player title wraps to two lines, the time row keeps both labels whole (at 1.3 the link wraps under the time), the scripture pill drops under the reference, the tab labels wrap (report whether "Affirmations" breaks inside the word at 360dp and 1.3), the words chip and the prayer text wrap, the footer button stays whole beside the share circle, and nothing is clipped.
12. **Accessibility** (`uiautomator dump --compressed`): the scripture is one node with the combined label; the tabs are `tab` nodes with `selected`; the player card exposes the play button, the spoken time and "Open full player" as separate nodes (the card itself is not one); the words row is a button with `expanded`; the prayer row is one switch. TalkBack and VoiceOver are not run here: say so.

Fix every error before finishing. Then ask me to confirm the iPhone checks (manual setup item 3), and remind me of manual setup item 4. Say plainly what was not verified: the iPhone until I confirm (the share sheet, the native `Switch`, `popTo` into the tab navigator, filled play and pause, VoiceOver on the nested controls), TalkBack and VoiceOver.

Report: each file created or changed, the icon names used on each platform, the dp values you measured, every difference between the design and what you built (decision 13 lists the expected ones), every `// TODO(NN)` and `// TEMP(NN)` left for steps 12, 13, 24, 25, 26 and 29, every text and background pair below 4.5:1 that is not in decision 12, confirmation that nothing was installed, and the AGENTS.md lines you updated.

## AGENTS.md updates

These changes were already written when this prompt was reviewed, so only check that they are there (do not write them again): in "SDK and Vendor Version Notes" the extended note on `navigate` and `popTo` and the note that an accessible `Pressable` groups its children; in "Standing Rulings" the rulings that `rose` is never text and that a heading size without a token is a measured one-off; the rewritten "5. Reflection" specification; and the updated Reflection row in "Design Tool Artifacts". In this step, record the decisions and the new state, replacing the text they supersede:

- Architecture tree: add `hooks/useReflection.ts` and `useMockPlayback.ts`, the `components/` entries (`MiniPlayerCard`, `ScriptureCard`, `ReflectionCarousel`, `TranscriptRow`, `FadeIn`), `screens/journal/` (`ReflectionScreen` is built; `ReflectionStateViews`), and the `utils/` line (`formatEntryDate`, `getValidationHeadline`); update the `copy.ts` line (`reflection`) and the "Built so far" component list; remove "(TEMP until step 11)" from the `ReflectionScreen` entry.
- Navigation Map, "Current state": a sentence that Reflection leaves with `goBack()` (the chevron) or `popTo("MainTabs", { screen: "Journal" })` ("Return to Journal", and the chevron when there is nothing to go back to), and in the `DevToolsPanel` sentence the "Open reflection (dev)" row and "Fail next Reflection load (dev)".
- State Management Rules, "Dev store (step 09)": add `nextReflectionLoadFails`.
- Build Status & Decisions Log: a Step 11 entry with the decisions above, the files, the measured dp values, every difference from the design, what was verified and what was not, and the open items (the `TODO(12)`, `TODO(24)`, `TODO(25)`, `TODO(29)` and `TEMP(13)`, `TEMP(26)` markers; the `rosewood` on blush pair; the "Affirmations" break at large text; step 12 deleting `useMockPlayback`; step 13 replacing the temporary crisis view and reusing `TranscriptRow`).

Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.
