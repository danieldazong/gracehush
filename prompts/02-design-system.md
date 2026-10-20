# 02-design-system.md

Read AGENTS.md first and follow it strictly.

Implement the full Gracehush design system using NativeWind, based on the attached DESIGN.md and the Design System section of AGENTS.md. Set up the design tokens, a separate theme file, global CSS utilities, and font loading. Do not build any screens.

@prompts/DESIGN.md

## Source-of-truth rules (resolve conflicts this way)

- **Colors:** the AGENTS.md hex table is the source of truth. Ignore the auto-generated Material palette in the DESIGN.md front-matter (`primary #432446`, `error #ba1a1a`, etc.).
- **Fonts:** use **Fraunces** wherever DESIGN.md says Newsreader. Use DM Sans for all UI and body text.
- **Gradients:** allowed only for the onboarding hero card and player artwork (plum `#5B3A5E` → rose `#D4A5A5`). No gradients anywhere else.
- **Shadows, radii, spacing, and elevation tiers:** follow DESIGN.md.

## 1. Tokens

Use the NativeWind version installed in step 01. Define tokens where that version expects them (`tailwind.config.js` theme extension for v4, or `@theme` in `global.css` for v5). Do not mix the two.

Colors:

```txt
plum #5B3A5E      plum-deep #3E2741   rose #D4A5A5      rosewood #9E5A62
terracotta #C4704F  sage #8FA58A      linen #FBF7F2     linen-deep #F1EDE8
blush #F5ECE8     card #FFFFFF        ink #2E2A33       mauve #8A7F88
petal #EADFDB     crisis #B4443A
```

`linen-deep` is the segmented-control track and the soft chip fill seen in the screenshots.

Emotion tints (bg / text):

```txt
anxious  #F3E6EE / #5B3A5E    weary    #F0EAE6 / #6B5D57
grateful #E8EFE6 / #4F6B4A    grieving #ECE6F0 / #4A3B5C
hopeful  #F7E9DF / #9A4F31
```

Radii: `sm 4`, `DEFAULT 8`, `input 12`, `card 16`, `hero 24`, `sheet 24`, `full 9999`.
Spacing: keep the default Tailwind scale (8px grid) and add `screen 20`, `screen-narrow 16`, `space-xl 40`.

## 2. Fonts

- Check whether `@expo-google-fonts/fraunces`, `@expo-google-fonts/dm-sans`, `expo-font`, and `expo-splash-screen` are installed. If any are missing, stop and ask me before installing, then use `npx expo install`.
- Load these weights: Fraunces 400, 500, 600, 400 Italic; DM Sans 400, 500, 600 (use 700 if 600 is not in the installed package), 700.
- Load fonts once in `App.tsx` with `useFonts`. Keep the splash screen visible until fonts are loaded or a load error occurs. Never render text before fonts are ready.
- Map each loaded font to its own font-family utility (`font-fraunces`, `font-fraunces-medium`, `font-fraunces-semibold`, `font-fraunces-italic`, `font-dm`, `font-dm-medium`, `font-dm-semibold`, `font-dm-bold`). Do not combine custom fonts with `fontWeight` or `font-bold`, because Android will fall back to the system font.

Type scale (size / line height):

```txt
display        Fraunces SemiBold   32 / 40   tracking -0.01em   (onboarding + greeting titles)
title          Fraunces SemiBold   28 / 34                      (page titles)
headline       Fraunces Medium     24 / 32                      (validation headline, paywall title)
section        Fraunces Medium     20 / 28                      (section headers, card titles)
scripture      Fraunces Italic     17 / 26   tracking 0.01em
scripture-ref  Fraunces SemiBold   17 / 24   rosewood
body-lg        DM Sans Regular     17 / 26                      (transcripts)
body           DM Sans Regular     15 / 22
body-sm        DM Sans Regular     13 / 19                      (metadata, captions)
label-lg       DM Sans SemiBold    15 / 20                      (buttons)
label-md       DM Sans Medium      13 / 18                      (chips, tabs)
eyebrow        DM Sans Bold        11 / 16   uppercase, tracking 0.8px
timer          DM Sans Medium      15 / 20   tabular-nums (no mono font)
```

## 3. Theme file (`src/constants/theme.ts`)

Mirror the same tokens in TypeScript for values that can't come from class names (SafeAreaView, StatusBar, icons, gradients, Animated, shadows):

