# 10-new-entry-ui.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory": the iOS developer account comes last, and my iPhone stays on Expo Go until then.

Implement the New Entry screen exactly as shown in the design, replacing the step 08 placeholder: the header, the Speak/Write toggle, the Speak section (waveform, timer, mic orb, info card), the Write section, the footer, the discard dialog, and the full-screen Processing overlay with its error view. Recording and submission are **mocked** behind typed interfaces that steps 23 and 25 swap without changing this screen. Nothing here needs a development build or a new package: the iPhone (Expo Go) and the Android emulator both run this step.

Where things stand after step 09: `src/screens/journal/NewEntryScreen.tsx` is a TEMP placeholder (a close button and one line of text) that already receives `route.params.mode` (`"speak" | "write"`). The dock opens it (pen: write, mic: speak), and it is a `fullScreenModal` in `RootNavigator`. `src/services/recorder.ts` has only the step 07 permission functions (`getMicPermission`, `requestMicPermission`). `Reflection` takes `{ entryId }` and `Paywall` takes `{ source: "profile" | "limit" }`; both are TEMP screens. `src/store/devStore.ts` (step 09) holds `scenario` and `nextHomeLoadFails`, and `DevToolsPanel` (Profile tab) has the scenario buttons. `.env.local` holds the Clerk development key, which is all the app needs; this step reads no environment variable.

Design reference (read only). Take every size from the HTML, where 1 CSS px = 1dp, and never from the PNG:

- `prompt_material/04-new-entry.png` and `prompt_material/04-new-entry.html`

The PNG is 703px wide for a 390dp frame (about 1.8x) and shows only the Speak view. The HTML has all three views: Speak (`#sectionSpeak`), Write (`#sectionWrite`) and Processing (`#sectionProcess`), so read all three. Ignore the Stitch artifacts: the outer header ("← New Entry", the "Private" chip and the avatar) and the outer toggle "Speak / Write / Processing State". The real header is the HTML's sub-header ("New Reflection").

## What the design says (measured, final)

Every size below comes from the HTML, never the PNG. The first draft of this prompt used PNG-derived numbers (24 side padding, a 56 button, a 96 orb in a 150 halo, 11 waveform bars, a 22 title); the HTML gives a 20 margin, a 48 button, an 84 orb in a 124 halo, 9 bars and an 18 title. Tokens win over the HTML (AGENTS.md "Standing Rulings"), and where the HTML copy differs from this prompt's copy, this prompt wins. List every difference you keep in your report.

Narrow screens and large text: React Native's default `flexShrink` is 0, so text beside a fixed element must be `flex-1` or `shrink`. Measured from the font files (cmap and hmtx of the real `.ttf` files): at 320dp with font scale 1.3 the header row needs about 342dp for a 288dp content width (and 286dp at default text, which barely fits), and the footer's "Submit Reflection" button needs 242dp beside "Cancel" (105dp). So the header title wraps and the footer wraps (both specified below). Everything else fits or wraps freely.

### Frame

`SafeAreaView` (top and bottom edges, linen, inline style) → `KeyboardAvoidingView` (`behavior="padding"` on both platforms, AGENTS.md "Bottom Sheets") filling it → the header, one `ScrollView` and the pinned footer. Side padding everywhere is the screen margin: 20 (16 below 360dp): the `screen__content` class on views, and the numeric rule (`width < layout.narrowBreakpoint ? layout.screenPaddingNarrow : layout.screenPadding`, `width` from `useWindowDimensions`) for the `ScrollView` content container. The content container has `flexGrow: 1` and `paddingBottom` 24; `keyboardShouldPersistTaps="handled"`, `keyboardDismissMode="on-drag"`.

### Header (the HTML's sub-header)

| Part | Build |
| --- | --- |
| Row | `screen__content min-h-14 flex-row items-center gap-2 py-1`. It is `min-h`, not a fixed height, so it grows at large text |
| Close | `Pressable` (style function only) with an inner `size-11 items-center justify-center` box (44 touch area) and the close icon 20 in `ink`. `accessibilityRole="button"`, label `copy.common.close` |
| Title column | `flex-1`. "New Reflection" in `text-section text-plum-deep` (Fraunces Medium 20/28, `accessibilityRole="header"`; the HTML has 18) **wraps** when it must: no `numberOfLines`. Below it, only while there is a recording or text: `flex-row items-center gap-1.5`, a 6dp `rose` dot and "Saved locally" in `text-label-md text-mauve`. `// TODO(24): reflect real local save` (step 24 says "Saved locally" is true only after the entry is queued; here it is a mock) |
| Chip | `shrink-0 flex-row items-center gap-1 rounded-full bg-linen-deep px-2.5 py-1`: lock icon 14 in `plum-deep` and "Private" in `text-label-md text-plum-deep`. Not pressable |
| Divider | Under the row, inset by the same margin (not edge to edge, as in the HTML): a `screen__content` wrapper with `my-1` and a `divider` inside |

### Toggle (`SegmentedControl`, the first item of the scrolling content)

`self-center`, 8 below the divider and 16 above the title block. Compact like the HTML (about 160 wide, 34 tall including the 4 track padding), built on the existing `.segmented` classes: track `segmented`, each item `segmented__item segmented__item--active-plum` when selected, with `min-h-0 flex-none px-5 py-1` utilities on the item (utilities come last in `global.css`, so they override `min-h-11` and `flex-1`), label `segmented__label` plus `segmented__label--active-plum`. The visual height is 26, and `hitSlop` of 9 top and bottom brings each touch area to 44. Items "Speak" and "Write". Disabled while recording or requesting (50% opacity, `accessibilityState.disabled`).

### Speak section (`src/screens/journal/SpeakSection.tsx`)

