# 22-tts-and-storage.md

Read AGENTS.md first and follow it strictly.

Add devotional audio to process-entry: build a safe speech script on the
server, synthesize it with Google Cloud Text-to-Speech, upload the MP3 to
the private journal_media bucket, measure its real duration, and return a
short-lived signed URL. Also enforce the free tier (3 devotionals per
week) on the server, after crisis screening. Client playback comes in
step 26, ambient sound in step 27 (mixed on device, never on the server),
client wiring in step 25. No UI changes. No new dependencies.

AGENTS.md requires approval before deploying Edge Functions, migrations
and pricing/limit changes. Build and test locally; deploy only after the
user says yes (section 11).

Docs (source of truth, follow exactly):

- https://docs.cloud.google.com/text-to-speech/docs/chirp3-hd
  (voices, markup field + pause tags, speaking_rate 0.25–2.0, MP3 in
  batch/synchronous requests, supported SSML subset)
- https://docs.cloud.google.com/text-to-speech/docs/reference/rest/v1/text/synthesize
- https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
- https://docs.cloud.google.com/text-to-speech/quotas
- https://cloud.google.com/text-to-speech/pricing
- https://supabase.com/docs/reference/javascript/storage-from-upload
- https://supabase.com/docs/reference/javascript/storage-from-createsignedurl

---

## 1. Before writing code

1. Read supabase/functions/process-entry/ (index.ts, lifecycle.ts,
   contracts.ts, gemini.ts), \_shared/ (including bible/reference.ts),
   supabase/migrations/ (step 18 columns, bucket settings, storage
   policies), src/types/index.ts, src/constants/app.ts
   (FREE_DEVOTIONALS_PER_WEEK) and src/data/journalRepository.ts
   (getUsage mock).
2. Confirm columns exist: devotional_audio_path, devotional_duration_ms,
   devotional_audio_url (deprecated), error_code, processing_status,
   is_crisis, devotional_script, scripture_verified, timezone,
   subscription_tier. If any is missing, stop and ask (step 18 owns the
   schema).
3. Pricing check: read the pricing page and report the current price and
   any free tier for Chirp 3: HD voices. Do not assume "1M free
   characters/month". Estimate the cost per devotional from the average
   script length in section 3.
