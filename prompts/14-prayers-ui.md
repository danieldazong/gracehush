# 14-prayers-ui.md

Read AGENTS.md first and follow it strictly.

Build the Prayers screen for Gracehush with Active and Answered tabs, an
answered-prayers timeline, and the Mark Answered bottom sheet. It
replaces the step 08 placeholder in src/screens/PrayersScreen.tsx
(remove // TEMP: replaced in step 14). This step is UI plus mocked data
changes only. Real persistence (SQLite + Supabase) comes in step 29.

Design reference: @prompt_material/06-prayers.png. Replicate it exactly:
layout, spacing, font sizes, colors, radii, shadows and alignment. Ignore
Google Stitch preview artifacts (state toggles, duplicate headers, device
frames). Use only the tokens in src/constants/theme.ts, the utilities in
global.css and existing components (ScreenHeader, SegmentedControl,
PrimaryButton, ConfirmDialog, EmotionBadge). Do not add new colors,
fonts, radii or shadows. If the screenshot needs something the tokens
can't express, stop and ask. Text in this prompt overrides text in the
screenshot.

There is no mockup for the Mark Answered sheet. Build it as a variation
of the screen's cards, using the sheet radius (24) and theme.shadows.sheet.

---

## 1. Before writing code

1. Read src/screens/PrayersScreen.tsx, src/data/journalRepository.ts,
   src/data/selectors.ts, src/data/mappers.ts, src/data/mock/,
   src/types/index.ts, src/navigation/types.ts, src/utils/format.ts,
   src/constants/copy.ts, src/components/SegmentedControl.tsx and
   src/components/ConfirmDialog.tsx.
2. Find the Prayer model from step 06 (toPrayer). Identify the fields
   for: id (the entry id: a prayer lives on its entry), title and summary,
   category (PrayerCategory | null),
   createdAt, isAnswered, answeredAt, answeredNote. Use them exactly.
   If there is no short summary field, stop and ask. Do not show the
   full raw transcript on cards and do not invent a summary on device.
3. Check package.json for @react-native-community/datetimepicker. Do
   not install it. If it's missing, build everything else, show only
   the "Today" / "Yesterday" chips, and stop and ask before adding it.
   Never build a custom date wheel.
4. Confirm the step 02 icon library has: check-circle, circle, calendar,
   chevron-right, more-horizontal, rotate-ccw, x. Do not install another
   icon set.

---

## 2. Data access (mocked)

Add to journalRepository.ts, each marked
// TEMP(29): replace internals with SQLite + Supabase, keep signatures
(listPrayers() already exists from step 06 and returns every prayer, newest
first. Do not redefine it):

markPrayerAnswered(input: {
prayerId: string; answeredAt: string; note: string | null;
}): Promise<RepoResult<Prayer>>
unmarkPrayerAnswered(prayerId: string): Promise<RepoResult<Prayer>>
updateAnsweredNote(prayerId: string, note: string | null):
Promise<RepoResult<Prayer>>

Use the RepoResult type that step 06 defined in src/types/index.ts.

Rules:

- The mock mutates the in-memory mock store, so changes show on Prayers,
  Journal Home and Reflection for the rest of the session.
- About 500ms delay. Honor devStore: add
  `nextPrayerMutationFails: boolean` (default false, **DEV** only) to
  test the error path.
- listPrayers excludes crisis entries and entries whose prayer is null.
- Validation in the repository AND in the sheet: answeredAt is a date
  between the prayer's createdAt (date only) and today, local time. The
  note is trimmed. An empty note becomes null. Max length
  MAX_GRATITUDE_NOTE_LENGTH = 1000 (add to src/constants/app.ts).

Selectors in src/data/selectors.ts (pure, unit-testable):
selectActivePrayers(prayers) // !isAnswered, oldest createdAt first (the design shows 24, 11, then 4 days)
selectAnsweredPrayers(prayers) // isAnswered, newest answeredAt first
groupByMonth(prayers, key) // [{ title: 'October 2026', data }]
countLabel(n, singular, plural)
Counts like "12 answered prayers" and "5 active" always come from these
selectors. Never hardcode them.

Hook src/hooks/usePrayers.ts:

- State union: loading | error (with retry) | ready { active, answered,
  answeredSections, refresh, refreshing }.
- Refetch on focus (useFocusEffect) and pull-to-refresh. Ignore late or
  out-of-order responses and updates after unmount.
- Mutations are optimistic: update local state first, then roll back
  and return the error if the repository fails.

---

## 3. Screen layout: src/screens/PrayersScreen.tsx

- SafeAreaView (linen, top edge), ScreenHeader "Prayers" exactly as on
  the other tabs.
- One SectionList (Answered) / FlatList (Active) per tab. Do not nest a
  list inside a ScrollView. Horizontal padding 24 (20 when the width is
  under 360). paddingBottom = useTabScreenBottomPadding() so the dock
  never covers the last card. RefreshControl tint plum. useScrollToTop
  on the active list.
- List header: summary line or stat card as shown in the screenshot
  (e.g. "{n} answered prayers", computed), then SegmentedControl with
  "Active" / "Answered", each label including its count if the
  screenshot shows counts. The selected tab is kept in local state and
  persists across focus changes during the session.
- Category chips: build them only if the screenshot shows them. They
  filter the current tab by PrayerCategory, with "All" first. Otherwise
  skip and leave // TODO: category filter (not in V1 design).

Active prayer card (src/components/prayers/PrayerCard.tsx, reused on
both tabs):

- White .card per the screenshot. Created date (formatLongDate), short
  summary (2 lines max), EmotionBadge if the screenshot shows one,
  category chip if shown.
- Tapping the card opens Reflection { entryId }. accessibilityHint
  "Opens the reflection".
- "Mark answered" action (button or check-circle, per screenshot),
  44×44 minimum touch target, opens the Mark Answered sheet. It must not
  also trigger the card press.

Answered timeline (Answered tab):

- Sections grouped by month of answeredAt (sticky section headers in
  .eyebrow mauve).
- Each item uses PrayerCard in its answered variant: terracotta
  "Answered on {Oct 2}" label (formatShortDate; add it to
  utils/format.ts if missing), the gratitude note in Fraunces Italic
  per the scripture style when present, otherwise a text button
  "Add a gratitude note" that opens the sheet in edit mode.
- A vertical timeline rail/dots only if the screenshot shows them, drawn
  with Views (petal line, terracotta dot). No SVG library.
- An overflow (more-horizontal) action opens a small menu or action
  sheet (RN ActionSheetIOS on iOS; on Android a simple Modal list) with
  "Edit gratitude note" and "Move back to Active". "Move back to Active"
  asks for confirmation via ConfirmDialog: title "Move this prayer back
  to Active?", body "Its answered date and note will be removed.",
  confirm "Move back", cancel "Keep as answered".

Empty states (no illustrations or stock photos; icon tile + text):

- Active empty: "No open prayers right now." / "When you pray about
  something, you can keep it here and watch for God's answer."
- Answered empty: "Answered prayers will gather here." / "When a prayer
  is answered, mark it so you can remember His faithfulness."
- Loading: plum ActivityIndicator. Error: calm message + "Try again".

---

## 4. Mark Answered sheet: src/components/prayers/MarkAnsweredSheet.tsx

RN Modal (transparent, animationType 'slide'; 'none' when Reduce Motion
is on), backdrop ink at low opacity that closes on tap,
KeyboardAvoidingView (padding on iOS, height on Android), sheet top
radius 24, theme.shadows.sheet, white surface, padding 24, bottom safe
area respected.

Props: prayer, mode: 'mark' | 'editNote', onClose, onSubmit.

Content:

- Grab handle (petal, 36×4, radius full).
- Title, Fraunces SemiBold 22/28 ink: "Mark as answered" (mode mark) or
  "Your gratitude note" (mode editNote).
- The prayer's short summary, DM Sans 15/22 mauve, 2 lines.
- "WHEN WAS IT ANSWERED?" eyebrow (mark mode only). Chips: "Today",
  "Yesterday", "Pick a date". Today is selected by default. Hide
  "Yesterday" if it's before createdAt. "Pick a date" opens
  DateTimePicker (mode date, maximumDate today, minimumDate createdAt;
  inline/spinner per platform defaults). The chosen date shows as
  formatLongDate under the chips.
- "GRATITUDE NOTE (OPTIONAL)" eyebrow. Multiline .input, min height 120,
  placeholder "What did God do? How did He answer?", max
  MAX_GRATITUDE_NOTE_LENGTH, counter shown after 900 characters.
- Primary: "Mark as answered" (mark) or "Save note" (editNote). Disabled
  while saving and shows an inline spinner. Ghost "Cancel".
- Closing with unsaved note text (backdrop, Cancel, Android back) shows
  ConfirmDialog "Discard this note?" with "Discard" / "Keep writing".
- On error: inline message under the button "We couldn't save this.
  Please try again." The sheet stays open with text intact.
- On success: close the sheet. In mark mode, switch to nothing; stay on
  Active, and the card leaves the list. A persistent inline banner at
  the top of the list reads "Marked as answered. View in Answered"
  (text button switches tabs) and dismisses on its own only after the
  next tab switch or refresh, never by timer.
- The note text is never logged or sent to analytics.

---

## 5. Connections to other screens

- Reflection's prayer toggle (step 11) still has // TODO(29). Do not
  wire it here, but confirm that prayers toggled in the mock appear in
  Active after refocus.
- Journal Home counts (step 09) must still compute correctly after
  marking or unmarking.
- Add all new strings to src/constants/copy.ts under `prayers`.
- // TODO(29): persist via SQLite + Supabase; sync answered fields.
- // TODO(34): track prayer_marked_answered { has_note: boolean,
  days_to_answer: number } only. No text, no ids.

