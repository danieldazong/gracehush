# UI, design, styling and copy

> Part of the GraceHush rules, moved out of `AGENTS.md` word for word on 2026-11-23. `AGENTS.md` is the short core that every session loads, and its "Rules index" says which file holds which section. The sections below keep their original `##` headings, so a reference such as "AGENTS.md, Crisis Safety Rules" finds them. A rule that changes is changed here, in its section, in a few lines; a step's history goes to `docs/build-log.md`. This file can be long: search it (`git grep -n "<words>" docs/rules/ui-and-design.md`) and read only the part you need.

## UI Implementation Rules (VERY IMPORTANT)

For any UI-related task:

- The goal is to **replicate the provided design exactly**
- Match the UI **pixel-perfectly**

When the user provides a design image, you MUST:

- match layout exactly
- match spacing and padding
- match font sizes and hierarchy
- match colors precisely
- match border radius and shadows
- match alignment and positioning
- match proportions of elements
- replicate all visible UI elements that belong to the real app

Do not approximate. Do not simplify unless explicitly asked.

### Design references

- `prompts/DESIGN.md` is the design system (Warm Sanctuary). Colors come from the table in the Design System section. Ignore the Material palette in its front-matter.
- Each screen has a screenshot `prompt_material/NN-name.png` and the Stitch HTML `prompt_material/NN-name.html`. Identical copies of the screenshots are in `Images/` (`N._name.png`), and some prompts point there, but only `prompt_material/` has the HTML. The HTML holds the exact values, where 1 CSS px = 1dp. The PNGs are rendered at 1.25x (a 390dp screen is 487px wide), so never measure dp from a PNG.
- If the HTML uses a color, radius, or size that is not a token, keep the token and report the difference.

### Standing Rulings (decided in steps 03, 04, 09, 10 and 11, apply to every screen)

