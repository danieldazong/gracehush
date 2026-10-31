# Gracehush: facts for the Privacy Policy and the Terms of Use

A brief of facts for a lawyer, or for a policy generator you trust. It is **not legal text**: nothing here may be pasted into the app or a store form as it stands. The two draft pages built from it are [privacy-policy.md](privacy-policy.md) and [terms-of-use.md](terms-of-use.md), written on the owner's go-ahead on 2026-10-22 (prompt 34 says not to write legal copy, which bound that step and not this request) and marked DRAFT, with every unconfirmed fact left as a TODO. This brief was written on 2026-10-22 from `AGENTS.md` and the step prompts. "Planned" means the step that builds it has not run yet, so check the line again when it has. Every **TODO** needs your answer or your lawyer's.

What the app needs from this: two pages at real addresses (`PRIVACY_POLICY_URL`, `TERMS_URL` in `src/constants/app.ts`), a real `SUPPORT_EMAIL`, and, from step 31, an account deletion page for Google Play's Data safety form. The release gate in `AGENTS.md` ("Before a store build") stays red until these are real.

## 1. The product

- Gracehush is a private audio prayer journal. The user speaks (up to 5 minutes) or types (10 to 5,000 characters) a prayer. The app names the emotion, picks one Berean Standard Bible passage, writes a devotional of about a minute and a half and three affirmations, and reads the devotional aloud.
- Audience: practicing Christian adults, 25 to 45. **TODO:** the minimum age (13, 16 or 18?) and the store age ratings.
- Free plan: 3 audio devotionals a week (resets Monday). Gracehush Pro: unlimited audio devotionals, and nothing else is advertised as Pro.
- Not a medical, therapy, pastoral or crisis service. An entry that shows risk of self-harm, abuse or immediate danger gets a support screen (988 Suicide & Crisis Lifeline, Crisis Text Line, 911, a worldwide directory) and no devotional.
- The app bundles three ambient sound loops (soft rain, gentle piano, morning birds) under licenses that allow a sold app and need no credit (CC0, the Pixabay Content License or the owner's own recording); each source, author and license is in `assets/audio/ambient/LICENSES.md`. They play on the phone and are never sent anywhere.

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
| Affirmation notifications | the device schedules them | the device | none | reminders. No push server in V1. A notification shows the slot ("Morning affirmation") and the affirmation's one-line headline, never its longer text, the transcript, the emotion or the verse; after a crisis entry none is sent until a newer reflection is ready (step 28) |

Not collected, as far as the plans go (**TODO:** re-check before saying so): location, contacts, the advertising id, advertising or cross-app tracking SDKs, ads of any kind. Payment card data never reaches the app: Apple and Google take the payment. Bible text comes from the HelloAO Bible API, which is sent a passage reference and no user data; the Berean Standard Bible is public domain.

## 3. Sensitive data

- Prayers show religious belief, and often health, mental health, grief, abuse or self-harm. Ask the lawyer which rules apply and what notice and consent each needs, at least: GDPR Art. 9 (special categories, explicit consent), California's CPRA (sensitive personal information), Washington's My Health My Data Act and similar state laws, and the health categories in Apple's App Privacy and Google's Data safety forms. **TODO:** where consent is taken. The onboarding permissions step is the natural place, and it has none today.
- A crisis entry keeps its transcript so the user can read it later. The app does not alert anyone, contact a service or monitor entries, and the policy should say so plainly. **TODO:** the lawyer reads that wording.
- **The Gemini plan matters.** Google's Gemini API Additional Terms say that on *unpaid* services (Google AI Studio and the unpaid quota of the API) Google may use the content to improve its products and human reviewers may read it, and that on *paid* services it does not. Real users' prayers may only go through a billed project. Read the live terms at https://ai.google.dev/terms before the first real call (steps 19 and 32), and for Cloud Text-to-Speech: Google's data-logging page (read on 2026-10-23) says "Google does not log any customer Cloud TTS text or audio data" and says nothing about training, and the paid Google Cloud terms apply. **TODO:** the lawyer confirms that is enough, and the Gemini answer is recorded here.

## 4. What the user can do in the app

- **Export** (step 31): a ZIP with a README, the data as JSON, the journal as readable Markdown, and the audio: the person's own recordings first, then the devotional audio, newest first, while the ZIP stays under 48 MB. Anything left out is listed by name in the README. The download link works for one hour. One ZIP is kept per person, in private storage, until the next export or the account's deletion, and a second export within ten minutes hands back the same ZIP with a fresh link. A crisis entry appears in the readable journal as its date and the person's own words, with no label. **TODO:** a scheduled clean-up of old exports (planned for after V1).
- **Delete the account** (step 31): after two confirmations (Profile, Delete Account), the server removes the storage files (recordings, devotional audio, exports), then the database rows, then the RevenueCat customer, then the Clerk user, and finally checks storage and the database once more for anything written while it ran. A step that fails stops there and the person can try again: what was done stays done. It does **not** cancel an App Store or Google Play subscription, and the app says so first. Known limits: another phone still signed in to the account can keep writing for up to a minute (a sign-in token lives 60 seconds), and the final pass catches only what arrives before it ends; Sign in with Apple tokens are not revoked yet (no account can sign in with Apple before step 35, which adds the revocation). **TODO:** the lawyer confirms these two need no wording in the policy beyond what it says.
- **Sign out** wipes the local copy (step 24). The analytics switch (step 34), the Daily Affirmations switch, and the microphone and notification permissions are all under the user's control.
- **Delete one reflection** (step 29b): from the Prayers tab (the ⋯ menu on a prayer) or the end of a reflection, "Delete reflection…" asks first and then removes that reflection for good: its text, its recording, its devotional audio and its affirmations, at once, and only while the phone is online. "Remove from Prayers" is a different action: it keeps the reflection and only takes it off the Prayers list. One small record is kept for a deleted devotional: an opaque identifier, the account it belongs to and the time it was made, with nothing the person wrote or heard. It exists only because the free plan counts devotionals per week and deleting must not hand one back. It is removed the next time that person deletes a reflection after it is more than 14 days old, and with the account (so it can outlive 14 days if the person never deletes again; a scheduled sweep would make "within 14 days" literally true). **TODO:** the lawyer confirms the record needs no separate listing, that the policy's sentence about it is enough, and whether a sweep is required.
- **TODO: retention.** Entries are kept until the user deletes them or the account. A single reflection the user deletes is removed from our systems at once, apart from the record above. How long do backups and server logs live, and what happens to a deleted user's rows in them?

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
| Export is a ZIP (data, readable text, audio, recordings first) with a one-hour link; one ZIP is kept per person until the next export or the account's deletion, and an export within 10 minutes hands back the same file; deleting removes storage, rows, the RevenueCat customer and the Clerk user, then checks again, and does not cancel a store subscription | 31 |
| Deleting a reflection removes its text, recording, devotional audio and affirmations at once; one record (an opaque identifier, the owner and the time it was made) is kept to count the devotional in the free week, removed at the owner's next delete after 14 days and with the account | 29b |
| Analytics are opt-in, anonymous, from a fixed event list, with no crisis events, IP location off and a new anonymous ID per account | 34 |
| A crisis entry gets no devotional, affirmations, audio or analytics, and its transcript is kept | 13, 21, 34 |
| The free limit (three a week, resetting Monday), the 7-day trial on the yearly plan and the prices are set in the stores | 30 (the store setup) |
| No other SDK collects data (crash reporting, over-the-air updates, ads) | any step that adds one |
