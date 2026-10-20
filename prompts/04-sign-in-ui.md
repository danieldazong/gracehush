# 04-sign-in-ui.md

Read AGENTS.md first and follow it strictly.

Implement the Sign In screen exactly as shown in the attached design, plus a mocked "Continue with email" flow (email sheet → 6-digit verification code). Use the tokens, `theme.ts`, `global.css` utilities, `Icon`, and `PrimaryButton` from steps 02–03. This step is UI and mock behavior only. Real Clerk comes in step 05.

`C:\Users\PC\Desktop\gracehush\Images\2._sign_in_sign_up.png`

The Stitch HTML for this screen (`prompt_material/02-sign-in.html`) is the source for exact sizes (1 CSS px = 1dp). The PNG is rendered at 1.25x (a 390dp screen is 487px wide), so never measure dp from it. The sizes and spacing below are already the HTML's. Where the HTML differs from a token (colors, radii, type styles, the screen margin), keep the token and tell me. Ignore two things in the HTML: the inline email field revealed by its `toggleEmailInput()` script (the email flow below replaces it) and the "By continuing you agree…" footer (the screenshot has none).

## Product decisions (follow these, do not ask)

- **One screen for new and returning users.** Do not build a separate Sign Up screen. "Continue with Apple / Google / email" covers both. In step 05, Clerk's sign-in-or-up flow (`signUpIfMissing`) covers both.
- **Passwordless email.** The email flow uses a one-time 6-digit code. Never add a password field.
- **Sign in with Apple stays first and visually equal or more prominent than Google.** This follows App Store Guideline 4.8 and Apple's button guidelines: black background, white Apple logo, title "Continue with Apple". Render it on both iOS and Android in this step. Step 05 decides the Android behavior.
- **Google branding:** use the official multicolor "G" logo, not a monochrome icon.
- **No Terms or Privacy text on this screen.** Those links belong on the Paywall (step 16).

## Before writing code

- Replace the `// TEMP: replaced in 04` placeholder in `src/screens/auth/SignInScreen.tsx`.
- **The logos are image assets, not icons.** `assets/images/` has no Google G or Apple logo, `react-native-svg` is not installed, and SF Symbols / Material Symbols have no multicolor G (or, on Android, an Apple logo). Create `assets/images/google-g.svg` and `assets/images/apple-logo.svg` from the two inline `<svg>` blocks inside the Apple and Google buttons in `prompt_material/02-sign-in.html`, as standalone files with `xmlns` and `viewBox="0 0 24 24"` (the HTML spells the attribute in lowercase, which an `.svg` file does not recognize). Keep the G's four fills (#4285F4, #34A853, #FBBC05, #EA4335) and fill the Apple path white. Export both from `src/constants/images.ts` as `googleG` and `appleLogo`, and render them with `Image` from `expo-image`, the way `logoMark` is rendered (size with `style`, never `className`). Do not install `react-native-svg`. Never substitute a single-color Google icon.
- **Every other icon goes through `Icon`** (`src/components/Icon.tsx`) with both names (android / ios): back chevron `chevron_left` / `chevron.left`, mail `mail` / `envelope`, lock `lock` / `lock`. Do not install an icon library.
- Use only React Native `Modal`, `KeyboardAvoidingView`, `TextInput`, and `Animated`. Do not install a bottom-sheet or OTP library. If you think one is needed, ask me first.

## Navigation

- Add `Home` to `RootNavigator` and to `RootStackParamList`. `SignIn` already exists and becomes the real screen. Type its props with `NativeStackScreenProps<RootStackParamList, "SignIn">`.
- `Home` is a temporary placeholder in `src/screens/HomePlaceholderScreen.tsx` showing centered text "Journal — built in step 08" and a ghost button (`.btn-ghost`) "Back to sign in (dev)" that resets to `SignIn`. Mark both `// TEMP: replaced in 08`.
- After any successful mocked sign-in, call `navigation.reset({ index: 0, routes: [{ name: 'Home' }] })` so back cannot return to auth. Do it in one place: a `goHome()` in `SignInScreen`, which the email sheet reaches through its `onSignedIn` prop after the sheet has closed. Step 05 deletes it in one edit.
- The back chevron calls `navigation.goBack()` and renders only when `navigation.canGoBack()` is true. When the chevron is hidden, keep an empty 44×44 spacer so "Step 1 of 1" stays centered.

