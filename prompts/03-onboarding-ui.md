# 03-onboarding-ui.md

Read AGENTS.md first and follow it strictly.

Implement the 3-step onboarding flow (Welcome → Rhythm → Permissions) exactly as shown in the attached design. Use the design tokens, `theme.ts`, and `global.css` utilities from step 02. Also set up the minimal React Navigation shell the flow needs. This step is UI only.

`C:\Users\PC\Desktop\gracehush\Images\1._onboarding_flow_3_steps.png`

The PNG shows step 1 only. The HTML contains all three steps and is the source for exact sizes (1 CSS px = 1dp). The PNG is rendered at 1.25x (a 390dp screen is 487px wide), so never measure dp from it. If the HTML uses a color, radius, or size that is not a token, keep the token and tell me.

## Before writing code

- Check `package.json` for `@react-navigation/native`, `@react-navigation/native-stack`, and `@react-native-community/datetimepicker` (`react-native-screens` and `react-native-safe-area-context` are already installed). All three are missing right now, so ask in your first message, listing them, before installing. Then use `npx expo install`. Do not build a custom time wheel.
- Already installed, so do not add anything else: `expo-linear-gradient` (hero gradient), `expo-symbols` (icons), `expo-image` (logo mark), `expo-status-bar`.

## Entry point

The repo still boots through the Expo Router template. `package.json` `main` is `expo-router/entry`, and the fonts and splash screen live in `src/app/_layout.tsx` next to the step 02 preview in `src/app/index.tsx`. Convert it to the architecture in AGENTS.md:

- Create `App.tsx` at the project root. Move the font loading and splash handling from `src/app/_layout.tsx` unchanged (`useFonts` keyed by `theme.fonts`, `preventAutoHideAsync` / `hideAsync`, render nothing until the fonts load or fail). Import `./global.css` here.
- Create `index.ts` at the project root that calls `registerRootComponent(App)`, and set `package.json` `main` to `index.ts`.
- Delete `src/app/`. This removes the `// TEMP: design system preview` block.
- In `app.json`, remove the `expo-router` plugin and `experiments.typedRoutes`, and change `web.output` from `static` to `single` (static output requires Expo Router). Keep everything else, including the plum splash color. Do not uninstall `expo-router` or any other package, and tell me that it is now unused.

## Navigation shell

- `App.tsx` wraps the app in `SafeAreaProvider` → `NavigationContainer` → `RootNavigator`, with `StatusBar` from `expo-status-bar` set to `style="dark"`. Providers only, no screen UI.
- Create `src/navigation/RootNavigator.tsx` with a native stack (`headerShown: false`, linen `contentStyle`) and two routes:
  - `Onboarding` → `src/screens/onboarding/OnboardingScreen.tsx` (initial route)
  - `SignIn` → a temporary placeholder in `src/screens/auth/SignInScreen.tsx` showing only the centered text "Sign In — built in step 04", marked `// TEMP: replaced in 04`
- Create `src/navigation/types.ts` with a typed `RootStackParamList`. Use typed navigation props, with no `any`.
- Do not add tabs, auth guards, or other routes yet.

## Images and icons

- Create `src/constants/images.ts` per the AGENTS.md Image Rule and export `logoMark`. Never import images directly in screens.
- `assets/images/logo-mark.svg` is the candle-and-halo line mark from the design (white strokes, 48×48 viewBox). Render it with `Image` from `expo-image`. TypeScript has no `*.svg` declaration yet, so add `src/types/assets.d.ts` with `declare module "*.svg"` whose default export is a `number`.
- Icons: `SymbolView` from `expo-symbols`, always passing both `ios` and `android` names. Use exactly these (android / ios):
  - morning `wb_sunny` / `sun.max`, afternoon `partly_cloudy_day` / `cloud.sun`, evening `bedtime` / `moon`
  - time chip `schedule` / `clock`
  - button arrow `arrow_forward` / `arrow.right`, button check `check` / `checkmark`
  - microphone `mic` / `mic`, notifications `notifications` / `bell`, privacy note `lock` / `lock`

