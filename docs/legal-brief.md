# Gracehush: facts for the Privacy Policy and the Terms of Use

A brief of facts for a lawyer, or for a policy generator you trust. It is **not legal text**: nothing here may be pasted into the app or a store form as it stands. The two draft pages built from it are [privacy-policy.md](privacy-policy.md) and [terms-of-use.md](terms-of-use.md), written on the owner's go-ahead on 2026-10-22 (prompt 34 says not to write legal copy, which bound that step and not this request) and marked DRAFT, with every unconfirmed fact left as a TODO. This brief was written on 2026-10-22 from `AGENTS.md` and the step prompts. "Planned" means the step that builds it has not run yet, so check the line again when it has. Every **TODO** needs your answer or your lawyer's.

What the app needs from this: two pages at real addresses (`PRIVACY_POLICY_URL`, `TERMS_URL` in `src/constants/app.ts`), a real `SUPPORT_EMAIL`, and, from step 31, an account deletion page for Google Play's Data safety form. The release gate in `AGENTS.md` ("Before a store build") stays red until these are real.

## 1. The product

- Gracehush is a private audio prayer journal. The user speaks (up to 5 minutes) or types (10 to 5,000 characters) a prayer. The app names the emotion, picks one Berean Standard Bible passage, writes a devotional of about a minute and three affirmations, and reads the devotional aloud.
- Audience: practicing Christian adults, 25 to 45. **TODO:** the minimum age (13, 16 or 18?) and the store age ratings.
- Free plan: 3 audio devotionals a week (resets Monday). Gracehush Pro: unlimited audio devotionals, and nothing else is advertised as Pro.
- Not a medical, therapy, pastoral or crisis service. An entry that shows risk of self-harm, abuse or immediate danger gets a support screen (988 Suicide & Crisis Lifeline, Crisis Text Line, 911, a worldwide directory) and no devotional.

## 2. What the app handles, and where it goes