- Tokens win over the HTML: `ink` / `mauve` for text (the HTML uses its own charcoals), `petal` for borders and dividers, the 2-stop `gradients.brand` for gradient hero cards (the HTML adds a deeper middle stop), `.btn-primary` (48 min height, 15 SemiBold label) instead of the HTML's 52-tall 16px button, and the type scale for body text (`text-body-lg` 17, `text-body` 15) instead of the HTML's 16 and 13.
- Skip decorative extras the HTML adds, such as blurred glow circles and inner shadows, unless a prompt asks for them.
- When the HTML copy differs from the step prompt or the Screen Specifications below, use the prompt and the specifications.
- Sizes come from the HTML. If a step prompt lists sizes that disagree with its HTML, they were probably measured from the 1.25x PNG: build from the HTML and the tokens, and report the difference, unless the prompt says it is overriding the HTML on purpose.
- A Stitch state view (offline, empty) swaps out whole sections of the screen to show one state. Build the real screen from the normal view, and add only what the state view adds, in the HTML's order and with its spacing. For example, the offline banner goes directly under the greeting, and the affirmation card and the section row stay (step 09).
- A Stitch HTML can hold views its PNG does not show (New Entry's Write and Processing views, step 10; Reflection's Now Playing and Crisis views, steps 12 and 13; Prayers' Answered view and Mark Answered sheet, step 14; Profile's export and delete dialogs, step 15): read the whole HTML, and take sizes from it. PNG scales differ per file (about 1.25x for most, about 1.8x for `04-new-entry.png`), so never measure a PNG.
- Controls the HTML shows that the app has no data or function for are skipped and reported, not built as decoration. Step 10 skips the Write view's mood chips (the request contract has no field for them, and the AI names the emotion), its "Auto-saved" tag (nothing is saved while typing) and its clear button (the discard dialog covers it). A color the HTML uses that is not a token maps to the nearest token (the waveform's brown bar is `rosewood`), never to a new token. Step 15 skips Profile's Devotional Voice row (one server-side voice, no data to choose from), the export dialog's fake file card (it claims a PDF and encryption nothing builds) and the HTML's timed toasts. Step 16 skips the Paywall's blurred glow (a decorative extra, and gradients are for Now Playing only), four of its five benefit rows (they are not gates, see Subscription Rules) and its "Cancel with one tap" shield line (a claim the app cannot keep).
- `rose` is a fill, never text (colour table). Where the HTML sets small text in `dusty-rose` on a plum surface (Reflection's player card subtitle and times, 3.88:1), build it white at 70% (5.61:1) and keep `rose` for circles, progress fills and icons (step 11).
- A heading size that has no type-scale token and whose line count matters is a one-off class, measured from the font files, with the reason in the step log: Reflection's first line was `font-fraunces text-[27px] leading-[34px] tracking-[-0.675px]` because `text-headline-lg` (30/38) and `text-title` (28 SemiBold) both made three lines at 390dp where the HTML has two (step 11); since 2026-11-08 it is `font-fraunces text-[22px] leading-[30px] tracking-[-0.55px]` with `lineBreakStrategyIOS="push-out"` and `textBreakStrategy="balanced"`, because the line is written from the entry since step 36 (8 to 18 words) and at 27/34 it ran to four lines with a one-word last line (the "Reflection's first line is a lead" entry in the log).

### Design Tool Artifacts — DO NOT IMPLEMENT

The reference screenshots were generated in Google Stitch and contain preview-only controls that switch between design states. These are **not** part of the real UI:

| Screen     | Artifact to ignore                                                   | Real behavior                                                           |
| ---------- | -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Onboarding | Pill tabs "1: Welcome / 2: Rhythm / 3: Permissions"                  | Keep only the progress dots + "1 OF 5" counter, over the scene                          |
| Sign In    | Inline email field revealed by the HTML's `toggleEmailInput()` script, and the "By continuing you agree…" footer that the screenshot omits | "Continue with email" opens a bottom sheet (email, then a 6-digit code). No Terms or Privacy text on this screen |
| Journal    | Toggle "Feed (Normal) / Offline Sync / Empty State"                  | States are driven by real data and network status                       |
| New Entry  | Outer toggle "Speak / Write / Processing State" and duplicate header | One header ("New Reflection" and the "Private" chip; step 24 removed "Saved locally"), one Speak/Write toggle; the Processing view is the full-screen overlay shown while submitting |
| Reflection | Toggle "Devotional View / Now Playing Sheet / Crisis Support", and the header's bookmark and share icons | Now Playing opens from the mini player; Crisis is a data state; share lives in the footer (there is no bookmark feature) |
| Prayers    | Link "Preview Mark Answered Sheet"                                   | The sheet opens from each card's "Mark Answered" button                 |
| Profile    | Toggle "Settings / Export View (Dialog) / Delete View (Dialog)"      | Dialogs open from the Export / Delete rows                              |

Also do not replicate rendering glitches in the references. Examples: the scripture reference overlapping the verse text on Reflection, placeholder dashes where icons failed to render, and truncated or wrapped labels. Implement the clear intent of the design. If the intent is ambiguous, ask.

Third tab is labeled **Profile**, with a person icon (resolved in step 08): the "Sanctuary" label and church icon on the Prayers and Profile screenshots are a design inconsistency.

---

## Design System

### Colors (`@theme` in `global.css` + `src/constants/theme.ts`)

| Token        | Hex       | Use                                                 |
| ------------ | --------- | --------------------------------------------------- |
| `plum`       | `#5B3A5E` | Primary buttons, mic, active tab, player card       |
| `plum-deep`  | `#3E2741` | Duration pills, titles on light surfaces            |
| `rose`       | `#D4A5A5` | Badge fills, waveform accents (never text)          |
| `rosewood`   | `#96555D` | Scripture refs, links, eyebrows                     |
| `terracotta` | `#C4704F` | Consistency chip, "Save 50%", answered prayers      |
| `sage`       | `#8FA58A` | Checks, success, synced                             |
| `linen`      | `#FBF7F2` | App background                                      |
| `linen-deep` | `#F1EDE8` | Chip and segmented-control track backgrounds        |
| `blush`      | `#F5ECE8` | Scripture card, privacy card, sheets                |
| `card`       | `#FFFFFF` | Cards                                               |
| `ink`        | `#2E2A33` | Primary text                                        |
| `mauve`      | `#6E636D` | Muted text, inactive tabs, placeholders             |
| `petal`      | `#EADFDB` | Borders, dividers                                   |
| `crisis`     | `#B4443A` | Recording, crisis support, destructive actions ONLY |
| `glass`      | `#F7E9DF` | The floating tab bar's glass tint (the Hopeful badge's background, under the name of its role; step 08b follow-up) |

Emotion badges (bg / text): Anxious `#F3E6EE / #5B3A5E`, Weary `#F0EAE6 / #6B5D57`, Grateful `#E8EFE6 / #4F6B4A`, Grieving `#ECE6F0 / #4A3B5C`, Hopeful `#F7E9DF / #9A4F31`. Unknown emotions fall back to Weary styling.

Sample hex values from the screenshots when they differ slightly from this table, then confirm with the user before changing tokens.

**`mauve` is `#6E636D`, not the design's `#8A7F88`** (decided with the user on 2026-10-20, the step 09 follow-up). The design value measures 3.84:1 on white, 3.60 on linen and 3.29 on linen-deep (the chips), below AA for the 13px text it carries. `#6E636D` is 5.72, 5.37 and 4.91, and still reads as secondary (ink is 14:1 on white). The designer's own muted colour in the HTML (`#7E747C`) also fails on linen and chips, so do not re-derive mauve from the screenshots. `prompts/DESIGN.md` and prompt 02 still say `#8A7F88`: this table wins. **`rosewood` is `#96555D`, not the design's `#9E5A62`** (decided with the user on 2026-10-20, the step 11 follow-up). The design value measures 4.41:1 on blush and 4.40 on linen-deep, below AA for the 17px scripture reference and the 15px email-sheet errors that sit on blush. `#96555D` is 4.81 on blush, 4.80 on linen-deep, 5.24 on linen, 5.59 on white and 5.34 on the scripture pill (white at 70% over blush): about 5% darker with the same hue, and 0.3 of headroom (the bare minimum, `#9B5860`, clears blush by only 0.06, the margin turned down for `mauve`). `prompts/DESIGN.md` and prompt 02 still say `#9E5A62`: this table wins. **Text links on a blush surface (the sheets and the microphone card) stay `plum`** (8.16:1 against rosewood's 4.81): they were built that way and the decision stands.