## Screen structure (shared by all 3 steps)

Build one `OnboardingScreen` that keeps `step` (0, 1, 2) in local state. Do not create 3 routes.

- `SafeAreaView` (inline style, linen). Inside it, one View with `.screen__content` for the horizontal padding (20, or 16 below 360 wide).
- **Header row** (12 above, 16 below): progress indicator on the left (the active step is a plum pill 28×8, the other steps are 8×8 petal dots, gap 6) and a counter on the right ("1 OF 3", "2 OF 3", "3 OF 3"), DM Sans SemiBold 12, tracking 1.2, mauve. Below it, a 1px petal divider that runs edge to edge (it ignores the horizontal padding).
- **Content:** inside a `ScrollView` with 16 padding on top, so small screens never clip.
- **Footer:** pinned to the bottom above the safe-area inset (32 above on step 1 and 24 above on steps 2 and 3, 8 below), containing the step's primary button and, where listed, a text link below it with a 12 gap. The link is at least 44 tall.
- **Ignore the Stitch artifact.** The pill tabs "1: Welcome / 2: Rhythm / 3: Permissions" must not be rendered.
- Fade content between steps with a short opacity transition (about 200ms) using the React Native `Animated` API. Nothing bouncy.
- Android hardware back and the system back gesture go to the previous step. Register the handler only while the screen is focused. On step 0, normal back behavior applies.
- All three step titles use Fraunces Regular 30 / 38 (DESIGN.md `headline-lg`). Add one `@utility text-headline-lg` for it to `global.css`. Do not change any existing token.

## Step 1: Welcome (match the screenshot, using the HTML sizes)