---

## 6. Rules

- No new dependencies. No `any`. NativeWind classes first. StyleSheet
  only for the cases AGENTS.md allows.
- Only PrayerCard and MarkAnsweredSheet are new reusable components.
  Keep the empty states and banner inside the screen.
- Crisis red is not used anywhere on this screen.
- Do not change the tab bar, dock, header or any other screen.
- Never log summaries, transcripts or notes.

---

## 7. Verify

Run `npx expo start -c`, `npm run lint` and `npm run typecheck`. Then:

1. The layout matches 06-prayers.png on a 390-wide iPhone and a small
   Android phone. The dock never covers the last card.
2. Counts match the mock data, with "1 answered prayer" in the singular.
3. Mark with Today, Yesterday and a picked date. Future dates and dates
   before creation are impossible.
4. Mark without a note, then add one from the Answered tab.
5. Edit a note, then "Move back to Active" with confirmation. The prayer
   returns to Active with its date and note removed.
6. Set devStore.nextPrayerMutationFails: the optimistic change rolls
   back, the inline error shows and the text is kept.
7. Cancel with typed text shows the discard dialog.
8. No crisis entry appears on either tab.
9. VoiceOver/TalkBack: the tabs read their counts, every action is
   labelled, and the banner is read aloud.

Report: files created and changed; the Prayer fields used; whether
datetimepicker was present; icons used; copy keys added; and every TODO
left for steps 29 and 34.