### Typography

- **Fraunces** for display, titles, scripture, and the wordmark
  - Page title 28 SemiBold · Section 20 Medium · Scripture 17 Italic / 26 line height · Headline-lg 30 / 38 Regular (`text-headline-lg`, the three onboarding step titles)
- **DM Sans** for UI and body
  - Body 15 / 22 · Buttons 15 SemiBold · Labels 11 Bold uppercase, tracking 0.8
  - Eyebrows, taglines, and counters render uppercase through the `uppercase` style. Store their strings in sentence case ("Your rhythm", "1 of 3") so screen readers read words.
- The recording timer uses a monospaced style in the design. Ask before adding a mono font. Until then, use DM Sans with `fontVariant: ['tabular-nums']`.
- Load fonts through `@expo-google-fonts/fraunces` and `@expo-google-fonts/dm-sans` (check whether they are installed first).

### Shape & Elevation

- Scholar's ask bar (step 38): `layout.askBarHeight` 56 and `layout.askBarClearance` 112 in `theme.ts`. `Waveform` takes `size` (`default`, or `compact`: half the bar heights and 4-wide bars in a 32-tall row, Scholar's composer).

- Cards 16 radius · Hero cards 24 · Inputs 12 · Buttons and chips full pill · Sheets 24 top corners
- A Scholar conversation (2026-11-15): the person's bubble is `radii.bubble` 20 on three corners and `radii.bubbleTail` 6 on the bottom-right one, and Scholar's answer is the mirror (the small corner bottom-left), both set as a style because per-corner radii have no class, and the composer is a pill at `radii.hero` 24.
- Soft, low-opacity shadows only. Rely on Petal borders. Shadows come from `shadows.card` / `shadows.sheet` / `shadows.orb` in `theme.ts` and are applied with `style` (for example `.card` plus `style={shadows.card}`). Since step 08b `shadows.glass` (the floating tab bar's lift) and `shadows.lens` (the lens's inset highlight and shade) are React Native's own `boxShadow` (0.76 and later, New Architecture): one shadow for both platforms, and the only way to draw an inset one; the three older tokens stay on the legacy shadow props. Since 2026-11-19 `shadows.planTagPro` and `shadows.planTagFree` (the plan tag's lift on the profile picture: a contact shadow 1 down with a blur of 2 and a softer one 2 down with a blur of 5, in ink at 35% and 15% under the Pro pill and 22% and 10% under the Free one) are `boxShadow` too, beside the tag's gradients `gradients.planTagPro`, `planTagFree`, `planTagShinePro` and `planTagShineFree`. Since 2026-11-20 `shadows.deckCard` (each card of the Today tab's deck: ink at 14%, 6 down with a blur of 16, and ink at 22%, 1 down with a blur of 4) is `boxShadow` too, on the card's own moving layer with the card's 24 radius, inside the 12 points of room the deck's scroll view keeps above the cards and the 24 under them.
- 8px spacing grid. Screen horizontal padding 20 (16 on narrow screens, under 360 wide).
- Touch targets ≥ 44px. Body text ≥ 15px (legal footers may be 12px).

### Icons & Imagery

- Icons: render every icon through `src/components/Icon.tsx`, for example `<Icon name={{ ios: "mic", android: "mic" }} size={22} color={colors.plum} />`. It wraps `SymbolView` from `expo-symbols` (SF Symbols on iOS, Material Symbols on Android) and counter-scales the glyph on Android so it is not clipped at large font sizes. Always pass both names. Do not use `SymbolView` directly in screens or components, and do not add another icon library.
- Icon names in step prompts that look like Lucide or Feather names (`check-circle`, `chevron-right`, …) are conceptual: pick the matching `{ ios, android }` pair and render it through `Icon`.
- The one exception is brand logos. SF Symbols and Material Symbols have no multicolor Google G (or, on Android, an Apple logo), so the Apple and Google logos are SVG files in `assets/images/` (`apple-logo.svg`, `google-g.svg`), exported from `images.ts` and rendered with `expo-image`. Never use a monochrome Google icon, and do not add `react-native-svg` for them.
- Android's Material Symbols are outline only: `SymbolView` has no fill option, and aliases such as `favorite` and `favorite_border` draw the same outline glyph (checked on the emulator in the step 09 review). Where a design needs filled against outline (a saved heart, a selected tab), iOS uses the `.fill` symbol, and Android keeps the glyph and changes the color, or uses a different glyph where one fits (`heart_check` for a saved heart).
- **No emojis in the UI.** Replace any emoji from older code (🎙️, 📖, 🔥) with icons.
- No stock photos. The Welcome step's five scenes, the Sign In cover's four (2026-11-01: three women, then two men, then two more of each) and the player's four (2026-11-02, the Now Playing card and, in square crops, the lock screen: two women and two men of different ages and backgrounds, praying at four times of day) and their sixteen more (2026-11-20: men and women of different ages, work and family situations in moments of an ordinary day, from the dawn feed to the bills after bedtime, so most reflections find a scene of their own; the Today word card and its shared picture use the same twenty), and the Paywall cover's two (2026-11-15: a woman and a man listening with headphones, at golden hour and at sunrise), and the Scholar hero's two (2026-11-16: a woman and a man studying Scripture by lamplight), and the eight voice portraits (2026-11-19: head and shoulders on a plain warm ground, four women and four men of different ages and backgrounds) are painterly illustrations, not photographs: the user generated them with an external tool to one style block (a gouache look with brush texture and film grain, the palette's plum, rose, linen and amber, a woman or a man alone in a moment of an ordinary day, the car at dawn, the office, a walk, the kitchen before dawn, the bedroom at night, eyes closed, weary but at peace, calm not sad, no text), the prompts are in the "Welcome scenes" log entry, and a new scene follows the same block so the three keep reading as one app. A photograph at full bleed reads as stock, three photographs never match each other, and an illustrated person lets her project herself in.