| Data | Where it comes from | Stored in | Processed by | Why |
| --- | --- | --- | --- | --- |
| Email, name, photo, sign-in method (Apple, Google, or an emailed code) | the user, Apple, Google | Clerk | Clerk | sign-in, and the id every database row hangs on |
| Voice recording (AAC `.m4a`, up to 5:00) | the microphone, after a permission prompt | Supabase Storage (**TODO:** confirm the bucket is private) | Google Gemini (transcription) | to make the entry |
| Typed text | the user | Supabase Postgres | Google Gemini | to make the entry |
| Transcript, emotion, scripture reference and verified text, devotional, closing prayer, three affirmations, prayer title/category/summary, a crisis flag | Gemini's output | Supabase Postgres | none after creation | the reflection the user reads |
| Spoken devotional audio | Google Cloud Text-to-Speech, from the devotional text | Supabase Storage | Google Cloud Text-to-Speech | playback, including the lock screen |
| Prayer tracking: active or answered, answered date, gratitude note | the user | Supabase Postgres | none | the Prayers tab |
| Reminder times, time zone, affirmations on or off, ambient sound and volume | the user | Supabase Postgres, and the device | none | reminders and playback defaults |
| Plan (free, trial, pro) and when it ends | the store, through RevenueCat | RevenueCat; the tier and its end date are mirrored to Postgres by a webhook (step 30) | RevenueCat, Apple, Google | the free limit and Pro |
| Anonymous usage events (**planned, step 34, off until the user opts in**) | the app | PostHog (**TODO:** EU or US region, step 34 asks) | PostHog | to see which features are used |
| Reflections not prepared yet (the words of a written one, and a voice recording as an audio file) and a copy of the entries the app has seen (step 24), the sign-in token, onboarding flags | the app | SQLite (the words sealed with AES-256-GCM, the key in the phone's secure storage, this device only and not in backups), the app's document folder (recordings, **not encrypted by the app**), SecureStore, AsyncStorage | none | offline use |
| Affirmation notifications | the device schedules them | the device | none | reminders. No push server in V1. The text is the affirmation only, never the transcript |

Not collected, as far as the plans go (**TODO:** re-check before saying so): location, contacts, the advertising id, advertising or cross-app tracking SDKs, ads of any kind. Payment card data never reaches the app: Apple and Google take the payment. Bible text comes from the HelloAO Bible API, which is sent a passage reference and no user data; the Berean Standard Bible is public domain.

## 3. Sensitive data

- Prayers show religious belief, and often health, mental health, grief, abuse or self-harm. Ask the lawyer which rules apply and what notice and consent each needs, at least: GDPR Art. 9 (special categories, explicit consent), California's CPRA (sensitive personal information), Washington's My Health My Data Act and similar state laws, and the health categories in Apple's App Privacy and Google's Data safety forms. **TODO:** where consent is taken. The onboarding permissions step is the natural place, and it has none today.
- A crisis entry keeps its transcript so the user can read it later. The app does not alert anyone, contact a service or monitor entries, and the policy should say so plainly. **TODO:** the lawyer reads that wording.
- **The Gemini plan matters.** Google's Gemini API Additional Terms say that on *unpaid* services (Google AI Studio and the unpaid quota of the API) Google may use the content to improve its products and human reviewers may read it, and that on *paid* services it does not. Real users' prayers may only go through a billed project. Read the live terms at https://ai.google.dev/terms before the first real call (steps 19 and 32), and for Cloud Text-to-Speech: Google's data-logging page (read on 2026-10-23) says "Google does not log any customer Cloud TTS text or audio data" and says nothing about training, and the paid Google Cloud terms apply. **TODO:** the lawyer confirms that is enough, and the Gemini answer is recorded here.

## 4. What the user can do in the app

- **Export** (planned, step 31): a ZIP with a README, JSON, Markdown and the audio. The link works for 24 hours, one export every 10 minutes, and recordings that do not fit are listed in the README.
- **Delete the account** (planned, step 31): removes the storage files, the database rows, the RevenueCat customer and the Clerk user, in that order, and can be retried. It does **not** cancel an App Store or Google Play subscription, and the app says so.
- **Sign out** wipes the local copy (step 24). The analytics switch (step 34), the Daily Affirmations switch, and the microphone and notification permissions are all under the user's control.
- **TODO: retention.** Entries are kept until the user deletes them or the account. How long do backups and server logs live, and what happens to a deleted user's rows in them?

## 5. Service providers

Clerk (sign-in), Supabase (database and files; **TODO:** region, there is no Gracehush project yet), Google (Gemini and Cloud Text-to-Speech), RevenueCat (purchases), Apple and Google (sign-in and in-app purchase), PostHog (opt-in analytics), HelloAO (Bible text, no personal data). **TODO:** each provider's terms or data processing agreement accepted, and the legal basis for sending data to the United States for users in the EU and UK.

## 6. Subscriptions, and what the Terms must cover

As built (the Paywall, step 16): a yearly and a monthly plan. The prices on screen come from the store at runtime. The launch pricing adopted in `AGENTS.md` is $9.99 a month and $59.99 a year with a 7-day free trial on the yearly plan only, offered only when the store says this user is eligible. After the trial the store charges the yearly price unless the user cancels. The wording the user sees is `copy.paywall` (the four renewal disclosures): the lawyer should read it as the in-app summary of the terms.

- Billing, renewal, cancellation and refunds belong to the App Store or Google Play, not to Gracehush. The user cancels in the store's subscription settings, and the app links there. Restore purchases is in the app.
- The iPhone could use Apple's standard EULA in place of your own Terms of Use (an open item in `AGENTS.md`, step 16). Google has no equivalent, and Profile links to your Terms either way.
- **TODO, the Terms themselves:** the legal entity (name, address, country), the minimum age, the service description, acceptable use, what the user owns (their own words) and the permission to process them with the providers above, that AI-written devotionals can be wrong and are not professional advice (scripture is checked against the Berean Standard Bible), that Gracehush is not a medical, therapy, pastoral or crisis service (with 988), changes to the service, termination, limitation of liability, governing law and venue, how the Terms change, and the contact address.

## 7. Store forms the owner fills in

- **Apple:** the Privacy Policy URL, the App Privacy answers (contact info, user content, identifiers, purchases, usage data if analytics is on, and whether prayers count as sensitive info), and the review note for account deletion (Profile, Privacy & Data, Delete account).
- **Google Play:** the Privacy Policy URL, the Data safety form, the account deletion web URL (`ACCOUNT_DELETION_URL`, added in step 31), and whether the health-apps declaration applies. **TODO:** ask, because the app is not medical but handles mental-health-adjacent entries.
- Step 34 lists the exact analytics answers for both forms. Step 35 checks the privacy manifest.

## 8. Questions only the owner can answer

1. The legal entity, its address and country, and the governing law.
2. The domain for the pages, the support mailbox, and the address of the account deletion page.
3. The minimum age.
4. The Supabase region and backup retention, and the PostHog region.
5. A billed Google Cloud account (one account pays for Gemini and for Text-to-Speech), and whether Google's statement about Text-to-Speech data is enough.
6. The on-device copy (decided in the step 24 review): the words are encrypted, ids, statuses and times are not, and a recording waiting to be sent is an audio file the app does not encrypt (it is deleted once the reflection is prepared, at sign-out, and after 7 days if nothing refers to it). The database and the recordings are in the phone's own backups (iCloud or a computer backup); a restored phone cannot read the encrypted words. Is that fine to say as written?
7. Whether onboarding takes explicit consent for sensitive data.
8. Apple's standard EULA, or your own Terms, for the iPhone.
9. Whether to offer a "hide the text on the lock screen" option: reminders show an affirmation written from the user's own prayers, and the drafts disclose that either way.
10. Who at Gracehush can read entries, if anyone (support, debugging), and the controls on that.
11. Whether anything is ever trained or fine-tuned on entries. The drafts say no, which is the plan; confirm it.

## 9. Check the drafts against the shipped build

The drafts describe the app as designed. These statements depend on a step that has not run yet, so check each one when its step is done, and again after any later change. Then resolve every TODO and delete the DRAFT block at the top of each page.

| Statement in the drafts | Step that makes it true |
| --- | --- |
| The database holds an account ID and not the email address | 17, 18 |
| Recordings are in private storage, and encryption at rest is the provider's default | 18, 22 |
| Google's paid Gemini terms apply, and Google says it does not log Cloud Text-to-Speech text or audio (its data-logging page, 2026-10-23) | 19, 22, 32 (and the live terms at https://ai.google.dev/terms) |
| Unsent reflections and the copy of entries on the device are removed at sign-out and at account deletion; the words are encrypted, recordings are not | 24 |
| Reminders are local notifications that show an affirmation, with no push server | 28 |
| Plan and trial status come through RevenueCat, and the tier and its end date are mirrored | 30 |
| Export is a ZIP (data, readable text, audio) with a 24-hour link and one per 10 minutes; deleting removes storage, rows, the RevenueCat customer and the Clerk user, and does not cancel a store subscription | 31 |
| Analytics are opt-in, anonymous, from a fixed event list, with no crisis events, IP location off and a new anonymous ID per account | 34 |
| A crisis entry gets no devotional, affirmations, audio or analytics, and its transcript is kept | 13, 21, 34 |
| The free limit (three a week, resetting Monday), the 7-day trial on the yearly plan and the prices are set in the stores | 30 (the store setup) |
| No other SDK collects data (crash reporting, over-the-air updates, ads) | any step that adds one |
