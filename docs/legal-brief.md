# GraceHush: facts for the Privacy Policy and the Terms of Use

A brief of facts for a lawyer, or for a policy generator you trust. It is **not legal text**: nothing here may be pasted into the app or a store form as it stands. The two draft pages built from it are [privacy-policy.md](privacy-policy.md) and [terms-of-use.md](terms-of-use.md), written on the owner's go-ahead on 2026-10-22 (prompt 34 says not to write legal copy, which bound that step and not this request) and marked DRAFT, with every unconfirmed fact left as a TODO. This brief was written on 2026-10-22 from `AGENTS.md` and the step prompts. "Planned" means the step that builds it has not run yet, so check the line again when it has. Every **TODO** needs your answer or your lawyer's.

What the app needs from this: two pages at real addresses (`PRIVACY_POLICY_URL`, `TERMS_URL` in `src/constants/app.ts`), a real `SUPPORT_EMAIL`, and, from step 31, an account deletion page for Google Play's Data safety form. The release gate in `AGENTS.md` ("Before a store build") stays red until these are real.

## 1. The product

- GraceHush is a private audio prayer journal. The user speaks (up to 5 minutes) or types (10 to 5,000 characters) a prayer. The app names the emotion, picks one Berean Standard Bible passage, writes a devotional of about a minute and a half and three affirmations, and reads the devotional aloud.
- Audience: practicing Christian adults, 25 to 45. **TODO:** the minimum age (13, 16 or 18?) and the store age ratings.
- Free plan: 3 audio devotionals a week (resets Monday). GraceHush Pro: unlimited audio devotionals, and nothing else is advertised as Pro.
- Not a medical, therapy, pastoral or crisis service. An entry that shows risk of self-harm, abuse or immediate danger (a "heavy moment") gets a whole reflection written under extra-care rules (it never repeats what was written about harm and urges reaching out to someone trusted), with one line under the devotional naming 988 and 911 and a button that opens the dialer with 988. Since 2026-11-08; until then it got a support screen and no devotional, and the separate Support Resources screen was removed the same day. **TODO:** the lawyer reads the new wording in the Privacy Policy.
- The app bundles three ambient sound loops (soft rain, gentle piano, morning birds) under licenses that allow a sold app and need no credit (CC0, the Pixabay Content License or the owner's own recording); each source, author and license is in `assets/audio/ambient/LICENSES.md`. They play on the phone and are never sent anywhere.

## 2. What the app handles, and where it goes

| Data | Where it comes from | Stored in | Processed by | Why |
| --- | --- | --- | --- | --- |
| Email, name, photo, sign-in method (Apple, Google, or an emailed code) | the user, Apple, Google | Clerk | Clerk | sign-in, and the id every database row hangs on |
| Voice recording (AAC `.m4a`, up to 5:00) | the microphone, after a permission prompt | Supabase Storage (**TODO:** confirm the bucket is private) | Google Gemini (transcription) | to make the entry |
| Typed text | the user | Supabase Postgres | Google Gemini | to make the entry |
| Transcript, emotion, scripture reference and verified text, devotional, closing prayer, three affirmations, prayer title/category/summary, a "heavy moment" flag (`is_crisis`) | Gemini's output | Supabase Postgres | none after creation | the reflection the user reads |
| Spoken devotional audio | Google Cloud Text-to-Speech, from the devotional text | Supabase Storage | Google Cloud Text-to-Speech | playback, including the lock screen |
| Prayer tracking: active or answered, answered date, gratitude note | the user | Supabase Postgres | none | the Prayers tab |
| Reminder times, time zone, affirmations on or off, ambient sound and volume | the user | Supabase Postgres, and the device | none | reminders and playback defaults |
| Plan (free, trial, pro) and when it ends | the store, through RevenueCat | RevenueCat; the tier and its end date are mirrored to Postgres by a webhook (step 30) | RevenueCat, Apple, Google | the free limit and Pro |
| A short "this reflection changed" message (step 33): the reflection's id, whether it was added, changed or deleted, its status and the time of the change (for affirmations, their ids) | the database, when a reflection or an affirmation changes | Supabase Realtime (`realtime.messages`, kept by Supabase for 3 to 4 days) | Supabase | to show a change on the person's open screen at once; only the person's own private channel receives it, and it holds nothing the person wrote |
| Anonymous usage events (built in step 34; off until the user opts in, on the Journal's first visit after sign-in or with Profile's Share Usage Data switch; only the fixed list of the privacy policy's section 1.4) | the app | PostHog, US region (kept 12 months; the IP address is discarded and location lookup is off) | PostHog | to see which features are used |
| Reflections not prepared yet (the words of a written one, and a voice recording as an audio file) and a copy of the entries the app has seen (step 24), the sign-in token, onboarding flags | the app | SQLite (the words sealed with AES-256-GCM, the key in the phone's secure storage, this device only and not in backups), the app's document folder (recordings, **not encrypted by the app**), SecureStore, AsyncStorage | none | offline use |
| Affirmation notifications | the device schedules them | the device | none | reminders. No push server in V1. A notification shows the slot ("Morning affirmation") and the affirmation's one-line headline, never its longer text, the transcript, the emotion or the verse; a heavy moment's affirmations are sent like any other's since 2026-11-08 (they are written to speak hope, never the danger), and after one saved before then, which has none, none is sent until a newer reflection is ready (step 28) |

Not collected, as far as the plans go (**TODO:** re-check before saying so): location, contacts, the advertising id, advertising or cross-app tracking SDKs, ads of any kind. Payment card data never reaches the app: Apple and Google take the payment. Bible text comes from the HelloAO Bible API, which is sent a passage reference and no user data; the Berean Standard Bible is public domain.

## 3. Sensitive data

- Prayers show religious belief, and often health, mental health, grief, abuse or self-harm. Ask the lawyer which rules apply and what notice and consent each needs, at least: GDPR Art. 9 (special categories, explicit consent), California's CPRA (sensitive personal information), Washington's My Health My Data Act and similar state laws, and the health categories in Apple's App Privacy and Google's Data safety forms. **TODO:** where consent is taken. The onboarding permissions step is the natural place, and it has none today.
- A heavy moment keeps its transcript so the user can read it later, like any entry. The app does not alert anyone, contact a service or monitor entries, and the policy says so plainly. **TODO:** the lawyer reads that wording.
- **The Gemini plan matters.** Google's Gemini API Additional Terms say that on *unpaid* services (Google AI Studio and the unpaid quota of the API) Google may use the content to improve its products and human reviewers may read it, and that on *paid* services it does not. Real users' prayers may only go through a billed project. Read the live terms at https://ai.google.dev/terms before the first real call (steps 19 and 32), and for Cloud Text-to-Speech: Google's data-logging page (read on 2026-10-23) says "Google does not log any customer Cloud TTS text or audio data" and says nothing about training, and the paid Google Cloud terms apply. **TODO:** the lawyer confirms that is enough, and the Gemini answer is recorded here.

## 4. What the user can do in the app

- **Export** (step 31): a ZIP with a README, the data as JSON, the journal as readable Markdown, and the audio: the person's own recordings first, then the devotional audio, newest first, while the ZIP stays under 48 MB. Anything left out is listed by name in the README. The download link works for one hour. One ZIP is kept per person, in private storage, until the next export or the account's deletion, and a second export within ten minutes hands back the same ZIP with a fresh link. A heavy moment appears in the readable journal like any reflection, with no label (one saved before 2026-11-08 as its date and the person's own words). **TODO:** a scheduled clean-up of old exports (planned for after V1).
- **Delete the account** (step 31): after two confirmations (Profile, Delete Account), the server removes the storage files (recordings, devotional audio, exports), then the database rows, then the RevenueCat customer, then the Clerk user, and finally checks storage and the database once more for anything written while it ran. A step that fails stops there and the person can try again: what was done stays done. It does **not** cancel an App Store or Google Play subscription, and the app says so first. Known limits: another phone still signed in to the account can keep writing for up to a minute (a sign-in token lives 60 seconds), and the final pass catches only what arrives before it ends. For an account that signed in with Apple (step 35), Apple's sheet asks the person to confirm first, and the server then asks Apple to end GraceHush's access, using a one-time code it never stores or logs; if that cannot happen the deletion still goes ahead, as Apple requires, and the dialog has already told the person they can remove GraceHush in iPhone Settings. **TODO:** the lawyer confirms this needs no wording in the policy beyond what it says.
- **Allow Google's AI** (2026-11-03; a sheet since 2026-11-07; Apple's guideline 5.1.2(i)): the first time New Entry opens, a short bottom sheet asks "Allow Google’s AI to write your devotional?" and says that the recording or words go to Google's Gemini AI and the devotional to Google's text-to-speech, that GraceHush does not train AI on them, that Google's paid terms say it does not use them to improve its products, and that nothing is sent until the person taps Allow; "Allow" and "Not now" are the same size. Under "Learn more" it says why it asks, that Google can keep the words for a limited time to check for misuse, and that the choice can be changed in Profile, with a link to the Privacy Policy. Nothing a person says or writes leaves the phone until they allow it, and Profile's Share with Google's AI switch takes it back. The answer is kept on the phone, per account, and there is no server record of it. **TODO:** the lawyer reads the sheet's words (`copy.aiPermission`), above all the sentence about Google's paid terms, which covers the Gemini API and Cloud Text-to-Speech together.
- **Sign out** wipes the local copy (step 24). The analytics switch (step 34), the Daily Affirmations switch, the AI permission, and the microphone and notification permissions are all under the user's control.
- **Delete one reflection** (step 29b): from the Prayers tab (the ⋯ menu on a prayer) or the end of a reflection, "Delete reflection…" asks first and then removes that reflection for good: its text, its recording, its devotional audio and its affirmations, at once, and only while the phone is online. "Remove from Prayers" is a different action: it keeps the reflection and only takes it off the Prayers list. One small record is kept for a deleted devotional: an opaque identifier, the account it belongs to and the time it was made, with nothing the person wrote or heard. It exists only because the free plan counts devotionals per week and deleting must not hand one back. It is removed the next time that person deletes a reflection after it is more than 14 days old, and with the account (so it can outlive 14 days if the person never deletes again; a scheduled sweep would make "within 14 days" literally true). **TODO:** the lawyer confirms the record needs no separate listing, that the policy's sentence about it is enough, and whether a sweep is required.
- **TODO: retention.** Entries are kept until the user deletes them or the account. A single reflection the user deletes is removed from our systems at once, apart from the record above. How long do backups and server logs live, and what happens to a deleted user's rows in them?

## 5. Service providers

Clerk (sign-in), Supabase (database and files; **TODO:** region, there is no GraceHush project yet), Google (Gemini and Cloud Text-to-Speech), RevenueCat (purchases), Apple and Google (sign-in and in-app purchase), PostHog (opt-in analytics), HelloAO (Bible text, no personal data). **TODO:** each provider's terms or data processing agreement accepted, and the legal basis for sending data to the United States for users in the EU and UK.

## 6. Subscriptions, and what the Terms must cover

As built (the Paywall, step 16): a yearly and a monthly plan. The prices on screen come from the store at runtime. The launch pricing adopted in `AGENTS.md` is $9.99 a month and $59.99 a year with a 7-day free trial on the yearly plan only, offered only when the store says this user is eligible. After the trial the store charges the yearly price unless the user cancels. The wording the user sees is `copy.paywall` (the four renewal disclosures): the lawyer should read it as the in-app summary of the terms.

- Billing, renewal, cancellation and refunds belong to the App Store or Google Play, not to GraceHush. The user cancels in the store's subscription settings, and the app links there. Restore purchases is in the app.
- The iPhone could use Apple's standard EULA in place of your own Terms of Use (an open item in `AGENTS.md`, step 16). Google has no equivalent, and Profile links to your Terms either way.
- **TODO, the Terms themselves:** the legal entity (name, address, country), the minimum age, the service description, acceptable use, what the user owns (their own words) and the permission to process them with the providers above, that AI-written devotionals can be wrong and are not professional advice (scripture is checked against the Berean Standard Bible), that GraceHush is not a medical, therapy, pastoral or crisis service (with 988), changes to the service, termination, limitation of liability, governing law and venue, how the Terms change, and the contact address.

## 7. Store forms the owner fills in

- **Apple:** the Privacy Policy URL, the App Privacy answers (contact info, user content, identifiers, purchases, usage data if analytics is on, and whether prayers count as sensitive info), and the review note for account deletion (Profile, Privacy & Data, Delete account).
- **Google Play:** the Privacy Policy URL, the Data safety form, the account deletion web URL (`ACCOUNT_DELETION_URL`, added in step 31), and whether the health-apps declaration applies. **TODO:** ask, because the app is not medical but handles mental-health-adjacent entries.
- The exact analytics answers for both forms are in AGENTS.md, "Before a store build" (step 34). Step 35 checks the privacy manifest.

## 8. Questions only the owner can answer

**Answered by the owner on 2026-11-04:** the legal entity and its address (given to the website build and kept out of this public repository), the domain (gracehush.com), the support address (support@nouvrix.com) and the minimum age (18). **Proposed by the agent and confirmed by the owner the same day:** a US-only launch, North Carolina law with the courts of Mecklenburg County and no arbitration, a liability cap of what a user paid in the 12 months before the claim (or US$50), answering requests within 30 days, and that nobody reads entries except to fix a problem the person reports (with their permission) or when the law requires it. None of it has been reviewed by a lawyer. The pages are in `privacy-policy.md`, `terms-of-use.md` and `site/`.

1. The legal entity, its address and country, and the governing law.
2. The domain for the pages, the support mailbox, and the address of the account deletion page.
3. The minimum age.
4. The Supabase region and backup retention (the PostHog region is decided: US, step 34).
5. A billed Google Cloud account (one account pays for Gemini and for Text-to-Speech), and whether Google's statement about Text-to-Speech data is enough.
6. The on-device copy (decided in the step 24 review): the words are encrypted, ids, statuses and times are not, and a recording waiting to be sent is an audio file the app does not encrypt (it is deleted once the reflection is prepared, at sign-out, and after 7 days if nothing refers to it). The database and the recordings are in the phone's own backups (iCloud or a computer backup); a restored phone cannot read the encrypted words. Is that fine to say as written?
7. Whether the AI permission (section 4) is enough as explicit consent for sensitive data (beliefs, health), whether it must name them, and whether a server record of it is needed.
8. Apple's standard EULA, or your own Terms, for the iPhone.
9. Whether to offer a "hide the text on the lock screen" option: reminders show an affirmation written from the user's own prayers, and the drafts disclose that either way.
10. Who at GraceHush can read entries, if anyone (support, debugging), and the controls on that.
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
| Analytics are opt-in, anonymous, from a fixed event list, with no event about a heavy moment, IP location off and a new anonymous ID per account | 34 |
| A heavy moment gets a whole reflection under extra-care rules, never counts toward the free limit, sends no analytics, and keeps its transcript | 13, 21, 34, 2026-11-08 |
| The free limit (three a week, resetting Monday), the 7-day trial on the yearly plan and the prices are set in the stores | 30 (the store setup) |
| No other SDK collects data (crash reporting, over-the-air updates, ads) | any step that adds one |