---

## Image Generation Rules

If the user enables image generation:

- Generate images that are **visually identical or extremely close** to the provided UI reference
- Do not change style, colors, or composition
- Keep consistency with the design system (plum-to-rose gradients, the filled two-tone mark)
- A scene with a person in it follows the Welcome scenes' style block (Design System, Icons & Imagery): painterly, the palette's colours, a calm face, no text; the implementer crops it to 4:5, sizes it to 1290 by 1612 and writes a progressive JPEG with no metadata (the recipe is in the "Welcome scenes" log entry)

After generating images:

- Place them inside the `assets/` folder
- Use clear and organized naming:

```txt
assets/images/
  logo-mark.png
  logo-mark-light.png
  onboarding-scene-1.jpg
  onboarding-scene-2.jpg
  onboarding-scene-3.jpg
  player-scene-1.jpg
  empty-journal.png
```

Use these assets properly in the UI.

---

## Image Rule

Use centralized image imports.

Before using any image asset:

1. Check if `src/constants/images.ts` exists.
2. If it does not exist, create it.
3. Import and export all app images from `src/constants/images.ts`.
4. Use images through the centralized object.

```ts
import logoMarkLight from "@/assets/images/logo-mark-light.png";
import logoMark from "@/assets/images/logo-mark.png";
import playerScene1 from "@/assets/images/player-scene-1.jpg";

export const images = {
  logoMark,
  logoMarkLight,
  playerScene1,
};
```

```tsx
<Image source={images.logoMark} />
```

