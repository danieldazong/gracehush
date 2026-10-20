# 13-crisis-support-state.md

Read AGENTS.md first and follow it strictly.

Build the Crisis Support state on the Reflection screen and a dedicated
Support Resources screen for Gracehush. This replaces the temporary
crisis view from step 11 (marked // TEMP(13)). This step is UI and
device actions only (phone, text, web links). Real crisis screening on
the server comes in step 21. Use the existing crisis mock entry from
step 06 and devStore.nextSubmitOutcome = 'crisis' from step 10 to test.

There is no dedicated mockup. Treat this as the crisis variant of
@prompt_material/05-reflection.png. Use only the tokens in
src/constants/theme.ts, the utilities in global.css, and the existing
components (PrimaryButton, ScreenHeader patterns, ConfirmDialog). Do not
add new colors, fonts, radii or shadows. Crisis red (#B4443A, token
`crisis`) is allowed on this screen and only for the primary "Talk to
someone now" action and the emergency row. Everything else stays calm:
linen, blush, plum, ink, mauve.

---

## 1. Before writing code

1. Read src/screens/ReflectionScreen.tsx (find the // TEMP(13) crisis
   view), src/hooks/useReflection.ts, src/navigation/types.ts,
   src/navigation/RootNavigator.tsx, src/constants/copy.ts,
   src/types/index.ts and the crisis entry in src/data/mock/.
2. Confirm that crisis entries have scripture, devotional, prayer = null
   and no affirmations (step 06 rule). If the mock breaks this rule, fix
   the mock, not the screen.
3. Check package.json for expo-web-browser and expo-clipboard. Do not
   install either one. If expo-web-browser is missing, open web links
   with Linking.openURL. If expo-clipboard is missing, stop and ask
   before adding it (it's needed for the "Copy number" fallback).
4. Confirm the icon library from step 02 has: phone, message-circle,
   globe/external-link, alert-triangle (or shield), heart, x/close,
   copy. Do not install another icon set.

---

## 2. Resources data: src/constants/crisisResources.ts

Add these types to src/types/index.ts:

type CrisisActionKind = 'call' | 'text' | 'web';
type CrisisAction = {
kind: CrisisActionKind;
label: string; // button text
value: string; // number or URL
body?: string; // SMS prefill, text only
accessibilityLabel: string;
};
type CrisisResource = {
id: string;
name: string;
description: string;
availability: string; // e.g. "24/7, free"
region: 'US' | 'INTL';
actions: CrisisAction[];
};

Export from crisisResources.ts:

export const CRISIS_RESOURCES_LAST_VERIFIED = '2026-10-16';
// Re-verify every number and URL before each App Store / Play release.

export const EMERGENCY_NUMBER = '911';

export const CRISIS_RESOURCES: CrisisResource[] = [
{
id: 'lifeline-988',
name: '988 Suicide & Crisis Lifeline',
description: 'Talk or text with a trained crisis counselor.',
availability: '24/7, free',
region: 'US',
actions: [
{ kind: 'call', label: 'Call 988', value: '988',
accessibilityLabel: 'Call the 988 Suicide and Crisis Lifeline' },
{ kind: 'text', label: 'Text 988', value: '988',
accessibilityLabel: 'Text the 988 Suicide and Crisis Lifeline' },
{ kind: 'web', label: 'Chat online',
value: 'https://988lifeline.org/chat/',
accessibilityLabel: 'Open 988 Lifeline online chat' },
],
},
{
id: 'crisis-text-line',
name: 'Crisis Text Line',
description: 'Text with a trained volunteer crisis counselor.',
availability: '24/7, free',
region: 'US',
actions: [
{ kind: 'text', label: 'Text HOME to 741741', value: '741741',
body: 'HOME',
accessibilityLabel: 'Text HOME to 741741, Crisis Text Line' },
],
},
{
id: 'find-a-helpline',
name: 'Outside the United States',
description: 'Find a free, confidential helpline in your country.',
availability: 'Worldwide directory',
region: 'INTL',
actions: [
{ kind: 'web', label: 'Find a helpline',
value: 'https://findahelpline.com',
accessibilityLabel: 'Open Find a Helpline directory' },
],
},
];

Rules:

- Screens read only from this file. Never hardcode a number in a
  component or in copy.ts.
- Do not add other hotlines, religious counseling lines or
  church-finder links without asking.
- The word "confidential" appears only in the description that the
  directory itself uses. The app never makes its own privacy promise
  about any service.

---

## 3. Device actions: src/services/crisisLinks.ts

openCall(number: string): Promise<CrisisLinkResult>
openText(number: string, body?: string): Promise<CrisisLinkResult>
openWeb(url: string): Promise<CrisisLinkResult>
type CrisisLinkResult = { ok: true } | { ok: false; fallback: string };

Rules:

- Do NOT call Linking.canOpenURL. Without declared query schemes it
  returns false even when the action would work. Call
  Linking.openURL inside try/catch. On failure return
  { ok: false, fallback: number or url }.
- openCall: `tel:${number}`.
- openText: iOS `sms:${number}&body=${encodeURIComponent(body)}`,
  Android `sms:${number}?body=${encodeURIComponent(body)}`. Without a
  body: `sms:${number}`. Branch on Platform.OS.
- openWeb: WebBrowser.openBrowserAsync(url) if expo-web-browser is
  installed, otherwise Linking.openURL(url).
- Never log anything from the entry. Log nothing at all here except
  **DEV** warnings about the failure type (no numbers, no user data).

When a result is not ok, the caller shows the fallback sheet (section 6).

---

## 4. Crisis state on Reflection

In useReflection / ReflectionScreen, the crisis check already runs
first, before the status checks (step 11). Keep that order. When
entry.isCrisis is true, render <CrisisSupportPanel entry={entry} />
instead of every normal Reflection section. Never render MiniPlayerCard,
ScriptureCard, ReflectionCarousel, EmotionBadge, the prayer toggle or
the share button for crisis entries, even if the data contains them.
Delete the // TEMP(13) view.

Create src/components/crisis/CrisisSupportPanel.tsx.
ScrollView with linen background and horizontal padding 24 (20 when the
width is under 360). Bottom padding clears the safe area.

Header: keep the Reflection close/back control exactly as in step 11.

Hero card (white .card, padding 24, margin-top 16):

- Icon tile 56×56, radius 16, blush, heart icon 26 rosewood.
  Decorative: accessible={false}.
- Eyebrow "YOU'RE NOT ALONE" (.eyebrow, rosewood), margin-top 16.
- Title, Fraunces SemiBold 26/32, ink:
  "Thank you for telling us. You don't have to carry this alone."
  This is the first accessibility focus when the screen opens (use a
  ref + AccessibilityInfo.setAccessibilityFocus after mount).
- Body, DM Sans Regular 16/25, mauve, margin-top 12:
  "What you shared sounds really heavy. Right now, the kindest thing
  we can do is help you reach a real person who will listen. Trained
  counselors are available any time, day or night."

Primary actions (margin-top 20, gap 12):

- "Talk to someone now", PrimaryButton in the critical variant
  (.btn-critical, crisis fill, white text), phone icon, height 56.
  Calls openCall('988'). accessibilityHint "Calls the 988 Suicide and
  Crisis Lifeline".
- "Text 988 instead", ghost button, message-circle icon.
  Calls openText('988').
- "Find support resources", text button (.btn-text, plum).
  navigation.navigate('CrisisResources', { source: 'reflection' }).

Emergency row (margin-top 20): a .list-row with a 1px crisis border at
low emphasis (use the existing critical outline utility; if none exists,
ask before adding one). Alert icon in crisis, DM Sans Medium 15 ink:
"If you're in immediate danger, call 911." Right side: a "Call 911"
chip button, accessibilityLabel "Call 911". Calls
openCall(EMERGENCY_NUMBER).

Gentle note card (blush .card, padding 20, margin-top 24):

- DM Sans Medium 13 eyebrow "ABOUT THIS REFLECTION", mauve.
- DM Sans Regular 15/23, ink:
  "We've paused the devotional and affirmations for this entry so you
  can focus on getting support. Reaching out for help is not a lack of
  faith. God often meets us through the people around us."
- No Bible verse here, verified or not.

"What you shared" (margin-top 16): the same collapsible transcript row
as step 11, collapsed by default. Never expanded automatically.

Footer (margin-top 28): ghost "Return to Journal", which resets to the
Journal tab the same way as step 11.

Never on this screen:

- Questions about safety or risk ("Are you safe?", scales, checkboxes).
- Any mention of specific methods or means.
- Promises about confidentiality, police involvement or what a
  counselor will do.
- Urgency animations, pulsing, sounds or haptics. Static layout;
  Reduce Motion needs nothing extra.

---

## 5. Support Resources screen

Add `CrisisResources: { source: 'reflection' | 'profile' }` to
RootStackParamList. Register it in RootNavigator with
presentation: 'modal' and headerShown: false. Update the Navigation Map
in AGENTS.md: "CrisisResources — modal, from Reflection crisis state
and Profile (step 15)."

Create src/screens/CrisisResourcesScreen.tsx:

- Header: 44×44 close button (x, "Close support resources"), centered
  title "Support Resources" (DM Sans Semibold 17, ink), and a 44×44
  spacer.
- Intro, DM Sans Regular 15/23, mauve: "Free, trained people are ready
  to listen. You can reach them any time."
- Emergency row from section 4 at the top (reuse it as
  src/components/crisis/EmergencyRow.tsx, because it's used in two
  places).
- One src/components/crisis/CrisisResourceCard.tsx per resource, gap 12:
  white .card padding 20; name Fraunces Medium 18/24 ink; description
  DM Sans 15/22 mauve; availability chip (.chip, sage tint, DM Sans
  Medium 12); action buttons stacked full width (call = plum primary,
  text/web = ghost), height 48, icons by kind.
- Group US resources first, then the "Outside the United States" card.
- Footer, DM Sans Regular 12, mauve, centered:
  "Gracehush is not a crisis service. Resources last checked
  {formatLongDate(CRISIS_RESOURCES_LAST_VERIFIED)}."
- Works fully offline (only the web actions need a connection). Never
  fetch anything on this screen.

The Profile entry point is built in step 15:
// TODO(15): add "Get support now" row in Profile → CrisisResources
// { source: 'profile' }.

---

## 6. Fallback when a link can't open

Create src/components/crisis/CrisisFallbackSheet.tsx, using RN Modal
(transparent, slide, sheet radius 24, theme.shadows.sheet). Show it when
a crisisLinks call returns ok: false:

- Title: "Your phone couldn't open this." (Fraunces Medium 20)
- Big selectable number or URL (DM Sans Semibold 28, ink, selectable).
- "Copy" button (expo-clipboard). After copying, show the inline label
  "Copied", never a toast that disappears before VoiceOver reads it.
- For call/text: "Dial this number from your phone app."
- "Close" ghost button.
  Simulators and iPads without cellular service hit this path. That's
  expected, so test it there.

---

## 7. Copy and flow rules

- Put all new strings in src/constants/copy.ts under `crisis`, except
  numbers and URLs (crisisResources.ts only).
- Crisis entries never schedule affirmations:
  // TODO(28): skip notification scheduling when isCrisis.
- Analytics later: // TODO(34): track crisis_resources_viewed
  { source } only. No entry id, emotion or text.
- The Processing overlay's crisis outcome from step 10 still uses
  navigation.replace('Reflection', { entryId }). Do not change it.
- Never log the transcript or any entry text.

---

## 8. Verify

Run `npx expo start -c`, `npm run lint` and `npm run typecheck`. Then:

1. Set devStore.nextSubmitOutcome = 'crisis', submit an entry. The
   Reflection crisis state shows, with no player, verse, tabs, share
   button, emotion badge or prayer toggle.
2. Open the mock crisis entry from Journal Home. Same result.
3. On a physical iPhone: "Talk to someone now" shows the system call
   confirmation for 988. Cancel it. "Text 988 instead" opens Messages
   to 988. On Android: the dialer opens with 988 and doesn't call.
4. Crisis Text Line: Messages opens to 741741 with "HOME" prefilled on
   BOTH iOS and Android.
5. On a simulator: tapping call shows the fallback sheet with Copy.
6. "Find support resources" opens the modal. Close by swipe (iOS) or
   back (Android).
7. Web links open in the in-app browser (or the system browser).
8. VoiceOver/TalkBack: focus lands on the title first, and every button
   reads its full label.
9. A normal (non-crisis) entry looks exactly the same as before this
   step.

Report: files created, changed and deleted; whether expo-web-browser and
expo-clipboard were present; icons used; copy keys added; and every TODO
left for steps 15, 21, 28 and 34.