## Mock auth service (swappable in step 05)

Create `src/types/index.ts` with the types below (step 06 adds to this file):

```ts
export type AuthErrorCode = 'INVALID_EMAIL' | 'INVALID_CODE' | 'CANCELLED' | 'NETWORK' | 'UNKNOWN';
export type AuthResult = { ok: true } | { ok: false; code: AuthErrorCode; message: string };
```

Create `src/services/auth.ts` exporting these functions as a mock marked `// TEMP(05): replace internals with Clerk, keep signatures`:

```ts
continueWithApple(): Promise<AuthResult>
continueWithGoogle(): Promise<AuthResult>
sendEmailCode(email: string): Promise<AuthResult>
verifyEmailCode(code: string): Promise<AuthResult>
resendEmailCode(): Promise<AuthResult>
```

Mock behavior (about 800ms delay each):

- Apple and Google always succeed.
- `sendEmailCode` fails with `INVALID_EMAIL` if the email does not match a simple email regex, otherwise it succeeds.
- `verifyEmailCode` fails with `INVALID_CODE` for `000000`, otherwise it succeeds. This lets us test the error state.
- `resendEmailCode` always succeeds.
- Every failure carries a ready-to-show `message` taken from `copy.auth.errors`. Screens render `result.message` and never build error text themselves.

Screens call only these functions, never mock logic inline.

## Screen layout (HTML sizes, tokens for color, type, and padding)

`SafeAreaView` (inline style, linen) with the content in a `ScrollView` (24 of bottom padding). Use `.screen__content` for the horizontal padding (20, or 16 below 360 wide). The HTML uses 24, which is not a token, so keep the token and tell me. Everything is centered.

1. **Header row** (56 tall): the back button on the left (`Icon` chevron, ink, 24, a 44×44 touch area, accessibility label "Go back") and "Step 1 of 1" centered between it and an empty 44×44 spacer on the right (`text-label-md`, mauve, `tracking-[0.3px]`).
2. **Icon tile**, 8 below the header: `.icon-tile` at 64×64 (`size-16`) plus `border border-petal/60` and `style={shadows.card}`, holding `images.logoMark` at 32×32 with `tintColor` rosewood. If `tintColor` does not recolor the SVG on a platform, add a rosewood copy of the mark as its own asset and tell me.
3. **Title** "Your sanctuary is waiting.", 20 below the tile: `text-title` (the HTML's 26/34 is not a token), ink, with `tracking-[-0.7px]` (the HTML's `tracking-tight`). Measured from the font, it is about 353 wide without the tracking against 350 available at 390, so it can wrap there. With the tracking it is about 334 and fits on one line at 390. It may wrap on narrower phones, which is fine for a centered title.
4. **Subtitle**, 8 below the title: `text-body`, mauve, `max-w-[290px]`.
5. **Buttons**, 32 below the subtitle, full width, 12 gap. Each is `.btn-ghost` (48 tall, full pill, Petal border, white) with `.btn-ghost__label`, the icon first, and a 12 gap between icon and label:
   - "Continue with Apple": `bg-black border-black` and a `text-white` label, with `appleLogo` at 16×16.
   - "Continue with Google": `.btn-ghost` as is, with `googleG` at 16×16.
6. **Divider**, 16 above and below: a row with a `.divider` line (`flex-1`) on each side of "or" (`text-body-sm`, mauve, 12 gap).
7. **"Continue with email"**: same as the Google button, with the mail `Icon` (rosewood, 19, 10 gap).
8. **Privacy card**, 24 below the email button: `PrivacyNoteCard` with the title and body below.

`PrivacyNoteCard` is `.card card--blush` (16 radius, Petal border, 16 padding) laid out as a row aligned to the top with a 14 gap:

- A 28×28 white circle with a Petal border (`size-7 rounded-full border border-petal bg-card`, 2 below the top) holding a rosewood lock `Icon` (15).
- The title "Your entries are private" (`text-label-lg`, ink) over the body "AI helps write and organize your reflections; you can export or permanently delete everything at any time." (`text-body-sm`, mauve, 2 below the title).

## Button states