Do not require or import image assets directly inside screens or components unless there is a strong reason. Ambient audio files follow the same pattern in `src/constants/sounds.ts`. Use `Image` from `expo-image`, which also renders the SVG brand logos and the share panel's app tiles. `src/constants/images.ts` exists and exports `logoMark`, `logoMarkLight`, `googleG`, `appleLogo`, `playerScene1` to `playerScene20` and `playerSceneSquare1` to `playerSceneSquare20` with the lists `playerScenes` and `playerSceneSquares` (2026-11-02; twenty since 2026-11-20, in file order, so a scene index is the file's number less one), `onboardingScene1` to `onboardingScene5` with the list `onboardingScenes` (2026-11-01; five since the men joined the same day), and `signInScene1` to `signInScene4` with the list `signInScenes` (the Sign In cover, the same day), and `paywallScene1` and `paywallScene2` with the list `paywallScenes` (the Paywall cover, 2026-11-15), and `scholarScene1` and `scholarScene2` with the list `scholarScenes` (the Scholar tab's hero, 2026-11-16), and `iconOpenBook`, `iconAnxious`, `iconSunrise` and `iconCheckBadge` (the Scholar tab's drawn icons, 2026-11-16), and `orbCore`, `orbGlow`, `orbRibbonLight`, `orbRibbonRose` and `orbSheen` (the live talk's voice orb, 2026-11-15), and `shareWhatsApp` and `shareMessages` (the share panel's app tiles, 56-point SVG circles in each brand's colour with a white Simple Icons mark, CC0, 2026-11-16), and `voiceAvatars` (the eight voices' portraits by voice key, 2026-11-19: the owner's painted portraits, cropped to 384 around the face), and `sourceTikTok`, `sourceInstagram`, `sourceFacebook`, `sourceYouTube`, `sourceGoogle`, `sourceAppStore` and `sourceChurch` (the source step's tiles, 2026-11-20: each brand's colour as a circle with its mark in white, Simple Icons, CC0, Google's G on white, and a church drawn in the Scholar icons' hand); `*.svg`, `*.png` and `*.jpg` imports are typed in `src/types/assets.d.ts`. Size `expo-image` images with `style`, not `className`.

---

## Styling Rules

Use NativeWind Tailwind classes for styling. Do not use `StyleSheet` unless something cannot be styled with Tailwind class names.

Prioritize clean, readable mobile UI.

When building from an attached design image:

- match spacing closely
- match typography hierarchy
- match border radius and shadows
- match layout structure
- use consistent reusable styles
- make the UI responsive for different screen sizes (the references range from ~320 to ~490pt wide)

Prefer the reusable classes that already exist in `global.css` (step 02): `.screen`, `.screen__content`, `.card` (`--blush`, `--hero`), `.btn-primary` / `.btn-ghost` / `.btn-critical` (each with `__label`), `.btn-text__label` (`--rosewood`), `.chip` (`--terracotta`), `.segmented` (`__item`, `__label`, `--active`, `--active-plum`), `.input`, `.icon-tile`, `.divider`, `.list-row`, `.eyebrow`, and the type scale `text-display` through `text-timer` plus `text-headline-lg` (step 03). One-off utility classes in a component are fine. Add to `global.css` only when a pattern repeats, using the BEM method, and follow these NativeWind v5 rules:

- Anything another class must `@apply` (the type scale, `eyebrow`) is declared with `@utility`. Structure classes go in `@layer components`.
- Variants are modifiers on each part (`chip__label--terracotta`). Do not rely on descendant selectors. `.chip__label--terracotta` is `text-hopeful-fg` (`#9A4F31`), not `text-terracotta` (changed in step 09 for contrast): terracotta on the chip's 12% tint is 3.0:1, `hopeful-fg` on the same tint is 4.9:1.
- Keep `:root { font-size: 16px }` (native rem is 14 otherwise) and keep the `utilities.css` import last, so utilities such as `bg-black` override component classes.
- Tokens come from `@theme`. Never put raw hex in a component.
- `className` works on core React Native components. Third-party components (`expo-image`, `LinearGradient`, `Icon`, the date-time pickers) take `style` instead. So does `Animated.View` (react-native-css has no wrapper for it): give it `style`, and put the classes on an inner `View`, as `Toast`, `Skeleton`, `Waveform`, `SpeakSection` and `ProcessingOverlay` do.
- A `Pressable` cannot take `className` together with a `style` function: NativeWind merges them into an array that Pressable ignores. Give the Pressable only the `style` function (pressed and disabled states) and put the classes on an inner `View`, as `PrimaryButton` does. A static `style` object such as `shadows.card` merges with `className` fine.
- `max-[360px]` compiles to a width strictly below 360, which is how `.screen__content` switches from 20 to 16.

Avoid large inline styles unless required.

---

## NativeWind Rule

Use the NativeWind version already installed in this app.

Before implementing styling or NativeWind-related code:

- Check the current NativeWind version in `package.json`
- Follow the syntax, setup, and patterns supported by that exact version
- Do not use APIs, config patterns, or examples from a different NativeWind version
- Do not upgrade NativeWind unless the user explicitly approves it
- If NativeWind is not installed yet, ask before installing it

Refer to this for more info: https://www.nativewind.dev/v5/llms-full.txt

---

## Style Exception Rules

Use `StyleSheet` or inline styles for these React Native components and scenarios instead of NativeWind classes:

| Component / Scenario           | Why                                                        | Use Instead                           |
| ------------------------------ | ---------------------------------------------------------- | ------------------------------------- |
| **SafeAreaView**               | className not supported reliably                           | Inline styles or `StyleSheet`         |
| **Button**                     | Only supports `title` and `onPress`                        | `TouchableOpacity` with custom styles |
| **KeyboardAvoidingView**       | Behavior props not supported by className                  | Inline styles or `StyleSheet`         |
| **Modal**                      | `visible`, `transparent` props                             | Inline styles                         |
| **ScrollView / FlatList**      | `contentContainerStyle`, `indicatorStyle`                  | `StyleSheet`                          |
| **TextInput**                  | Input-specific props like `underlineColorAndroid`          | Inline styles                         |
| **Animated.View**              | Animated values (mic pulse, waveform, processing circle)   | `StyleSheet` with animated values     |
| **Dynamic styles**             | Runtime values (progress bars, usage bar, scrubber)        | `StyleSheet.create()` or inline       |
| **Platform-specific**          | iOS-only or Android-only props                             | Conditional inline styles             |
| **Pressable/TouchableOpacity** | Pressed-state `style` function, not with `className`       | `StyleSheet`, classes on inner `View` |
| **Shadow (iOS/Android)**       | Different shadow syntax per platform                       | `StyleSheet` with platform checks     |
| **LinearGradient**             | Gradient colors/locations are props                        | Props + `StyleSheet`                  |
| **Third-party components**     | No `className` on `expo-image`, `Icon`, pickers            | `style` (StyleSheet or inline)        |
| **Transform arrays**           | Complex transform combinations                             | `StyleSheet`                          |
| **Z-index**                    | Floating dock and overlays sometimes need explicit z-index | `StyleSheet`                          |

### When to Use StyleSheet

Use `StyleSheet` or inline styles when:

- The prop is React Native-specific (not web-equivalent)
- The value is dynamic or calculated at runtime
- Platform-specific behavior is needed
- NativeWind doesn't map the property to a style

### SafeAreaView Example

```tsx
// ✅ CORRECT
import { SafeAreaView } from "react-native-safe-area-context";
import { colors } from "@/constants/theme";

function JournalFeedScreen() {
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.linen }}>
      {/* content */}
    </SafeAreaView>
  );
}

// ❌ INCORRECT
<SafeAreaView className="flex-1 bg-linen">{/* content */}</SafeAreaView>;
```

The same applies to the other exception components above. Otherwise, always use NativeWind utilities.

---

## UI Quality Bar

The app should feel:

- calm
- warm and dignified
- private and safe
- polished and modern
- visually identical to the provided design references

Use:

- rounded cards with Petal borders
- soft, subtle shadows
- generous white space
- one clear primary action per screen
- gentle, slow animations (mic pulse, waveform, processing circle, the Welcome scene's breathing zoom and 7-second cross-fade, the Now Playing card's same motion on a 20-second beat while the voice is heard, the progress pill's slide, and the Welcome rows' icons taking their turn: a pulse, a page turn, a bell's swing, one after another, the user's request of 2026-11-01, and a Prayer card title too long for its column scrolling slowly to the left in a loop, the user's request the same day, and the live talk's voice orb, whose two ribbons of light turn slowly and whose outline swells, bulges and ripples with the voice it hears, more the louder it is, the user's request of 2026-11-15, and the Today tab's deck of words, whose cards behind grow into place as the top one is swiped away, following the finger with no motion of their own, the user's request of 2026-11-20), never bouncy or playful
- friendly empty states
- large touch targets
- a few small haptic taps (below), and nothing louder

**Haptics** (decided in the step 11 follow-up, 2026-10-20; `src/services/haptics.ts` over `expo-haptics`). Exactly these moments, and no others: `selection` when a tab or a toggle changes to a different value (the bottom tabs, the `SegmentedControl` items, the prayer-request switch, and from step 12 the speed chips and the ambient chips on Now Playing, decided in the step 12 review on 2026-10-20 because they are value pickers like the segmented control; pressing the one that is already selected does nothing; and from step 15 the Daily Affirmations switch and the ambient chips on Profile, decided in the step 15 review on 2026-10-21 because they are the same kind of control, and the chips are the shared `ChoiceChip`, so they tick like Now Playing's; and from step 16 the plan options on the Paywall, decided in the step 16 review on 2026-10-21 for the same reason: a changed plan ticks, pressing the selected plan does not, and a purchase result makes no haptic, and since 2026-11-18 the "Remind me before my trial ends" switch under the plans ticks once for a changed value too (the hook ticks, never the row); and from step 34 the Share Usage Data switch on Profile, the same kind of control as Daily Affirmations, while the consent card's two buttons make none; and from 2026-11-20 the tiles of onboarding's source step ("How did you hear about GraceHush?"), a changed answer only, while its Continue and Skip make none; and from 2026-11-03 the Share with Google’s AI switch on Profile, while the permission sheet's buttons make none; and from step 39 a changed voice in the voice rows (the Talk sheet, the Conversation screen's voice sheet since 2026-11-19, and Profile) and the Share Your Voice with ElevenLabs switch, while the Talk sheet's buttons, the Talk screen and a live talk make none); `light` when a recording starts or resumes and `medium` when it stops, from recording or from paused, fired from the recorder's state change in `SpeakSection` (since step 38 the same two taps in Scholar's composer, and nothing else in Scholar makes a haptic) (so the automatic five-minute stop counts and a denied microphone does not); the automatic pause makes none; `success` when the reflection the person handed over comes back ready: since 2026-11-10 Reflection fires it (`useReflection`, on the sync engine's `finished` event for the client entry id it was opened with: New Entry leaves after 3 seconds for Reflection, where the reflection fills in), Journal fires it only when it is the screen in front (the person went back before the server was done; only the focused screen is subscribed, so never both), and New Entry fires it for an answer inside its 3 seconds; never for a heavy moment. (On 2026-11-09 Journal fired it, because the handoff landed there.) Play, pause, skip and scrubbing on Now Playing make no haptic (checked in step 12 with a temporary call-site log: one tick per changed chip, none for the selected chip, play, pause, skip or scrubbing). Never on a heavy moment's outcome or its help line (prompt 13: no urgency, sounds or haptics), and never for an error. They are fire-and-forget: a device without a haptic engine, or a failure, is ignored. Where a native control would have given its own tap and the app hides it (the prayer row hides its `Switch` and takes the whole row as the touch target), the app gives the tap itself.

Accessibility and responsiveness (check before calling a screen done):

- Every interactive element has an `accessibilityRole` and a label that includes its state, for example "Morning reminder, 8:00 AM, change time". Step counters read "Step 1 of 3".
- The screen holds up at 320dp wide and at font scale 1.3: content scrolls, footers stay pinned, nothing is clipped (icons included), and every touch target is at least 44.
- React Native's default `flexShrink` is 0, so text beside a chip, badge, pill, icon or button must be `flex-1` or `shrink`, or it pushes that element out. A row that cannot fit on one line at 320dp or font scale 1.3 wraps (`flex-wrap`, with a `minWidth` on the text block that is the longest word at the current `fontScale`) instead of squeezing a word into a mid-word break. Yoga breaks lines using the flex basis clamped by min/max size, so `flex-1` plus `minWidth` does trigger the wrap (read in the step 09 review). To know whether a row fits, measure its strings with the real font files (the advance widths in the `.ttf`), for example the Journal greeting row in step 09: its chip is 166dp wide and "afternoon," at 28dp is 136dp. Two more rules from step 15 (Profile, at 320dp and font scale 1.3): a slider that shares a row with fixed icons and a readout gets `min-w-[96px] flex-1` on its wrapper and the row wraps, so the readout drops under it instead of squeezing the track (it was 73dp wide and is 150dp now); and a clock time keeps its digits and its AM or PM on one line with a non-breaking space (`copy.profile.reminders.summary`: "Afternoon 3:00 / PM" otherwise).

---

## Date & Time Pickers

Decided in step 03 and reused by every later picker (Profile reminders, the Prayers answered date).

- **iOS:** a bottom sheet (React Native `Modal`, 24 top radius) holding `{ DateTimePicker }` from `@expo/ui/community/datetime-picker` with `display="spinner"` and `themeVariant="light"`, plus a primary `Done` button. Use the named export, because the default export trips `import/no-named-as-default`. Changes apply live through `onValueChange`, so the chip behind the sheet updates as the wheel settles.
- **Android:** the native dialog through the imperative `DateTimePickerAndroid.open({ value, mode, is24Hour: false, onValueChange })` from `@react-native-community/datetimepicker`.
- Never render the community picker as a component on either platform: on iOS its change events do not arrive, and on Android it re-opens the dialog whenever `value` changes.
- Keep each time as one `"HH:mm"` 24-hour string in state, derive the picker's `Date` from it (a fixed date, only the time of day matters), and display it as `h:mm AM/PM`.
- **A date** (the Prayers answered day, step 14) is kept as one `"YYYY-MM-DD"` string in local time (`utils/prayerDates.ts`: `toCalendarDate`, `parseCalendarDate`), never built with `new Date("YYYY-MM-DD")`, and shown with `formatCalendarDate`. Since step 29 it is stored as 12:00 UTC on that day (`answeredDateToTimestamp`) and read back as the stamp's UTC date (`answeredDayOf`, `answeredLocalDate`, `formatAnsweredDay`), so it is the same day in every time zone (Prayer Rules). Android: `DateTimePickerAndroid.open({ mode: "date", minimumDate, maximumDate, onValueChange })`. iOS: **inside a `BottomSheet` the spinner is shown inline under its row** (the Expo UI `DateTimePicker`, `display="spinner"`, `themeVariant="light"`, `minimumDate`, `maximumDate`) and not in a second `Modal`, because a Modal opened from inside the sheet's Modal is the fragile case on iOS (decided in the step 14 review; built in step 14 and verified on the Android emulator, where the dialog greys out the days before the prayer was created and after today; the iOS inline spinner inside the sheet is not verified).
- **The reminder times on Profile** (step 15) are edited through the same `ReminderTimePicker` as onboarding's Rhythm step (extracted in step 15: the iOS `Modal` sheet with the Expo UI spinner and `Done`, and the imperative Android dialog). The sheet is opened by the screen itself, never from inside a `BottomSheet` (the reason the Prayers date row has an inline spinner instead).
- Never build a custom wheel.

---

## Bottom Sheets

Decided in step 04. Every sheet (the email sheet, Mark Answered, Filter) is a `BottomSheet`: build new ones on it instead of a new `Modal`. The Rhythm time sheet keeps its own `Modal` because its picker is verified on the iPhone, and only shares the blush background.

- **Look:** blush surface, `radii.sheet` top corners, a 1px petal top border, `shadows.sheet`, a centered 48×6 petal handle, padding 24 plus the bottom safe-area inset. The scrim is `ink` at 40%, closes the sheet, and is labelled "Close" (`copy.common.close`). Android back closes it too.
- **Behavior:** React Native `Modal` (`transparent`, `slide`) with `statusBarTranslucent` and `navigationBarTranslucent`, so the scrim covers the system bars on Android. Its content sits in a `SafeAreaProvider` of its own (2026-10-27: see the vendor note on safe areas in modals). `KeyboardAvoidingView` uses `padding` on both platforms (checked on the Android emulator, which is edge-to-edge). The sheet reserves the top safe-area inset, so it never climbs under the status bar. Children sit in a `ScrollView` with `keyboardShouldPersistTaps="handled"`, so content taller than the space above the keyboard scrolls.
- **Inputs inside a sheet:** do not use `autoFocus`. On Android it focuses the field before the dialog window has focus, so the keyboard stays closed, and React Native then ignores a second `focus()` on that field. Call `ref.current?.focus()` about 300 ms after the sheet opens or its step changes (see `EmailSheet`).
- **Flows inside a sheet:** a dismiss (the scrim, the Android back key) is cheap to undo. The email sheet keeps its step, address, typed digits and countdown across a dismiss and reopens where it was, clearing only its error line, and a request that finishes after the dismiss keeps its result; only its own exits ("Use a different email", a sign-in that worked, another provider) reset it (2026-11-09; from step 04 until then closing reset everything and a late result was ignored). Mark Answered asks before a typed note is lost. A sheet with nothing to lose (the Filter, the prayer menu) just closes.
- **A choice that opens another Modal (step 29b follow-up, 2026-10-28):** iOS presents a Modal at once and cannot present one while another is still on its way out (React Native 0.88, `RCTModalHostViewComponentView.mm`: no queue; `onDismiss` is emitted when the dismissal completes), so a dialog or sheet opened in the same tick as the sheet closes may never appear. `BottomSheet` takes an optional `onDismiss` (iOS only; Android has no such event). A screen that opens something from a choice keeps the choice in a ref and goes on from `onDismiss` on iOS, with a `MODAL_HANDOFF_FALLBACK_MS` timer in case iOS never reports it (it runs once, whichever comes first), and at once on Android (the Prayers menu does this). Never use the native `ActionSheetIOS` or `Alert` for a menu: they draw system blue and red, not the palette (DESIGN.md: sheets are blush, destructive is Crisis Red).
- **The AI permission sheet is the one exception (2026-11-07).** `AiPermissionSheet` has the look of a `BottomSheet` (blush, the sheet radius, a petal edge and handle, `shadows.sheet`, an ink 40% scrim) but is a view drawn over New Entry's own content and not a `Modal`, because its Allow brings the keyboard up (until 2026-11-08 its Support resources link also opened a native-stack modal), and iOS presents one Modal at a time. It therefore has no swipe-down and no system detents; it ends with the scrim, the back key, VoiceOver's two-finger scrub or one of its buttons. Do not move it onto `BottomSheet`.
- **Code boxes:** one TextInput laid over the boxes at `opacity: 0.01`. Never 0, because Android hides a fully transparent view from screen readers, and never a transparent text color, because Android ignores it.

---

## Copy & Tone Rules

- Gentle, validating, and never preachy. Validate feelings before offering scripture.
- No toxic positivity ("Just trust God and be happy!").
- No guilt or shame around streaks, missed days, or upgrading. Use "5 days of reflection," never "You broke your streak."
- No pressure tactics on the Paywall: no fake countdowns, no fake scarcity.
- All user-facing strings live in `src/constants/copy.ts`, grouped by screen (`copy.onboarding`, …), including accessibility labels built by functions (for example `changeTime(slot, time)`). No prose inline in components. A `// TEMP` placeholder is the only exception, together with dev-only UI (the `DevToolsPanel`, step 08), which is never shown to users and keeps its strings inline.
- Strings that render uppercase (eyebrows, taglines, counters) are stored in sentence case. The `uppercase` style does the casing.
- Every string uses typographic punctuation: curly apostrophes (’) and curly double quotes, never the straight ones (decided in the step 11 follow-up, 2026-10-20, from the serif headlines "you’re" and "that’s" on the user's iPhone: 39 straight apostrophes in `copy.ts` and 18 in the mock data became ’). Text the app does not write is left as it comes: the user's own words, and scripture, which keeps the BSB's own marks (`quoteVerse`). AI-written text arrives with curly apostrophes as well: since step 32 the reflection's instruction asks for them (and `output.ts` turns a straight one after a letter into the curly one); the client does not rewrite it. The same instruction writes God's pronouns in lowercase (he, him, his, you, your), as the Berean Standard Bible does.
- Copy says only what the app does today, or what a named step will make true. Do not promise a notification, a save or a sync that no step builds. The design's "We'll notify you when it's ready" became "Your reflection will be waiting in your Journal" in step 10, because no step sends a "ready" notification. Step 24 removed New Entry's "Saved locally" (nothing is saved until Submit, and drafts are not built) and reworded the overlay note to "Your reflection is saved on this phone. If you leave this screen, it will finish in your Journal." (the reflection is in the outbox, and the app prepares it only while it is open; that note went on 2026-11-09, when the overlay became a short handoff and Journal's card took over the progress; since 2026-11-10 the overlay's three step cards are back with the note "Your reflection is saved. It’ll open in a moment." (for a few hours that day it read "It’ll finish in your Journal in a moment.", until the handoff moved to Reflection), and a step says Done only when its thing is done on the phone); Reflection's failed view said "Your words are safe. You can try again from your journal." until step 25 made it "Your words are safe. Please record or write this reflection again.": a failed server entry has no "Try again", and the phone has no copy of its words (a reflection still on the phone has its own card, with Review).

---