- `colors`: every color token above
- `emotionColors`: `Record<EmotionKey, { bg: string; fg: string }>` plus `getEmotionColors(emotion: string)`, which is case-insensitive and falls back to `weary`
- `fonts`: the exact loaded font-family names
- `radii`, `spacing`, and `layout` (`screenPadding: 20`, `screenPaddingNarrow: 16`, narrow breakpoint `< 360` width, `minTouch: 44`, `buttonHeight: 48`, `micOrb: 64`)
- `gradients.brand`: `['#5B3A5E', '#D4A5A5']` with locations
- `shadows`: platform-safe `StyleSheet` objects (iOS shadow props + Android `elevation`) taken from DESIGN.md:
  - `card`: `0 4px 18px -4px rgba(46,42,51,0.04)`
  - `sheet`: `0 -8px 30px rgba(46,42,51,0.07)`
  - `orb`: `0 8px 24px -4px rgba(91,58,94,0.35)`

All values must match the token config exactly. Keep everything typed, and do not use `any`.

## 4. Global CSS utilities (`global.css`)

Add these reusable BEM utilities using `@apply` with the tokens above. Use only properties NativeWind supports, and leave shadows to `theme.shadows`.

```txt
.screen                       linen background, flex-1
.screen__content              horizontal padding 20 (16 below 360 wide)
.card                         white, radius 16, 1px petal border, padding 16
.card--blush                  blush background
.card--hero                   radius 24, overflow hidden
.btn-primary                  plum, full pill, min-height 48, centered row
.btn-primary__label           white, label-lg
.btn-ghost                    white, full pill, 1px petal border, min-height 48
.btn-ghost__label             ink, label-lg
.btn-critical                 crisis, full pill, min-height 48
.btn-critical__label          white, label-lg
.btn-text__label              ink or rosewood, label-lg (no background)
.chip                         full pill, linen-deep background, px 12, py 4, row, centered
.chip__label                  mauve, label-md
.chip--terracotta             terracotta at low opacity background, terracotta label
.segmented                    linen-deep track, full pill, padding 4, row
.segmented__item              flex-1, full pill, py 8, centered
.segmented__item--active      white background (light variant) or plum (dark variant via --plum)
.segmented__label             mauve, label-md
.segmented__label--active     ink (or white on --plum)
.input                        white, radius 12, 1px petal border, min-height 48, px 16, body, ink
.icon-tile                    blush, radius 16, 56x56, centered
.divider                      1px petal height
.list-row                     row, min-height 56, items-center, gap 12
.eyebrow                      eyebrow scale, rosewood
.text-display / .text-title / .text-headline / .text-section
.text-scripture / .text-scripture-ref
.text-body-lg / .text-body / .text-body-sm / .text-body-muted (mauve)
.text-label-lg / .text-label-md
```

Name things consistently, keep each utility small, and do not create utilities for one-off styles.

## Rules

- Do not create screens, navigation, components, or `src/constants/images.ts` yet. Those come in step 03.
- Do not install an icon library. Tell me which one is already installed, if any, so step 03 can use it.
- Do not use emojis anywhere.
- Rose (`#D4A5A5`) must never be a text color. Crisis red is only for recording, crisis support, and destructive actions.
- Body text is never below 15px, except `body-sm` for metadata and legal text.

## Verify

Replace the step 01 TEMP block in `App.tsx` with a temporary design preview, marked `// TEMP: design system preview — removed in 03`, inside a `ScrollView` (`contentContainerStyle` via StyleSheet, per AGENTS.md) on a linen `SafeAreaView` (inline style). It should show:

- every color as a swatch with its token name
- every type scale line rendered with its utility
- one of each button (primary, ghost, critical, text)
- a chip, a terracotta chip, a light and a plum segmented control, an input, a card, a blush card, and an icon tile
- all five emotion badges built with `getEmotionColors()`
- one card using `theme.shadows.card` and a 64px plum orb using `theme.shadows.orb`
- a small brand gradient block, only if `expo-linear-gradient` is already installed (otherwise skip it and tell me)

Then run:

```bash
npx expo start -c
npm run lint
npm run typecheck
```

Check on both iOS and Android development builds that Fraunces and DM Sans render (including italic and every weight on Android), that colors match the hex values, and that shadows appear on both platforms. Fix every error before finishing.

When done, list each file created or changed, the NativeWind token location used (config or `@theme`), the font weights loaded, the installed icon library, and any token or utility you could not implement and why.