- **Hero card:** full width, radius 24, padding 32, content centered, height set by its content (about 216). Gradient from top-left (plum) to bottom-right (rose) using `expo-linear-gradient` with `theme.gradients.brand` (start `{0,0}`, end `{1,1}`). The design has a slightly deeper middle stop (#8E5A7F) that is not a token, so keep the token gradient and tell me. Skip the two blurred glow circles in the HTML.
  - Frosted icon tile: 80×80, radius 16, padding 16, white at 15% opacity, 1px white border at 20% opacity, `logoMark` at 48×48 inside.
  - "Gracehush": Fraunces Regular 30 / 36, white, 16 below the tile.
  - "AUDIO SANCTUARY": DM Sans SemiBold 11, uppercase, tracking 2.4, white at 80% opacity, 4 below the wordmark.
- Title "A quiet place for your heart.": `text-headline-lg`, ink, left-aligned, 24 below the hero.
- Subtitle "Speak or write what you're carrying. Receive scripture, a spoken devotional, and gentle reminders through your day.": `text-body-lg`, mauve, left-aligned, 12 below the title.
- **Footer:** primary button "Get Started" with the arrow icon (→ step 2), then a centered text link "I already have an account" in rosewood `label-lg` (→ `SignIn`).

## Step 2: Rhythm (HTML frame 2)

- Eyebrow "YOUR RHYTHM" (`.eyebrow`), then title "When would you like a gentle word?" (`text-headline-lg`, ink), then subtitle "Three short affirmations, drawn from your own prayers, at the times you choose." (`text-body`, mauve). Left-aligned, 8 between each, 24 below the block.
- Three separate white `.card`s (not one grouped card) with `theme.shadows.card`, stacked with a 12 gap. Each is a row with the card's 16 padding, the slot on the left and the time chip on the right:
  - Left: a 44×44 circular blush tile (`size-11 rounded-full bg-blush`) with a 22px plum icon, then 14 later the slot name (`text-label-lg`, ink) over a descriptor (`text-body-sm`, mauve).
  - Morning (sun icon, "Dawn stillness & focus", default 8:00 AM), Afternoon (cloud-sun icon, "Midday breather & peace", default 1:00 PM), Evening (moon icon, "Rest & surrender", default 8:00 PM).
  - Right: a time chip (`.chip` plus `border border-petal bg-linen py-1.5`, ink `label-md`) with the time and a 14px plum clock icon after it (6 gap).
  - The whole card is the touch target, at least 56 tall.
- Tapping a card opens the time picker for that slot. Store times in local state as `"HH:mm"` 24-hour strings and display them as `h:mm AM/PM`.
- Helper text 20 below the cards: "You can change these anytime in Settings." (`text-body-sm`, mauve, centered).
- **Footer:** primary button "Continue" with the arrow icon (→ step 3), then a text link "Back" (mauve `label-lg`, → step 1).

## Step 3: Permissions primer (HTML frame 3)

- Eyebrow "BEFORE WE BEGIN", then title "Two small things to make Gracehush work" (`text-headline-lg`, ink), then subtitle "We'll only ask once. You can change these in your device settings." (`text-body`, mauve). Same spacing as step 2.
- Two white `.card`s with 20 padding and `theme.shadows.card`, stacked with a 14 gap. Each is a row aligned to the top: a 48×48 circular blush tile with a 24px plum icon, 16 gap, then the text:
  - Mic icon: "Microphone" (`text-label-lg`, ink, 4 below) / "So you can pray out loud. Your recording is used only to create your reflection." (`text-body`, mauve; the HTML uses 13px, but body text stays at 15)
  - Bell icon: "Notifications" / "For your three daily affirmations. Never ads or spam."
- A privacy note 20 below the cards: a centered row (blush background, radius 12, padding 8 / 12) with a 14px plum lock icon and "Your words stay private. You can export or delete everything anytime." (`text-body-sm`, ink).
- **Footer:** primary button "Allow & Continue" with the check icon, then the text link "Maybe later" (mauve `label-lg`). For now, both navigate to `SignIn`. Do not request OS permissions in this step. That is wired in step 07, so add `// TODO(07): request mic + notification permissions`.

## Components

- Create `src/components/PrimaryButton.tsx` using `.btn-primary` / `.btn-primary__label`, with props `label`, `onPress`, optional `iconRight` (an `expo-symbols` name object, rendered white at 18 with an 8 gap), `disabled`, and `loading`. Pressed state scales to 0.98 (StyleSheet per AGENTS.md). Disabled state uses 50% opacity. It is reused on every screen.
- Keep the progress indicator, hero card, and the time and permission cards inside the onboarding screen for now. Do not extract them.

## Copy

Put all onboarding strings in `src/constants/copy.ts` under an `onboarding` key, including the three descriptors and "Back". No emojis anywhere.

## Accessibility

- Buttons and cards use `accessibilityRole="button"` with clear labels, for example "Morning reminder, 8:00 AM, change time".
- The counter has the accessibility label "Step 1 of 3".
- Every touch target is at least 44pt. Text supports dynamic type without clipping, because the content scrolls.

## Rules

- Do not build Sign In, tabs, auth, Zustand stores, or persistence. Those are steps 04–08.
- Do not request permissions or save reminder times anywhere except local state.
- Do not change design tokens. If a value in the screenshot or HTML differs from the tokens (the HTML uses its own charcoal text colors, a different divider tint, a 52-tall 16px primary button, and the three-stop gradient), keep the token and tell me.
- No stock photos and no emojis.

## Verify

```bash
npx expo start -c
npm run lint
npm run typecheck
```

On both iOS and Android development builds, and on a small (about 320pt) and a large (about 430pt) screen:

1. The app opens on Welcome, and the screenshot matches with the pill tabs omitted.
2. "Get Started" → Rhythm (counter "2 OF 3"). Change each time, and the chip updates.
3. "Continue" → Permissions ("3 OF 3"). Both buttons open the SignIn placeholder.
4. "Back" on step 2 and the Android back gesture on steps 2 and 3 return to the previous step. "I already have an account" opens SignIn.
5. Fonts render correctly on Android, the gradient, the frosted tile, and the logo mark display correctly, and nothing is clipped on the small screen. The side padding is 20, and 16 on the small screen.

Fix every error before finishing. When done, list each file created or changed, the time picker used, the icon names used, and any screenshot or HTML values that differed from the tokens.
