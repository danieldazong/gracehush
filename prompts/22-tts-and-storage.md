# 22-tts-and-storage.md

> **Update 2026-10-24:** the devotional is stored as a lossless WAV (`LINEAR16`, `audio/wav`, `{userId}/devotionals/{entryId}.wav`), not the MP3 this step
> was first written for: the MP3 that Cloud Text-to-Speech produces is fixed at 32 kbps and was heard as robotic. Every MP3 detail below describes the first build
> and is kept as history; `AGENTS.md` (the Cloud Text-to-Speech vendor note and "Step 22 follow-up") has the current design.

Read AGENTS.md first and follow it strictly.

Add the spoken devotional to `process-entry`, and enforce the free tier on the server.

After the crisis screening has called an entry clear and the reflection is saved, the function builds a safe speech script from the saved devotional, has Google Cloud Text-to-Speech (a Chirp 3 HD voice) read it, measures the MP3, saves it in the private `journal_media` bucket and stores its **path**. A free account gets three devotionals a week, checked on the server after the crisis screening; a crisis is never counted and never blocked. No UI change, no new package, no migration. Playback on the phone is step 26, the ambient loop is step 27 (mixed on the phone, never on the server), and wiring the app to the function is step 25.

**Most of the code already exists.** The old text of this step was a specification written before steps 19 to 21 were built. It said `index.ts`, `functions serve`, a key in an `x-goog-api-key` header, a signed URL inside the response, a column `devotional_audio_url` to drop, and it asked you to confirm two numbers that AGENTS.md had already decided. The review checked each claim against the code, Google's current documentation and the real endpoints, and **one of them was wrong in a way that changes the design: Cloud Text-to-Speech does not accept API keys.** It then wrote and proved the parts that need no Google account (sections 1 and 10). What is left is:

- **(a)** you set up the Google Cloud side (the next section: billing, one API, one service account, one line in `.env.local`);
- **(b)** the implementer wires the code into the request flow, the app's types and the developer check (sections 3 and 4), and runs the real checks once your part is done (section 5);
- **(c)** you deploy and run the check on your phone (sections 6 and the walk-through).

The step is built so that **nothing blocks on billing except the sound itself.** With no speech secrets set, speech is simply off: the function still makes the reflection, saves it as text, and enforces the free limit. So the code, the limit and the deploy can all be finished while the Google payment is still being sorted out; the audio switches on, with no new deploy, the moment the secrets are set.

Sources, read in the review on 2026-10-23:

- https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd (the `markup` field, the pause tags, the voices, speaking rate, audio formats), https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize and `/v1/SynthesisInput`, `/v1/AudioConfig` (the request fields), https://docs.cloud.google.com/text-to-speech/quotas (5,000 bytes, 200 requests a minute), https://cloud.google.com/text-to-speech/pricing, https://docs.cloud.google.com/text-to-speech/docs/authentication, https://docs.cloud.google.com/text-to-speech/docs/data-logging, https://docs.cloud.google.com/text-to-speech/docs/gemini-tts (the alternative)
- https://ai.google.dev/gemini-api/docs/billing, `/rate-limits`, `/troubleshooting`, `/speech-generation.md.txt` (the Gemini API's own speech models return WAV or PCM, never MP3)
- https://supabase.com/docs/guides/functions/limits.md (150 s, 2 s of CPU, 256 MB), and `@supabase/storage-js` 2.118 (read from `node_modules`: how `upload` builds its request)
- the real endpoints `texttospeech.googleapis.com` and `oauth2.googleapis.com`, probed with the project's Gemini key and then with a made-up service account and token (no credential of yours was involved)
- the code of steps 18 to 21 (`supabase/functions/`, the migrations, `src/types/`), `AGENTS.md`, and ffmpeg 9.0 with `libmp3lame` and `ffprobe` (the MP3 test files)

---

## What the review found (these changed the prompt)

