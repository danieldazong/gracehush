# 08-tabs-and-dock.md

Read AGENTS.md first and follow it strictly, including "Instructional Memory": the iOS developer account comes last, and my iPhone stays on Expo Go until then.

Implement only the signed-in app shell: bottom tab navigation (Journal, Prayers, Profile) with a custom tab bar, the shared tab screen header, and the floating pen + mic input dock, all matching the attached designs. The three tabs get simple placeholder screens for now. Do not implement the Journal, Prayers, or Profile screen UI yet. Nothing here needs a development build: the tabs are plain JavaScript, so the iPhone and the Android emulator both run this step in Expo Go.

Where things stand after step 07: the signed-in branch of `RootNavigator` has one TEMP route, `Home` (`src/screens/HomePlaceholderScreen.tsx`), which holds the step 06 data check, the three scenario buttons, "Sign out (dev)" and "Reset onboarding (dev)". `@react-navigation/bottom-tabs` is not installed. `.env.local` holds the Clerk development key, which is all this step needs (it reads no environment variable).

Design reference (read only). Take every size from the HTML, where 1 CSS px = 1dp, and never from the PNG (the PNGs are rendered at 1.25x):

- `prompt_material/03-journal-home.png` and `prompt_material/03-journal-home.html`
- `prompt_material/06-prayers.png` and `prompt_material/06-prayers.html`
- `prompt_material/07-profile.png` and `prompt_material/07-profile.html`

Only the header, the tab bar and the dock of those screens are built here. Their content is built in steps 09, 14 and 15.

## What the designs say (measured, final)

The three HTML files disagree with each other on a few details, and this prompt's earlier text (read off the PNG) disagreed with all three: a 56 tab bar, 12 labels, a 64 mic orb, a 56 header with 24 padding. The values below replace it. Tokens win over the HTML (AGENTS.md "Standing Rulings"). List every difference you keep in your report.

### Header (`ScreenHeader`): `03` is the reference

| Part | Build |
| --- | --- |
| Row | 64 tall below the top inset. Side padding from `.screen__content` (20, 16 under 360). `linen`. 1px `petal` bottom border |
| Emblem | `images.logoMark`, 32×32, `tintColor={colors.plum}`. Same `expo-image` call as the Sign In tile, with plum instead of rosewood |
| Text block | 8 to the right of the emblem. Eyebrow: "Gracehush" stored in sentence case, `eyebrow` utility plus `font-dm-semibold tracking-[2.4px] leading-[11px]` (11, `rosewood`). Title: `font-fraunces-medium text-[21px] leading-[26px] text-plum-deep` |
| Lotus | 44×44 box, icon 22 in `plum`. Decorative only |
| Avatar | 8 to the right of the lotus. 32×32 `plum-deep` circle with a white `person` glyph, 18 |

Differences between the designs: `06` and `07` use a soft shadow instead of the bottom border (the border is kept: AGENTS.md says to rely on Petal borders), a 22 Regular title, eyebrow tracking of 1.1 and a charcoal lotus, while `03` has a rosewood lotus. The earlier text said a mauve eyebrow, an ink title and a rosewood emblem. The measured colors are rosewood, deep plum and plum.

### Tab bar (`GracehushTabBar`)

