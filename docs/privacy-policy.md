> **DRAFT for legal review. Not legal advice, not reviewed by a lawyer, not published.** Written on 2026-10-22 from the product's design documents (`AGENTS.md` and the step prompts), not from a shipped app, so it describes how Gracehush is designed to work at launch. Every **[TODO]** is a fact or a decision only the owner or a lawyer can supply. Before publishing: have a lawyer review it, resolve every TODO, check each statement against the shipped build (the list is in `legal-brief.md`, section 9), and delete this block.

# Privacy Policy

**Gracehush** · Effective **[TODO: date]** · Last updated **[TODO: date]**

Gracehush is a private audio prayer journal. You speak or write what you are carrying, and Gracehush returns a Bible passage, a short spoken devotional and three gentle affirmations. This policy explains what information Gracehush handles, why, who helps us do it, how long we keep it, and the choices you have.

**Who we are.** Gracehush is provided by **[TODO: legal entity name, street address, country]** ("Gracehush", "we", "us"). You can reach us about this policy at **[TODO: privacy contact email: the SUPPORT_EMAIL mailbox or another]**.

## The short version

- Your prayers are yours. We use your recordings and words to make your reflections and run the features you use. We do not use them for advertising, and we do not sell your personal information. **[TODO: lawyer to confirm the wording on "sell" and "share" for each place we operate.]**
- To make a reflection, your recording or text is processed by Google's AI services. **[TODO: before publishing, confirm that Gracehush uses Google's paid terms, under which Google does not use the content to improve its products, and say so here.]**
- Usage analytics are off unless you turn them on, and they never contain your words.
- You can export a copy of your journal or permanently delete your account in the app, at any time.
- Gracehush is not a crisis, medical or counseling service.

## 1. Information we handle

### 1.1 Information you give us

- **Your account.** You sign in with Apple, Google or a code we email you. Our sign-in provider, Clerk, receives your email address (which can be Apple's private relay address), and your name and photo if Apple or Google share them. Our own database identifies you by an account ID and does not keep your email address. **[TODO: confirm at launch.]**
- **Your prayers.** Voice recordings (up to five minutes each) and typed entries (up to 5,000 characters), exactly as you give them to us. We call these your entries.
- **Your notes.** Whether a prayer is active or answered, the date it was answered, and any gratitude note you add.
- **Your settings.** Your reminder times, your time zone, whether daily affirmations are on, and your ambient sound and volume.

### 1.2 Information we create for you

From each entry Gracehush creates: a transcript of a recording; an emotion label (such as anxious, weary or grateful); one Bible passage from the Berean Standard Bible and its text; a short devotional and its spoken audio; a closing prayer; three affirmations; and, for prayers you track, a title, category and summary. These are stored with your entry and are as private as the entry itself.

### 1.3 Subscription information

Apple and Google handle payment; we never see your card number. Through RevenueCat we receive your account ID, your plan, whether you are in a free trial, and when your plan renews or ends.

### 1.4 Usage information, only if you choose

If you tap "Share usage data" (at the end of setup, or later in Profile), we record anonymous events from a fixed list: which screens you open (by name), whether an entry was voice or typed and a rough length range, whether a reflection finished or failed, how much of a devotional you listened to and at what speed, whether you changed the ambient sound or marked a prayer answered, and whether a purchase or restore completed. We never send your words, prayers, recordings, name or email address. We send nothing about an entry that triggers the support screen, or about the support screens. Location from your IP address is turned off. The events are not tied to your name or email, and your plan type and app version are attached. If you do not opt in, none of this is sent. You can turn it off at any time in Profile. **[TODO: confirm each statement against the final analytics build, and name the PostHog region.]**

### 1.5 What stays on your device

A copy of your entries so you can use Gracehush offline, your sign-in token in your phone's secure storage, and your preferences. Signing out removes the copy of your entries from the device. The words in that copy are encrypted on your phone, with a key that stays on your phone. **[TODO: confirm with the final build. A recording waiting to be sent is stored on the phone as an audio file that the app does not encrypt, and the phone's own backups may include the copy: decide how to say this.]**

### 1.6 What we do not collect

We do not collect your location, your contacts or your phone's advertising ID, and Gracehush has no advertising and no tracking across other companies' apps or websites. **[TODO: re-check before publishing, and again whenever an SDK is added.]**

## 2. How we use information