| Part | Build |
| --- | --- |
| Title block | `items-center`, 16 below it: eyebrow "Sanctuary of voice" (`eyebrow text-center mb-1`, stored in sentence case), title "What's on your heart today?" (`text-headline text-plum-deep text-center`, 24/32 Medium, `accessibilityRole="header"`; the HTML has 24 regular), helper "Take a breath. Speak freely — there is no wrong way to pray." (`text-body text-ink/80 text-center mt-2`, `maxWidth: 320`, `self-center`) |
| Recorder card | `card card--hero items-center p-6` with `style={shadows.card}` (radius 24, padding 24). Shown unless the microphone is denied |
| Waveform | `src/components/Waveform.tsx`, see section 3. Container 64 tall (`h-16`), `w-full`, `px-4`, with 4 above and below |
| Timer chip | `chip gap-2 px-3.5`, 12 below the waveform: a 10dp dot (crisis red while recording, `rose` otherwise, so the chip never changes width; pulsing opacity 1 to 0.4 while recording, static with Reduce Motion) and `text-timer text-ink` "{formatTimer} / {formatTimer(MAX_RECORDING_MS)}", for example "01:42 / 05:00" |
| Mic orb | A 124 box (`layout.recordHalo`) centered, with an 84 circle (`layout.recordOrb`) at its center, 8 above and below the box (`my-2`). Idle and recorded: `bg-plum`, white mic icon 36, `shadows.orb`, and a static 116 halo in `rose` at 30% (the HTML's second state). Recording: `bg-crisis`, a white **stop** icon 28 (the HTML keeps the mic glyph; a stop square says what the tap does), and a 124 halo in `crisis` at 20% whose opacity pulses 1 to 0.5 over 2s (static with Reduce Motion). Pressed: scale 0.96. The halo is a sibling behind the orb, inside the box, so it never overlaps the timer chip or the caption (the HTML lets it bleed 12dp over the chip; that overlap is a rendering glitch). Requesting the permission: a white `ActivityIndicator` instead of the icon, `accessibilityState.busy`, taps ignored |
| Caption | `mt-1`, 11 Medium uppercase, tracking 1, `text-mauve` ("Tap to start/stop", sentence case in `copy`): `font-dm-medium text-[11px] leading-[16px] uppercase tracking-[1px] text-mauve`. After a recording: "Recorded 00:12" in the same style |
| Messages | Under the caption, `mt-2 text-center text-body-sm`, each `accessibilityLiveRegion="polite"` and announced on iOS through `useAnnounce`: "30 seconds left" in `text-rosewood` from 4:30 while recording; "Your 5 minutes are up. You can finish your reflection now." in `text-mauve` once a recording reached the limit; the recorder error in `text-rosewood` ("We couldn't start recording. Please try again." or "We couldn't save that recording. Please try again.") |
| Record again | Only when recorded: a `min-h-11` pressable, refresh icon 14 in `rosewood` and "Record again" in `text-label-md text-rosewood`, centered. It opens the discard-recording dialog (section 5) |
| Denied | Replaces the recorder card with a `card card--blush items-center gap-3`: "Microphone access is off" (`text-label-lg text-ink`), "Turn it on in Settings to pray out loud, or switch to Write." (`text-body-sm text-mauve text-center`), a `btn-ghost` "Open Settings" (`Linking.openSettings()`) and a text link "Write instead" (`btn-text__label text-plum`, `min-h-11`; plum, not rosewood, on blush, AGENTS.md colour note) that switches to Write |
| Info card | 16 below the recorder card (or the denied card): `card card--blush flex-row items-start gap-3`. A 32 circle in `bg-rose/50` with the ear icon 18 in `plum-deep` (see decision 4; the design has a lotus), then a `flex-1` column: "Whisper or speak aloud" (`text-label-md text-plum-deep`) and, `mt-0.5`, "Gracehush listens for what you're carrying and shapes a short devotional and scripture just for you." (`text-body-sm text-ink/80`). The HTML's "tomorrow's personal psalm" is inaccurate, because the devotional is created now |

### Write section (`src/screens/journal/WriteSection.tsx`)

The section fills the space between the toggle and the footer. It is `flex-1` inside the content container (which has `flexGrow: 1`), so the white card stretches and the text area scrolls inside itself. That keeps the caret visible as the text grows, which a growing input inside a `ScrollView` does not guarantee on Android. On a short screen with the keyboard up, the page scrolls instead.

| Part | Build |
| --- | --- |
| Title block | `items-center mb-2`: "Pour out your heart" (`text-headline text-plum-deep text-center`, `accessibilityRole="header"`) and `mt-1` "Written prayers hold the quiet weight of honest thoughts." (`text-body-sm text-ink/80 text-center`). No eyebrow (the HTML has none) |
| Card | `card card--hero flex-1 p-6` with `style={shadows.card}` and `minHeight: 260` |
| Text area | `TextInput` (styled like the email sheet input; no border and no fill, the card is the container): `multiline`, `flex-1`, `minHeight: 200`, `text-body-lg text-ink`, `textAlignVertical="top"`, `autoCapitalize="sentences"`, `autoCorrect`, `maxLength={MAX_TEXT_LENGTH}`, `placeholderTextColor={colors.mauve}`, placeholder "Pour out your heart… Type freely, share your worries, praises, or questions without judgment." (the HTML's), `accessibilityLabel` "Your reflection". The text lives in screen state until submit and nowhere else |
| Counter row | Inside the card, `mt-3 flex-row items-center justify-between border-t border-petal pt-3`: left, the pen icon 16 (the dock's pair) in `mauve` and "{n} words" in `text-label-md text-mauve` ("1 word"); right, only from `TEXT_COUNTER_FROM` characters, "4,512 / 5,000" in `text-body-sm text-mauve` |

### Footer (pinned above the bottom inset)

`screen__content flex-row flex-wrap items-center gap-x-4 gap-y-2 pt-3 pb-3`. "Cancel": a `min-h-11 justify-center px-5` pressable with `text-label-lg text-ink/80`. Primary: a `PrimaryButton` ("Finish Reflection" in Speak, "Submit Reflection" in Write, `iconRight` arrow) in a `flex-1` view with `minWidth: 74 + 130 * fontScale` (74 is the button padding, gap and icon, 130 is the longest label at 15 SemiBold; `fontScale` from `useWindowDimensions`). Where it cannot fit beside Cancel (320dp, or large text) the row wraps and the button takes the full width under Cancel; nothing clips. The HTML's button is `h-12` = `.btn-primary`'s 48 (the draft said 56).

### Processing overlay (`src/screens/journal/ProcessingOverlay.tsx`, the HTML's `#sectionProcess`)

Full screen over everything (`StyleSheet.absoluteFill`, linen, inside the safe area), content in a `ScrollView` centered with `flexGrow: 1` and `justifyContent: "center"`, margin as above, `py-6`.

| Part | Build |
| --- | --- |
| Pulse | A 128 box. A 128 circle in `plum` at 15% (the halo) scales 1 to 1.08 and back over 2s, looping (static with Reduce Motion), behind an 80 `bg-plum` circle with `shadows.orb` holding `images.logoMark` 36, white (`tintColor`). The HTML's spinning sparkle, its ring, the ping and the blurred glow are left out |
| Title | `mt-6 text-headline text-plum-deep text-center`, `maxWidth: 320`, `accessibilityRole="header"`: "Listening, praying, and finding scripture…", and for a text entry "Reading, praying, and finding scripture…" |
| Subtitle | `mt-2 text-body text-ink/80 text-center`, `maxWidth: 384`: "Gathering your thoughts into a contemplative benediction." |
| Step cards | `mt-6 w-full gap-3`, three `flex-row items-start gap-3 rounded-card border p-3.5` cards, each `accessible` with one label (children hidden): "{title}, {done / in progress / up next}. {description}". Circle 28 on the left (`mt-0.5`), then a `flex-1` column: a `flex-row flex-wrap items-center gap-x-2` row with the title (`text-label-lg`) and the status label (`text-label-md`), then the description (`text-body-sm`, `mt-0.5`). **Done:** `bg-card border-petal`; circle `bg-grateful-bg` with a check icon 18 in `grateful-fg`; title `text-ink`; status "Done" in `text-grateful-fg`; description `text-mauve`. **In progress:** `bg-card border-plum/30`; circle `bg-plum` with a white 8dp dot whose opacity pulses 1 to 0.4 (static with Reduce Motion); title `text-plum`; status "In progress" in `text-plum`; description `text-ink`. **Up next:** `bg-linen-deep border-petal`; circle `bg-card` with a 1.5 `petal` ring 20; title `text-mauve`; no status label; description `text-mauve`. No opacity on any text (the HTML fades the whole upcoming card to 70%, which drops its text below 4.5:1) |
| Steps | "Listening" (text entry: "Reading") with "Your words are held in stillness." / "Reflecting" with "Discerning the themes in what's on your heart." / "Preparing your devotional" with "A short devotional and a verse chosen for you." The descriptions are the same in every state, written for this prompt because the HTML's ("heart-weariness", "personalized psalm") assume an emotion and a psalm |
| Note | `mt-6 card card--blush flex-row items-center gap-2.5 p-3.5`: the Journal icon (`book` / `menu_book`) 20 in `plum` and `flex-1` "You can close the app. Your reflection will be waiting in your Journal." (`text-label-md text-ink`). The design says "We'll notify you when it's ready", but no step sends that notification (decision 6) |
| Close | `mt-4 btn-ghost` "Close" (the HTML's white pill with "Keep Editing Reflection" would have to cancel a run that is already on its way, so it is not built) |
| Error view | Replaces the pulse, steps and note, same centered column: "We couldn't finish this reflection." (`text-headline text-plum-deep text-center`), `mt-2` "Your words are safe. Try again, or save it and we'll retry later." (`text-body text-mauve text-center`), `mt-6` `PrimaryButton` "Try again" (in a `w-full` view, so it stretches in the centered column), `mt-2` text button "Save and close" (`btn-text__label`, `min-h-11`). Never crisis red |

### Discard dialog (`src/components/ConfirmDialog.tsx`)

RN `Modal` (`transparent`, `animationType="fade"`, `statusBarTranslucent`, `navigationBarTranslucent`, `onRequestClose` = cancel), a `bg-ink/40` scrim (`accessible={false}`: the cancel button does the same), a centered white card (`rounded-hero p-6`, `width: "100%"`, `maxWidth: 340`, `accessibilityViewIsModal`). Content centered: an optional icon in a 44 `bg-blush` circle, the title (`text-section text-plum-deep`, header role), the body (`text-body text-ink/80`, `mt-2`), optional `children` (a slot between body and buttons), then two stacked full-width buttons 12 apart, 24 below the body: the confirm button first (`.btn-primary`, or `.btn-critical` when `tone="destructive"`; when `loading` it shows a spinner), then the cancel button as `btn-ghost`. They are stacked because side by side they need 299dp at font scale 1.3 and the card has 292. Props: `visible`, `title`, `body`, `confirmLabel`, `cancelLabel`, `tone?: "default" | "destructive"`, `icon?`, `loading?` (disables both buttons and ignores the scrim and Android back), `children?`, `onConfirm`, `onCancel`. Steps 14, 15, 29, 31 and 34 reuse it; `loading` and `children` are for steps 15 and 31.

### Icons (render every one through `Icon`, with both names; all exist in the installed typings)

| Use | iOS | Android |
| --- | --- | --- |
| Close | `xmark` | `close` |
| Private chip | `lock.fill` | `lock` |
| Mic (idle, recorded) | `mic.fill` | `mic` |
| Stop (recording) | `stop.fill` | `stop` |
| Arrow in the footer | `arrow.right` | `arrow_forward` |
| Record again | `arrow.clockwise` | `refresh` |
| Info card (replaces the lotus) | `ear` | `hearing` |
| Word count | `square.and.pencil` | `edit_note` |
| Done step | `checkmark` | `check` |
| Note under the steps | `book` | `menu_book` |

## Decisions (made, do not ask me again)

These settle everything this step would otherwise stop and ask about. If one turns out to be impossible, stop and tell me instead of picking another.

1. **No new packages.** The step uses `expo-crypto` (installed in step 05; `randomUUID()`), `zustand`, React Native `Animated`, `Icon`, `expo-image` and `@react-navigation/native`. `expo-keep-awake` and `expo-haptics` are not installed: install neither, skip both, and say so in the report. Keep-awake only matters once a real recording runs (step 23), and I will decide it there.
2. **The HTML is the design source for all three views.** The first draft said Write and Processing had no mockup; they do, in the HTML.
3. **Skipped from the HTML on purpose** (report them): the Write view's mood chips (no field for them in the request contract, and the AI names the emotion), its "Auto-saved" tag (nothing is saved while typing, so it would be false), its clear button (the discard dialog covers it), the Processing view's spinning sparkle (the logo mark instead), rings, ping and blur, and its "Keep Editing Reflection" button.
4. **The lotus is replaced by a listening ear** (`ear` / `hearing`) in the info card, for the reasons the header lotus was removed on 2026-10-20: iOS has no lotus symbol (it showed a leaf), and a lotus signals spa or Eastern meditation to an explicitly Christian audience. The ear also says what the card says. Strike this if you want the lotus back.
5. **No new tokens.** The waveform's brown bar (the HTML's `#7b5455`) is `rosewood`, so the first draft's `waveform-brown` token is not added. `layout.micOrb` (64, from step 02, used nowhere) is replaced in `theme.ts` by `recordOrb: 84` and `recordHalo: 124`.
6. **Copy says only what the app does.** The design's note "We'll notify you when it's ready" is replaced by "Your reflection will be waiting in your Journal", because no step (24, 25, 28, 33) sends a "ready" notification; this stays true once steps 24 and 25 keep processing after the screen closes. The time-limit message says "You can finish your reflection now" and not "saved". "Saved locally", "Your words are safe" and the note's "waiting in your Journal" are mock until steps 24 and 25 make them true, so they carry `// TODO` markers. A "your reflection is ready" notification would be a nice addition to step 28; I will decide that there.
7. **Leaving the screen uses `usePreventRemove`, not `addListener("beforeRemove")`** (AGENTS.md "SDK and Vendor Version Notes"). With native-stack, `usePreventRemove(prevent, callback)` is the one that stops iOS's native swipe-down dismissal and still calls the screen back, so it can show the dialog (`gestureEnabled: false` also stops the swipe, but silently). Every removal, `replace` included, fires `beforeRemove`, so a guard that blocks everything would also block `navigation.replace("Reflection")`. The pattern: a `leaving` ref; the callback re-dispatches `data.action` when `leaving.current` is set, does nothing while sending, and otherwise keeps `data.action` and shows the dialog (the confirm button dispatches the kept action). Set `leaving.current = true` just before every deliberate exit (the replace calls, "Close", "Save and close"). `prevent = phase !== "editing" || hasContent`. A re-dispatched `data.action` passes the guard (it carries the routes already asked).
8. **Finish and Submit.** The first draft said both "disabled while recording" and "pressing Finish while recording stops, then submits". The rule is: Speak is enabled when the elapsed or recorded time is at least `MIN_RECORDING_MS` (3s), including while recording, where pressing it stops first and then submits; Write is enabled at `MIN_TEXT_LENGTH` (10) trimmed characters; never while the permission is being requested or the microphone is denied. A ref guard blocks a double press.
9. **The mock submission is one-shot and mutates the mock database.** `nextSubmitOutcome` resets to `"ready"` as soon as a submit takes it (like `nextHomeLoadFails`), so "Try again" after `failed` succeeds, and a forgotten `crisis` never sticks. A `ready` or `crisis` outcome adds an entry to the mock database (section 4), so Journal shows it afterwards in every scenario, including `empty`, and Reflection can load it. Stages follow where the real server answers: `ready` all three, `crisis` and `failed` the first two (the crisis check runs before the devotional), `limit` the first only (the limit is checked before any AI call).
10. **One `clientEntryId` per screen.** Created once when the screen mounts (`useState(() => randomUUID())`) and used by every attempt, so "Try again" resubmits the same id and step 23 can name the recording file after it. Never create a second id for the same entry.
11. **The waveform shows the last 9 levels**, the data model step 23 describes ("keep the last values"): the hook exposes `levels` (one 0..1 value per bar, the newest on the right). With Reduce Motion on, the bars still show the current level without animation, as step 23 says; they do not freeze.
12. **Crisis is checked before the limit** when the result arrives (step 16 relies on that order: crisis support is never paywalled). `LIMIT_REACHED` goes to `navigation.replace("Paywall", { source: "limit" })` with `// TODO(22): the server returns entryId with LIMIT_REACHED; step 16 passes it to the Paywall`.
13. **The microphone is re-checked on return.** While the state is `denied`, the app returning to the foreground (`AppState` `active`) re-reads `getMicPermission()`; if it is granted the card goes away by itself. Otherwise someone who turns the microphone on in Settings still sees the card.
14. **Contrast.** Every text pair this step ships is at least 4.5:1 (computed): rosewood on white 5.13 and on linen 4.81, mauve on white 5.72, linen 5.37, blush 4.92 and linen-deep 4.91, `ink/80` on white 7.32 and on blush 6.66, plum on blush 8.16, `grateful-fg` on white 5.94, white on `crisis` 5.49. Below 3:1, decorative only: the `rose` waveform bars on white (2.16) and the active step's `plum/30` border (1.69); the recording state is also conveyed by the red orb and the timer, and the active step by its "In progress" label. List any pair you ship that is not in this paragraph.
15. **Numbers come from the HTML, and tokens win.** Differences you keep go in your report. Expected ones: the 20/28 Medium title where the HTML has 18; the 24/32 Medium Speak and Write titles where the HTML has 24 regular with a 30 line height; the 13 Medium small labels where the HTML has 11 or 12; the `text-timer` 15 Medium where the HTML has a 14 monospaced face; `shadow-sm` on the cards left to `shadows.card`; the stop icon while recording; the halo not overlapping; "Tap to start/stop" kept while recording (the HTML's script says "Recording… tap to pause", which is a pause model this app does not have); the logo mark in the processing circle; the processing note and its icon; the Processing content in a full-screen overlay instead of inside a card.

## What you do yourself (manual setup)

Nothing here blocks the implementation. Do each item when the report asks for it.

1. **Environment keys: nothing to add.** `.env.local` already has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (a development key); this step uses no other key. The four Google values from `.env.example` are not needed until the Android development build (step 05b). Keep `.env` free of real values.
2. **Metro: no restart is needed.** This step installs nothing and edits no CSS, so Fast Refresh picks everything up. If Expo Go shows a red screen after a refresh, reload it (shake, then Reload). If Expo Go's floating "Tools" button covers the "Private" chip, drag it aside.
3. **Confirm the result on your iPhone in Expo Go.** The implementer cannot run an iPhone, so the report will list these checks for you:
   1. Tap the mic in the dock: Speak opens and matches the screenshot (no second header, no "Processing State" toggle). Close it with the X and tap the pen: Write opens with the keyboard up.
   2. In Speak, tap the big orb. If you have not decided the microphone yet, iOS asks (in Expo Go the prompt names Expo Go, which is expected). Allow: the orb turns red with a halo, the timer runs, the bars move. Tap again to stop: "Recorded 00:12", "Record again", and "Saved locally" in the header. "Finish Reflection" stays dimmed until 3 seconds.
   3. Deny the microphone (iPhone Settings → Expo Go → Microphone off), then tap the orb: the card "Microphone access is off" appears. "Open Settings" opens Settings; turn it on and come back: the card disappears by itself.
   4. In Write, type: the footer stays above the keyboard, the word count updates, "Submit Reflection" turns on at 10 characters.
   5. With something recorded or typed, press the X, Cancel or swipe the screen down: the dialog "Discard this reflection?" appears above the screen. "Keep editing" stays, "Discard" closes. With nothing recorded or typed it closes at once.
   6. On the Profile tab, in the developer card, pick a "Next submit" value (it resets to `ready` after each submit), then submit from New Entry. `ready`: the three step cards advance, Reflection opens with an id, back returns to Journal (not New Entry) and a new card is on top. `crisis`: Reflection opens with the crisis entry. `failed`: the error view; "Try again" succeeds. `limit`: the Paywall placeholder opens. While processing, a swipe down does nothing, and "Close" returns to Journal.
   7. Optional, VoiceOver: the orb reads "Start recording" and, while recording, "Stop recording, 12 seconds recorded"; the stage changes are announced.
4. **Optional: see the microphone prompt again on the iPhone.** Settings → Expo Go → Microphone: switch it off and on, or delete Expo Go and install it again (then the iOS prompt returns).
5. **Later, not now:** at step 23 tell me whether to approve `expo-keep-awake` and `expo-haptics`, and at step 28 whether to add a "your reflection is ready" notification.

## Before writing code

1. Read-only checks: `NewEntryScreen.tsx` is the step 08 placeholder (`// TEMP: replaced in step 10`); `recorder.ts` has only `getMicPermission` and `requestMicPermission`; `devStore.ts` has `scenario` and `nextHomeLoadFails`; `layout.micOrb` is used nowhere; `expo-crypto` is installed and `expo-keep-awake` and `expo-haptics` are not; `RootStackParamList` already has `NewEntry: { mode }`, `Reflection: { entryId }` and `Paywall: { source }`; `.env.local` has the Clerk key (the app does not launch without it; never print it). Search the repo (the Grep tool) for `TODO(10)`, `TEMP(10)` and `step 10` and close every one.
2. Start your own Metro on 8082 (`npx expo start --port 8082`, never 8081, which is mine) and open the app in Expo Go on the emulator as AGENTS.md "Verifying on this machine" describes.
3. Files: new `src/components/SegmentedControl.tsx`, `ConfirmDialog.tsx`, `Waveform.tsx`, `src/hooks/useRecorder.ts`, `src/screens/journal/SpeakSection.tsx`, `WriteSection.tsx`, `ProcessingOverlay.tsx`; changed `NewEntryScreen.tsx`, `src/services/recorder.ts`, `src/constants/app.ts`, `copy.ts`, `theme.ts`, `src/types/index.ts`, `src/utils/format.ts`, `src/data/journalRepository.ts`, `src/data/mock/db.ts`, `entries.ts` and `scenario.ts`, `src/store/devStore.ts`, `src/components/dev/DevToolsPanel.tsx`. The three section files are private to this screen, so they live in `src/screens/journal/`, not in `components/`.

## 1. Constants, types and formatters

- `src/constants/app.ts`: `MAX_RECORDING_MS = 300_000`, `MIN_RECORDING_MS = 3_000`, `RECORDING_WARNING_MS = 270_000`, `MAX_TEXT_LENGTH = 5_000`, `MIN_TEXT_LENGTH = 10`, `TEXT_COUNTER_FROM = 4_500`, with the comment "Keep in sync with supabase/functions/process-entry/contracts.ts (step 19)". Steps 19 and 23 read these exact names. Also `WAVEFORM_BAR_COUNT = 9`, here and not in the component, so the hook and the component share it without the hook importing a component.
- `src/types/index.ts`: `RecorderStatus = { isRecording: boolean; durationMs: number; metering: number }` (metering 0..1), `RecordingResult = { uri: string; durationMs: number; mimeType: AudioMimeType }`, `ProcessingStage = "receiving" | "reflecting" | "preparing"`, and `SubmitResult = { kind: "ready"; entryId: string } | { kind: "crisis"; entryId: string } | { kind: "error"; code: ProcessEntryErrorCode }`.
- `src/utils/format.ts`: `formatTimer(ms)` returns zero-padded whole seconds, floored (a stopwatch never shows a second early), "mm:ss", minutes not capped, "00:00" for a non-finite or non-positive value. Add `countWords(text)` (trimmed, split on whitespace, 0 for an empty string). On screen and in spoken labels, floor once (`Math.floor(durationMs / 1000) * 1000`) and pass that to `formatTimer` and `formatDurationSpoken`, so the timer, the caption and the spoken label agree. (`formatDuration` rounds; step 12 will use `formatTimer` for its scrub labels, which gives "00:42"; I will review that there.)
- `src/constants/theme.ts`: the `layout` change in decision 5.

## 2. The recorder (service and hook)

`src/services/recorder.ts` keeps the step 07 permission functions unchanged and adds, marked `// TEMP(23): replace internals with expo-audio, keep signatures`:

```ts
startRecording(onStatus: (status: RecorderStatus) => void): Promise<void>
stopRecording(): Promise<RecordingResult>
cancelRecording(): Promise<void>
```

Mock: a module-level timer emitting a status every 100ms with `isRecording: true`, the elapsed time from `Date.now()` (never a tick count: JS timers run late on this machine), and smoothed random metering (`level = 0.6 * level + 0.4 * random(0.15..0.9)`). `stopRecording` clears the timer and returns `{ uri: "mock://recording-{timestamp}.m4a", durationMs, mimeType: "audio/m4a" }`. `cancelRecording` clears it and returns nothing. No file is written and the microphone is not opened.

`src/hooks/useRecorder.ts` returns:

```ts
state: "idle" | "requesting" | "denied" | "recording" | "recorded"
error: "start" | "save" | null            // step 23 reuses these two messages
durationMs: number                         // elapsed while recording, final when recorded
levels: number[]                           // WAVEFORM_BAR_COUNT values, 0..1, newest last; zeros when not recording
recording: RecordingResult | null
start(): Promise<void>
stop(): Promise<RecordingResult | null>    // so Finish can wait for it
discard(): Promise<void>                   // cancels a running recording, back to idle, clears everything
```

- `start()`: ignore it while a start or stop is in flight (ref guard). Read `getMicPermission()`: `granted` records; `undetermined` sets `requesting`, calls `requestMicPermission()` and records only if that answers `granted`; anything else sets `denied` and does not record. A rejection from `startRecording` sets `error: "start"` and `idle`. It never starts by itself: only a tap calls it.
- Each status updates `durationMs` and pushes the metering into `levels`. When `durationMs >= MAX_RECORDING_MS`, stop automatically through the same path as `stop()`, and cap the stored `durationMs` at `MAX_RECORDING_MS` (the screen shows the five-minute message when `recording.durationMs === MAX_RECORDING_MS`).
- A failed `stopRecording` sets `error: "save"` and `idle`.
- `AppState` leaving `active` while recording: stop and keep the recording (`recorded`). `// TODO(23): real interruption handling (pause, resume)`. `AppState` returning to `active` while `denied`: re-check (decision 13).
- Unmount while recording: `cancelRecording()`.

## 3. Shared components

- **`SegmentedControl`**: `items: readonly { value: T; label: string }[]`, `value`, `onChange`, `variant?: "light" | "plum"` (default `"light"`: `segmented__item--active` and `segmented__label--active`; `"plum"`: the plum pair), `compact?: boolean` (the New Entry look above), `disabled?`, `accessibilityLabel`. The container has `accessibilityRole="tablist"` (step 11 expects it); each item is a `Pressable` (style function only, classes on the inner `View`) with `accessibilityRole="tab"` and `accessibilityState={{ selected, disabled }}`, labelled with its text (on iOS React Native speaks no role for `tab`, but "selected" is spoken). Steps 11 and 14 reuse it, full width and with three items, so the default (non-compact) layout is `flex-1` items on the full-width track.
- **`ConfirmDialog`**: the table above.
- **`Waveform`** (`src/components/Waveform.tsx`, step 23 reads it): `levels: number[]`, `active: boolean`; the bar count is `WAVEFORM_BAR_COUNT` from `constants/app.ts`. Nine bars, `w-1.5` (6) wide, `rounded-full`, `gap-1.5`, in a 64 tall row, bar colors `rose, plum, plum, plum-deep, rosewood, plum, rose, plum, rose` (the HTML's, mapped to tokens). Resting heights (idle, recorded, denied): `[16, 28, 42, 52, 36, 46, 26, 34, 18]`. Active: each bar's height is `12 + level * 40` (12 to 52), animated with `Animated.timing` over 100ms and `useNativeDriver: false` (the native driver cannot animate `height`). When `active` turns off, the bars ease back to the resting heights over 200ms. With Reduce Motion on (`useReduceMotion`), set the heights directly with no timing animation. Create the nine `Animated.Value`s with `useState(() => ...)`. The whole element is hidden from screen readers (`importantForAccessibility="no-hide-descendants"`, `accessibilityElementsHidden`).

## 4. Mock submission

- `src/data/mock/scenario.ts`: next to `MockScenario`, `export type MockSubmitOutcome = "ready" | "crisis" | "failed" | "limit"` and `takeMockSubmitOutcome()`: returns `"ready"` outside `__DEV__`; in development returns `useDevStore.getState().nextSubmitOutcome` and resets it to `"ready"`.
- `src/store/devStore.ts`: `nextSubmitOutcome: MockSubmitOutcome` (default `"ready"`) with `setNextSubmitOutcome`; the store imports the type with `import type`, as it does for `MockScenario`.
- `src/data/mock/entries.ts`: export the crisis entry id (`CRISIS_ENTRY_ID`, now a string literal inside the builder).
- `src/data/mock/db.ts`: `addMockEntry(kind: "ready" | "crisis", req: ProcessEntryRequest): string`, marked `// TEMP(25)`. Idempotent on `client_entry_id`, like the real server: if a row with `req.clientEntryId` exists, return its id. Otherwise clone the anxious fixture (`ready`) or the crisis fixture (`crisis`) from `buildEntries(now)` with `id: "entry-new-{clientEntryId}"`, `created_at` and `updated_at` now, `client_entry_id`, `input_type` from the request, `is_active_prayer: false` and the `prayer_*`, `is_answered` and `answered_*` fields cleared (so the Prayers counts do not change). For a text request the typed text becomes the transcript, so the Journal card quotes what was written (it lives only in the in-memory mock, never in storage or a log). For `ready`, also clone the three affirmation rows of the anxious entry onto the new id (`affirmation-{id}-{slot}`), so the Journal's affirmation card stays. Push the rows onto `getMockDb()`. Update the comment above `MockDb` ("Steps 10, 14, 15 and 16 mutate it").
- `src/data/journalRepository.ts`: `submitEntry(req: ProcessEntryRequest, onStage: (stage: ProcessingStage) => void): Promise<SubmitResult>`, marked `// TEMP(25): call process-entry via api/journalApi.ts`. It takes the outcome with `takeMockSubmitOutcome()`, then emits the stages for that outcome, 1.2s apart (`ready`: receiving, reflecting, preparing; `crisis` and `failed`: receiving, reflecting; `limit`: receiving), and returns after the last wait: `ready` and `crisis` call `addMockEntry` and return its id; `failed` returns `{ kind: "error", code: "AI_UNAVAILABLE" }`; `limit` returns `{ kind: "error", code: "LIMIT_REACHED" }`. Log only the stage name and the outcome in `__DEV__`.
- `DevToolsPanel`: a row "Next submit" with four `DevButton`s (`ready`, `crisis`, `failed`, `limit`), `selected` for the current value, accessibility labels "Next submit {name} (dev)". Strings stay inline there.

## 5. The screen (`src/screens/journal/NewEntryScreen.tsx`)

Remove `// TEMP: replaced in step 10`. State: `mode` (initial from `route.params.mode`), the Write `text`, `phase: "editing" | "sending" | "error"`, `stage: ProcessingStage | null`, the dialog (`null | "leave" | "record-again"`), the pending leave action, `clientEntryId` (decision 10), the `useRecorder()` result, and `leaving` and `mounted` refs.

- `hasContent = recorder.state === "recording" || recorder.state === "recorded" || text.trim().length > 0`. Content in either mode counts.
- Layout as in the tables. The editing UI (header, toggle, section, footer) stays mounted under the overlay while `phase !== "editing"` so the text and the recording survive "Try again"; hide it from screen readers then (`importantForAccessibility="no-hide-descendants"` and `accessibilityElementsHidden`).
- **Write focus.** Not `autoFocus` (AGENTS.md "Bottom Sheets"): when the screen opens in write mode, call `inputRef.current?.focus()` about 350ms after mount (after the modal transition), as `EmailSheet` does. Pressing Submit dismisses the keyboard.
- **Footer enabled** per decision 8. "Finish Reflection" while recording: `const result = await recorder.stop()`, then submit with that result.
- **Leaving** (decision 7): `usePreventRemove(phase !== "editing" || hasContent, callback)`. The callback: if `leaving.current`, `navigation.dispatch(data.action)`; else if `phase === "sending"`, do nothing; else keep `data.action` and open the "leave" dialog. The X and "Cancel" call `navigation.goBack()`, which goes through the same guard (with no content it closes at once). Confirming the leave dialog: `await recorder.discard()`, then dispatch the kept action. The "Discard this reflection?" dialog (destructive): "What you've recorded or written will be deleted." / "Discard" / "Keep editing". "Record again" opens the "record-again" dialog (destructive): "Discard this recording?" / "It will be deleted, and you can record again." / "Discard" / "Keep recording"; confirming calls `recorder.discard()`. While recording, leaving also asks (the recording is content).
- **Submit.** Build the request from the active mode with `clientEntryId`: audio `{ clientEntryId, inputType: "audio", audioPath: recording.uri, durationMs: recording.durationMs, mimeType: recording.mimeType }` (`audioPath` holds the local file uri until step 23 uploads the file and sends the storage path), text `{ clientEntryId, inputType: "text", text: text.trim() }`. A ref guard blocks a double press. Set `phase: "sending"` and `stage: "receiving"`, call `submitEntry(request, onStage)`, and ignore any result or stage after unmount (`mounted`). The result:
  - `ready` or `crisis` (checked **before** any error code): `leaving.current = true`, then `navigation.replace("Reflection", { entryId })`. Reflection decides what to render (the crisis state is a data state, step 13). Show nothing crisis-specific here.
  - `error` with `LIMIT_REACHED`: `leaving.current = true`, then `navigation.replace("Paywall", { source: "limit" })` with the `// TODO(22)` from decision 12.
  - any other `error`: `phase: "error"` (the error view). "Try again" sets `phase: "sending"` and submits the **same** request with the same `clientEntryId`. "Save and close": `leaving.current = true`, `navigation.goBack()`, `// TODO(24): queue for retry`. While in the error phase the guard asks before the user can leave any other way (back, swipe), because leaving discards the text.
  - "Close" during `sending`: `leaving.current = true`, `navigation.goBack()`. The mock keeps running; its late result is ignored. `// TODO(25): keep processing after the screen closes and show the entry when it is ready`.
- Announcements: `useAnnounce` for the recording started and stopped messages, the warning and the limit message; on Android the same texts carry `accessibilityLiveRegion="polite"`. For the stage changes, a screen-reader-only live region in the overlay (a `Text` at 1x1, `position: "absolute"`, `opacity: 0.01`, never 0, because Android hides a fully transparent view) carries the current stage message, and `useAnnounce` speaks it on iOS.

## 6. The Processing overlay

`ProcessingOverlay` takes `entryKind` (`"audio" | "text"`), `stage`, `error` (a boolean), and the callbacks `onClose`, `onRetry` and `onSaveAndClose`. It fades in over 250ms (`Animated.Value` from `useState`, opacity only). The stage maps to the cards: `receiving`: card 1 in progress; `reflecting`: card 1 done, card 2 in progress; `preparing`: cards 1 and 2 done, card 3 in progress. The overlay fills the screen over the editing UI.

## 7. Strings (`copy.newEntry`)

Every string lives in `src/constants/copy.ts` under `newEntry`, grouped as `header`, `modes`, `speak`, `write`, `footer`, `discard`, `discardRecording` and `processing` (the error view's strings are in `processing`); accessibility labels built from values are functions (for example `stopLabel(spoken)`). Eyebrows and captions are stored in sentence case. The strings are the ones quoted in this prompt:

- Header: "New Reflection", "Saved locally", "Private". Modes: "Speak", "Write", group label "Reflection mode". Footer: "Cancel", "Finish Reflection", "Submit Reflection".
- Speak: "Sanctuary of voice", "What's on your heart today?", "Take a breath. Speak freely — there is no wrong way to pray.", "Tap to start/stop", "Recorded {time}", "Record again", "Start recording", "Stop recording, {spoken} recorded", "Recording started", "Recording stopped, {spoken} recorded", "30 seconds left", "Your 5 minutes are up. You can finish your reflection now.", the two errors, the denied card ("Microphone access is off", "Turn it on in Settings to pray out loud, or switch to Write.", "Open Settings", "Write instead") and the info card ("Whisper or speak aloud", "Gracehush listens for what you're carrying and shapes a short devotional and scripture just for you.").
- Write: "Pour out your heart", "Written prayers hold the quiet weight of honest thoughts.", the placeholder, "Your reflection", `words(n)` ("1 word", "{n} words") and `limit(n)` ("{n} / 5,000" with thousands separators).
- Processing: the two titles, the subtitle, the three step titles with their descriptions and the status labels ("Done", "In progress", "up next" for the spoken label), the four stage announcements ("Listening to your reflection.", "Reading your reflection.", "Reflecting on what you shared.", "Preparing your devotional."), the note, "Close", and the error view ("We couldn't finish this reflection.", "Your words are safe. Try again, or save it and we'll retry later.", "Try again", "Save and close").

### Lint rules that apply here (checked on this machine; `expo lint` runs eslint-plugin-react-hooks 7.1.1 with the React Compiler rules as errors)

A candidate with all of these patterns was linted through stdin and passed:

- `usePreventRemove(prevent, ({ data }) => { if (leaving.current) navigation.dispatch(data.action); … })`: reading a ref inside the callback is fine.
- `useState(() => randomUUID())` and `useState(() => bars.map((height) => new Animated.Value(height)))`. Never `useRef(new Animated.Value(…)).current` (`react-hooks/refs`).
- A ref that only an effect writes (`phaseRef.current = phase` inside `useEffect`) to give an `AppState` listener the latest value; `setState` inside the `AppState` listener callback; `mounted` set in an effect and read in async callbacks.
- Do not call `setState` directly in an effect body (`react-hooks/set-state-in-effect`); do not read or write `ref.current` during render. Define components at module level.

## Rules

- Do not build the Reflection, Crisis or Paywall UI: only navigate to them. Do not change `ScreenHeader`, the tab bar, the dock, the Journal screen or `PrimaryButton`. The shared files that change are the ones listed in "Before writing code".
- Do not implement real recording, upload, SQLite, the Edge Function call, network checks or notifications. Leave exactly these markers: `// TEMP(23): replace internals with expo-audio, keep signatures`, `// TODO(23): real interruption handling (pause, resume)`, `// TODO(24): reflect real local save`, `// TODO(24): queue for retry`, `// TEMP(25): call process-entry via api/journalApi.ts` (on `submitEntry` and `addMockEntry`), `// TODO(25): keep processing after the screen closes and show the entry when it is ready`, `// TODO(22): the server returns entryId with LIMIT_REACHED; step 16 passes it to the Paywall`. Step 24 owns offline handling.
- Never persist the typed text or the recording anywhere (AGENTS.md forbids journal text in AsyncStorage), never put it in navigation params, and never log a transcript, the text or a file path. Log only stage names and outcome codes in `__DEV__`.
- Crisis red is used only for the recording orb, its dot and halo, and the destructive Discard buttons. Raw hex does not appear in a component: use `colors.*` where a prop needs a color and the Tailwind classes everywhere else.
- No library, no `any`, no emojis. Run your own Metro on 8082 and never stop mine on 8081.

## Verify

```bash
npm run lint
npm run typecheck
npx expo install --check
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Run the pure parts in Node from a scratch folder outside the repo (a scratch tsconfig with `paths` for `@/*`, `module: commonjs` and a `declare const __DEV__`): `formatTimer` (0, 999, 1000, 59999, 60000, 299999, 300000, a negative, `NaN`, `Infinity`) and `countWords` (empty, spaces only, repeated spaces and newlines); and the mock database: `addMockEntry` in each scenario (`default` goes from 24 to 25 entries and the new entry has 3 affirmations; a `crisis` entry has none; `empty` ends with one entry; the same `clientEntryId` twice returns the same id and adds nothing; the prayer counts stay 5 active and 12 answered; `getLatestAffirmations` still returns three). Then check on the Android emulator in Expo Go (AGENTS.md "Verifying on this machine"; sign in with an address like `yourname+clerk_test@example.com` and the code `424242`), at about 411dp wide and at 320dp wide with font scale 1.3:

1. **Speak matches the design:** compare crops of your screenshots with `prompt_material/04-new-entry.png` at the design's own width, 390dp (`adb shell wm size 1080x2340` with `wm density 443`; reset both afterwards with `wm size reset` and `wm density reset`). The PNG is about 1.8x, so compare proportions, not pixels. The dock mic opens Speak with no outer header and no Stitch toggle; the pen opens Write with the keyboard up (focused about 350ms after the screen opens). Measure with `uiautomator dump` and report: the side padding (20), the toggle (about 160 x 34), the recorder card padding (24), the orb (84) and halo (124), the footer button (48).
2. **Recording (mock):** tapping the orb turns it crisis red with a stop icon and the halo, the timer and bars run, the dot pulses. Tap again: "Recorded 00:12" and "Record again", "Saved locally" in the header, the orb plum again. "Finish Reflection" is disabled until 3s, enabled while still recording after 3s, and pressing it then stops and submits. The toggle is disabled while recording.
3. **Limits:** the warning "30 seconds left" at 4:30 and the auto-stop at 5:00 with the five-minute message. Run it once for real, or with a `TEMP-EXPERIMENT` that sets `MAX_RECORDING_MS` to 20_000 and `RECORDING_WARNING_MS` to 10_000 (copy `app.ts` to the scratchpad first, revert and `cmp` after).
4. **Microphone:** `adb shell pm clear host.exp.exponent`, open the app, tap the orb: the OS prompt (drive it with `uiautomator dump`; its buttons are "While using the app", "Only this time" and "Don’t allow", with a typographic apostrophe). Choose "Don’t allow" twice (Android stops asking after the second; Expo Go may first show its own "Allow gracehush to also use it?" confirmation, AGENTS.md "Verifying on this machine"): the card "Microphone access is off" appears. "Open Settings" opens the system app settings for Expo Go. Grant it with `adb shell pm grant host.exp.exponent android.permission.RECORD_AUDIO`, return to the app: the card disappears without a restart. "Write instead" switches to Write. Sending the app to the background (Home) while recording stops it and keeps the recording.
5. **Write:** Submit is disabled under 10 trimmed characters; the word count updates; the footer stays directly above the keyboard (check the bounds in a dump); the counter appears from 4,500 characters and typing stops at 5,000 (use a `TEMP-EXPERIMENT` that sets `TEXT_COUNTER_FROM` to 30 and `MAX_TEXT_LENGTH` to 40, reverted afterwards, because typing 5,000 characters with `adb` is slow). Each mode keeps its own content when switching.
6. **Leaving:** with content, the X, Cancel and Android back open "Discard this reflection?"; "Keep editing" stays, "Discard" closes and cancels the recording. With no content they close at once. "Record again" opens its own dialog. Back during processing does nothing. "Close" during processing returns to Journal. In the error view, back asks before leaving.
7. **Outcomes:** from Profile set "Next submit" and submit from New Entry. `ready`: the three cards advance about 1.2s apart, Reflection opens with the **new** entry id, back returns to Journal (not New Entry) and the new card is on top with the count one higher and the affirmation card still there. `crisis`: Reflection opens with the new crisis entry; Journal shows a "Support resources" card on top. `failed`: the error view; "Try again" reuses the same `clientEntryId` (prove it with a temporary `__DEV__` log of the id, reverted) and then succeeds; "Save and close" returns to Journal. `limit`: after about 1.2s the Paywall placeholder opens with source `limit`. After each submit the Profile chips show `ready` again. In the `empty` scenario a `ready` submit gives Journal its first card.
8. **Reduce Motion** (`adb shell settings put global transition_animation_scale 0`, back to `1.0`): the halo, the dot, the processing pulse and the active step's dot are static, and the waveform bars show the level without animating.
9. **320dp (`wm size 720x1280`, `wm density 360`) and font scale 1.3 (`adb shell settings put system font_scale 1.3`, back to `1.0`):** the header title wraps instead of clipping, "Private" stays whole, the footer button drops under "Cancel" at full width when it does not fit, the recorder card fits, the step cards wrap their text, and nothing is clipped.
10. **Accessibility** (`uiautomator dump --compressed`): the orb is a button labelled "Start recording" (and "Stop recording, … recorded" while recording); the toggle items are tabs with `selected`; the dialog buttons are buttons; during processing the compressed dump shows no header, toggle or footer; the live-region text for the stage exists. TalkBack and VoiceOver are not run here: say so.

Fix every error before finishing. Then ask me to confirm the iPhone checks (manual setup item 3), and remind me of manual setup items 4 and 5. Say plainly what was not verified: the iPhone until I confirm (the discard dialog above a `fullScreenModal`, the native swipe-down guard, the transition of `replace` out of a modal), TalkBack and VoiceOver.

Report: each file created or changed, the icon names used on each platform, the dp values you measured, every difference between the design and what you built, every `// TODO(NN)` left for later steps, every text and background pair below 4.5:1 that is not in decision 14, confirmation that nothing was installed (and that keep-awake and haptics were skipped), and the AGENTS.md lines you updated.

## AGENTS.md updates

These changes were already written when this prompt was reviewed, so only check that they are there (do not write them again): in "SDK and Vendor Version Notes" the note on native-stack, `usePreventRemove` and `beforeRemove`; in "Standing Rulings" the two new rulings (a Stitch HTML can hold views its PNG does not show; controls without data or function are skipped and reported); the rewritten "4. New Entry" specification and the updated row in "Design Tool Artifacts"; and in "Copy & Tone Rules" the rule that copy says only what the app does. In this step, record the decisions and the new state, replacing the text they supersede:

- Architecture tree: add `hooks/useRecorder.ts`, the `components/` entries (`SegmentedControl`, `ConfirmDialog`, `Waveform`), `screens/journal/` (`SpeakSection`, `WriteSection`, `ProcessingOverlay`; `NewEntryScreen` is built) and the new constants (`MAX_RECORDING_MS`, `MIN_RECORDING_MS`, `RECORDING_WARNING_MS`, `MAX_TEXT_LENGTH`, `MIN_TEXT_LENGTH`, `TEXT_COUNTER_FROM`, `WAVEFORM_BAR_COUNT`) in the `constants/app.ts` line; update the `services/` line (`recorder.ts` now has the mock recorder) and the `utils/` line (`formatTimer`, `countWords`). Update the "Built so far" component list.
- Navigation Map, "Current state": in the sentence about `DevToolsPanel`, add the "Next submit (dev)" selector; add a sentence that `NewEntry` guards leaving with `usePreventRemove` (blocked while sending, a discard dialog with content) and that its exits set a `leaving` ref first.
- State Management Rules: in "Data layer (step 06)" add `submitEntry` (mock, `TEMP(25)`, one-shot outcome, stages per outcome) and `addMockEntry` (the mock database grows when a submit succeeds); in "Dev store (step 09)" add `nextSubmitOutcome`.
- Build Status & Decisions Log: a Step 10 entry with the decisions above, the files, the measured dp values, every difference from the design, what was verified and what was not, and the open items (the `TODO(22)`, `TODO(23)`, `TODO(24)` and `TODO(25)` markers; keep-awake and haptics for step 23; the "ready" notification for step 28; step 12 using `formatTimer`; step 23 saying 11 waveform values where there are 9 bars).

Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.