4. Ask the user to confirm two settings:
   - WEEK_STARTS_ON = 1 (Monday, 00:00 in the profile's time zone).
   - FREE_DEVOTIONALS_PER_WEEK = 3.
     Do not change either without a yes.

---

## 2. Voice choice and secrets

Secrets (add to supabase/functions/.env.example, empty values):
GOOGLE_TTS_API_KEY=
TTS_VOICE_NAME= # e.g. en-US-Chirp3-HD-<Name>
TTS_LANGUAGE_CODE=en-US
TTS_SPEAKING_RATE=0.92 # 0.25–2.0
No voice name in code. Fail fast (500 INTERNAL, log
"missing_config:<NAME>") if the key or voice is missing.

Voice audition (dev script, never deployed):
supabase/functions/\_shared/tts/audition.ts creates the same sample
devotional with 3–4 calm, warm female Chirp 3 HD en-US voices from the
docs list (for example Aoede, Leda, Sulafat, Achernar; confirm they
exist in list-voices for en-US), at rates 0.88 and 0.95. Save the MP3s
to ./tts-audition/ (gitignored). Ask the user to listen and pick the
voice and rate. Write their choice into .env.local only.

Recommend in the report: restrict GOOGLE_TTS_API_KEY in Google Cloud
Console to the Cloud Text-to-Speech API only, with no app or browser
restrictions that would block server calls. This key never ships in
the app.

---

## 3. Speech script builder: \_shared/tts/script.ts

buildSpeechScript(input): { markup: string; plainText: string;
chars: number }
input = { title: string | null; devotional: string;
scripture: { reference: string; text: string } | null;
closingPrayer: string | null }

Rules:

- Build from plain text only. Never pass model output straight to TTS.
- Sanitize every field: remove anything that looks like a tag
  (<...>), remove square brackets [ and ], remove emojis and control
  characters, normalize quotes, collapse spaces. Keep paragraph breaks
  (blank lines).
- Order, with pause tags between sections (markup version):
  opening line: "Here is your devotional." [pause]
  devotional paragraphs, joined with " [pause] "
  scripture (only when verified — the caller passes null otherwise):
  "[pause long] A reading from {spokenReference}. [pause short]
  {verse text} [pause long]"
  closing prayer: "Let's pray. [pause short] {prayer} Amen."
- plainText = the same content with no pause tags (paragraphs separated
  by "\n\n"), used when the voice doesn't support markup.
- spokenReference(ref) in \_shared/bible/reference.ts:
  "Philippians 4:6–7" → "Philippians chapter 4, verses 6 through 7"
  "John 3:16" → "John chapter 3, verse 16"
  "Psalm 23:1–3" → "Psalm 23, verses 1 through 3"
  "1 John 4:18" → "First John chapter 4, verse 18"
  Numbered books read First/Second/Third.
- Size limit: the synthesize request input must stay under the
  documented limit (check the quotas page; 5,000 bytes for text/SSML at
  the time of writing). If the full script is over 4,800 bytes, drop the
  scripture reading first, then the closing prayer. Never cut the
  devotional mid-sentence. If it's still too long → skip TTS and log
  "tts_script_too_long".
- Unit tests: sanitization strips <speak>, [pause], emojis; reference
  speech forms; the size fallback order.

---

## 4. TTS client: \_shared/tts/synthesize.ts

synthesize(script): Promise<{ ok: true; mp3: Uint8Array } |
{ ok: false; kind: 'TRANSIENT' | 'INVALID' }>

- POST https://texttospeech.googleapis.com/v1/text:synthesize with header
  x-goog-api-key. Never put the key in the URL.
- Body:
  input: Chirp 3 HD voice (TTS_VOICE_NAME contains "Chirp3-HD") →
  { markup }; otherwise → { text: plainText }
  voice: { languageCode: TTS_LANGUAGE_CODE, name: TTS_VOICE_NAME }
  audioConfig: { audioEncoding: 'MP3', speakingRate: TTS_SPEAKING_RATE }
  Do not send pitch or effectsProfileId unless the docs list them for
  the chosen voice. Use the field casing the REST reference shows.
- Timeout 30 seconds. Retry once after 1s on 429, 5xx or timeout →
  then TRANSIENT. 400 → INVALID (log the status only).
- Decode audioContent from base64. Empty or under 1 KB → INVALID.

Duration: \_shared/tts/mp3Duration.ts
mp3DurationMs(bytes: Uint8Array): number | null

- Skip an ID3v2 tag if present. Walk MPEG audio frame headers (sync
  0xFFE), reading version, layer, bitrate index, sample rate and padding
  to step frame by frame. Duration = total samples / sample rate.
  If there's a Xing/Info header with a frame count, use it.
- Any invalid header before 90% of the file → null.
- Unit tests with a small MP3 fixture created once by the audition
  script (commit only a short one, under 50 KB). Its duration must be
  within ±100 ms of the expected value.

---

## 5. Storage: \_shared/tts/storeAudio.ts

storeDevotionalAudio(userId, entryId, mp3):
Promise<{ path: string; signedUrl: string; expiresAt: string }>

- path = `${userId}/devotionals/${entryId}.mp3` (step 18 layout).
- Upload with the service-role client to journal_media: contentType
  'audio/mpeg', upsert true (safe retries), cacheControl '3600'.
- createSignedUrl(path, SIGNED_URL_TTL_SECONDS = 3600).
- Never create public URLs. Never write devotional_audio_url again.
- Upload error → throw AppError('INTERNAL'). Log size and ms only.

Client note (for step 26, write it in AGENTS.md now): the app refreshes
links itself with supabase.storage.from('journal_media')
.createSignedUrl(path, 3600). The step 18 select policy already allows
this for the user's own folder. Only the path is stored in the database.

---

## 6. Free-tier limit: \_shared/limits/weekly.ts

weekStart(now: Date, timeZone: string, weekStartsOn: 1): Date (UTC)
checkDevotionalLimit(admin, userId, profile, currentEntryId):
Promise<{ allowed: true } |
{ allowed: false; used: number; limit: number;
resetsAt: string }>

- pro or trial → allowed (no query). // TODO(30): tier set by the
  RevenueCat webhook, including trial expiry.
- free → count journal_entries where user_id = userId, id <>
  currentEntryId, is_crisis = false, created_at >= weekStart, and
  (devotional_script is not null OR processing_status = 'processing').
  Counting processing rows stops parallel requests from getting a 4th.
- weekStart uses the profile's time zone with Intl only (no library).
  Test the DST boundary (America/New_York, first Monday after the
  spring-forward Sunday) and a UTC+13 zone.
- Invalid time zone → use 'UTC' and log "bad_timezone".
- Constants in one file, \_shared/limits/constants.ts:
  FREE_DEVOTIONALS_PER_WEEK = 3, WEEK_STARTS_ON = 1. The client mirror in
  src/constants/app.ts gets the same values plus a comment "Keep in sync
  with supabase/functions/\_shared/limits/constants.ts".

---

## 7. Flow changes (index.ts)

After screening (step 21) returns clear:
9 limit check (replaces the // TODO(22)):
not allowed → set entry processing_status 'failed',
error_code 'LIMIT_REACHED' (transcript kept) → return 402:
{ error: { code: 'LIMIT_REACHED', message, requestId },
entryId, usage: { used, limit, resetsAt } }
Crisis entries never reach this line (they return in step 8).
10–12 generation, scripture, save (unchanged)
13 TTS (new), only for ready, non-crisis entries: - Build the script with scripture only when scripture_verified. - synthesize → mp3DurationMs → storeDevotionalAudio. - Update the entry: devotional_audio_path, devotional_duration_ms
(null if unmeasurable). - TTS or storage failure → keep the entry ready, path null,
error_code 'TTS_FAILED' (informational), log it, still return 200.
14 Response adds devotional.audio:
{ path, url, expiresAt, durationMs } | null

Idempotent retries (lifecycle claim, extend step 19 rules):

- ready + crisis → return as is (step 21).
- ready + devotional_script present + devotional_audio_path null →
  run step 13 only (no limit check, no Gemini) and return.
- ready + audio path present → return with a fresh signed URL.
- failed with error_code 'LIMIT_REACHED' → reclaim and run the limit
  check again (after an upgrade it passes; the transcript is reused, so
  screening runs on the saved transcript text, not the audio).
- If total time reaches 110 seconds before step 13, skip TTS (entry
  ready, path null) so the function stays under the platform limit.
  Check the Edge Functions limits page and report the current wall-clock
  limit.

contracts.ts + src/types/index.ts (kept in sync):

- ProcessEntryResponse devotional.audio as above.
- 402 body shape with entryId and usage.
- Add 'TTS_FAILED' to the stored error codes (not a response error).
  Update the client mock in journalRepository only so it type-checks.
  Close the step 16 TODO: Paywall receives entryId from this 402 body.
  // TODO(25): wire it.

---

## 8. Remove the deprecated public URL column (approval gate)

1. grep the repo for devotional_audio_url. Every read must be gone or
   marked // TODO(26) with a plan to use the path. Report each hit.
2. Ask: "Drop journal_entries.devotional_audio_url now?" Only on yes:
   `npx supabase migration new drop_devotional_audio_url` with
   `alter table public.journal_entries drop column if exists
devotional_audio_url;`, run `npx supabase db reset` locally twice,
   rerun supabase/tests/rls_test.sql, regenerate types (`npm run
types:db`). Push to the hosted project only after a second yes
   (same steps as step 18 section 8).
3. If no: leave it and keep the AGENTS.md gap.

---

## 9. Logging

Allowed: requestId, hashed user id, tts ms, tts attempts, script chars,
mp3 bytes, duration ms, upload ms, limit allowed/used counts, voice name.
Never: script text, verse text, transcript, signed URLs, paths with the
raw user id, API keys.

---

## 10. Local testing

1. `deno test` (script builder, spokenReference, mp3Duration, weekStart).
2. Run the audition script; the user picks a voice.
3. `npx supabase functions serve process-entry`, then curl:
   a. clear text entry → 200 with devotional.audio url; the signed URL
   plays in a browser; durationMs within 1s of the real length
   b. the same file's public URL (/object/public/...) → fails (bucket
   private)
   c. verified scripture → the reading is heard; force unverified (step
   20 dev switch) → no reading in the audio
   d. GOOGLE_TTS_API_KEY invalid → 200, entry ready, audio null,
   error_code TTS_FAILED; fix the key, retry the same clientEntryId
   → audio added, no new Gemini call (check logs)
   e. free user: 3 entries → 200; 4th → 402 with entryId and usage;
   entry saved as failed/LIMIT_REACHED with its transcript
   f. set that user to pro in SQL (service role), retry the 4th
   clientEntryId → 200 with a devotional
   g. crisis entry while over the limit → crisis response, never 402
   h. two parallel requests as the 3rd and 4th entries → only one passes
   i. profile time zone Pacific/Auckland: week boundary matches local
   Monday 00:00
   j. a devotional containing "[pause long]" and "<speak>" text from the
   model → both removed from the spoken script (check with a unit
   test, not logs)
4. Re-run step 20 and 21 tests; they must still pass.

---

## 11. Deploy (approval gate)

Show: pricing check and cost per devotional, voice chosen, week rule
confirmed, test results a–j, the Edge Function time limit found, and
section 8 status. Ask: "Deploy process-entry with TTS and the free
limit?" Only on yes: `npx supabase secrets set GOOGLE_TTS_API_KEY=...
TTS_VOICE_NAME=... TTS_LANGUAGE_CODE=en-US TTS_SPEAKING_RATE=...`
(values from the user, never printed), then
`npx supabase functions deploy process-entry`; re-run cases a and e
against the hosted URL.

---

## 12. AGENTS.md updates

- Tech Stack: "Google Cloud TTS, Chirp 3 HD voice from TTS_VOICE_NAME
  (Journey voices were renamed Chirp-HD by Google)." Remove "en-US-
  Journey-F", "pitch -1.5", "Natural Breath Pacing" and "1M free
  chars/mo" unless the pricing check confirms it.
- Audio Rules: server builds the script; scripture spoken only when
  verified; MP3 at {userId}/devotionals/{entryId}.mp3; only the path is
  stored; signed URLs 1 hour, refreshed by the client; duration measured
  from the MP3; ambient sound mixed on device (step 27), never baked in.
- Free Tier Rules: 3 per week, Monday 00:00 profile time zone, checked
  on the server after crisis screening, crisis never counted or
  blocked, processing rows count, 402 returns entryId + usage.
- Remove "devotional_audio_url deprecated" from Known Schema Gaps if
  section 8 dropped it.

---

## 13. Rules

- No new dependencies, no UI changes, no `any`. No migration except the
  approved section 8.
- Never log or return script text, verse text or API keys.
- Never generate a public URL or make the bucket public.

Report: pricing found and cost per devotional; voice and rate chosen;
files created and changed; the duration method and test accuracy; the
week rule; test results a–j; section 8 outcome; whether deployed; and
every TODO left for steps 25, 26, 27 and 30.