- To create your reflections: transcribe your recording, name the emotion, choose a Bible passage, and write and speak your devotional and affirmations.
- To keep your journal, prayers and settings, and to sync them across your devices.
- To schedule your reminders (on your device) at the times you choose.
- To run your plan: the weekly free limit, your free trial or subscription, and restoring purchases.
- To keep Gracehush secure, prevent abuse, fix problems and answer your messages.
- To improve Gracehush, from anonymous usage events, only if you opted in.
- To meet legal obligations.

We do not use your entries to show you advertising or to build advertising profiles. **[TODO: state the position on training AI models with entries (the intended answer is no), consistently with the provider terms in section 3.]**

## 3. Who helps us, and what they receive

| Provider | What it does for Gracehush | What it receives |
| --- | --- | --- |
| Clerk | Sign-in and account management | Your email address, your name and photo if shared, your sign-in method, and technical data (such as IP address and device type) needed to keep you signed in securely |
| Supabase | Hosts our database and file storage **[TODO: region]** | Your entries, recordings, generated content, settings, account ID and plan status |
| Google (Gemini API) | Transcribes recordings and writes your reflection | Your recording or typed text |
| Google Cloud Text-to-Speech | Turns your devotional into spoken audio | The devotional text |
| HelloAO Bible API | Supplies Berean Standard Bible text | Only the Bible reference (for example "Psalm 23:1–3"), nothing about you |
| RevenueCat | Manages subscriptions | Your account ID and your purchase and plan status |
| Apple and Google | Sign in with Apple and Google, in-app purchases and subscriptions | What their own policies describe |
| PostHog, only if you opt in | Anonymous usage analytics **[TODO: EU or US region]** | The anonymous events in section 1.4 |

These providers handle information only to provide their service to us, under their terms. **[TODO: for each provider, link its privacy policy here and confirm a signed data processing agreement or equivalent terms.]** We also disclose information if the law requires it, or to protect people's safety, rights or property **[TODO: lawyer: how we respond to legal requests, and whether we tell you]**, and in a sale or reorganization of the business, with the same protections for your information.

We do not sell your personal information, and we do not share it for advertising. **[TODO: lawyer to confirm this statement, for each place we operate.]**

## 4. Your prayers are sensitive

What you pray can reveal your faith, and sometimes your health, your relationships or other private circumstances. We treat everything you say or write as sensitive. We use it to give you your reflection and to run the features you use, and we do not share it except with the providers in section 3 to do that. **[TODO: state who at Gracehush can read entries, if anyone, and the controls on it (for example, only to fix a problem you report, with your permission). Lawyer: whether explicit consent or a separate notice is needed in the places we operate, and where it is collected.]**

## 5. If an entry shows you may be in danger

Gracehush looks for signs in an entry that you may be in danger or thinking about harming yourself. When it finds them, it shows you support resources (in the US, for example, the 988 Suicide & Crisis Lifeline) instead of a devotional, and it creates no affirmations, audio or analytics for that entry. Your words are kept like any other entry, so you can read them later. This check is automatic and imperfect. We do not read entries as you write them, we do not contact emergency services, family or anyone else on your behalf, and Gracehush is not a crisis service. If you are in danger, call your local emergency number. Tapping a resource opens your phone's dialer, messages or browser; Gracehush sends nothing when you do. **[TODO: lawyer to review this section.]**

## 6. Reminders on your lock screen

If you turn on reminders, your phone shows an affirmation (text written for you from your own prayers) in a notification. It may appear on your lock screen, and anyone who can see your phone could read it. You can turn reminders off in Profile, and your phone's settings let you hide notification previews. **[TODO: product decision: offer a "hide the text on the lock screen" option in the app, and say so here.]**

## 7. How long we keep information

We keep your entries and everything created from them until you delete them or delete your account. When you delete a single reflection, its text, recording, devotional audio and affirmations are deleted from our systems at once. We keep one small record of a devotional you delete: a random identifier, your account and the time it was made, and nothing you wrote or heard. It exists only so that deleting a devotional does not give you a free one back in the same week. It is removed the next time you delete a reflection after it is more than 14 days old, and when you delete your account. **[TODO: lawyer: is that enough, or must the record be removed after 14 days whether or not you delete again?]** After you delete your account we delete your information from our systems, and copies in backups are removed within **[TODO: number]** days. Our service providers keep technical logs for up to **[TODO: number]** days. The download link for an export works for 24 hours, and the export file is removed when you request a newer one or delete your account **[TODO: a scheduled cleanup of old exports is planned; state the period when it exists]**. Anonymous usage events are kept for **[TODO: period]**. **[TODO: retention at Clerk, RevenueCat and PostHog, and any records we must keep for tax or legal reasons.]**