| Part | Build |
| --- | --- |
| Bar | `linen`, 1px `petal` top border, no shadow, no blur (the HTML's translucent blur is a decorative extra). Row 64 tall plus the bottom inset (`insets.bottom`, nothing added) |
| Row | `justify-content: space-around`, 16 side padding. Each item is at least 56 wide and the full 64 tall (so the touch area is far above 48), icon over label, gap 4 |
| Icon and label | icon 22, label DM Sans 11 with line height 11, `maxFontSizeMultiplier={1.3}` so three labels never wrap |
| Active | `plum` icon and label, label DM Sans SemiBold. On iOS the icon is the filled symbol |
| Inactive | `mauve` icon and label, label DM Sans Medium (the HTML is Regular, Medium reads better at 11) |
| Change | 150ms opacity crossfade between the two colored layers. No moving indicator, no scale, no bounce |

### Dock (`FloatingInputDock`): `06` and `07` agree, `03` is the odd one out

| Part | Build |
| --- | --- |
| Position | 20 from the right edge, its bottom edge 20 above the top of the tab bar. Row, `align-items: flex-end`, gap 8 |
| Pen | 44×44 white (`card`) circle, 1px `petal` border, `shadows.card`, icon 20 in `plum-deep` |
| Mic orb | 56×56 `plum` circle, `shadows.orb`, white icon 26 |
| Pressed | both scale to 0.96 |

Differences: `03` has a 40 pen, a gap of 10, centered alignment and a `#432446` orb. `06` and `07` use `#5B3A5E` for the orb, which is our `plum` token and the DESIGN.md "Floating Action" color.

### Icons (render every one through `Icon`, with both names)

| Use | iOS (SF Symbol) | Android (Material Symbol) |
| --- | --- | --- |
| Journal tab | `book`, active `book.fill` | `menu_book` |
| Prayers tab | `hands.sparkles`, active `hands.sparkles.fill` | `volunteer_activism` |
| Profile tab | `person`, active `person.fill` | `person` |
| Lotus (header) | `leaf` | `spa` |
| Avatar glyph | `person` | `person` |
| Pen | `square.and.pencil` | `edit_note` |
| Mic | `mic.fill` | `mic` |

All of these names exist in the installed typings (`sf-symbols-typescript`, `expo-symbols/build/android/symbols.json`). `hand.heart` does not exist in SF Symbols, which is why Prayers uses `hands.sparkles`. `SymbolView` has no fill option on Android, so there the active icon is the same glyph in `plum`. Tell me if you change a name.

### Space the screens leave for the dock

The HTML pads the last card 112 above the tab bar (`main` has `pb-36` and the inner block `pb-8`, minus the 64 bar). `layout.dockClearance` is 112. The tab bar is rendered **in normal flow** below the scenes (verified in the 7.21 source), so a screen already ends where the bar begins: `useTabScreenBottomPadding()` returns `layout.dockClearance` and never adds the bar's height.

## Decisions (made, do not ask me again)

These settle everything this step would otherwise stop and ask about. If one turns out to be impossible, stop and tell me instead of picking another.

1. **Package approved: `@react-navigation/bottom-tabs`.** Run `npx expo install @react-navigation/bottom-tabs`, then `npx expo install --check` and `npx expo-doctor`. Expo does not pin it, so this installs the registry's latest, 7.21.0, which matches our `@react-navigation/native` 7.5.1 (its peers are `native ^7.5.1`, `react-native-screens >= 4` and `react-native-safe-area-context >= 4`, all installed). Do not install anything else. If `expo-doctor` is not 21/21 afterward, stop and tell me.
2. **The third tab is "Profile" with a person icon.** The "Sanctuary" label and church icon on `06` and `07` are a design inconsistency. AGENTS.md already says so (written when this prompt was reviewed), so only check that the line is there.
3. **The dock is bottom-right and not a centered pill.** AGENTS.md's Navigation Map already says so. Check it, do not rewrite it.
4. **The avatar shows on all three tabs**, because every design shows it. On Journal and Prayers it is a button that opens the Profile tab. On Profile it is a plain, non-pressable circle. (The earlier text hid it on Profile, which the `07` design does not do.)
5. **Colors, tokens win:** active tab `plum` (DESIGN.md reserves the primary `#5B3A5E` for "active navigation tabs"; the earlier text said `plum-deep`), inactive `mauve`, mic orb `plum`, title, avatar and pen icon `plum-deep`, eyebrow `rosewood`, lotus and emblem `plum`. No raw hex in a component: use `colors.*` where a prop needs a color and the Tailwind classes everywhere else.
6. **Skipped on purpose:** haptics (`expo-haptics` is not installed and stays out; I may approve it in a later step), and `expo-navigation-bar` (not installed, and the app is edge-to-edge on Android: the bar's bottom padding paints `linen` behind the system navigation bar). The lotus has no action yet.
7. **Ignore the Stitch artifacts:** the "Feed (Normal) / Offline Sync / Empty State" toggle, the "Preview Mark Answered Sheet" link, and the "Settings / Export View / Delete View" toggle are not built.
8. **Expo Go stays the test target** (my iPhone) together with the Android emulator. This step adds no native module. Keep any dark-mode or `app.json` `userInterfaceStyle` change out of it: only report what you see (see Verify).

## What you do yourself (manual setup)

Nothing here blocks the implementation. Do each item when the report asks for it.

1. **Environment keys: nothing to add.** `.env.local` already has `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`. The four Google values from `.env.example` are not in `.env.local`, which is fine until the Android development build (step 05b). Keep `.env` free of real values.
2. **Restart your own Metro after the install.** When the report says the package is installed, stop your Metro yourself (`Ctrl+C` in its terminal), run `npx expo start -c`, and reload Expo Go on the iPhone. The implementer never stops your Metro on 8081.
3. **Confirm the result on your iPhone in Expo Go.** The implementer cannot run an iPhone, so the report will list checks 1 to 6 below for you:
   1. Sign in (or reopen the app while signed in). You land on the Journal tab with the header on top, the tab bar at the bottom, and the pen and mic bottom-right above it.
   2. Tap Prayers, then Profile, then Journal. The colors fade and the dock stays put. The avatar opens Profile from Journal and Prayers, and on Profile it does nothing.
   3. Tap the pen and the mic. A full-screen "New Entry" placeholder opens with no tab bar and no dock, and its X closes it. Tapping the dock again afterward still works.
   4. On Journal, tap "Open sample reflection". A placeholder opens, and back returns.
   5. On Profile, scroll to the bottom: the last control sits clearly above the dock. Tap the active Profile tab: the page scrolls to the top.
   6. On Profile, use the developer card: "Sign out (dev)" shows Sign In (not Welcome). Sign in again, and "Reset onboarding (dev)" shows Welcome at once.
4. **Later, not now:** tell me what the lotus icon in the header should do, and whether I should approve `expo-haptics` for a light tap on tab changes and on the mic.

## Before writing code

1. Read-only checks: `package.json` has no `@react-navigation/bottom-tabs`, `.env.local` has the Clerk key (the app does not launch without it), and the only references to `Home` and `HomePlaceholderScreen` are in `RootNavigator.tsx` and the placeholder file itself.
2. Install the package (decision 1).
3. Start your own Metro on 8082 (`npx expo start --port 8082 -c`, never 8081, which is mine) and open the app in Expo Go on the emulator as AGENTS.md "Verifying on this machine" describes.

## 1. Navigation (`src/navigation/`)

Replace `src/navigation/types.ts`:

```ts
import type { BottomTabScreenProps } from "@react-navigation/bottom-tabs";
import type { CompositeScreenProps, NavigatorScreenParams } from "@react-navigation/native";
import type { NativeStackScreenProps } from "@react-navigation/native-stack";

export type MainTabParamList = {
  Journal: undefined;
  Prayers: undefined;
  Profile: undefined;
};

export type RootStackParamList = {
  Onboarding: undefined;
  SignIn: undefined;
  MainTabs: NavigatorScreenParams<MainTabParamList>;
  NewEntry: { mode: "speak" | "write" };
  Reflection: { entryId: string };
  Paywall: { source: "profile" | "limit" };
};

export type RootStackScreenProps<T extends keyof RootStackParamList> = NativeStackScreenProps<
  RootStackParamList,
  T
>;

export type MainTabScreenProps<T extends keyof MainTabParamList> = CompositeScreenProps<
  BottomTabScreenProps<MainTabParamList, T>,
  RootStackScreenProps<keyof RootStackParamList>
>;
```

The `Home` route is gone. No `any`, and no untyped `useNavigation()`: always pass the type, for example `useNavigation<MainTabScreenProps<"Journal">["navigation"]>()`. Do not add a global `ReactNavigation.RootParamList` augmentation.

- Create `src/navigation/MainTabs.tsx`: `createBottomTabNavigator<MainTabParamList>()` with `initialRouteName="Journal"`, `tabBar={(props) => <GracehushTabBar {...props} />}` and `screenOptions={{ headerShown: false, lazy: true, sceneStyle: { backgroundColor: colors.linen } }}`. The v7 option is `sceneStyle` (the old `sceneContainerStyle` is gone). Leave the other tab options at their defaults (no tab animation, default back behavior).
- In `RootNavigator`, the signed-in group becomes `MainTabs` (first, so it is the initial route), `NewEntry` (`presentation: "fullScreenModal"`), `Reflection` (default push) and `Paywall` (`presentation: "modal"`). The signed-out branch stays exactly as it is: the returning-user effect, the three-line branch table, and the `navigationKey` on `SignIn` from step 07.
- Delete `src/screens/HomePlaceholderScreen.tsx` and its route and import.
- Temporary placeholder screens, each marked `// TEMP: replaced in step NN` (their text may stay inline for that reason):
  - `src/screens/journal/NewEntryScreen.tsx` (step 10): "New Entry ({mode}) — built in step 10" and a 44×44 close (X) button that calls `goBack()`.
  - `src/screens/journal/ReflectionScreen.tsx` (step 11): "Reflection {entryId} — built in step 11" and a back chevron.
  - `src/screens/paywall/PaywallScreen.tsx` (step 16): "Paywall ({source}) — built in step 16" and a close (X) button.
  - These are stack screens above the tabs, so the tab bar and the dock are hidden on them automatically. Do not add manual hide logic.

## 2. Tab bar (`src/components/GracehushTabBar.tsx`)

Match the "Tab bar" table above. Props are `BottomTabBarProps` from `@react-navigation/bottom-tabs`. Use its `insets.bottom`, not a second `useSafeAreaInsets()`.

- The bar's root `View` has the linen background, the top border and `paddingBottom: insets.bottom`. It must **not** set `overflow: "hidden"`, because the dock extends above it.
- The row of tabs has `accessibilityRole="tablist"`. The dock is a sibling of that row, not inside it (the pen and mic are not tabs).
- Each item is a `Pressable` following the AGENTS.md pattern (the `style` function for the pressed state, classes on an inner `View`). Keep one small local `TabItem` component in this file. It stacks two layers in the same box so nothing shifts: the inactive layer (`mauve`, Medium) and the active layer (`plum`, SemiBold, filled symbol on iOS). An `Animated.Value` per item drives the active layer's opacity with `Animated.timing` (150ms, `useNativeDriver: true`) when `focused` changes. Hide both layers from accessibility, so the `Pressable` is the only element.
- Implement React Navigation's custom tab bar contract exactly like the default bar (read from the 7.21 source):

```tsx
const onPress = () => {
  const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
  if (!focused && !event.defaultPrevented) {
    navigation.dispatch({ ...CommonActions.navigate(route.name, route.params), target: state.key });
  }
};
const onLongPress = () => navigation.emit({ type: "tabLongPress", target: route.key });
```

  `CommonActions` comes from `@react-navigation/native`. This keeps `useScrollToTop` working on the screens.
- Accessibility: each item has `accessibilityRole="tab"` and `accessibilityState={{ selected: focused }}`. The label is the tab name on Android (TalkBack announces the role). On iOS under the New Architecture, React Native maps the `tab` role to no trait and speaks no role, so the label must say it: `copy.tabs.a11yLabel(name, position, total)`, for example "Journal, tab, 1 of 3", used on iOS only (as the default bar does). A single "Journal tab" label would be read twice on Android and not at all as a tab on iOS.
- Do not use `useBottomTabBarHeight()` anywhere: a custom bar would have to report its own height through `BottomTabBarHeightCallbackContext`, and nothing needs it.

## 3. Floating input dock (`src/components/FloatingInputDock.tsx`)

Render it **once**, as the last child of the tab bar's root view, so it stays mounted across tab switches. Position it with `position: "absolute"`, `right: layout.screenPadding` (20), `bottom: "100%"` and `marginBottom: layout.dockOffset` (20), so it follows the bar's real height and inset without any height constant (percentage offsets are valid in React Native's `DimensionValue` type). If a platform does not resolve the percentage, measure the bar with `onLayout` instead and tell me. The wrapper has `pointerEvents="box-none"`, so the empty area stays tappable.

- The pen and the mic follow the "Dock" table. Labels come from `copy.dock`: "Write a reflection" and "Speak a reflection". The pen opens `NewEntry` with `{ mode: "write" }` and the mic with `{ mode: "speak" }`.
- Navigate with `useNavigation<RootStackScreenProps<"MainTabs">["navigation"]>()` (inside the tab bar, the navigation object is the `MainTabs` route's).
- The pressed scale 0.96 goes in a `StyleSheet` style function on the `Pressable` (AGENTS.md pattern).
- Double-tap guard: a `useRef` flag blocks a second open while the first is in flight, and **it must reset**, or the dock stops working after the first use:

```tsx
const isFocused = useIsFocused();
const opening = useRef(false);
useEffect(() => {
  if (isFocused) opening.current = false;
}, [isFocused]);
function open(mode: "speak" | "write") {
  if (opening.current) return;
  opening.current = true;
  navigation.navigate("NewEntry", { mode });
}
```

- The dock sits outside the tab bar's own bounds. React Native 0.86 hit-tests such children on both platforms (on Android through the parent's `overflowInset`, which I read in `TouchTargetHelper`), but prove it: on the emulator, tap the pen and the mic. If a tap does nothing, look for an `overflow: "hidden"` on the bar or a parent, fix it, and tell me. Do not move the dock somewhere else without telling me.
- Add the numbers to `layout` in `src/constants/theme.ts` (next to `micOrb`): `tabBarHeight: 64`, `dockOffset: 20`, `dockPen: 44`, `dockOrb: 56`, `dockClearance: 112`. Create `src/hooks/useTabScreenBottomPadding.ts`, which returns `layout.dockClearance`. It stays a hook so that one place changes if a later step adds a persistent mini player above the bar. Tab screens use it for their scroll bottom padding, and no screen hardcodes a bar or dock height.

## 4. Shared tab header (`src/components/ScreenHeader.tsx`)

Match the "Header" table above. Props: `{ title: string; avatar?: "link" | "static" }`, with `avatar` defaulting to `"link"`. Profile passes `"static"`.

- The header does **not** apply the top inset. Each tab screen wraps it in a `SafeAreaView` from `react-native-safe-area-context` with `edges={["top"]}` and `style={{ flex: 1, backgroundColor: colors.linen }}` (an inline style, per the AGENTS.md exception table), and the header sits above the `ScrollView`, not inside it. Steps 09, 14 and 15 already assume this layout.
- Lotus: `accessible={false}` and `importantForAccessibility="no-hide-descendants"` on its wrapper, not pressable, with the comment `// TODO: lotus action undefined — confirm with product`.
- Avatar button (`"link"`): label `copy.header.openProfile` ("Open profile"), `hitSlop={6}` so the touch area is 44 around the 32 circle, navigates with `useNavigation<MainTabScreenProps<"Journal">["navigation"]>().navigate("Profile")`. With `"static"` it is a plain `View` with no role.
- The status bar already shows dark content on linen from `App.tsx`. Do not add per-screen status bar code.

## 5. Placeholder tab screens

Each is marked `// TEMP: replaced in step NN`, wraps its content as described in section 4, and puts the content in a `ScrollView` with `contentContainerStyle={{ paddingBottom: useTabScreenBottomPadding() }}` and `useScrollToTop(ref)`:

- `src/screens/journal/JournalFeedScreen.tsx` (step 09): `ScreenHeader` "Journal" and the centered text "Journal feed — built in step 09". In `__DEV__` only, a button "Open sample reflection": it reads `listEntries()` from `journalRepository`, takes the first entry that is `ready` and not a crisis, and navigates to `Reflection` with its id. If there is none (the `empty` scenario), the button does nothing.
- `src/screens/prayers/PrayersScreen.tsx` (step 14): `ScreenHeader` "Prayers" and "Prayers — built in step 14".
- `src/screens/profile/ProfileScreen.tsx` (step 15): `ScreenHeader` "Profile" with `avatar="static"`, "Profile — built in step 15", then `DevToolsPanel`.

## 6. Dev tools panel (`src/components/dev/DevToolsPanel.tsx`)

Move every temporary dev control from the deleted Home placeholder into this panel, **with the same behavior**. It renders only when `__DEV__` and stays permanently in development builds (step 15 keeps it at the bottom of Profile; steps 09, 10, 17, 19, 23, 24, 25, 28 and 33 add controls to it, so keep it a simple vertical stack of sections). Its strings stay inline: it is never shown to users (AGENTS.md "Copy & Tone Rules").

- The signed-in email (body-sm, mauve)
- The step 06 data summary (the `loadDataCheck` function moves over unchanged)
- The scenario buttons `default` / `empty` / `offline` (still `setMockScenario`; step 09 moves them to a store)
- "Reset onboarding (dev)" with its helper text. Keep the order from step 07: `await signOut()` first, then `resetOnboarding()`, then `useOnboardingStore.persist.clearStorage()`. The AGENTS.md Navigation Map explains why.
- "Sign out (dev)": Clerk `signOut()` only. Keep `// TODO(31): full sign-out cleanup`
- "Open paywall (dev)": navigates to `Paywall` with `{ source: "profile" }`, typed with `useNavigation<MainTabScreenProps<"Profile">["navigation"]>()`

Style it as a `.card` with the eyebrow "Developer", visually separate from real UI.

## 7. Strings (`src/constants/copy.ts`)

Add `copy.tabs` (`journal`, `prayers`, `profile`, and `a11yLabel(name, position, total)`), `copy.header` (`eyebrow`: "Gracehush", `openProfile`: "Open profile") and `copy.dock` (`write`, `speak`). Eyebrows are stored in sentence case, and the `uppercase` style does the casing. No user-facing string is written inline except the `// TEMP` placeholders.

## Rules

- Do not build Journal, Prayers, or Profile content, the greeting, cards, or any real data screens.
- Do not change the Onboarding, Sign In, or auth logic, or the signed-out branch of `RootNavigator`.
- No emojis. Crisis Red belongs only to recording, crisis and destructive actions: the mic orb here is plum.
- No library other than `@react-navigation/bottom-tabs`. No `any`. No raw hex in a component.
- Run your own Metro on 8082 and never stop mine on 8081.

## Verify

```bash
npm run lint
npm run typecheck
npx expo install --check
npx expo-doctor
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes. Then check on the Android emulator in Expo Go (AGENTS.md "Verifying on this machine"; sign in with an address like `yourname+clerk_test@example.com` and the code `424242`):

1. **Signing in lands on the Journal tab.** The header, tab bar and dock match the designs. Measure with `uiautomator dump` bounds (pixels ÷ 2.625 at 420dpi) and report the dp values: header row 64, tab bar 64 plus the inset, dock right margin 20, dock bottom edge 20 above the bar, orb 56, pen 44, avatar 32.
2. **Switching tabs** crossfades the colors, the selected state moves (`selected="true"` in the dump), and the dock neither flickers nor changes bounds. The avatar opens Profile from Journal and Prayers, and does nothing on Profile.
3. **The pen and the mic open `NewEntry`** full-screen (write and speak), with no tab bar and no dock, and X closes it. Tap the pen twice quickly: only one `NewEntry` opens and one X returns. After closing, the dock works again. Tap the pen then the mic quickly: the mode does not change.
4. **"Open sample reflection"** pushes `Reflection` with an id, and back returns to Journal. With the `empty` scenario the button does nothing.
5. **Scrolling:** on Profile, scroll to the end: the last control ends at least 36 above the dock. Scroll down, then tap the active Profile tab: the page returns to the top. Hardware back from Prayers returns to Journal.
6. **The dev panel works:** the scenario switch, "Open paywall (dev)" (X closes it), "Sign out (dev)" shows Sign In and not Welcome, and after signing in again "Reset onboarding (dev)" shows Welcome at once.
7. **Accessibility:** the dump shows each tab as a selectable tab item with its name, the dock buttons with their labels, and nothing for the lotus. TalkBack and VoiceOver themselves are not run here, so say so.
8. **Small and large:** at 320dp wide and at font scale 1.3 (AGENTS.md recipes), the header does not clip or wrap, the three tab labels fit, and the dock does not overlap the tab bar.
9. **Android navigation modes and dark mode (report only, change nothing):** switch the emulator to 3-button navigation with `adb shell cmd overlay enable-exclusive --category com.android.internal.systemui.navbar.threebutton` (back to gestures with `...navbar.gestural`). Confirm it with a screenshot, because the `navigation_mode` setting does not update on this emulator image. Then run `adb shell cmd uimode night yes` (and `night no` afterward). In each case the tab bar must clear the system bar, the dock must still be tappable, and the system buttons and status icons must stay readable over linen. Tell me what you see. Do not change `userInterfaceStyle` or install anything for it.
10. **Release build (only if the Android development build from step 05b exists):** `npx expo run:android --variant release --port 8082` with the JDK 17 from 05b: the dev panel is not rendered. If 05b has not been done, say it was not run. The iPhone is not checked here: I confirm it in Expo Go (manual setup item 3), and the iPhone development build waits for the last step (AGENTS.md "Instructional Memory").

Fix every error before finishing. Then ask me to confirm checks 1 to 6 of manual setup item 3 on my iPhone, and remind me of manual setup items 2 and 4. Say plainly what was not verified: the iPhone until I confirm, TalkBack and VoiceOver, and the release build if 05b is not done.

Report: each file created or changed, the exact icon names used on each platform, the dp values from check 1, every difference between the three designs and what you built, the AGENTS.md lines you updated, and confirmation that nothing else was installed.

## AGENTS.md updates

Four changes were already written when this prompt was reviewed, so only check that they are there (do not write them again): the resolved third-tab line ("Third tab is labeled Profile (resolved in step 08)"), the "bottom-right" dock line in the Navigation Map, the `@react-navigation/bottom-tabs` bullet in "SDK and Vendor Version Notes", and the dev-only exemption in "Copy & Tone Rules". In this step, record the decisions and the new state, replacing the text they supersede:

- Tech Stack: replace "Not installed yet: `@react-navigation/bottom-tabs` (step 08 asks first)" with "Installed in step 08:" and the exact installed version. Decision Making & Clarifications, "Approved so far": add `@react-navigation/bottom-tabs`.
- Architecture tree: add `navigation/MainTabs.tsx`, `components/GracehushTabBar.tsx`, `FloatingInputDock.tsx`, `ScreenHeader.tsx`, `components/dev/DevToolsPanel.tsx`, `hooks/useTabScreenBottomPadding.ts`, and the screens under `journal/`, `prayers/`, `profile/` and `paywall/`. Remove the `HomePlaceholderScreen.tsx` line, and update the `constants/` line (`layout` gained the tab bar and dock numbers) and the "Built so far" component list.
- Navigation Map, "Current state": replace the step 07 paragraph with the step 08 one: the signed-in group is `MainTabs` (initial), `NewEntry` (full-screen modal), `Reflection` and `Paywall` (modal). Replace the `Home` branch in the three-line table. Replace the `Home` bullet (the dev controls now live in the `DevToolsPanel` at the bottom of the Profile placeholder, and "Reset onboarding (dev)" keeps its order and helper text). Keep every other bullet, including the `navigationKey` one.
- State Management Rules, "Data layer (step 06)": the TEMP data check and `setMockScenario` now live in `DevToolsPanel`, not on `HomePlaceholderScreen`.
- Verifying on this machine: add the two recipes from check 9 (3-button navigation with `enable-exclusive`, and `cmd uimode night yes|no`), and the note that `navigation_mode` does not update on this image.
- Build Status & Decisions Log: a Step 08 entry with the decisions above, the installed version, the files, the measured dp values, every difference between the designs, what was verified and what was not, and any open items (the lotus action and haptics).

Then copy the file with `cp AGENTS.md prompts/AGENTS.md` and confirm with `cmp`.