1. **An API key does not work for this API.** Sent the project's key, in the header and in `?key=` alike, `texttospeech.googleapis.com` answered 401 `UNAUTHENTICATED`: "API keys are not supported by this API. Expected OAuth2 access token or other authentication credentials that assert a principal". Google's current pages document only service accounts, application default credentials and OAuth tokens. So the function signs in as a **service account** (a JWT signed with the account's private key, traded for a one-hour token at `oauth2.googleapis.com`), written with `jose`, which both functions already depend on: no new package. The old text's `GOOGLE_TTS_API_KEY` and its advice to restrict an API key are gone.
2. **Billing is required.** The pricing page says "You must enable billing to use Text-to-Speech", even for the free part. When this was written your Billing account was still a "Free trial account" whose $30 activation payment had not gone through yet. You paid later the same day (2026-10-23) and AI Studio then showed your key as Tier 1. Both checks the walk-through starts with then passed: the Cloud console says "Paid account", and the Gemini credits were bought (until then every Gemini call answered HTTP 402, "Your prepayment credits are depleted"; the first calls were served at 22:37 UTC). The Google billing entry in AGENTS.md's log has the facts.
3. **Speech is optional by design.** The old text made a missing key a 500 for every request. That would have broken working reflections the moment the code was deployed without the secrets. Now no secrets means "off", a half-set or malformed secret is a logged `bad_config` (never a crash), and a typo is told apart from "not switched on".
4. **The response carries no link.** The old text returned a signed URL (and its expiry) from the function. The app has to mint its own link anyway (a link lasts an hour and the entry is opened for days; the bucket's select policy lets it, step 26 says so), so a link in the response saves one round trip once and adds a contract field, a place to leak a link into a log, and a thing to keep in step. The response keeps `devotional.audioPath` and `devotional.durationMs`, which the contract already has.
5. **Speech runs after the reflection is `ready`, and a failed speech never fails the reflection.** A request killed at 150 s, a Google outage and a missing secret all leave a good entry. Sending the same request again (same `clientEntryId`) runs the speech step alone, with no screening, no limit and no model call, so the audio can be added later; its update only fills an empty path, so two retries cannot both win.
6. **The old "count processing rows" rule would block both of two parallel requests.** If two requests arrive as the third and fourth devotional and each counts the other as "processing", each sees three and both get a 402. Now an entry still being made counts only when it was claimed earlier than the one being checked (with the id as the tie-break), so exactly one passes. A claim older than the 3-minute lease (a request that died) is not counted.
7. **The free limit would have broken the developer check.** A free account stops at its third devotional of the week, and every run of "Process-entry check (dev)" makes two. The test account must be `pro` while you run the normal check, and the check now prints the account's plan first and says plainly when a 402 is the reason (the walk-through, G and H).
8. **Only Chirp 3 HD voices.** They take the `markup` field and its pause tags; the voice names have a fixed shape, so the language code is taken from the name instead of a second secret that could disagree. The old `plainText` fallback is gone (it was for voices this step does not use).
9. **Nothing to drop.** The old section 8 asked to drop `journal_entries.devotional_audio_url`. That column was never created (step 18 saved only paths), so there is no migration, no `db reset`, and no "ask before dropping".
10. **Two numbers were already decided.** `FREE_DEVOTIONALS_PER_WEEK = 3` and `WEEK_STARTS_ON = 1` are in `src/constants/app.ts` and the Paywall and Profile copy since steps 06, 15 and 16. The old text asked you to confirm them again; it no longer does.
11. **The time budget is a number now.** Model calls end by 90 s (screening by 60 s); speech may start only in the first 100 s of a request and ends by 135 s; the platform stops a function at 150 s (free plan, checked again today).
12. **No Docker.** Every check runs through Deno from `npx`, against the fake world (`process-entry/testing/fakes.ts`), and every deploy is yours.
13. **A known limit, stated.** The weekly count is by when an entry was created, so a free account's blocked entry from an earlier week that is sent again later is made and not counted. Counting by when it was made needs a column (a later migration); it is bounded by the 10-requests-in-10-minutes rule and by the fact that the app never retries a blocked entry by itself. It is in AGENTS.md (requirement 10).
14. **Gemini-TTS was considered.** Cloud Text-to-Speech also serves Gemini speech models (`gemini-2.5-flash-tts` and others, MP3 for non-streaming requests). They are steerable and about $0.025 for 100 s of audio against about $0.045 for Chirp 3 HD, but they are language models (a verse or a prayer could be altered or skipped), several voices are Preview, and there is no free allowance. Chirp 3 HD stays unless you dislike its voices at the audition; switching is a follow-up (other request fields and tags). The Gemini API's own speech models return WAV or PCM only (about ten times the size, and the bucket takes only mp4, m4a, aac and mpeg), so they are not an option either.

---

## What you do yourself (read this first)

The implementer cannot do this part: it is your Google Cloud account, your bank, your Supabase dashboard and your phone. If you would rather be walked through it one instruction at a time, with a screenshot after each, say "guide me" (that is how steps 17 to 20 went). Only the first step needs your bank; the rest is clicking and one pasted line.

### Keys: three secrets are new (checked in the review, by name only)

| file | names | state |
| --- | --- | --- |
| `.env.local` (the app) | `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | all set; this step adds nothing to it |
| `supabase/functions/.env.local` | `GEMINI_API_KEY` (an `AQ.` key), `GEMINI_MODEL` (`gemini-3.1-flash-lite`), `CLERK_ISSUER` | all set |
| `supabase/functions/.env.local` | `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, optionally `TTS_SPEAKING_RATE` | **missing: steps B to E make them** |
| the hosted project's secrets | `GEMINI_FALLBACK_MODEL` (set in the step 21 follow-up) | exists only on the hosted project: add the line `GEMINI_FALLBACK_MODEL=gemini-3.5-flash-lite` to the local file too, so that `secrets set --env-file` (step F) can be run safely from it |

The names are in `supabase/functions/.env.example` already (the review added them, with no values). A secret in the local file must never have an empty value: `secrets set --env-file` would send it.

### A. Billing (the one blocker: only the sound waits for it)

Where it stands (2026-10-23, end of that day): both payments are done. The Cloud console shows **"Postpay – Google Cloud Services"** (the account activation, which Text-to-Speech needs) holding your $30 as a credit under the header **Paid account**, and **"Prepay – AI Studio"** (the Gemini credits) holding $20.00. Items 1 to 5 below are kept for a repeat setup (another project or a new account): on this project skip them.

1. **At your bank:** switch on international online payments for the card; make sure its dollar limit allows at least $60; if a Google payment is declined, ask whether it needs an approval in the bank's app or an SMS code.
2. **Check the country of your payments profile** at https://pay.google.com (Settings). It must be the country of the card and its address.
3. In the Cloud console (https://console.cloud.google.com/billing, Overview, "How you pay"), in the left card, **"Postpay – Google Cloud Services"**: if it still asks for a payment, click **Pay now**, $30, your card, confirm. If Google asks you to activate the full account, say yes. The account must no longer say "Free trial account" (the label can take up to 24 hours to change).
4. In the right card, **"Prepay – AI Studio"** (or on https://aistudio.google.com/billing, **Buy credits**), buy the Gemini credits (the minimum it allows) and leave **auto-reload off**, so that no more can be spent than was added. While the balance is $0 every Gemini call is refused with HTTP 402, the hosted function's included. (Done on this project on 2026-10-23; the page first showed auto-reload **On** and the user switched it off.)
5. Tell the implementer "billing is paid" once the console no longer says "Free trial account" and the credits show. On this project that is already true; the billing reminder in AGENTS.md was deleted on 2026-10-23.

Do not press Pay now again and again after a decline: several declines in a row can flag the payments profile.

### B. Switch on the Cloud Text-to-Speech API

1. Open https://console.cloud.google.com/apis/library/texttospeech.googleapis.com and look at the **project name at the top**. It must be the project of your Gemini key (the one AI Studio shows as "gracehush" on https://aistudio.google.com/apikey). If it is another project, use the project picker.
2. Click **Enable**. It then shows the API's page with an "API enabled" status. If the button is disabled, or it asks to enable billing, step A is not finished.

### C. Make a service account and a key

1. Open https://console.cloud.google.com/iam-admin/serviceaccounts (same project). Click **Create service account**. Name it `gracehush-tts`. Click **Create and continue**. **Leave the roles empty** and click **Continue**, then **Done**. (Text-to-Speech needs no role. If the first real call answers `PERMISSION_DENIED` mentioning `serviceusage.services.use`, the troubleshooting table at the end says what to add.)
2. Click the new account's email, open the **Keys** tab, **Add key**, **Create new key**, **JSON**, **Create**. A file downloads. It is a secret that can spend money: **never put it in the Gracehush folder, never open it in the editor tab you share, never paste it or screenshot it.**
3. Move it out of Downloads into a private folder outside the project. In the VS Code terminal (PowerShell), with the real file name that Google gave it:

```powershell
New-Item -ItemType Directory -Force "$HOME\gracehush-secrets" | Out-Null
Move-Item "$HOME\Downloads\<the downloaded file>.json" "$HOME\gracehush-secrets\gracehush-tts.json"
```

If **Create new key** says key creation is disabled by an organization policy, tell the implementer: it needs a different route.

### D. Turn the key into one line for `.env.local`

These commands were run on Windows PowerShell 5.1 against a made-up key file in the review. They print nothing: the line goes to your clipboard, and the function's own parser returned the identical key from it.

```powershell
$key = Get-Content -Raw -Path "$HOME\gracehush-secrets\gracehush-tts.json" | ConvertFrom-Json
$small = @{ type = $key.type; client_email = $key.client_email; private_key = $key.private_key } | ConvertTo-Json -Compress
[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($small)) | Set-Clipboard
```

1. In VS Code open `supabase/functions/.env.local` (the one **inside `supabase/functions`**, not the root file). On a new line type `GOOGLE_TTS_CREDENTIALS_B64=` and paste right after the `=` (Ctrl+V): one long line, no spaces. **Save with Ctrl+S** (a dot on the tab means it is not saved: an unsaved file looks like a missing one to every check).
2. Clear the clipboard and delete the key file (you can always make another key in C):

```powershell
Set-Clipboard -Value $null
Remove-Item "$HOME\gracehush-secrets\gracehush-tts.json"
```

3. Tell the implementer "the key is in". It checks the file **by name and shape only** (the value decodes, is a service account, has an email and a private key) and never prints a value.

### E. Listen and choose the voice

Once the line is in, the implementer runs the audition (section 5): it writes eight short MP3s of the same made-up devotional (four calm female voices at two speeds) into `tts-audition/` inside the project (git ignores it). Open them in Windows (double-click) and tell the implementer which you like: the file name says the voice and the speed. Listen for a warm, unhurried voice; clear words; natural pauses between paragraphs; the verse read clearly; "Lord" and "God" said as words (not letter by letter); a plain "Amen." at the end. The implementer then writes `TTS_VOICE_NAME` (and `TTS_SPEAKING_RATE`) into your `.env.local`.

### F. Set the hosted secrets and deploy

After section 5 has passed, the implementer gives you these with your project reference filled in (it is the first part of your Supabase address; it is not a secret). Run them in a VS Code terminal in the project folder:

```
npx --yes supabase@2.121.0 secrets set --env-file supabase/functions/.env.local --project-ref <ref>
npx --yes supabase@2.121.0 functions deploy process-entry --project-ref <ref> --use-api
npx --yes supabase@2.121.0 functions deploy confirm-scripture --project-ref <ref> --use-api
```

`secrets set` prints no value; `npx --yes supabase@2.121.0 secrets list --project-ref <ref>` shows names and digests, and must now list `GOOGLE_TTS_CREDENTIALS_B64` and `TTS_VOICE_NAME`. (`confirm-scripture` changes only its log line, so it is deployed to keep the two functions' lines alike.) If Billing is not paid yet when the code is ready, run only the two `functions deploy` lines: the limit goes live and speech stays off; run `secrets set` later, with no redeploy.

### G. Make the test account Pro, then run the check on your phone

The check makes two devotionals a run, so a free account stops at its third (a 402 `LIMIT_REACHED`, which is correct). For the normal run the test account must be `pro`:

1. In the Clerk dashboard, Users, open `gracehush17b+clerk_test@example.com` and copy its **User ID** (it starts with `user_`).
2. In the Supabase dashboard, Table Editor, `users_profile`: find the row whose `id` is that User ID, change `subscription_tier` from `free` to `pro`, save.
3. Reload the app in Expo Go. In Profile, scroll to **Developer**; if you are signed in as yourself, tap **Sign out (dev)** and sign in as the test account (code `424242`).
4. Tap **Process-entry check (dev)** and wait up to about three minutes. The first line says "account plan: pro". Send a screenshot of every line. With speech on, the new lines say the devotional has audio of so many seconds, that the app's own link plays a WAV (it must answer `audio/wav` and start with RIFF/WAVE), and that the public address is refused.

Your own account is `free`: while you build steps 23 to 29 against the real function, the limit will stop you after three devotionals in a week. Set your own row to `pro` or `trial` in the Table Editor the same way while you develop (step 30's purchase webhook takes that column over later).

### H. Test the free limit on the hosted function

1. With the account still `pro`, run the check once more, so that this week holds at least three devotionals (every devotional made as Pro counts, runs from earlier in the same week included).
2. In the Table Editor set the test account back to **`free`**, reload the app and run the check. The account has now used its three, so the lines that need a new devotional (the written entry, the instructions entry) say `SKIP … this test account is free and has used its 3 devotionals this week`: that is the correct answer here, not a failure. Read the "free limit" line: it must say a new entry got a 402 `LIMIT_REACHED` with the entry saved and a usage of **3 or more out of 3** (the count is real, so a number like "9 of 3" is normal after several test runs), and that the crisis sentence was still answered as a crisis.
3. Set the account to **`pro`** again and run the check once more: the new "blocked entry, after an upgrade" line must say the same entry was now made (200, a devotional), with no second entry created.
4. Leave the account `pro` for the next steps, or put it back to `free` if you want the limit on.

### If something goes wrong: what the log and the check say

The function's log line has a field `tts` (one word and, for a failure, Google's short reasons, never its message). The developer check prints the same words.

| `tts` says | it means | what to do |
| --- | --- | --- |
| `off` | neither speech secret is set on the hosted project | step F |
| `bad_config:GOOGLE_TTS_CREDENTIALS_B64` | the secret is not the one-line base64 of the key | redo D, then `secrets set` again |
| `bad_config:TTS_VOICE_NAME` | not a Chirp 3 HD voice name such as `en-US-Chirp3-HD-Aoede` | write it again exactly, no spaces |
| `bad_config:TTS_SPEAKING_RATE` | not a number from 0.25 to 2.0 | fix or empty the line |
| `failed:tts_auth:invalid_grant` | Google refused the key: it was deleted or disabled, or the key text is wrong | make a new key (C), redo D and F |
| `failed:tts_auth:bad_key` | the private key text is damaged | redo D |
| `failed:tts_http_403:PERMISSION_DENIED/SERVICE_DISABLED` | the API is not enabled in the key's project | step B (the right project?) |
| `failed:tts_http_403:PERMISSION_DENIED/BILLING_DISABLED` | billing is not active | step A |
| `failed:tts_http_403:PERMISSION_DENIED/...` mentioning `serviceusage.services.use` | the account may not use the project's services | IAM, **Grant access**, the service account's email, role **Service Usage Consumer** |
| `failed:tts_http_400:INVALID_ARGUMENT` | a voice Google does not know, or markup it refuses | audition again and send the log line |
| `failed:tts_http_429...` or `tts_http_503...` | busy; the function already tried twice | send the same request again: it adds the audio only |
| `failed:tts_timeout` | slower than 30 s twice | the same |
| `skipped:time` | the reflection took so long that speech did not fit (over 100 s) | send the same request again |
| `skipped:script` | the devotional is empty, or alone over 4,800 bytes | report it: the model wrote too much |
| `SKIP … this test account is free …` lines in the check | the account is `free` and has used its three: the 402 is correct | set it to `pro` (G) or wait for Monday |

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

The reasons are in "What the review found"; these are the binding choices.

1. **A service account signs in, not an API key.** The secret is `GOOGLE_TTS_CREDENTIALS_B64`: the key file reduced to `type`, `client_email` and `private_key`, as one line of base64. The token endpoint is a constant in the code and is never read from the file.
2. **Speech is optional, with three states** (`readTtsConfig`): `ready`, `off` (neither secret set) and `bad` (something set but wrong or half-set, naming the secret). `bad` is logged and speech is skipped; it never fails a request.
3. **Only Chirp 3 HD voices, `markup` input, MP3 out.** The language code comes from the voice name; the speaking rate is `TTS_SPEAKING_RATE` or 0.92 until the audition chooses. No pitch, no effect profile.
4. **The script** is what `script.ts` builds: "Here is your devotional.", the paragraphs with a `[pause]` between them, "A reading from {spoken reference}." and the verse (only when `scripture_verified`), then "Let's pray.", the prayer and "Amen.". The title is not spoken. The two fixed sentences are constants at the top of `script.ts`: change them there if the audition says so.
5. **No link in the response and none stored.** `devotional.audioPath` and `devotional.durationMs` already exist in the contract; the app mints its own link (Backend requirement 13).
6. **Speech runs after `ready`, best effort.** A failure leaves the entry ready with no audio and sets `error_code` to `TTS_FAILED` only when a Google or storage call failed (not when speech is off or skipped); a later success clears it. The same request sent again runs speech only. Speech never runs for a crisis entry, and its update refuses one.
7. **The free limit** follows section 2.2 and its 402 follows section 2.6. A blocked audio entry keeps its screened transcript, and a later retry screens that saved text instead of downloading the recording again.
8. **The week** is `weekWindow(now, profile.timezone)`: Monday 00:00 on the profile's clock. A zone that `Intl` does not know is read as UTC and logged.
9. **The time budget** is section 2.4; **the log** gains the seven fields of section 2.7.
10. **The developer check** gets the account's plan line, the audio cases, a "speech added by a retry" case and the limit cases (section 4.3).
11. **A known limit, accepted for V1:** the count is by creation time, so an old blocked entry sent again later is not counted (finding 13). If you want it closed now, the least-bad fix is to set `created_at` to now when a blocked entry from an earlier week is finally made; that changes the date the entry shows, so it is not done by default.
12. **No migration, no new package, no environment switch in production code, no `any`.**

---

## 0. Before you write code

1. `git status`: the files listed in section 1 exist (written in the review, uncommitted). Run **Part A of section 10 first**. Everything must be green before you change anything; if a count differs from the one in section 1, stop and say so.
2. Read what you will edit: `process-entry/handler.ts`, `lifecycle.ts`, `constants.ts`, `contracts.ts`, `response.ts`, `testing/fakes.ts`, `handler_test.ts`; `_shared/errors.ts`, `_shared/log.ts`, `_shared/limits/weekly.ts`; `confirm-scripture/handler.ts` and its test; `src/types/index.ts`, `src/types/contractParity.ts`, `src/components/dev/processEntryCheck.ts`; the TODO markers `TODO(22)` in `NewEntryScreen.tsx` and `PaywallScreen.tsx`.
3. Confirm these columns exist in `src/types/supabase.ts` (the generated file: never edit it): on `journal_entries` `devotional_audio_path`, `devotional_duration_ms`, `error_code`, `is_crisis`, `devotional_script`, `closing_prayer`, `scripture_reference`, `scripture_text`, `scripture_verified`, `processing_status`, `created_at`, `updated_at`; on `users_profile` `subscription_tier` (`free`, `trial` or `pro`) and `timezone`. **`devotional_audio_url` must not exist** (nothing to drop). If anything is missing, stop and ask: step 18 owns the schema.
4. Check `supabase/functions/.env.local` **by name only** (a script that prints names and "set" or "empty", never a value) and report which of the three new names exist. Expected today: none.
5. Re-read https://cloud.google.com/text-to-speech/pricing and report the Chirp 3 HD price and free allowance against section 2.8. Do not assume "1 million free characters": the page said so on 2026-10-23; say if it has changed.

---

## 1. What the review created (read these; do not rewrite them)

All under `supabase/functions/`. They need no Google account and no key; they are proven by tests, and the review mutation-tested them.

| file | what it is | tests |
| --- | --- | --- |
| `_shared/tts/script.ts` | `buildSpeechScript(input)`: the markup that is read aloud, cleaned, in order, with the size fallback (`MAX_SCRIPT_BYTES` 4,800); `cleanForSpeech(text)` | 11 in `script_test.ts` |
| `_shared/tts/mp3Duration.ts` | `mp3DurationMs(bytes)`: the length of an MP3 by walking its frames (Layer III, MPEG-1/2/2.5, ID3v2 skipped, the Info/Xing frame not counted); null for anything damaged or foreign | 10 with four real files in `fixtures/` (made with ffmpeg; the expected lengths come from `ffprobe`) |
| `_shared/tts/googleAuth.ts` | `parseServiceAccount`, `getAccessToken` (RS256 JWT with `jose`, form POST to the token endpoint, a cache until five minutes before expiry, one shared sign-in at a time), `forgetAccessToken`, `GoogleAuthError`, `authTiming` | 9 |
| `_shared/tts/config.ts` | `readTtsConfig(read)` with `ready`, `off` and `bad`; `DEFAULT_SPEAKING_RATE` | 5 |
| `_shared/tts/synthesize.ts` | `synthesize(markup, config, deadlineAt)`: the call, two attempts, a refreshed token after a 401, log-safe reasons; `ttsTiming` | 9 |
| `_shared/tts/storeAudio.ts` | `storeDevotionalAudio(admin, userId, entryId, mp3)` and `devotionalAudioPath`: an upload to `journal_media` as `audio/mpeg`, replacing any earlier file, returning only the path | 4 |
| `_shared/tts/testing.ts` | a fake Google (token endpoint and Text-to-Speech) with a real RSA key, for these tests; step 22 folds the same idea into `process-entry/testing/fakes.ts` | |
| `_shared/limits/constants.ts`, `weekly.ts` | `FREE_DEVOTIONALS_PER_WEEK` (3), `WEEK_STARTS_ON` (1) and `weekWindow(now, zone, weekStartsOn?)`: the week's start and end on the profile's clock, `Intl` only | 9: worked examples (a 167-hour and a 169-hour week in New York, UTC+13, +14 and -11), and 18 zones over two years |
| `_shared/bible/reference.ts` | `spokenReference(ref)`: "Philippians chapter 4, verses 6 through 7", "Psalm 23, verses 1 through 3", "First John chapter 4, verse 18", "Jude, verses 24 through 25" | 2 in `reference_test.ts`, all 66 books |
| `supabase/functions/.env.example`, `.gitignore`, `docs/legal-brief.md`, `AGENTS.md` | the three new secret names (no values), `tts-audition/` ignored, the checked Text-to-Speech data facts, and the decisions of this review (section 7) | |

**How they were proven (so you can trust them and not repeat it):**

- `deno check`, `deno lint` (three folders), `deno fmt --check` and the whole Deno suite are green; the suite went from 233 to 292 tests.
- The MP3 reader is exact to the frame on four real files (for example 211 frames at 576 samples and 24,000 Hz is 5,064 ms, and `ffprobe`'s own gapless figure is 5.000 s: inside 100 ms), and walks 100,000 frames in about 25 ms.
- The week code was swept over 18 zones for two years: every instant is inside its week, weeks tile, a week starts on a local Monday at 00:00, a skipped midnight (Havana, with weeks that start on Sunday) is handled; the sweep takes 2 s, because `Intl` is slow and the full-density version took 1 min 44 s.
- The sign-in and the call were run against the **real** Google endpoints with a made-up service account and a made-up token: the token endpoint answered 400 `invalid_grant` (the request is well formed; the account is unknown) and Text-to-Speech answered 401 `UNAUTHENTICATED` with the reason `ACCESS_TOKEN_TYPE_UNSUPPORTED`, which the code turned into `AUTH`, `tts_http_401:UNAUTHENTICATED/ACCESS_TOKEN_TYPE_UNSUPPORTED`, after one fresh sign-in. These are the strings in the troubleshooting table.
- The PowerShell commands of step D were run on Windows PowerShell 5.1 with a made-up key file: one line of 2,468 characters, and `parseServiceAccount` returned the identical key, which `jose` imports.
- **Mutation tests:** 48 deliberate breakages of the new rules (the MP3 reader's sizes, frames, tags and header guards; the week's start day, length, zones and skipped midnights; the script's cleaning, order, size fallback and Amen; the sign-in's expiry, sharing, audience, scope and error kinds; the call's header, retries, token refresh, audio checks and fields; the settings' voice, rate and half-set rules; the storage writer's upsert, content type and id check; the spoken references), each run in a scratch copy with `--no-check` so that only a failing test counts: **47 are caught by named tests, and one is equivalent** (a second offset pass in the week code is only a speed-up: without it the minute-by-minute search still finds the right instant). Three things it found: the three MP3 header guards were first rejected by other checks, so tests were added that reach each guard alone; `assertEquals` compares through JSON, which prints `NaN` as `null`, so the MP3 tests now check `null` strictly; and a branch in the week code that no time-zone data can reach (the earlier of two midnights, which the first pass already picks) was removed instead of tested.

**What they do not include (yours):** the request flow, the profile read, the limit's database queries, the speech step's wiring, the 402 body, the contract and log fields, the fake world's new routes, the handler tests, the developer check, `audition.ts`, the `--speak` option of `live_check.ts`, and everything that needs your key.

---

## 2. How it works (reference)

### 2.1 The request, with the new steps marked

```
verify the token → validate → read the speech settings (NEW, never throws) → ensure the profile → find the entry
  already ready:  a crisis entry                    → answer as it is
                  devotional, no audio, speech on   → SPEECH ONLY (NEW) → answer
                  anything else                     → answer as it is
→ rate limit (429) → claim → read the recording, if there is one
→ SCREEN (step 21)    crisis → saved as a crisis, answered: no limit, no speech
→ LIMIT (NEW)         over it → saved failed with LIMIT_REACHED, answered 402
→ reflection → passage → save as ready (with the three affirmations)
→ SPEECH (NEW, best effort) → script → Google → MP3 → measure → upload → save the path and the duration
→ answer, built from the saved row
```

A retry of an entry that failed with `LIMIT_REACHED` is claimed again like any failed entry (step 19), screened again (an audio entry from its saved transcript), and checked against the limit again: after an upgrade it passes.

### 2.2 The limit

`checkDevotionalLimit(admin, userId, profile, current)` in `_shared/limits/weekly.ts`, where `profile` is `{ tier, timezone }` read from `users_profile` (no query at all for `trial` or `pro`: they are exempt) and `current` is the claimed row (`id`, `created_at`). For a free account, with `window = weekWindow(now, profile.timezone)`:

- **made** = the count of this user's `journal_entries` with `is_crisis = false`, `id <> current.id`, `created_at >= window.start` and `devotional_script is not null` (a head count: `{ count: "exact", head: true }`);
- **in flight** = this user's rows with `is_crisis = false`, `id <> current.id`, `created_at >= window.start`, `devotional_script is null`, `processing_status = 'processing'` and `updated_at` newer than `now - CLAIM_LEASE_MS` (a lapsed claim is a request that died), selecting only `id` and `created_at`; of those, count the ones **older than `current`**: smaller `Date.parse(created_at)`, and for equal milliseconds the smaller `id`. The tie-break is what makes the answer for two simultaneous entries exactly one allowed and one blocked.
- `used = made + older in flight`. Blocked when `used >= FREE_DEVOTIONALS_PER_WEEK`. The answer carries `used`, the limit and `resetsAt = window.end.toISOString()`.

A failed entry (including one that failed with `LIMIT_REACHED`) has no script and is not processing: it never counts. A crisis entry never counts and never reaches this code. Every query filters by the verified `userId` (AGENTS.md, Backend requirement 2: a test fails on one that does not).

### 2.3 The speech step

`speechStage` never throws; any failure leaves the row as it is. In order:

1. `off` → `tts: "off"`. `bad` → `tts: "bad_config:<SECRET>"`. Elapsed over `speechTiming.latestStartMs` → `tts: "skipped:time"`.
2. `buildSpeechScript` from the saved row: the devotional script, the closing prayer, and the passage **only when `scripture_verified` and both the reference and the text are there**. `null` → `tts: "skipped:script"`.
3. `synthesize(markup, config, startedAt + speechTiming.deadlineMs)`. Failure → `tts: "failed:<reason>"`, and `markSpeechFailed` sets `error_code = 'TTS_FAILED'` (guarded: ready, not a crisis, no audio path; its own failure is ignored).
4. `mp3DurationMs(mp3)` (null stays null: the app's player learns the length when it loads).
5. `storeDevotionalAudio` with a `speechTiming.uploadTimeoutMs` cap (`Promise.race` with a timer that is cleared). Failure → `tts: "failed:storage"`, `TTS_FAILED`.
6. `saveAudio(admin, userId, entryId, path, durationMs)`: one update, `devotional_audio_path`, `devotional_duration_ms`, `error_code = null`, with the filters `id`, `user_id`, `is_crisis = false`, `processing_status = 'ready'` **and `devotional_audio_path is null`**, returning the row; no row means another request got there first, so read the entry again and answer with that.
7. `tts: "ok"`, `ttsMs` (all of 3 to 6), `ttsAttempts`, `ttsChars` (the script's characters: what Google bills), `audioMs`.

### 2.4 The time budget

| what | limit | where |
| --- | --- | --- |
| the crisis screening, all its attempts | 60 s after the request started | `screenTiming.deadlineMs` (step 21 follow-up) |
| the reflection and the passage's second request | 90 s after the request started | `GEMINI_DEADLINE_MS` |
| speech may **start** | in the first 100 s | `speechTiming.latestStartMs` |
| speech's attempts all end | 135 s after the request started; 30 s an attempt, one retry after 1 s, none starts with under 8 s left | `speechTiming.deadlineMs`, `ttsTiming` |
| the upload | 20 s | `speechTiming.uploadTimeoutMs` |
| the platform | 150 s (free plan: checked again on 2026-10-23), 2 s of CPU (waiting is free), 256 MB | Supabase |

The worst case after speech is about 135 s plus an upload that was capped and one database write, so the answer is sent before 150 s. A request the platform kills still leaves a good `ready` entry, and the same request sent again adds the audio.

### 2.5 Retries and idempotency

| the entry is | the same request again |
| --- | --- |
| ready, a crisis | answered as it is (nothing is screened or made) |
| ready, with audio | answered as it is |
| ready, with its devotional and no audio | **speech only** (no screening, no limit, no model call) |
| failed, `LIMIT_REACHED` | claimed again, screened again, checked again |
| failed, anything else | claimed again (step 19) |
| processing, claim fresh | 409 `ALREADY_PROCESSING` |

### 2.6 The contract

In `contracts.ts` and `src/types/index.ts`, and compared by `src/types/contractParity.ts`:

```ts
// The 402 body (step 22): the usual error, the entry that was saved, and the numbers the Paywall needs.
export interface LimitUsage {
  used: number;
  limit: number;
  resetsAt: string; // ISO 8601: the start of next week on the person's clock
}
export interface ProcessEntryLimitError {
  error: { code: "LIMIT_REACHED"; message: string; requestId: string };
  entryId: string;
  usage: LimitUsage;
}
```

`usage.used` is the real count, so it can be higher than `limit` (a person who was Pro earlier in the week and then lapsed, or a test account after several runs): a screen that shows it shows `min(used, limit)`, and the server never clamps it. `ProcessEntryResponse` does not change (`devotional.audioPath` and `.durationMs` are already there). `StoredErrorCode` already has `TTS_FAILED`. The app's `PlanUsage` (tier, used, limit or null, resetsAt) stays as it is for Profile and the Paywall.

### 2.7 The log

`_shared/log.ts` gains seven fields (the line has 30 after this, and `confirm-scripture` fills them with `null` or 0):

| field | holds |
| --- | --- |
| `tts` | `null` (no speech step ran), `"ok"`, `"off"`, `"bad_config:<SECRET_NAME>"`, `"skipped:time"`, `"skipped:script"` or `"failed:<reason>"` (the reasons of section 2.3 and the troubleshooting table: short Google words only) |
| `ttsMs`, `ttsAttempts`, `ttsChars` | time, calls and billed characters of the speech step (0 when none ran) |
| `audioMs` | the measured length, or null |
| `limit` | `null` (no check ran), `"exempt"` (trial or Pro), `"free_ok"` or `"free_blocked"`, with `":bad_timezone"` added when the profile's zone was not valid |
| `limitUsed` | the count the check found, or null |

Never the script, the verse, a link, a path, a key, a token or Google's message.

### 2.8 Cost (from the price pages on 2026-10-23; the real run replaces these estimates)

Chirp 3 HD: the first 1 million characters a month are free, then $30 per million; characters are counted with spaces, newlines and tags; billing must be enabled. A script of 1,300 to 1,700 characters is about $0.04 to $0.05 after the free million (about 600 devotionals a month are free), plus about $0.0015 of Gemini. A daily listener is about $16 to $19 a year of cost against the $59.99 yearly price (AGENTS.md, Subscription Rules). Report the real figure from the real scripts.

---

## 3. Edits to the existing files

1. **`process-entry/constants.ts`**: add `export const speechTiming = { latestStartMs: 100_000, deadlineMs: 135_000, uploadTimeoutMs: 20_000 };` (an object, so tests can shorten it, like `timing` and `screenTiming`), with the table of section 2.4 as its comment.
2. **`_shared/errors.ts`**: `AppError` takes an optional third argument, `details: Record<string, unknown> | null = null`, kept as `readonly details`. `errorResponse` puts it next to `error`: `{ error: { code, message, requestId }, ...(error.details ?? {}) }`. `details` is never logged; it holds only values the function built (`entryId`, `usage`). A small test in `_shared/errors_test.ts`: the usual body is unchanged without details, and the 402 body has the three keys with them.
3. **`_shared/log.ts`** and **`confirm-scripture/handler.ts`**: the seven fields of section 2.7 (`confirm-scripture` sets `tts: null, ttsMs: 0, ttsAttempts: 0, ttsChars: 0, audioMs: null, limit: null, limitUsed: null`). Update both handlers' "the log line holds exactly these fields" tests.
4. **`process-entry/lifecycle.ts`**: add `readProfile(admin, userId): Promise<{ tier: "free" | "trial" | "pro"; timezone: string }>` (an unknown tier reads as `free`; a failed read is `dbFailure("profile_read")`); `saveTranscript(admin, userId, entryId, words)`; `saveAudio(...)` (section 2.3, step 6); `markSpeechFailed(admin, userId, entryId)` (never throws); and a pure `needsSpeech(row)`: `!row.is_crisis && row.processing_status === "ready" && row.devotional_script && !row.devotional_audio_path`. Every query filters by `userId`.
5. **`_shared/limits/weekly.ts`**: add `checkDevotionalLimit` (section 2.2), with the types `LimitProfile` and `LimitDecision`. It is the name prompt 30 expects.
6. **`process-entry/handler.ts`** (the flow of section 2.1):
   - Read `const speech = readTtsConfig(optionalEnv)` once, at the start of `run`.
   - Where a **ready** row is answered (the early `existing` check and `claim.kind === "ready"`), answer through `speechOnly` when `needsSpeech(row)` and `speech.state === "ready"`; otherwise as before. A speech-only request logs `screen: null`, `attempts: 0`.
   - After the screening is clear, **inside the existing `try`**: read the profile, run the limit, set `context.limit` and `context.limitUsed`. When blocked: for an audio entry call `saveTranscript` with the screened words first, then `throw new AppError("LIMIT_REACHED", "free_limit", { entryId, usage: { used, limit, resetsAt } })`. The existing `catch` marks the entry failed with the code. Replace the `TODO(22)` comment.
   - When the claimed row is an audio entry that already has a transcript (it was blocked), screen that text and do not download the recording.
   - After `saveReadyEntry`, call `speechStage` (section 2.3) and answer with the row it returns.
   - **Once the entry is saved (`saveReadyEntry` or `saveCrisisEntry` has returned), nothing may mark it failed.** Today the `catch` calls `failEntry` for any error, so a database hiccup while building the answer would flip a good reflection, or a saved crisis, to `failed`. Keep a `saved` flag, set it right after either save, and have the `catch` skip `failEntry` when it is set: the request answers a plain 500 and the entry stays as it was (a retry answers it from its saved row). Speech makes the window after the save longer, which is why it belongs to this step.
7. **`contracts.ts`, `src/types/index.ts`, `src/types/contractParity.ts`**: the two types of section 2.6 and their parity lines. In `src/types/index.ts` also reword the comment above `ProcessEntryResponse` (it mentions "the 402 body, signed audio URL": there is no URL) and keep the CRLF endings of that file (check `tr -cd '\r' < file | wc -c` first and use a script that matches the LF text).
8. **Markers.** `NewEntryScreen.tsx`: the `TODO(22)` becomes `TODO(25): read entryId from the 402 body (ProcessEntryLimitError) and pass { source: "limit", entryId }`. `PaywallScreen.tsx`: its `TODO(22)` comment ("the server checks crisis before the free-tier limit") becomes a plain statement that the server does (step 22). `src/constants/app.ts`: a comment on `FREE_DEVOTIONALS_PER_WEEK` and `WEEK_STARTS_ON`: "Keep in sync with supabase/functions/_shared/limits/constants.ts". No UI changes.

---

## 4. Tests, the fake world, the developer check and the audition

### 4.1 `process-entry/testing/fakes.ts`

Fold in what `_shared/tts/testing.ts` does, so the handler tests run the real handler, `jose` and `supabase-js` unchanged:

- **Routes:** `oauth2.googleapis.com` (a token; `world.tokenCalls`), `texttospeech.googleapis.com` (`world.ttsCalls`; replies from `world.ttsQueue`, and **by default the real MP3 `_shared/tts/fixtures/b-24k-mono-cbr32-info-id3.mp3`**, so a test that does not care gets audio) and Storage's upload: `POST /storage/v1/object/journal_media/{path}` stores the bytes in `world.storage`, records `{ path, contentType, upsert, cacheControl }` in `world.uploads`, refuses a content type the bucket does not allow (`audio/mp4`, `audio/m4a`, `audio/x-m4a`, `audio/aac`, `audio/mpeg`) and a body over 26,214,400 bytes (the bucket's limit), and answers 409 for an existing path without `x-upsert: true`.
- **Speech is off by default** in the world's environment. A helper `speechOn(world)` sets `GOOGLE_TTS_CREDENTIALS_B64` (a real test key from `makeServiceAccount`) and `TTS_VOICE_NAME`, and `world.restore()` puts the environment back. Clear the token cache (`clearTokenCache()`) in `installWorld` and `restore`.
- **PostgREST:** the limit's queries use `neq`, `gte`, `lt`, `eq`, `is.null` / `not.is.null` filters and head counts; extend the fake where it lacks one, and keep it refusing a column that does not exist.

### 4.2 `process-entry/handler_test.ts` (and `lifecycle_test.ts`, `_shared/limits/weekly_test.ts`)

Each row is a test through the real handler. Name them like the existing ones.

| # | case | expected |
| --- | --- | --- |
| a | speech off (no secrets) | 200 ready, `audioPath` null, `tts: "off"`, no Google call |
| b | speech on, a verified passage | `audioPath` is `{user}/devotionals/{entryId}.mp3`; `durationMs` 5064 (the fixture); the upload was `audio/mpeg`, upsert, `cacheControl "3600"`; the markup Google received equals `buildSpeechScript` of the saved row, with the reading; the response has **no** URL anywhere (`JSON.stringify` has no `http`); `tts: "ok"` and the other new fields |
| c | speech on, the Bible API down (`scripture_verified` false) | ready; the markup has no "A reading from" |
| d | Google answers 403 `SERVICE_DISABLED` | 200 ready, `audioPath` null, `error_code` `TTS_FAILED`, `tts: "failed:tts_http_403:PERMISSION_DENIED/SERVICE_DISABLED"`; then the same request again with Google fixed: audio added, **no screening call and no Gemini call**, `error_code` null, the same devotional |
| e | half-set secrets | ready, no audio, `tts: "bad_config:TTS_VOICE_NAME"` |
| f | the request already took longer than `speechTiming.latestStartMs` (set it to 0) | ready, no audio, `tts: "skipped:time"`; a retry (after restoring it) adds the audio |
| g | the storage upload fails | 200 ready, `TTS_FAILED`, `tts: "failed:storage"` |
| h | two requests ask for audio on the same entry at once | one wins `saveAudio`; both answer with the audio; one row; one file |
| i | a crisis entry, with speech on | no Google call, no limit query, no audio; a retry of it answers as it is |
| j | a free account with 3 devotionals this week sends a 4th | 402 `LIMIT_REACHED`; the body has `error`, `entryId` and `usage` `{ used: 3, limit: 3, resetsAt }` (`resetsAt` is a Monday 00:00 on the profile's clock); the entry is failed with `LIMIT_REACHED`; **a screening call was made and no reflection call**; `limit: "free_blocked"` |
| k | the same, as a **recording** | the screened transcript is saved on the entry |
| l | then the account becomes `pro` (change the fake's row) and the same request is sent | 200 ready; **an audio entry is screened from its saved transcript, and the recording is not downloaded again**; `limit: "exempt"` |
| m | the account stays `free` and the request is sent again | 402 again, still one entry |
| n | trial and Pro, with 10 devotionals this week | allowed, and no count query was made |
| o | a crisis entry while over the limit | the crisis answer (200), never a 402; it is not counted afterwards |
| p | what counts: failed entries (`AI_UNAVAILABLE`, `LIMIT_REACHED`), crisis entries, another user's entries, entries from before the week's start, the entry itself, a processing row with a lapsed claim | none counts; a ready entry with a script counts; a processing row that is **older** than the entry counts; one that is **newer** does not |
| q | two requests at once as the 3rd and 4th (seed two devotionals; send two new ids with `Promise.all`) | exactly one 200 and one 402, whichever order, and repeat it 20 times |
| r | the profile's zone is `Pacific/Auckland` and then `Mars/Phobos` | the week boundary is the Auckland Monday (an entry made Sunday 23:00 there still counts for the old week); the bad zone is read as UTC and `limit` ends `:bad_timezone` |
| s | the log line | exactly the 30 fields, `user` is a short hash, the text of the entry, the script and every key are not in it |
| t | the 402 body for an unauthenticated or invalid request | unchanged by this step |
| u | the database fails while the answer is being built, after the reflection was saved (and again after a crisis was saved) | a 500 `INTERNAL`, the entry is still `ready` (the crisis still a crisis), and the same request afterwards answers it from its saved row |

Re-run all of step 19, 20 and 21's tests: they must still pass, with the changes the new fields force (the "holds exactly these fields" lists).

### 4.3 The developer check (`src/components/dev/processEntryCheck.ts`, a dev-only file: its strings stay inline)

- The first line: **"account plan: free | trial | pro"**, read with the app's own client (`users_profile.subscription_tier`, the row the user may read). A **free account that has used its three** is a correct answer, not a failure: when a case that needs a new devotional (the written entry, the instructions entry, the recording) gets a 402 `LIMIT_REACHED` whose `usage.used` is at least `usage.limit`, print `SKIP <case>: this test account is free and has used its 3 devotionals this week (a 402, which is correct); set it to pro in the Table Editor to run this case (prompt 22, step G)`, skip the cases that need that devotional's audio, and go on to the limit cases below. A 402 whose `usage.used` is **below** the limit, or any 402 for a `trial` or `pro` account, is a FAIL (a bug). Then the closing "Done" line counts a correct 402 as a skip, not as a failure.
- **Audio cases**, after the written entry, when it has `devotional.audioPath`: (1) **"devotional audio: N s"** passes when `durationMs` is between 20,000 and 300,000; (2) **"the app's own link plays"**: `supabase.storage.from("journal_media").createSignedUrl(path, 60)` with the phone's Clerk session (the exact path step 26 will use), then fetch the first 4 KB with a `Range` header: it must answer 200 or 206, `audio/mpeg`, and start with `ID3` or an MPEG sync (`0xFF 0xE?`); (3) **"the public address is refused"**: fetch `${EXPO_PUBLIC_SUPABASE_URL}/storage/v1/object/public/journal_media/${path}`: it must **not** answer 200 (the bucket is private). When the entry has no audio path, print `SKIP  devotional audio: none (speech is off or failed: see the log's tts field)`.
- **"speech added by a retry"**: find the account's newest ready entry that has a devotional and no audio path (`journal_entries`, own rows); if there is one and the written entry did get audio (so speech is on), send its request again (a text entry: its saved `transcript` as the text, same `client_entry_id`): pass when the answer has an audio path, the same entry id and the same devotional script, and the account's entry count did not change. Otherwise `SKIP`.
- **The limit cases, free account only** (skipped with a reason for `trial` and `pro`): **"free limit"**: send a new written entry; pass when it is a 402 `LIMIT_REACHED` whose body has a UUID `entryId`, `usage.limit` 3, `usage.used` at least 3 and a `resetsAt` in the future, and when the crisis sentence still gives a crisis entry; if it is a 200, `SKIP  free limit: this account has not used its 3 this week (run the check twice as pro first)`. **"blocked entry, after an upgrade"**, `pro` or `trial` only: find the newest own entry with `error_code = 'LIMIT_REACHED'` and `processing_status = 'failed'`, send its text again with its `client_entry_id`, and pass when it is a 200 with a devotional and the entry count did not change; `SKIP` when there is none.
- Make the cases that depend on the Bible, Google or the model tolerate "busy" the way step 21's did, and keep the closing line that explains `AI_UNAVAILABLE`.
- Update the comment at the top (the cost of a run is now about $0.09 with speech on: two scripts).

### 4.4 `_shared/tts/audition.ts` (new; by hand, never deployed)

Run: `npx --yes deno@2.9.6 run --no-lock --node-modules-dir=none --config supabase/functions/process-entry/deno.json --allow-net --allow-env --allow-read --allow-write=tts-audition --env-file=supabase/functions/.env.local supabase/functions/_shared/tts/audition.ts [--voices Aoede,Leda,Sulafat,Achernar] [--rates 0.88,0.95] [--one en-US-Chirp3-HD-Aoede@0.92]`

- It needs only `GOOGLE_TTS_CREDENTIALS_B64` (not the voice). It prints nothing secret.
- First `GET https://texttospeech.googleapis.com/v1/voices?languageCode=en-US` with the bearer token: print how many `Chirp3-HD` voices exist and, for each requested voice, whether it is there and its `ssmlGender`. A requested voice that does not exist is reported and skipped.
- Then, for each voice at each rate (default 4 voices at 0.88 and 0.95: eight files), build the script with `buildSpeechScript` from a **made-up sample** inside the file (about 170 words of devotional in the style of the model's, a short prayer, and Psalm 127:2 from the BSB with its spoken reference), call `synthesize`, and write `tts-audition/<voice>-<rate>.mp3` (a name like `Aoede-0.92.mp3`; the folder is created, git ignores it). Print one line per file: voice, rate, characters, bytes, measured duration, seconds the call took, attempts. A failure prints its reason and goes on.
- `--one voice@rate` makes a single file (used by section 5 to measure).
- Never a real person's words, never the key.

### 4.5 `process-entry/live_check.ts`

Add `--speak <out.mp3>`: after the first written case's reflection, build the script, call the real `synthesize` with the settings from `.env.local`, measure with `mp3DurationMs`, write the file, and print the script's characters and bytes, the attempts, the seconds and the measured duration (never the script). It is how section 5 listens to a real reflection read aloud.

---

## 5. The real checks (after your steps A to E; a free-tier Gemini key may still only see made-up text)

Skip this whole section if A to E are not done: say so in the report, finish sections 3, 4, 7 and Part A of section 10, and deploy without speech (step F without `secrets set`). Nothing else waits for it.

1. **The key, by name and shape.** A scratch script (outside the repo) prints, for `GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME` and `TTS_SPEAKING_RATE`: set or empty, and for the credentials whether they decode, parse as a service account (`parseServiceAccount`), and import with `importPKCS8`. **It prints no value, no email and no part of the key.** Fix a problem with the user before going on.
2. **The audition** (section 4.4). Report the voices list (how many `Chirp3-HD` voices, which of the requested four exist) and the table of eight files. Ask the user to listen and choose (step E); then write `TTS_VOICE_NAME` and `TTS_SPEAKING_RATE` into `.env.local` (report the names only).
3. **Measure the chosen voice** with `--one` three times: the seconds each call took (the first includes the sign-in), the characters and bytes, **the MP3's own sample rate, bit rate and channels** (read the first frame's header), and the length from `mp3DurationMs` against `ffprobe -show_entries format=duration` and against `packets x samples per frame / rate`: they must agree within 100 ms. **Report the length of a typical devotional against the "about 60 seconds" that AGENTS.md promises:** the model writes 140 to 190 words, so with the prayer and the verse expect roughly 1.5 to 2 minutes at normal speed; the speaking rate and the prompt are the two levers, and the choice is the user's (say what you measured; do not change either). **If Google refuses `audioEncoding: "MP3"` (a 400), stop and ask**: the Chirp 3 HD page lists MP3 for its non-streaming ("batch") requests and this is the first real call.
4. **A real reflection read aloud:** `live_check.ts --speak out.mp3` on the made-up entries. The user listens (the same things as step E, and "no odd pauses or read-out symbols", which prompt 32 asks again). Report each script's characters.
5. **The failure paths, at no cost:** a made-up voice name must give `tts_http_400:INVALID_ARGUMENT`; a made-up service account must give `tts_auth:invalid_grant`; a second call must reuse the token (one token request for two syntheses).
6. **The price**: from the real script lengths and the price page, the cost of one devotional's speech (and with Gemini). Report it against section 2.8.

---

## 6. Deploy and the hosted check (the user deploys)

AGENTS.md: deploying an Edge Function needs the user's yes, and the user runs the commands. Show first: Part A green, the voice and rate chosen (or "speech not set up yet"), the numbers of section 5, the time limits of section 2.4, and the list of cases of section 4.2 with their results. Then ask: **"Deploy process-entry and confirm-scripture with speech and the free limit?"** On a yes, give the user the commands of step F with their reference filled in (leave `secrets set` out if speech is not set up).

After they say "deployed":

1. With `curl.exe` from the PowerShell tool (and never the user's token): the four probes of step 21's follow-up (no token and a made-up bearer to each function: the function's own 401 body; GET: 405; OPTIONS: 204). The new build must boot (a platform error means a missing import).
2. The user runs steps G and H on the phone and sends the screenshots. Read every line; a FAIL is reported, not hidden.
3. The user exports the function's log as CSV (Edge Functions, `process-entry`, Logs, the export button) and pastes it. Check: every line has the 30 fields; a written entry has `tts: "ok"`, `audioMs`, `ttsChars` and `limit` words; a crisis has `tts` and `limit` null; the 402 has `limit: "free_blocked"`; nothing of the script, the verse, a link, a path, a key or a token appears; `user` is the short hash.
4. Record the hosted results in the Step 22 log entry.

---

## 7. AGENTS.md updates

**Done in the review** (read them; change only what the build proves different): the Text-to-Speech line of the Tech Stack; the server-only secrets list (`GOOGLE_TTS_CREDENTIALS_B64`, `TTS_VOICE_NAME`, `TTS_SPEAKING_RATE`; no `GOOGLE_TTS_API_KEY`); the "Google Cloud Text-to-Speech" vendor note (it replaced the old "Journey voices" note: the API-key finding, the request, the limits, the price, the data statement, the alternatives); the Gemini terms note (the Cloud Text-to-Speech data check is done); Backend requirement 10 (the free tier's rules and its known limit), requirement 12 (the speech budget) and the new requirement 13 (speak the devotional); the `_shared/` line of the architecture tree; a "Spoken devotional (step 22, on the server)" block in the Audio Rules; the cost estimate in the Subscription Rules; and the billing reminder, which was later deleted when the user said billing was done (its facts are in the Google billing entry of the log).

**You write:**

- The **Step 22 log entry** at the end of "Build Status & Decisions Log" (before "Final Reminder"), in the same shape as steps 19 to 21: decisions, what was added and changed, the real checks (the measured latency, the MP3's format, the length accuracy, the cost per devotional), the hosted results, not verified, open items, and the markers left.
- The **voice and rate chosen** in the vendor note (the voice name is not a secret).
- Anything in requirement 13 or the logs' field list that the build changed.
- The billing reminder entry is already deleted (the user said billing was done on 2026-10-23): do not add it back. If step A's two checks (the Cloud console no longer says "Free trial account", the Gemini credits show) turn out not to be done, say so in the report and in the Google billing log entry.
- Copy AGENTS.md to `prompts/AGENTS.md` and `cmp` them.
- **Public repo:** write `<project-ref>` and `<dev-instance>`, never the service account's email (it holds the project id), the key, a local path or a billing identifier, in any committed file.

---

## 8. Rules

- No new package, no UI change, no migration, no `any`, no environment switch in production code.
- Never log or return the script, the verse, a link, a path, a key, a token, the service account's email or Google's own message.
- Never create a public URL or make the bucket public. The function returns no link.
- The service account's key never enters the repo, a chat, a screenshot or a log; the downloaded file is deleted after step D; the implementer never prints a value. The audit script searches every file for the new secret's value too.
- Speech never fails or blocks a reflection, and never runs for a crisis entry. A crisis is never counted and never blocked by the limit.
- Every query on a user's table filters by the verified `userId`; a `user_id` in the request body is never read.
- The user deploys: `secrets set` and `functions deploy` are theirs, and the implementer never holds a management token.
- Do not commit or push unless asked. If asked, follow "Committing and publishing" in AGENTS.md (the audit before and after).

---

## 9. Notes for later steps (reported, not edited: reconcile each at its own review)

- **24:** `LIMIT_REACHED` uses `entryId` from `ProcessEntryLimitError`. Send queued entries **one at a time**: the 10-in-10-minutes rule would refuse a burst, and every blocked or retried entry costs a screening call. The client never retries a `LIMIT_REACHED` entry by itself while the account is free (that is also what keeps the known limit in finding 13 small).
- **25:** `getUsage()` should count only devotionals made (`devotional_script is not null`, not a crisis, `created_at` at or after `weekWindow(now, zone).start`; copy `weekWindow`, there is no `weekStart` function: prompt 25 says `weekStart`) and ignore entries in flight; the server's 402 `usage` is the authority. Read `entryId` from the 402 body for `Paywall { source: "limit", entryId }`. Treat a ready entry with no `devotional.audioPath` as "audio not made yet", and `failureCode: "TTS_FAILED"` on a ready entry as informational, not a failure to show; a "Prepare audio" action may send the same request again (speech only).
- **26:** delete "the process-entry response URL (step 22) seeds the cache": there is no URL. Mint with `createSignedUrl(path, 3600)`. `devotional.durationMs` can be null for an unmeasurable file: let the player take the length when it loads, and relax `getPlaybackTrack`, which today wants a measured length.
- **27:** no change: the server's MP3 is voice only.
- **29 and 30:** the count is by `created_at` (finding 13); a `devotional_at` column in a migration would count by when a devotional was made. Prompt 30 names `checkDevotionalLimit` in `_shared/limits/weekly.ts` (it is there now) and the tier-expiry handling.
- **31:** the export reads `{userId}/devotionals/`; deleting an account must remove that folder itself (the database cascade only removes rows).
- **32:** the audio is longer than the "about 60 seconds" of AGENTS.md (a 140 to 190 word devotional, a prayer and a verse are about 1.5 to 2 minutes): decide whether `gen-v2` should write less, or the rate should go up, from the length step 22 measured. `audition.ts` and `live_check.ts --speak` are how to listen to a changed prompt's output: odd pauses, read-out symbols, "You/Your" capitalised or not, verse variety. A `gen-v2` that writes longer devotionals changes the script size.
- **Development:** your own account is on the free plan and will hit the limit after three devotionals in a week: set your row to `pro` or `trial` in the Table Editor while building steps 23 to 29.

---

## 10. Verify

### Part A: always (no key, no download)

```
D="npx --yes deno@2.9.6"; C="--config supabase/functions/process-entry/deno.json"
$D check --no-lock --node-modules-dir=none $C supabase/functions/process-entry/index.ts supabase/functions/confirm-scripture/index.ts supabase/functions/process-entry/live_check.ts supabase/functions/_shared/safety/eval/run_eval.ts supabase/functions/_shared/tts/audition.ts
$D check --no-lock --node-modules-dir=none --config supabase/functions/confirm-scripture/deno.json supabase/functions/confirm-scripture/index.ts
$D lint $C supabase/functions/process-entry supabase/functions/confirm-scripture supabase/functions/_shared
$D fmt --check --line-width=120 supabase/functions
$D test --no-lock --node-modules-dir=none $C --allow-net --allow-env --allow-read supabase/functions/process-entry supabase/functions/confirm-scripture supabase/functions/_shared
node supabase/tests/process-entry/parity.cjs
npm run typecheck
npm run lint
grep -rnE "TEMP\(|TODO: real" src
```

All must exit 0 (the last prints the same 17 lines as before: this step adds no marker of that kind). Then:

1. **Count the tests per file** against section 1 and the new ones of section 4.2. Deno finds tests only under the folder of the `--config` file, so the command names every function folder and `_shared`: a missing folder is a silent skip.
2. **Prove the linter covers a new file** by planting a `var` in a new `_shared` file and deleting it.
3. **Prove the contract check bites:** add one field to `ProcessEntryLimitError` in `contracts.ts` only; `npm run typecheck` must fail at `contractParity.ts`; restore the file and `cmp` it.
4. `grep -rn "createSignedUrl\|signedUrl\|devotional_audio_url" supabase/functions` finds only comments: the function mints and returns no link.
5. The 30-field log test of 4.2 (s) passes, and there is no new `console.` call in the functions.
6. **The secrets audit** over every changed or new file: the literal values of both `.env.local` files (the new secret's included), the project reference, the Clerk domain, key shapes (`AQ.`, `AIza`, `sb_secret_`, JWTs, private key blocks, `BEGIN PRIVATE KEY`), emails other than `example.com`, local paths. Names and counts only, never a value.

### Part B: the real checks (section 5), after your steps A to E

### Part C: after the deploy (section 6 and steps F to H)

### Mutation check

The review mutation-tested the new modules (section 1). Do the same for what you add, in a scratch copy of `supabase/functions` (never the repo; leave out `.env.local`) with `deno test --no-check`, so only a failing test counts: each must fail a named test. Grep the results for "type error" and redo those with `--no-check`. At least:

1. the limit counts crisis entries; 2. it counts failed entries; 3. it counts the entry being checked; 4. it counts a lapsed claim; 5. the in-flight rule ignores who is older (both of two simultaneous entries blocked); 6. trial or Pro is not exempt; 7. the limit runs before the screening; 8. a crisis can get a 402; 9. the 402 body lacks `entryId` or `usage`; 10. a blocked audio entry does not save its transcript; 11. a retry of a blocked audio entry downloads the recording again; 12. speech runs for a crisis entry; 13. the speech-only retry screens or calls the model; 14. `saveAudio` loses its "audio path is null" filter; 15. a speech failure fails the request; 16. the passage is read when it is not verified; 17. the response carries a link; 18. `TTS_FAILED` is not cleared when audio is added; 19. the speech start time is ignored; 20. the log carries script text; 21. `failEntry` still runs after the entry was saved.

### Not verified, and said so

The sound of the voices until you listen (step E); the real latency, the MP3's format and the length accuracy until section 5; playback on a phone (step 26); the hosted function until you deploy; a real person's devotional (nothing real is sent while the Gemini key is the free-tier one); the production Clerk issuer; and the free limit in time zones the tests do not list.

---

## 11. Report

The pricing found and the cost of one devotional's speech (and with Gemini); the voice and rate chosen, or "speech not set up yet"; the files created and changed; the real MP3's format and the duration accuracy against `ffprobe`; the limit's rules as built and the results of cases a to u; whether the Google part (A to E) is done, and if not what still blocks the sound; whether deployed, and the hosted results; every marker left for steps 24, 25, 26, 29 and 30; and any difference from this prompt, each with its reason.

**At the end of your report, remind the user about the unfinished Google billing if it is still open (AGENTS.md, Instructional Memory), naming the next item.**
