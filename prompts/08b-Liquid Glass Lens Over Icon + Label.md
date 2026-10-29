### ROLE & OBJECTIVE

Act as an expert UI/UX frontend developer. Upgrade the existing traditional bottom tab navigation ("Journal", "Prayers", "Profile") into a modern iOS Liquid Glass floating capsule navigation bar matching the attached reference video.

### STRICT TOKEN & SCOPE CONSTRAINTS

- Output ONLY the code for the Bottom Tab Navigation component and its required SVG refraction filter / styling.
- Do NOT generate full page layouts, dummy screens, header bars, or unrelated boilerplate code.
- Do NOT include conversational filler or lengthy explanations—output clean, production-ready code only.

### VISUAL & STRUCTURAL SPECIFICATIONS

1. **Floating Pill Container (Replacing Full-Width Bar):**
   - Convert the flat full-width bottom bar into a floating, pill-shaped capsule (`border-radius: 9999px`) positioned near the bottom of the viewport (`bottom: 24px`, centered horizontally).
   - Surface styling: Translucent frosted glass background (`rgba(255, 255, 255, 0.75)`), `backdrop-filter: blur(16px)`, subtle inner specular border (`1px solid rgba(255, 255, 255, 0.8)`), and soft ambient elevation shadow (`0 12px 32px rgba(0, 0, 0, 0.08)`).
   - Maintain the 3 existing tabs from the current UI: **Journal** (book icon), **Prayers** (praying hands with sparkles icon), and **Profile** (user outline icon).

2. **Sliding iOS Liquid Glass Lens (Active Indicator):**
   - Create an oversized, pill-shaped 3D liquid glass droplet (`border-radius: 9999px`) that sits over the active tab and slightly overflows the vertical bounds of the main navigation bar (112% height of the bar) for a realistic convex lens look.
   - **Optical Refraction & Chromatic Aberration:** Include an inline `<svg>` filter in the DOM using `<feTurbulence>` / `<feDisplacementMap>` and RGB channel splitting (`<feColorMatrix>` + `<feOffset>`) applied via `backdrop-filter: url(#liquid-glass-lens) blur(1.5px) saturate(180%)` so that the edges of the capsule visibly bend, magnify, and create a subtle rainbow prism dispersion around the rim while keeping the center crystal clear.
   - **3D Specular Highlights:** Layer multi-stage inset box-shadows (`inset 0 2px 4px rgba(255,255,255,0.95)`, `inset 0 -3px 6px rgba(0,0,0,0.08)`, and a crisp outer rim highlight) to replicate a thick curved water droplet.

3. **Tab States & Spring Physics Animation:**
   - **Active Tab:** Highlighted in the primary brand accent color (`#4A354F` deep plum or `#FA2D48` iOS vibrant crimson) with a subtle `scale(1.06)` magnification inside the lens.
   - **Inactive Tabs:** Rendered in muted slate gray (`#6E6E73`) showing both icon and label cleanly.
   - **Sleek Motion:** Animate the liquid glass indicator's horizontal position (`transform: translate3d(...)`) using smooth iOS spring physics (`cubic-bezier(0.34, 1.56, 0.64, 1)`, duration `500ms`), adding a slight horizontal stretch (`scaleX(1.08)`) mid-transition to mimic fluid inertia.

---

## Implementation notes (2026-10-29)

Built as step 08b (the "Step 08b" entry in the AGENTS.md log). The text above is a web specification; this section says what React Native could and could not do with it, and holds the phone walk-through.

### Decisions

