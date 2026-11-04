<!--
Source of the page at gracehush.com/privacy. Written from how the app really works (AGENTS.md is the reference), not reviewed by a lawyer.
{{COMPANY_NAME}}, {{COMPANY_ADDRESS}}, {{SUPPORT_EMAIL}}, {{SITE}} and {{DATE}} are filled in by docs/site/build.cjs: the company's
details live in the git-ignored docs/site/facts.json, so they stay out of the public repository. Check each statement against the shipped
build before publishing, and again whenever a provider or an SDK is added (docs/legal-brief.md lists what to check).
-->

# Privacy Policy

**Gracehush** · Effective {{DATE}} · Last updated {{DATE}}

Gracehush is a private audio prayer journal. You speak or write what you are carrying, and Gracehush returns a Bible passage, a short spoken devotional and three gentle affirmations. This policy explains what information Gracehush handles, why, who helps us do it, how long we keep it, and the choices you have.

**Who we are.** Gracehush is provided by {{COMPANY_NAME}}, {{COMPANY_ADDRESS}} (“Gracehush”, “we”, “us”). You can reach us about this policy at [{{SUPPORT_EMAIL}}](mailto:{{SUPPORT_EMAIL}}). Gracehush is made for adults in the United States.

## The short version

- Your prayers are yours. We use your recordings and words to make your reflections and run the features you use. We do not use them for advertising, and we do not sell your personal information.
- To make a reflection, your recording or text goes to Google’s AI services, and only after you say yes in the app. Google’s paid terms, which Gracehush uses, say Google does not use what you send to improve its products; it may keep it for a limited time to check for misuse. You can take your permission back at any time in Profile.
- Usage analytics are off unless you turn them on, and they never contain your words.
- You can export a copy of your journal or permanently delete your account in the app, at any time.
- Gracehush is not a crisis, medical or counseling service.

## 1. Information we handle

### 1.1 Information you give us

- **Your account.** You sign in with Apple, Google or a code we email you. Our sign-in provider, Clerk, receives your email address (which can be Apple’s private relay address), and your name and photo if Apple or Google share them. Our own database identifies you by an account ID and does not keep your email address.
- **Your prayers.** Voice recordings (up to five minutes each) and typed entries (up to 5,000 characters), exactly as you give them to us. We call these your entries.
- **Your notes.** Whether a prayer is active or answered, the date it was answered, and any gratitude note you add.
- **Your settings.** Your reminder times, your time zone, whether daily affirmations are on, and your ambient sound and volume.

### 1.2 Information we create for you

From each entry Gracehush creates: a transcript of a recording; an emotion label (such as anxious, weary or grateful); one Bible passage from the Berean Standard Bible and its text; a short devotional and its spoken audio; a closing prayer; three affirmations; and, for prayers you track, a title, category and summary. These are stored with your entry and are as private as the entry itself.

### 1.3 Subscription information

Apple and Google handle payment; we never see your card number. Through RevenueCat we receive your account ID, your plan, whether you are in a free trial, and when your plan renews or ends.

### 1.4 Usage information, only if you choose

If you choose “Share usage data” (on your first visit to the Journal after you sign in, or later with the Share Usage Data switch in Profile), the app sends PostHog, our analytics provider, anonymous events from a fixed list: which of these screens you open (Journal, Prayers, Profile, New Entry, Now Playing and the plans screen, by name only); that a reflection finished (whether it was spoken or written, whether its passage was confirmed, and whether it has audio) or could not be prepared; that a devotional started or reached its end, and at what speed; that you changed the ambient sound, saved an affirmation, opened an affirmation notification, or tracked, answered or removed a prayer; that you deleted a reflection or asked for an export; that the plans screen opened; and whether a purchase or a restore went through. Each event carries a random ID made on your phone (a new one after you sign out), your plan type, the app version, the phone’s operating system and its version, and a session ID. We never send your words, prayers, recordings, gratitude notes, name, email or account ID, or anything that identifies a reflection, and nothing is sent about an entry that shows support resources, or about the support screens. PostHog receives your phone’s network address with each request and discards it; location lookup is turned off. PostHog stores the events in the United States and keeps them for 12 months. If you do not choose to share, the app does not contact PostHog at all. You can turn sharing off at any time in Profile: whatever was still waiting on your phone is deleted, and nothing more is sent.

### 1.5 What stays on your device

A copy of your entries so you can use Gracehush offline, your sign-in token in your phone’s secure storage, and your preferences, including whether you have allowed Google’s AI. Signing out removes the copy of your entries from the device. The words in that copy are encrypted on your phone, with a key that stays on your phone. A recording that is waiting to be sent is kept on your phone as an audio file until it has been sent, and the app does not encrypt that file itself. Your phone’s own backups (such as iCloud or a computer backup) may include the copy of your entries; the encryption key is not part of them, so a restored phone cannot read the encrypted words.