- Track `pending: 'apple' | 'google' | null` in local state. The email button opens the sheet immediately, so it never shows a spinner.
- While an action is pending, **disable all three buttons** to prevent double sign-in. In the pending button, show an `ActivityIndicator` in place of the logo (white on Apple, `colors.plum` on Google) and keep the label.
- Pressed state for every button: scale 0.98 with opacity 0.9. Give the `Pressable` only a `style` function (`StyleSheet`) and put the classes on an inner `View`, as `PrimaryButton` does, because NativeWind cannot merge a `className` with a style function.
- If Apple or Google returns `CANCELLED`, reset silently. For other errors, show `result.message` under the email button (`text-body-sm`, rosewood, centered, 12 above). Do not use crisis red for auth errors.

## Email flow (no mockup, follow the screen's visual language)

Create `src/components/BottomSheet.tsx` (listed in AGENTS.md and reused later by Mark Answered, Filter, and others). Match the Mark Answered sheet in `prompt_material/06-prayers.html`: it wraps RN `Modal` (`transparent`, `animationType="slide"`, inline styles), with an ink backdrop at 40% opacity that closes on tap (accessibility label "Close"). The sheet is **blush** (sheets are blush in the Design System table), with top radius `radii.sheet` (24), a 1px Petal top border, `shadows.sheet`, a centered 48×6 Petal drag handle, padding 24, and the bottom safe-area inset (`SafeAreaView edges={["bottom"]}` inside the Modal, as the onboarding time sheet does). Wrap the content in `KeyboardAvoidingView` so the sheet always sits above the keyboard: `padding` on iOS, and on Android whichever of `height` or `padding` works on the emulator (Android is edge-to-edge). Content taller than the space left (small phones with the keyboard open) must scroll: put the children in a `ScrollView` with `keyboardShouldPersistTaps="handled"` and keep the handle outside it. Props: `visible`, `onClose`, `children`. Android back closes it.

Put the sheet content in `src/screens/auth/EmailSheet.tsx` (props `visible`, `onClose`, `onSignedIn`) so `SignInScreen.tsx` stays short. It has two steps, kept in local state:

**Step A: Email**

- Title "Continue with email" (`text-headline`, the nearest scale token to a 22 Fraunces title, ink), body "We'll send a 6-digit code. No password needed." (`text-body`, mauve).
- Email input (`.input`): placeholder "you@example.com", `keyboardType="email-address"`, `autoCapitalize="none"`, `autoCorrect={false}`, `autoComplete="email"`, `textContentType="emailAddress"`, autofocus, `returnKeyType="send"` (submits). Trim the value before sending.
- `PrimaryButton` "Send code" is disabled until the email looks valid and shows loading while sending. On `INVALID_EMAIL`, show rosewood helper text under the input.
- On success, go to Step B.

**Step B: Verification code**

- Title "Check your inbox", body "Enter the 6-digit code we sent to {email}." with the email in ink `font-dm-medium`.
- Six boxes in a centered row, gap 8: each `flex-1` up to 48 wide and 56 tall (fixed 48s would overflow below about 376 wide), radius 12 (`rounded-input`), white, 1px Petal border, digit in DM Sans SemiBold 22 ink with `tabular-nums`. The active box has a 1.5px plum border.
- Use **one hidden `TextInput`** behind the boxes: `keyboardType="number-pad"`, `textContentType="oneTimeCode"` (iOS autofill), `autoComplete="one-time-code"` (Android), autofocus. Do not set `maxLength`: strip non-digits first, then keep the first 6, so pasting "123 456" works. The whole box row is one touch target (56 tall) that focuses the input.
- **Auto-submit when the 6th digit is entered.** Show a small plum `ActivityIndicator` and "Verifying…" (`text-body-sm`, mauve) while verifying, and lock input.
- On `INVALID_CODE`: box borders turn rosewood, show "That code didn't work. Please try again." in rosewood, clear the code, and refocus.
- On success: close the sheet, then call `onSignedIn`.
- Below the boxes: "Resend code" text link (rosewood `text-label-md`) with a 30-second cooldown showing "Resend in 0:24" in mauve. Then "Use a different email" (mauve `text-label-md`), which returns to Step A with the email kept. Both are at least 44 tall.
- Closing the sheet at any point resets it to Step A and clears the code. Clean up the cooldown timer on unmount.

## Components