## 8. Your choices and rights

In the app:

- **Export your journal.** Profile, Export Journal. You get a link, good for 24 hours, to a ZIP file with your entries as data and as readable text, plus your recordings and devotional audio. If it is too large, some recordings are left out, and the README in the file lists them.
- **Delete a reflection.** In Prayers (the ⋯ on a prayer) or at the end of a reflection, Delete reflection… permanently deletes that reflection, its recording, its devotional audio and its affirmations. It asks first and needs an internet connection. Remove from Prayers only takes a prayer off your prayer list and keeps the reflection in your journal.
- **Delete your account.** Profile, Delete Account. This permanently deletes your entries, recordings, devotionals, prayers and affirmations, your settings, your subscription record at RevenueCat and your sign-in account. It does not cancel an App Store or Google Play subscription: cancel that in your store's subscription settings first.
- **Turn things off.** Daily affirmations and reminders in Profile, usage sharing in Profile, and the microphone and notifications in your phone's settings.
- **Sign out.** This removes the local copy of your entries from that device.

You can also write to us at **[TODO: contact email]** to ask what we hold about you, to correct it, or to ask us to delete it. **[TODO: lawyer: rights by region (see the supplements below), how we verify requests, and response times.]**

## 9. Where information is processed

We and our providers may process information in the United States and other countries, whose data protection laws can differ from those where you live. **[TODO: hosting region, and the transfer mechanism for people in the EEA, UK and Switzerland (for example standard contractual clauses or the EU–US Data Privacy Framework).]**

## 10. Security

We protect your information with encryption in transit, access controls that let only your account read your entries, and private storage for your recordings. **[TODO: confirm encryption at rest (the provider's default) and that the storage is private.]** No system is perfectly secure, and we cannot promise absolute security.

## 11. Children

Gracehush is for adults. **[TODO: minimum age (13, 16 or 18), aligned with the store age ratings.]** We do not knowingly collect information from anyone younger. If you think a child has used Gracehush, write to us and we will delete the information.

## 12. Changes to this policy

When we change this policy we will update the date above and **[TODO: say how material changes are announced: in the app, by email or both]**.

## 13. Contact us

**[TODO: legal entity, postal address and email.]** **[TODO: if required, the EU and UK representative and a data protection officer.]**

---

## Supplement for people in the European Economic Area, the United Kingdom and Switzerland

**[TODO: lawyer to complete and confirm.]**

| What we do | Legal basis |
| --- | --- |
| Create your reflections, keep your journal, run your plan | Performing our contract with you |
| Process what your prayers reveal about your beliefs or health | Your explicit consent **[TODO: where it is collected; withdrawing it means deleting the entry or the account]** |
| Anonymous usage analytics | Your consent |
| Keep Gracehush secure and fix problems | Our legitimate interests |
| Meet legal obligations | Legal obligation |

You have the right to access, correct, delete, restrict and object to our use of your information, to receive it in a portable format, to withdraw consent at any time, and to complain to your data protection authority. Most of this you can do in the app (section 8) or by writing to us.

## Supplement for California residents

**[TODO: lawyer to complete and confirm.]** In the last 12 months we collected the following categories of personal information, from you or created for you, and disclosed them only to the service providers in section 3 to provide Gracehush:

| Category | Examples | Why |
| --- | --- | --- |
| Identifiers | Account ID, email address (held by Clerk), name | Sign-in and your account |
| Audio and written content | Voice recordings, typed entries, transcripts | Creating your reflections |
| Sensitive personal information | Religious beliefs, and any health or other sensitive details in your prayers | Giving you the reflection you asked for; we do not use or disclose it for other purposes |
| Inferences | The emotion label for an entry | Showing you your reflection; not used for advertising |
| Commercial information | Plan and purchase status | Your plan and the free limit |
| Internet or app activity | Anonymous usage events, only if you opt in | Improving Gracehush |

We do not sell your personal information or share it for cross-context behavioral advertising, and we do not knowingly sell or share the information of anyone under 16. You have the right to know, to access, to delete and to correct your personal information, and not to be treated differently for using these rights; use the app (section 8) or write to us. **[TODO: how we verify requests, using an authorized agent, and response times.]**

## Other places

**[TODO: lawyer: Washington's My Health My Data Act and similar laws (whether prayers and emotion labels count as consumer health data, and whether a separate notice and consent are needed), other US state privacy laws, and any other country where Gracehush is offered.]**