### 1.6 What we do not collect

We do not collect your location, your contacts or your phone’s advertising ID, and Gracehush has no advertising and no tracking across other companies’ apps or websites. Like any online service, our providers can see your phone’s network address when the app connects to them; we do not use it to work out where you are.

## 2. How we use information

- To create your reflections: transcribe your recording, name the emotion, choose a Bible passage, and write and speak your devotional and affirmations.
- To keep your journal, prayers and settings, and to sync them across your devices.
- To schedule your reminders (on your device) at the times you choose.
- To run your plan: the weekly free limit, your free trial or subscription, and restoring purchases.
- To keep Gracehush secure, prevent abuse, fix problems and answer your messages.
- To improve Gracehush, from anonymous usage events, only if you opted in.
- To meet legal obligations.

We do not use your entries to show you advertising or to build advertising profiles, and we do not use them to train AI models. Google’s paid terms say it does not use them to improve its products either.

## 3. Who helps us, and what they receive

| Provider | What it does for Gracehush | What it receives |
| --- | --- | --- |
| Clerk ([privacy policy](https://clerk.com/legal/privacy)) | Sign-in and account management | Your email address, your name and photo if shared, your sign-in method, and technical data (such as IP address and device type) needed to keep you signed in securely |
| Supabase ([privacy policy](https://supabase.com/privacy)) | Hosts our database and file storage in the United States | Your entries, recordings, generated content, settings, account ID and plan status |
| Google, Gemini API ([terms](https://ai.google.dev/gemini-api/terms), [privacy policy](https://policies.google.com/privacy)) | Transcribes recordings, checks entries for signs of danger, and writes your reflection | Your recording or typed text, only after you give permission |
| Google Cloud Text-to-Speech ([privacy policy](https://policies.google.com/privacy)) | Turns your devotional into spoken audio | The devotional text. Google’s documentation says Cloud Text-to-Speech does not log the text or audio it handles |
| HelloAO Bible API ([bible.helloao.org](https://bible.helloao.org/)) | Supplies Berean Standard Bible text | Only the Bible reference (for example “Psalm 23:1–3”), nothing about you |
| RevenueCat ([privacy policy](https://www.revenuecat.com/privacy)) | Manages subscriptions | Your account ID and your purchase and plan status |
| Apple ([privacy policy](https://www.apple.com/legal/privacy/)) and Google ([privacy policy](https://policies.google.com/privacy)) | Sign in with Apple and Google, in-app purchases and subscriptions | What their own policies describe |
| PostHog, only if you opt in ([privacy policy](https://posthog.com/privacy)) | Anonymous usage analytics, stored in the United States | The anonymous events in section 1.4 |

These providers handle information only to provide their service to us, under their own terms. We also disclose information if the law requires it, or to protect people’s safety, rights or property, and in a sale or reorganization of the business, with the same protections for your information.

We do not sell your personal information, and we do not share it for advertising.

## 4. Your prayers are sensitive

What you pray can reveal your faith, and sometimes your health, your relationships or other private circumstances. We treat everything you say or write as sensitive. Before anything you say or write leaves your phone, the app asks for your explicit permission to send it to Google’s AI services, and you can take that permission back in Profile at any time. We use your words to give you your reflection and to run the features you use, and we do not share them except with the providers in section 3 to do that.

We do not read entries as part of running Gracehush. A few people who run the service can technically reach our database; they open an entry only to fix a problem you report to us, and only with your permission, or when the law requires it.

## 5. If an entry shows you may be in danger

Every entry is checked, by our own rules and by Google’s AI as part of preparing your reflection, for signs that you may be in danger or thinking about harming yourself. When it finds them, Gracehush shows you support resources (in the US, for example, the 988 Suicide & Crisis Lifeline) instead of a devotional, and it creates no affirmations, audio or analytics for that entry. Your words are kept like any other entry, so you can read them later, and you can delete them. This check is automatic and imperfect. We do not read entries as you write them, we do not contact emergency services, family or anyone else on your behalf, and Gracehush is not a crisis service. If you are in danger, call your local emergency number. Tapping a resource opens your phone’s dialer, messages or browser; Gracehush sends nothing when you do.

## 6. Reminders on your lock screen

If you turn on reminders, your phone shows an affirmation (text written for you from your own prayers) in a notification. It may appear on your lock screen, and anyone who can see your phone could read it. You can turn reminders off in Profile, and your phone’s settings let you hide notification previews.

## 7. How long we keep information

We keep your entries and everything created from them until you delete them or delete your account. When you delete a single reflection, its text, recording, devotional audio and affirmations are deleted from our systems at once. We keep one small record of a devotional you delete: a random identifier, your account and the time it was made, and nothing you wrote or heard. It exists only so that deleting a devotional does not give you a free one back in the same week. It is removed the next time you delete a reflection after it is more than 14 days old, and when you delete your account.

After you delete your account we delete your information from our systems, and we delete your records at Clerk and RevenueCat. Our hosting provider keeps routine backups for a short, fixed period (days, not months), after which they are overwritten. Our service providers keep technical logs for a limited time under their own policies. Apple and Google keep their own purchase records.

The download link for an export works for one hour. The export file itself is kept in private storage until you export again or delete your account. Anonymous usage events are kept for 12 months.

## 8. Your choices and rights

In the app:

- **Export your journal.** Profile, Export Journal. You get a link, good for one hour, to a ZIP file with your entries as data and as readable text, plus your recordings and devotional audio. If it is too large, some audio is left out (your own recordings come first), and the README in the file lists what was left out. If you export again within ten minutes, you get the same file with a new link.
- **Delete a reflection.** In Prayers (the ⋯ on a prayer) or at the end of a reflection, Delete reflection… permanently deletes that reflection, its recording, its devotional audio and its affirmations. It asks first and needs an internet connection. Remove from Prayers only takes a prayer off your prayer list and keeps the reflection in your journal.
- **Delete your account.** Profile, Delete Account. This permanently deletes your entries, recordings, devotionals, prayers and affirmations, your exports, your settings, your subscription record at RevenueCat and your sign-in account. If you signed in with Apple, Apple asks you to confirm and Gracehush then asks Apple to end its access to your Apple sign-in; if that cannot happen, you can remove Gracehush yourself in your iPhone’s Settings, under your name, Sign-In & Security. If something stops it part way, what was deleted stays deleted and you can try again to finish. It does not cancel an App Store subscription: cancel that in your subscription settings first. If you are signed in on another device, sign out there first. You can also ask us to delete your account without the app at [{{SITE}}/delete-account/]({{SITE}}/delete-account/).
- **Turn things off.** Sharing with Google’s AI in Profile (Gracehush then cannot prepare new reflections, and a reflection still waiting on your phone stays there until you turn sharing back on or sign out), daily affirmations and reminders in Profile, usage sharing in Profile, and the microphone and notifications in your phone’s settings.
- **Sign out.** This removes the local copy of your entries from that device.

You can also write to us at [{{SUPPORT_EMAIL}}](mailto:{{SUPPORT_EMAIL}}) to ask what we hold about you, to correct it, or to ask us to delete it. We will answer within 30 days. To protect you, we may ask you to confirm that the account is yours.

## 9. Where information is processed

Our database and files are hosted in the United States, and our other providers may process information in the United States and other countries. Gracehush is made for people in the United States; if you use it from another country, your information is handled in the United States, whose data protection laws can differ from those where you live.

## 10. Security

We protect your information with encryption in transit, encryption of stored data by our hosting provider, access rules that let only your account read your entries, and private storage for your recordings and exports. No system is perfectly secure, and we cannot promise absolute security.

## 11. Children

Gracehush is for adults, 18 and older. We do not knowingly collect information from anyone younger. If you think a child has used Gracehush, write to us and we will delete the information.

## 12. Changes to this policy

When we change this policy we will update the date above and, for a significant change, tell you in the app or by email before it takes effect.

## 13. Our website

The pages of this website set no cookies and use no analytics.

## 14. Contact us

{{COMPANY_NAME}}, {{COMPANY_ADDRESS}}. Email: [{{SUPPORT_EMAIL}}](mailto:{{SUPPORT_EMAIL}}).

---

## For residents of California and other US states

Some US states, including California, give residents rights over their personal information. We offer the choices in section 8 to everyone, wherever you live. In the last 12 months we collected the following categories of personal information, from you or created for you, and disclosed them only to the service providers in section 3 to provide Gracehush:

| Category | Examples | Why |
| --- | --- | --- |
| Identifiers | Account ID, email address (held by Clerk), name | Sign-in and your account |
| Audio and written content | Voice recordings, typed entries, transcripts | Creating your reflections |
| Sensitive personal information | Religious beliefs, and any health or other sensitive details in your prayers | Giving you the reflection you asked for; we do not use or disclose it for other purposes |
| Inferences | The emotion label for an entry | Showing you your reflection; not used for advertising |
| Commercial information | Plan and purchase status | Your plan and the free limit |
| Internet or app activity | Anonymous usage events, only if you opt in | Improving Gracehush |

We do not sell your personal information or share it for cross-context behavioral advertising, and we do not knowingly sell or share the information of anyone under 18. You can ask to know what we hold, to access it, to correct it and to delete it, and we will not treat you differently for using these rights. We use sensitive personal information, such as what you pray, only to give you the reflection you asked for. Use the app (section 8) or write to us; an authorized agent may write for you with your written permission.