- `BottomSheet` and `EmailSheet`: create as above.
- `PrivacyNoteCard` (listed in AGENTS.md): create it with props `title?` and `body`, as above, in `src/components/PrivacyNoteCard.tsx`. Leave onboarding step 3's inline privacy note alone. It is a different, compact banner.
- In `OnboardingScreen.tsx`, change only the time sheet's `backgroundColor` from `colors.card` to `colors.blush`, so every sheet matches. Do not move that sheet onto `BottomSheet`: the picker is verified on the iPhone.
- Keep the three auth buttons inside `SignInScreen.tsx` as one local, non-exported component. Keep the code boxes inside `EmailSheet.tsx`.

## Copy

Add all strings to `src/constants/copy.ts` under `auth`: screen text, sheet text, accessibility labels (as functions where they take values), and `errors` with camelCase keys (`invalidEmail`, `invalidCode`, `network`, `unknown`), because step 05 adds `rateLimited`, `extraVerification`, and others next to them. The `Home` placeholder text is the only inline text (`// TEMP`). No emojis.

## Accessibility

- Buttons use `accessibilityRole="button"` with labels like "Continue with Apple". Pending buttons set `accessibilityState={{ busy: true, disabled: true }}`. The logos are decorative, so hide them from screen readers.
- The code input has the accessibility label "Verification code, 6 digits". Error messages use `accessibilityLiveRegion="polite"` (Android) and are announced on iOS via `AccessibilityInfo.announceForAccessibility`.
- Every touch target is at least 44pt.

## Rules

- Do not install or configure Clerk, and do not add auth guards or persistence. That is step 05.
- Do not add a password field, a separate Sign Up screen, Facebook, or terms text that isn't in the design.
- Do not change design tokens. If the screenshot or HTML differs from a token, keep the token and tell me.
- The only change to `OnboardingScreen.tsx` is the time sheet's background color.
- No stock photos and no emojis.

## Verify

```bash
npx expo start -c
npm run lint
npm run typecheck
npx expo export --platform android --platform ios --output-dir <a temp folder outside the repo>
```

Check the real exit codes (AGENTS.md, "Linting and Validation"). The export proves Metro resolves the new SVG assets. Then verify as AGENTS.md "Verifying on this machine" describes: the Android emulator with Expo Go 57 at about 320dp, 390dp (the design's width), and 430dp wide, and at font scale 1.3. If the on-screen keyboard does not appear on the emulator, run `adb shell settings put secure show_ime_with_hard_keyboard 1`. iOS cannot run here, so say plainly what you could not check and give me the iPhone checks.

1. Onboarding "I already have an account" and the step 3 buttons open Sign In. The screen matches the screenshot (sizes from the HTML), and the back chevron returns to onboarding.
2. Apple and Google show a spinner, all buttons are disabled meanwhile, and then the app lands on the Home placeholder. Back does not return to Sign In.
3. Email: an invalid address keeps "Send code" disabled or shows the helper text. A valid one goes to the code step with the keyboard up and the sheet fully visible above it. At 320 wide and on short screens the sheet content scrolls instead of being cut off.
4. Typing or pasting 6 digits (also "123 456") auto-submits. `000000` shows the error and clears the boxes. Any other code lands on Home.
5. The resend cooldown counts down. "Use a different email" keeps the email. Closing and reopening the sheet starts fresh. All six boxes fit at 320 wide.
6. Android: the official Google G and the Apple logo render, and nothing is clipped at font scale 1.3. On my iPhone: the one-time-code suggestion appears above the keyboard when a code is available, and the Rhythm time sheet (now blush) still updates its chip.

Fix every error before finishing. When done, list each file created or changed, the logo sources used, any temporary stand-ins, any screenshot or HTML values that differed from the tokens, and what you could not verify on the iPhone.

## AGENTS.md updates

Record these in AGENTS.md, replacing the text they supersede, then copy the file to `prompts/AGENTS.md` (see "AGENTS.md updates" in `prompts/TEMPLATE.md`):

- Architecture tree and Navigation Map ("Current state"): `SignIn` is now the real screen, `Home` is a TEMP placeholder route until step 08, and `BottomSheet`, `PrivacyNoteCard`, `images.googleG`, `images.appleLogo`, `src/services/auth.ts` (TEMP mock until step 05), and `src/types/index.ts` now exist.
- Build Status & Decisions Log: a Step 04 entry with the decisions above, the token differences you reported (for example the 24 → 20 margin, the title size and tracking, the label weight, the handle color), and any open items.