1. **Floating capsule.** `GracehushTabBar`'s root is an absolutely positioned layer over the scenes (`pointerEvents="box-none"`), with the capsule centered in it `insets.bottom + layout.tabBarBottom` (12) above the screen's bottom edge: the prompt's `bottom: 24px` is for a web page with no home indicator. The capsule is 276 × 64 for three tabs (`tabPillPadding` 6, three `tabItemWidth` 88 tabs, 6), on `bg-card/75` with a 1px `white/80` rim and `shadows.glass` (the prompt's `0 12px 32px` at 8%, as ink).
2. **The lens.** One tab wide and 72 tall (112% of 64: `tabLensOverflow` 4 over each edge), `bg-plum-deep/6` with a `white/90` rim and `shadows.lens` (React Native's inset `boxShadow`: white at 95% 2 down, ink at 8% 3 up). Decoration only: no touch, hidden from accessibility.
3. **Motion.** `Animated.spring` on the native driver (`stiffness` 220, `damping` 20, `mass` 1: about 400 ms, about 6% of overshoot) for the slide, with a `scaleX` stretch to 1.08 over the first 160 ms that springs back; the active tab's icon and label grow to 1.06 and the colors cross-fade in 150 ms as before. Under Reduce Motion all of it jumps. A tab chosen mid-flight stops the spring where it is.
4. **Tokens over the prompt's colors.** Active `plum` (not `#4A354F`; `#FA2D48` is not used: Crisis Red is the only red and it is for destructive actions), inactive `mauve` (not `#6E6E73`). No raw color outside `theme.ts`.
5. **Layout contract.** The bar takes none of the scenes' space, so `useTabScreenBottomPadding()` now adds `useTabBarClearance()` (the inset, 12 and 64) to the dock's 112; each list sets `scrollIndicatorInsets` to that clearance; the Toast anchors above the dock and the bar. `FloatingInputDock` is untouched (the overlay layer has no padding or border, so its `bottom: "100%"` still resolves against the capsule's height).
6. **Unchanged.** The `tabPress` and `tabLongPress` contract, `useScrollToTop`, the `selection` haptic, the accessibility labels, the icons and the labels. Nothing installed, nothing native changed.
7. **Follow-up (2026-10-29), from the user's first screenshots.** The capsule spans the content width like the cards (the window less the screen padding at each side: 350 × 64 at 390dp), and the tabs share it (112.7 each). Its surface is the `glass` token, `#F7E9DF`, the Hopeful badge's background under the name of its role. The material is `GlassSurface`: Apple's Liquid Glass through `expo-glass-effect` on iOS 26 (the bar `regular` glass tinted at 70%, the lens `clear` glass tinted `plum-deep` at 6%), an `expo-blur` blur (`light`, 40) under the tint at 70% on older iOS, the tint alone at 90% on Android. The lens keeps its rim and inset highlights. Motion: `damping` 18 (about 9% of overshoot), a stretch that grows with the distance (1.08 wide and 0.95 tall for one tab over, 1.14 and 0.92 for two), and the tab under the finger dims to 0.6 and squashes to 0.96. `isInteractive` is not used: the lens never receives a touch, so the system could not animate it. `expo-blur` 58.0.5 was installed and `expo-glass-effect` 58.0.5 first used, both with the user's yes.
8. **Follow-up 2 (2026-10-29), from the user's second screenshot.** The lens sits inside the capsule: `tabLensInset` (4) from its top and bottom edges and 4 narrower than its tab at each side (56 tall), so it never pokes out below the bar (the 112% overhang is gone). The bar reads as a pane: its tint is halved to 35% on iOS 26's regular glass and over the blur on older iOS, 85% on Android, and its shadow lifts it on every side (a halo 2 down with a blur of 20 at ink 16%, plus a contact edge 1 down with a blur of 3 at ink 8%; the first numbers, 4 down, 28 and 12%, left about 5% of ink at the top edge, which the user could not see). The bar keeps Apple's `regular` glass rather than the lens's `clear`, because regular glass keeps the tab labels readable over white text cards.
9. **Follow-up 4 (2026-10-29), the dock.** The user circled the pen in a screenshot: an outline icon beside the mic's filled one, in a smaller circle. Both buttons are now 56 (`layout.dockOrb`; `dockPen` is gone) with 26 glyphs, and color is the only difference: the mic stays the solid plum orb, and the pen wears the bar's glass, rim and halo with a plum glyph. On iOS the pen's glyph is the filled `long.text.page.and.pencil.fill` from iOS 18.4 (SF Symbols 6.3) and `square.and.pencil` before it, because iOS draws nothing for a symbol it lacks; Android keeps `edit_note`, outline like its `mic`. This departs from the Stitch design (a 44 white pen), by the user's choice.
10. **Follow-up 5 (2026-10-29), the dock as a column.** The user found the two buttons side by side crowded the tab bar. They now stand in one column at the right edge, the pen above the mic, 8 apart (`layout.dockHeight` 120): the space above the bar stays clear, the mic stays nearest the thumb and between the glass pen and the glass bar, and the column's right edge lines up with the capsule's and the cards'. A tab screen's end padding grows by 64 (`dockClearance` 112 to 176), so the last card can always scroll clear of the pen, and the Toast anchors above the column.

### Not possible in React Native (reported, not built)

- `backdrop-filter: blur(16px)`: no backdrop blur without a native module (see "Pending" below).
- The inline SVG filter (`feTurbulence`, `feDisplacementMap`, the RGB channel split) and `backdrop-filter: url(#liquid-glass-lens)`: no SVG filter can be applied to a backdrop in React Native, and `react-native-svg` is not installed. So there is no refraction and no prism dispersion at the rim. The inset box-shadows are real (`boxShadow` with `inset`).
- The "attached reference video" was not attached: nothing in `prompt_material/` or beside this prompt. The capsule follows the numbers above, and iOS 26's own floating tab bar for what they leave open.

### The frosted material (approved on 2026-10-29 with "Implement it", built in the follow-up)

- `expo-glass-effect` 58.0.5 (in `package.json` since the initial commit, first used here): `GlassView` is Apple's real Liquid Glass on iOS 26 (refraction, specular highlights and lensing drawn by the system), a plain `View` elsewhere; it is in Expo Go 58.
- `expo-blur` 58.0.5 (installed here with `npx expo install expo-blur`): `BlurView` is the frosted backdrop blur on every iOS version, in Expo Go too; on Android a blur needs a `BlurTargetView` around the content, which the tab bar cannot wrap the scenes in, so Android keeps the tint alone.
- `src/components/GlassSurface.tsx` picks the material once at import (`isLiquidGlassAvailable()` and `isGlassEffectAPIAvailable()`, inside a try/catch) and draws the bar and the lens as decision 7 says; the Tech Stack names both packages.

### Phone walk-through

Not run: on 2026-10-29, after the fourth round, the user looked at the bar on the iPhone and accepted it ("No need for the check, the nav bar looks good"). The checks stay here for a later run or another app.

Before B0: restart the dev server with `npx expo start -c` (new class names and theme values), then force-quit and reopen Expo Go. Any account; the test account is fine. Nothing is sent and nothing costs. The app stays open and in front for the whole run.

- **B0** — Do: open the app on the Journal tab. Expect: signed in, Journal focused, the capsule drawn. Read: the probe reads `navigationRef.getRootState()`: the `MainTabs` route's `state.index` is 0 and the focused route is `Journal`.
- **B1** — Do: send a screenshot of the Journal. Expect: a floating pill centered near the bottom, about 4.3 times as wide as tall, with three tabs (icon over label), the lens over Journal (a faint plum tint with a bright rim, inside the pill, a little shorter than it), the pen and the mic above the pill at the right, and nothing of the old full-width bar. Read: ask for the screenshot and read the proportions in it.
- **B2** — Do: tap Prayers once. Expect: the lens slides to Prayers with a slight stretch and a small overshoot, Prayers turns plum and grows a little, Journal fades to mauve, and a light tick is felt. Read: `state.index` is 1 (probe); the motion and the tick are the user's one-word answers.
- **B3** — Do: tap Profile, then Journal, within about half a second. Expect: one lens, ending over Journal; Journal focused. Read: `state.index` is 0 (probe); a screenshot shows one lens.
- **B4** — Do: on Journal, scroll to the end of the list and send a screenshot. Expect: the cards scroll under the capsule and show through it faintly, the last card ends above the dock (about 36dp), and the scroll indicator stops above the capsule. Read: the screenshot, measured against the capsule's 64dp height.
- **B5** — Do: tap the pen in the dock, then Cancel. Expect: New Entry opens in Write mode; Cancel returns to Journal with the capsule where it was. Read: the root state's top route is `NewEntry` with `params.mode === "write"`, then `MainTabs` again (probe).
- **B6** — Do: scroll down on Journal, then tap the active Journal tab. Expect: the list scrolls to the top; the lens does not move. Read: `state.index` stays 0 (probe); the scroll is the user's one-word answer.
- **B7** — Do: Settings → Accessibility → Motion → Reduce Motion on; back in the app tap Prayers, then Journal; then Reduce Motion off again. Expect: the lens jumps between the tabs with no slide and no stretch, and the colors switch at once. Read: the probe reads `AccessibilityInfo.isReduceMotionEnabled()` (true during the check) and `state.index`; the motion is the user's one-word answer.
- **B8** (optional) — Do: with Journal in front and nothing waiting to send, Airplane mode on, then off. Expect: "All reflections synced" floats above the dock and the capsule, centered, and fades out after a few seconds. Read: the probe reads the offline store's `netConnected` turning false and true; the place of the toast is a screenshot.
- **B9** (optional) — Do: VoiceOver on; swipe through the bottom of the screen. Expect: "Journal, tab, 1 of 3, selected", "Prayers, tab, 2 of 3", "Profile, tab, 3 of 3", "Write a reflection, button", "Speak a reflection, button"; the lens and the capsule's surface are never focused. Read: the user's answers.
- **B10** (optional) — Do: Settings → Display & Brightness → Text Size at the largest, back in the app, a screenshot of the capsule; then the size back. Expect: the three labels stay on one line inside their tabs (they cap at 1.3), nothing clipped. Read: the screenshot.

- **B11** — Do: on Journal, send a screenshot with the capsule and at least one card in it. Expect: the capsule's left and right ends line up with the cards' edges (20dp from each screen edge), peach-tinted, the three tabs sharing its width and the lens over Journal about a third of it. Read: the screenshot; the probe reads `Dimensions.get("window").width` and computes the capsule width (the window less 40).
- **B12** — Do: scroll Journal so that a white card sits under the capsule, then send a screenshot. Expect: the capsule is a see-through pane over the white card, faintly peach, lifted by a soft shadow on every side, and the card's edges and text are softened behind it (bent and brightened at the capsule's edge on iOS 26, blurred on older iOS). Read: the screenshot.
- **B13** — Do: say which iOS version the iPhone runs (Settings → General → About → iOS Version). Expect: on iOS 26 the probe reads `expo.modules.ExpoGlassEffect.isLiquidGlassAvailable` as true and the capsule refracts what scrolls under it; on iOS 18 it reads false and the capsule blurs instead. Read: the probe reads that constant and `expo.modules.ExpoDevice.osVersion`.
- **B14** — Do: tap Profile from Journal (two tabs over), then Journal. Expect: the lens stretches wider and flatter than for a one-tab hop and settles with one soft wobble; the tab under the finger dims and shrinks for the moment of the press. Read: `state.index` is 2, then 0 (probe); the motion is the user's one-word answer.
- **B15** — Do: send a close screenshot of the capsule with Prayers active. Expect: the lens stays inside the capsule, a few dp in from its top and bottom edges and from its tab's sides, with the capsule's edge visible all around it. Read: the screenshot, measured against the capsule's 64dp height.
- **B16** — Do: with the capsule over plain linen (the top of a list), send a screenshot. Expect: a soft shadow is visible above the capsule as well as below it, so it reads as lifted off the page, and the pane is only faintly peach. Read: the screenshot.

Follow-ups 4 and 5 (the dock), B17 to B20: no restart is needed (Fast Refresh carries it). Any account; the app stays open and in front.

- **B17** — Do: on Prayers, scroll until a white card sits under the dock, then send a screenshot. Expect: the pen and the mic are the same size, stacked at the right edge with the pen above the mic, 8dp apart, the column's right edge in line with the capsule's and the cards' right edges; the pen is a faintly peach glass circle with a soft shadow and a solid plum page-and-pencil icon, and it stands out from the white card; the mic is the solid plum orb with a white mic. Read: the screenshot; the fiber walk finds the dock's pen `Icon` with `name.ios` equal to `long.text.page.and.pencil.fill` and size 26 when the probe reads `Platform.Version` as 18.4 or later (`square.and.pencil` before it).
- **B18** — Do: tap the pen, then Cancel; then tap the mic, then the X. Expect: New Entry opens in Write, then in Speak, and each time the app returns to the tab with the dock where it was. Read: the root state's top route is `NewEntry` with `params.mode` `"write"`, then `"speak"`, then `MainTabs` again (probe).
- **B19** (optional) — Do: VoiceOver on; swipe to the dock. Expect: "Write a reflection, button", then "Speak a reflection, button"; the glass and the rim are never focused. Read: the user's answers.
- **B20** — Do: on Prayers, Active tab, scroll to the end of the list, then send a screenshot. Expect: the last card ends a little above the pen (about 36dp), and its Mark Answered button is clear of the column. Read: the screenshot; the fiber walk reads the list's `contentContainerStyle.paddingBottom`: the bottom inset plus 76 plus 176.

Not checkable on this target: Android (the emulator only with the user's yes), and the real refraction unless the iPhone runs iOS 26.

### AGENTS.md updates

The architecture tree (components, constants and hooks lines), the Components "Built so far" list, the Navigation Map (the shared tab-screen layout, the bar's bullet and a new "The bar floats" bullet, the dock's bullet), the two vendor notes (bottom-tabs, and the percentage offset), the Design System's elevation rule (`shadows.glass` and `shadows.lens` as `boxShadow`), and the Step 08b log entry. Follow-up 4: the tree's `theme.ts` line, the Navigation Map's dock line and the dock bullet, and its log entry. Follow-up 5: the tree's `theme.ts` line, the tab-screen layout and "bar floats" bullets (the dock clearance), the Navigation Map's dock line, the dock bullet, and its log entry.
