# 19-process-entry-hardening.md

Read AGENTS.md first and follow it strictly.

Build the foundation of the Supabase Edge Function `process-entry`: real Clerk session verification, input validation, an idempotent entry lifecycle, a schema-enforced Gemini call, output validation and one error format. Scripture hydration comes in step 20, dedicated crisis screening in step 21, and speech, signed audio and the free-tier limit in step 22. The app keeps using the mocked submit until step 25. No UI changes except the developer panel.

**The function did not exist.** The old text of this step spoke of a draft to fix, but `supabase/functions/` was empty and there was no `config.toml`. So the review of this step wrote the function and proved it offline with Deno: 90 tests, 19 deliberate breakages each caught by a test, the real `jose` and `supabase-js` running on top of a fake Clerk key set, fake Gemini, fake PostgREST and fake Storage. What the review cannot see is everything that needs a real key, your Supabase project or your phone. That is this step:

- **(a)** you create a Gemini key and put three lines in one file (next section);
- **(b)** the implementer re-runs every check, applies the small developer-panel change (section 3), and runs the real Gemini API with made-up text on this computer (section 4);
- **(c)** you log in to Supabase's command line and deploy the function (a few short commands, which are yours to run), and the developer panel on your phone checks it end to end (section 5).

Nothing is deployed, no migration is run and no dashboard setting is changed without you. No package is added to the app.

Sources, checked in the review on 2026-10-22:

- https://ai.google.dev/gemini-api/docs/structured-output, `/interactions`, `/audio`, `/models`, `/pricing`, `/safety-settings`, `/whats-new-gemini-3.8` and https://ai.google.dev/gemini-api/terms
- https://supabase.com/docs/guides/functions (`/secrets`, `/auth`, `/dependencies`, `/limits`) and https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- https://clerk.com/docs/guides/sessions/manual-jwt-verification
- the installed `@supabase/supabase-js` 2.118.0 (`functions.invoke`, `fetchWithAuth`)
- Deno 2.9.6, `jose` 6.2.13 and the Supabase CLI 2.121.0, all run through `npx` (nothing is installed on the computer or in the app).

---

## What you do yourself (read this first)

The implementer cannot do this: it is your Google account, your Supabase project and your phone. A to C take about 10 minutes and can be done now; D to G come after the implementer has finished section 4. If you would rather be walked through it, ask the implementer to guide you **one instruction at a time**, as in steps 17 and 18: you do it, send a screenshot, and it tells you the next one.

### Keys: what this step needs (checked in the review)

`.env.local` already holds the three names the app uses, all set (checked by name only, never by value): `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY`, `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`. **The app needs nothing new.** The function needs three secrets that do not exist yet, in a new file `supabase/functions/.env.local` (git ignores it):

| name | value | where it comes from |
| --- | --- | --- |
| `GEMINI_API_KEY` | a key | **you create it in step A** |
| `GEMINI_MODEL` | `gemini-3.8-flash` | chosen in the review: the stable Flash model on 2026-10-22 |
| `CLERK_ISSUER` | `https://<dev-instance>.clerk.accounts.dev` | read from your Clerk publishable key and confirmed in the review: that address serves an RS256 key set, and it is the domain you registered in Supabase in step 17 D |

Two optional secrets, left out on purpose: `GEMINI_THINKING_LEVEL` (the function uses `low`) and `CLERK_AUTHORIZED_PARTIES`. The Supabase address and the project's secret key are provided to the function by the platform: you never set them. **Never paste a key into the chat, a file other than the one below, or a screenshot.** If you ever do, revoke it at once and make a new one.

### A. Create a Gemini key (free tier is right for this step)

1. Open https://aistudio.google.com/apikey and sign in with the Google account that should own the key.
2. Click **Create API key**. If it asks for a project, choose to create the key in a new project and name it `gracehush-dev`.
3. Copy the key (it starts with `AIza`). Keep the page open until step B is done.
4. **Do not** click anything that says "Set up billing". On the free tier Google may read what the key receives and use it to improve its products, which is why this step only ever sends **made-up** text. The key is replaced by one from a billed project **before step 25**, the first step that can send a real person's prayer.

### B. Make `supabase/functions/.env.local`

1. In VS Code's Explorer open `supabase`, then right-click the `functions` folder, choose **New File** and type `.env.local`.
2. Paste these three lines, putting your key after the first `=`:

```
GEMINI_API_KEY=paste-your-key-here
GEMINI_MODEL=gemini-3.8-flash
CLERK_ISSUER=https://<dev-instance>.clerk.accounts.dev
```

3. Press **Ctrl+S**. The tab must show no white dot: an unsaved tab is invisible to every check. Do not add blank lines or other lines.

### C. Record a short test clip (optional, recommended)

It proves that a recording like the app's reaches Gemini and comes back transcribed. 1. Press the Windows key, type **Voice Recorder** and open it. 2. Record 10 to 20 seconds of a **made-up** prayer in your own voice (not a real private one) and stop. 3. Right-click the recording, choose **Open file location**, copy the `.m4a` file to your Desktop and rename the copy `test-prayer.m4a`. Keep it outside this repo. (No Voice Recorder? Any `.m4a` from your phone will do.)

**Then tell the implementer "A to C are done".** It runs the real Gemini API on this computer (section 4) and shows you the result before anything is deployed.

### D. Log in to the Supabase command line, once

In VS Code open **Terminal, New Terminal** and run:

```
npx --yes supabase@2.121.0 login
```

Press Enter when it offers to open the browser, log in to Supabase, copy the verification code the page shows, paste it into the terminal and press Enter. It says "You are now logged in." The login stays on this computer, outside the repo, and you can revoke it later at Account, Access Tokens in the dashboard. **The implementer never runs a command against your project; D, E and the deploy are yours.**

### E. Set the secrets and deploy (three commands)

After section 4 the implementer gives you these with your project reference filled in (it is the first part of your Supabase URL; it is not a secret). Run them in the same terminal, from the repo's top folder, one at a time:

```
npx --yes supabase@2.121.0 secrets set --env-file supabase/functions/.env.local --project-ref <ref>
npx --yes supabase@2.121.0 functions deploy process-entry --project-ref <ref> --use-api
npx --yes supabase@2.121.0 secrets list --project-ref <ref>
```

The first says the secrets were set, the second ends with "Deployed Functions on project <ref>: process-entry", and the third lists names and short fingerprints, never values (all three of yours should be there, and no others starting with `GEMINI` or `CLERK`). `--use-api` makes Supabase build the bundle on its side, because there is no Docker here. If a command shows an error, send the whole message to the implementer. **Tell it "deployed" when the second command has finished.**

### F. Upload the test clip (only if you did C)

1. Clerk dashboard, **Users**, open `gracehush17b+clerk_test@example.com` (the second test account from step 17) and copy its **User ID**, which starts with `user_`.
2. On your Desktop rename the clip to exactly `00000000-0000-4000-8000-000000000019.m4a`.
3. Supabase dashboard, **Storage**, the bucket **journal_media**: **Create folder**, paste the user id as the name, open it, **Create folder** `raw`, open it, **Upload file** and pick the renamed clip.

### G. Run the check on your phone

1. Reload the app in Expo Go. In Profile, scroll to **Developer**. If you are signed in as yourself, tap **Sign out (dev)** and sign in as `gracehush17b+clerk_test@example.com` with code `424242`. This keeps your own account clean.
2. Tap **Supabase check (dev)**. The new line `token issuer:` must read `<dev-instance>.clerk.accounts.dev`. If it shows another host, tell the implementer before going on: the `CLERK_ISSUER` secret is wrong.
3. Tap **Process-entry check (dev)** and wait up to about two minutes. One line appears as each case finishes (`PASS`, `FAIL` or `SKIP`, with the HTTP status and the time). Send a screenshot of all of them.
4. Tap **Sign out (dev)** and sign back in as yourself.

The check leaves a handful of test entries under the test account. They do not show in the app until step 25; delete them in the Table Editor whenever you like. Running the check more than twice within ten minutes hits the rate limit (429) on purpose.

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **Gemini is called through the Interactions API, not `generateContent`.** The structured-output, audio and models pages now document only Interactions for the current models; Google calls it generally available and recommended for new projects and `generateContent` legacy but fully supported. The old text of this step asked for `generationConfig` field names that those pages no longer show. `gemini.ts` is the only file that knows the wire format, so a change of API later is a change of one file.
2. **Model `gemini-3.8-flash`, thinking `low`, no temperature, at most 8,192 output tokens, and `store: false`.** Gemini 3 and later take no `temperature` (the old text said 0.3). **`store` defaults to true, which keeps a request and its reply on Google's servers for 55 days; a prayer is never stored.** Prices on 2026-10-22: $0.75 per million input and $3.75 per million output tokens (thinking included) until 2026-12-31, then $1.50 and $7.50.
3. **A free-tier key, made-up text only, for this step; a billed project before step 25.** (AGENTS.md "Gemini API terms", re-read on 2026-10-22.)
4. **`jose` 6.2.13 and `@supabase/supabase-js` 2.118.0 for the function only**, pinned in `supabase/functions/process-entry/deno.json`. Named by this prompt, so running it approves them. (The old text said `jose@5`; 5.x has had no release since February 2025.) Nothing is added to the app's `package.json`.
5. **`verify_jwt = false`**, with `verifyClerkRequest` on every request. Supabase's troubleshooting page calls the platform's check the "legacy auth verification check" and says it only understands the legacy format (HS256 tokens signed with Supabase's own secret): a Clerk token is RS256, signed by Clerk, so it would be refused with the platform's own 401 "Invalid JWT" before any code ran. The old text planned to test and flip; the docs give the answer, and section 5 proves it on the hosted function.
6. **No Docker.** The function is tested with Deno through `npx` and deployed with `--use-api`. **The user runs login, `secrets set` and `functions deploy`**, so the implementer never holds a management token (the same principle as step 18).
7. **The flow lives in `handler.ts`; `index.ts` only calls `Deno.serve`.** The tests call `handle(request)` without starting a server. Prompts 20, 21, 22 and 32 say "index.ts" where they mean `handler.ts`.
8. **A recording is capped at 12 MiB, not 15 MB.** Gemini takes 20 MB for the whole request and base64 makes a file a third bigger: 15 MiB of audio is exactly 20 MiB of base64 before the prompt. Five minutes of AAC is far smaller.
9. **A recording path that is not the caller's own is `400 INVALID_REQUEST`, not 401.** A 401 makes the app treat a good session as dead.
10. **A crisis entry keeps only the flag and the person's words.** No emotion either, as step 21 will require. The reply carries no affirmations.
11. **A prayer title is produced** (`prayer.title`, at most 60 characters). `prayer_title` had no producer; this closes that long-open conflict.
12. **`daily_affirmations.scheduled_for` stays unset and the reminder times are not read.** The phone schedules the notifications (step 28 confirms it with you). The old rule "use the profile's reminder times" has nothing to feed.
13. **Idempotency is done with a compare-and-set.** Of two requests that both see a failed or lapsed entry, exactly one claims it; the other gets 409. `ready` is the last write of a good run, so an entry is never ready without its affirmations. A retry of a finished entry returns it without a model call and without counting toward the rate limit.
14. **At most two model calls per request and one overall deadline of 90 seconds.** The old text allowed 45-second timeouts and an unlimited number of regenerations, which could pass the platform's 150-second limit and leave nothing for step 22's speech.
15. **The "Copy session token" button is dropped.** `expo-clipboard` was never approved or installed (step 13 removed it), and a Clerk token lasts about a minute and cannot be moved from an iPhone to a PC in time. A check that runs on the phone replaces it and costs no package.
16. **The contract already exists.** `ProcessEntryRequest`, `ProcessEntryErrorCode` and `ProcessEntryResponse` were written in step 06 and equal the old text's list, so "update the types" is a no-op. The function mirrors them in `contracts.ts` (types only, no imports), a compile-time check fails `npm run typecheck` if the two differ, and shared fixtures check the response against the app's mapper.
17. **Output cleaning is part of validation:** no tags, no emoji, curly apostrophes, and no "Amen" in the stored prayer (the app shows its own), because the app's `Devotional.closingPrayer` is "stored without the final Amen".

---

## 0. Before you write code

1. `git status`. Confirm the files in section 1 exist, that there is no `deno.lock` and no `supabase/.temp/`, and that `supabase/functions/.env.local` is either absent (the user makes it in B) or ignored by git (`git check-ignore -v supabase/functions/.env.local`).
2. Check `.env.local` by **name only** (a small Node script that prints names and set or empty; never a value), and, once it exists, `supabase/functions/.env.local` the same way. The three names above must be set there, and nothing else.
3. Re-run everything (section 9, Part A). It must all pass before you touch anything. If something is red, stop: something changed since the review.
4. Read `handler.ts`, `gemini.ts`, `lifecycle.ts`, `output.ts`, `_shared/auth.ts` and `_shared/log.ts` end to end. They are short. **Do not rewrite them.** A change is allowed only to fix what a real check shows (sections 4 and 5); it is made together with its test, and the whole suite is run again.

---

## 1. What the review created (read these; do not rewrite them)

| path | what it is |
| --- | --- |
| `supabase/config.toml` | deploy settings only: `project_id` and `verify_jwt = false` for `process-entry` |
| `supabase/functions/.env.example` | the secret names, no values |
| `supabase/functions/_shared/errors.ts` | the one error format `{ error: { code, message, requestId } }`: 13 codes, their statuses, one message map, `AppError` |
| `supabase/functions/_shared/cors.ts`, `env.ts`, `log.ts` | CORS headers; required and optional secrets (a missing one logs only its name); the one JSON log line and the short user hash |
| `supabase/functions/_shared/admin.ts` | the service-role client, made inside one request; reads `SUPABASE_SECRET_KEYS` (the `default` key) and falls back to `SUPABASE_SERVICE_ROLE_KEY` |
| `supabase/functions/_shared/auth.ts` | `verifyClerkRequest`: RS256, issuer, `exp` and `sub` required, `sid`, `role = authenticated`, `sts` not pending, `azp` when a list is set |
| `supabase/functions/process-entry/index.ts` | `Deno.serve(handle)` and nothing else |
| `.../handler.ts` | the request flow (section 2) |
| `.../validate.ts`, `constants.ts`, `contracts.ts` | the request rules; every limit in one place; the app's contract (types only) |
| `.../lifecycle.ts` | every database call: profile, find, count, the claim (compare-and-set), save ready, save crisis, fail, affirmations |
| `.../gemini.ts`, `prompt.ts`, `schema.ts`, `output.ts` | the Interactions request and its retries; the instruction; the response schema; the checks and cleaning of the reply |
| `.../audio.ts`, `response.ts` | reading a recording from `journal_media`; the saved row as the app's `ProcessEntryResponse` |
| `.../deno.json` | the two pinned imports |
| `.../live_check.ts` | by hand, against the real API with made-up text (section 4) |
| `.../fixtures/parity.json`, `.../testing/` | 7 shared fixtures; the fake Clerk key set, Gemini, PostgREST and Storage |
| `.../*_test.ts` | `validate` 9, `output` 15, `auth` 1 (11 steps), `gemini` 16, `lifecycle` 13, `handler` 26, `response` 10 |
| `supabase/tests/process-entry/parity.cjs` | the app's own `toJournalEntry` and `toAffirmation` on the same fixtures |
| `src/types/contractParity.ts` | compile-time proof that the app's process-entry types equal `contracts.ts` |
| `src/components/dev/processEntryCheck.ts` | the phone-run check (new file; nothing imports it until section 3) |
| `tsconfig.json`, `.gitignore` | `supabase/functions` is excluded from the app's `tsc`; secret files and CLI state are ignored |

**How it was proven (2026-10-22, Deno 2.9.6 on this machine):**

- `deno check`, `deno lint` and `deno fmt --check --line-width=120` clean; 90 tests pass; the app's `npm run typecheck` and `npm run lint` exit 0 with these files present; the 88 profile-sync checks still pass; the release gate still prints 17 lines.
- **Mutation run:** 19 deliberate breakages, each caught: a missing user filter, a token with no expiry, the role or algorithm not checked, `store: true`, a retried fatal error, a provider message in a reason, a fresh claim taken over, a reclaim that is not compare-and-set, an unverified entry marked verified, a failed run not recorded, an off-by-one rate limit, no profile row, a written entry losing its own words, another user's audio path, an ignored crisis flag, a kept "Amen", an oversize recording read, and unverified scripture showing text. (One survived the first run: the fixtures had no row with stale text and `scripture_verified` false. The fixture was added and the mutation is now caught.)
- `jose` 6.2.13 under Deno against a local key set: 18 paths (valid, cached key, tampered signature, forged subject, expired, drift, wrong issuer, no expiry, unknown key, wrong algorithm, none, garbage). **A token with no `exp` is accepted unless `requiredClaims` says otherwise.**
- `supabase-js` 2.118.0 under Deno, with a recording fetch: an ignore-duplicates upsert answers `[]` when the row exists; a compare-and-set update answers `[]` when it loses; a missing object comes back as HTTP 400 with `statusCode "404"`; a PostgREST error carries a Postgres `code`.
- Google's real endpoint answered a bad key with HTTP 400 and a body that is an **array** wrapping the error (`[{ "error": … }]`); the error classifier unwraps it (a test covers it).
- A 12 MiB recording is base64 and JSON in about 40 ms of CPU against the platform's 2 seconds.
- **Not provable offline, and the reason for sections 4 and 5:** the real reply shape of the Interactions API for this model, that `thinking_level: low` and the schema are accepted, that `audio/m4a` carries a recording like the app's, the real Clerk token's claims, `--use-api` bundling, and the hosted runtime.

---

## 2. The flow, limits and errors (reference)

**The flow (`handler.ts`):**

1. `OPTIONS` answers the preflight. Any method but `POST` is 405.
2. `verifyClerkRequest` (401, or 500 if Clerk's keys cannot be fetched). Then the Gemini secrets are read (a missing one is a 500 that logs only its name).
3. Read the body (JSON, 64 KB at most) and validate it (400, 413, 422). Nothing is saved yet.
4. Make sure the person's `users_profile` row exists (insert if missing, never touch an existing one).
5. Look up the entry by `(user, clientEntryId)`. **Finished: return it** (200, no model call, no rate limit).
6. Rate limit: 10 other entries in the last 10 minutes is 429.
7. `// TODO(22)`: the free-tier weekly limit goes here, after screening (402).
8. **Claim** the entry (insert as `processing`, or take over a failed or lapsed one by compare-and-set; a running one is 409). The person's text is saved at this point.
9. Audio: read the recording (missing, empty: 422 `AUDIO_NOT_FOUND`; over 12 MiB: 413). Any failure from here on marks the entry **failed** with its code and keeps the text or the file.
10. Gemini, at most twice, all within 90 seconds of the start. A reply that fails `output.ts` counts as a try. A refusal is 422 `CONTENT_BLOCKED`; anything else is 503 `AI_UNAVAILABLE`.
11. `no_speech` is 422 `NO_SPEECH`. `is_crisis` saves a crisis entry and answers with it (`// TODO(21)`).
12. Otherwise save the three affirmations, **then** mark the entry `ready` with the reflection, and answer 200 with `ProcessEntryResponse` built from the saved row. `// TODO(20)` scripture text, `// TODO(22)` speech, `// TODO(28)` `scheduled_for`.

**Limits (`constants.ts`):** body 64 KB; text 10 to 5,000 characters; recording 3 to 302 seconds and 12 MiB; rate limit 10 per 10 minutes; a claim lapses after 3 minutes; model calls end 90 seconds after the request started (at most 45 seconds each); devotional 80 to 260 words, closing prayer 10 to 100 words, title 60 characters, affirmation headline 8 words and text 30 words, prayer title 60 and summary 120 characters.

**Errors:** `INVALID_REQUEST` 400, `UNAUTHORIZED` 401, `LIMIT_REACHED` 402 (step 22), `METHOD_NOT_ALLOWED` 405, `ALREADY_PROCESSING` 409, `PAYLOAD_TOO_LARGE` 413, `TOO_SHORT` 422, `AUDIO_NOT_FOUND` 422, `NO_SPEECH` 422, `CONTENT_BLOCKED` 422, `RATE_LIMITED` 429, `INTERNAL` 500, `AI_UNAVAILABLE` 503. The message comes from one map; the log line carries a **reason** (for example `auth:claims`, `missing_config:GEMINI_MODEL`, `gemini_http_404:NOT_FOUND`, `output_invalid:devotional_words`, `db:claim:42501`).

**The log line (one per request):** `requestId`, `status`, `code`, `reason`, `inputType`, `user` (8 hex characters of a hash), `authMs`, `dbMs`, `geminiMs`, `totalMs`, `attempts`, `model`, `promptVersion`, `tokensIn`, `tokensOut`, `tokensThought`. Nothing else.

---

## 3. Edits to the existing files (the developer panel)

Two files change, and the diffs were applied to a copy of the app and type-checked and linted there (both exit 0). `DevToolsPanel.tsx` and `supabaseClient.ts` use **CRLF** line endings in the working tree: apply the diffs to LF copies (strip the CRs, `git apply --check -p1`, then apply) and write each file back with its own endings, or with a small Node script that matches on the LF text and writes CRLF back, as in step 18. Check `tr -cd '\r' < file | wc -c` before and after. `src/components/dev/processEntryCheck.ts` already exists.

```diff
--- a/src/services/supabaseClient.ts
+++ b/src/services/supabaseClient.ts
@@ -60,3 +60,38 @@
     return "unreadable";
   }
 }
+
+export type SessionTokenFacts = {
+  issuerHost: string | null;
+  sid: boolean;
+  azp: boolean;
+  sts: string | null;
+};
+
+// For the dev panel: what the Clerk token carries, so the Edge Function's CLERK_ISSUER secret can be checked against a
+// real token. It returns the issuer's host (the public address of the Clerk instance), whether the sid and azp claims
+// exist and the session status, never a value that identifies anyone.
+export async function describeSessionToken(): Promise<SessionTokenFacts | null> {
+  if (session === null) return null;
+  try {
+    const token = await session.getToken();
+    const payload = token ? readJwtPayload(token) : null;
+    if (payload === null) return null;
+    let issuerHost: string | null = null;
+    if (typeof payload.iss === "string") {
+      try {
+        issuerHost = new URL(payload.iss).host;
+      } catch {
+        // An issuer that is not a URL is reported as none.
+      }
+    }
+    return {
+      issuerHost,
+      sid: typeof payload.sid === "string",
+      azp: typeof payload.azp === "string",
+      sts: typeof payload.sts === "string" ? payload.sts : null,
+    };
+  } catch {
+    return null;
+  }
+}
--- a/src/components/dev/DevToolsPanel.tsx
+++ b/src/components/dev/DevToolsPanel.tsx
@@ -11,6 +11,7 @@
   listPrayers,
   setMockSubscriptionTier,
 } from "@/data/journalRepository";
+import { runProcessEntryCheck } from "@/components/dev/processEntryCheck";
 import { supabaseEnv } from "@/constants/env";
 import {
   countVisibleProfileRows,
@@ -33,6 +34,7 @@
 import { signOutCleanup } from "@/services/account";
 import {
   checkSessionToken,
+  describeSessionToken,
   getSupabaseUserId,
   type SessionTokenCheck,
 } from "@/services/supabaseClient";
@@ -158,6 +160,14 @@
   ];
   if (supabaseEnv.status !== "ok" || !signedIn) return lines;
   lines.push(`Clerk token: ${TOKEN_LABELS[await checkSessionToken()]}`);
+  // The issuer shown here is what the Edge Function's CLERK_ISSUER secret must be (step 19).
+  const facts = await describeSessionToken();
+  if (facts) {
+    const yes = (value: boolean) => (value ? "yes" : "no");
+    lines.push(
+      `token issuer: ${facts.issuerHost ?? "none"} | sid ${yes(facts.sid)} | azp ${yes(facts.azp)} | sts ${facts.sts ?? "none"}`,
+    );
+  }
   const found = await selectProfileRow();
   lines.push(
     `profile row: ${found.ok ? (found.data === null ? "not found" : "found") : `error ${found.code}`}`,
@@ -249,6 +259,8 @@
   const [tier, setTier] = useState<SubscriptionTier | null>(null);
   const [supabaseLines, setSupabaseLines] = useState<string[]>([]);
   const [checking, setChecking] = useState(false);
+  const [processLines, setProcessLines] = useState<string[]>([]);
+  const [processChecking, setProcessChecking] = useState(false);
   // The entries behind the paywall's "Limit + entry" and "Crisis entry" buttons.
   const readyEntryId = targets.find((target) => target.label === "Ready")?.entryId ?? null;
   const crisisEntryId = targets.find((target) => target.label === "Crisis")?.entryId ?? null;
@@ -286,6 +298,14 @@
     setChecking(false);
   }
 
+  // Calls the deployed process-entry function with made-up text; each line appears as its case finishes.
+  async function checkProcessEntry() {
+    setProcessChecking(true);
+    setProcessLines([]);
+    await runProcessEntryCheck((line) => setProcessLines((current) => [...current, line]));
+    setProcessChecking(false);
+  }
+
   // The session goes first, and the cleanup before it, as in Profile's own Sign out.
   async function signOutDev() {
     await signOutCleanup();
@@ -435,6 +455,18 @@
                 {line}
               </Text>
             ))}
+          </View>
+          <View className="items-center gap-2">
+            <DevButton
+              label="Process-entry check (dev)"
+              disabled={processChecking}
+              onPress={checkProcessEntry}
+            />
+            {processLines.map((line, index) => (
+              <Text key={`${index}-${line}`} className="text-center text-body-sm text-ink">
+                {line}
+              </Text>
+            ))}
           </View>
         </View>
         <View className="gap-2">
```

No new class name is added (every class already exists), so a hot reload carries it; no `-c` is needed. The check button is dev-only, like everything in that panel. After applying: `npm run typecheck` and `npm run lint` exit 0, and `git diff --stat` shows exactly these two files plus the untracked ones from section 1.

---

## 4. The real Gemini check (needs the key from A to C)

All commands run from the repo root, in Git Bash, with `D="npx --yes deno@2.9.6"` and `C="--config supabase/functions/process-entry/deno.json"`; the long form of the run command is:

```bash
$D run --no-lock --node-modules-dir=none $C --allow-net --allow-env --allow-read \
  --env-file=supabase/functions/.env.local supabase/functions/process-entry/live_check.ts <flags>
```

1. **`--shape` first.** It sends one request and prints the **structure** of the reply (strings as their length). Expect HTTP 200; a top-level `status` of `completed`; a `steps` list holding a `model_output` step whose `content` holds a text item; and a `usage` object with `total_input_tokens`, `total_output_tokens` and `total_thought_tokens`. **If the shape differs, or the status is not 200, stop and show the user the structure. Do not guess:** the Interactions API changed its reply shape once already (May 2026), and `gemini.ts` is written from the docs of 2026-10-22. If `store`, `thinking_level` or `response_format` is refused, the message names it: read it, check the docs page again, fix `gemini.ts` and its tests together, and say so in the report.
2. **The full run**, with `--audio ~/Desktop/test-prayer.m4a` if the clip exists. It sends four made-up written entries (anxious about work; gratitude and a request; instructions hidden inside the entry; a made-up crisis sentence) and the clip. Expect `ok` for the first three (ready, 80 to 260 words, a scripture location, three affirmations, a tracked prayer where there is a request), `ok` for the crisis sentence, and for the clip `ready` with a transcript (or `no_speech` only if the clip is silent). Record, for each case, the time, the attempts and the three token counts, and work out what one reflection costs at the 2026-10-22 prices (write both the intro and the 2027 price).
   - `UNEXPECTED` on the crisis sentence means the model did not flag it. That is **information, not a failure of this step**: the flag here is only a safety net, and step 21 adds the dedicated screening. Report it and move on.
   - `FAILED … output_invalid:<reason>` means the model broke one of the limits of `constants.ts`. Prefer a clearer instruction in `prompt.ts` over loosening a limit; a changed limit or prompt re-runs the whole suite.
3. **Read one reflection.** Run once more with `--show`, show the user the first made-up reflection and ask whether the voice is right. The checklist is AGENTS.md "Copy & Tone Rules": it names the feeling before any encouragement, no toxic positivity, no guilt, about 140 to 200 words, no quoted verse, no "Amen" in the prayer, curly apostrophes. A plain defect (a quoted verse, a lecture) is fixed in `prompt.ts`; everything about taste belongs to step 32, so note it and do not tune.
4. Send nothing but the made-up entries and the user's own test clip, and print no key.

---

## 5. Deploy and the hosted check (the user deploys)

1. Print the project reference (the first label of the host in `EXPO_PUBLIC_SUPABASE_URL`; read-only, not a secret), write the three commands of step E with it filled in, and ask: **"Ready for you to deploy process-entry?"** The user runs them (D first, once).
2. After "deployed", prove the function is live and that the platform check is off, from this computer. The publishable key is read from `.env.local` and never printed:

```bash
URL="https://<ref>.supabase.co/functions/v1/process-entry"
KEY=$(grep '^EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=' .env.local | cut -d= -f2- | tr -d '\r"')
curl -s -i -X POST "$URL" -H "apikey: $KEY" -H "Content-Type: application/json" -d '{}'
curl -s -i -X POST "$URL" -H "apikey: $KEY" -H "Authorization: Bearer aaa.bbb.ccc" -H "Content-Type: application/json" -d '{}'
```

   Both must answer **401 with the function's own body** `{"error":{"code":"UNAUTHORIZED","message":"Please sign in again.","requestId":"…"}}`. A body like `{"code":401,"message":"Invalid JWT"}` or "Missing authorization header" is the platform's, which means `verify_jwt` is still on: ask the user to deploy again with `--no-verify-jwt` added (or to turn off the JWT check in the function's settings in the dashboard) and report it.
3. The user does F and G. Read the screenshot line by line. Expected, in order: `PASS written entry` (ready, 80 to 260 words, 3 affirmations, a reference with "not verified yet"), `PASS same id again` (same entry, not processed again), `PASS text too short` (422 `TOO_SHORT`), `PASS text too long` (413), `PASS someone else's recording` (400), `PASS audio sent in the body` (400), `PASS made-up crisis sentence` (or `FAIL … did not flag`, the information above), `PASS instructions inside the entry` (read its title: it must not be a poem or a pirate), and `PASS your recording` (or `SKIP`).
4. Ask the user for a screenshot of the Supabase dashboard, **Edge Functions, process-entry, Logs**. Check it is **one JSON line per request** with only the fields in section 2, no text, no id, no token, no key. This is the privacy check on the hosted side.
5. The rate limit (10 in 10 minutes) is proven offline and is not repeated against Gemini (it would spend 11 model calls).
6. Troubleshooting for the user and for you:

| what you see | likely cause | what to do |
| --- | --- | --- |
| every line `no answer` | the function is not deployed, the phone is offline, or the wrong project | the dashboard's Edge Functions list must show `process-entry`; check the phone's connection |
| `401 UNAUTHORIZED` on the written entry | the token's issuer differs from `CLERK_ISSUER`, or a claim is missing | compare the `token issuer:` line; read the log line's `reason` (`auth:claims`, `auth:key`, `auth:role`, `auth:expired`) |
| `500 INTERNAL` | a secret is missing or wrong, or a table refused a write | the log `reason`: `missing_config:NAME` (run `secrets list`), `db:<operation>:<code>` (`42501` a missing grant, `23514` a check constraint) |
| `503 AI_UNAVAILABLE` | the model call failed | the reason: `gemini_http_404:NOT_FOUND` the model name; `gemini_http_400:…` the request shape (run `--shape` and `live_check.ts` again); `gemini_http_401` or `403` the key; `gemini_http_429` the free-tier quota; `output_invalid:*` the reply broke a limit |
| `429 RATE_LIMITED` | more than 10 entries in 10 minutes | wait ten minutes |
| `SKIP your recording` | the clip is not uploaded for this account | step F |
| `deploy` fails with a size error | the bundle passed the 5 MB limit of server-side bundling | send the whole message; nothing else was added to the function |
| `deploy` fails to resolve an import | server-side bundling of `deno.json` imports | send the whole message; do not change the imports without a look |

---

## 6. AGENTS.md updates

**Done in the review** (the function and its tooling exist, so the document already describes them): the Tech Stack lines for Edge Functions and Gemini; the vendor notes for the **Gemini API**, the Gemini terms (re-read), **Supabase Edge Functions** and **jose**; the approved packages (`jose` and the pinned `supabase-js` for the function only; Deno and the CLI through `npx`); the architecture tree (`config.toml`, `functions/` and its files, `contractParity.ts`, `processEntryCheck.ts`, the new test); Backend / Edge Function Rules (the secrets, "`process-entry` requirements" replacing "Mandatory Fixes", and "Edge Function Rules"); the TypeScript rule on the contract; the "Edge Function changes" commands in Linting and Validation (no `supabase functions serve`); and the closed `prayer_title` gap.

**Left for the implementer:**

- A **"Step 19 — Edge Function foundation"** entry in the Build Status & Decisions Log, newest last: the decisions above, what was built, the measured numbers (time, attempts and tokens per case, cost per reflection), the hosted results, what was **not** verified (iOS; the production Clerk instance; a billed key; a recording made by the app itself, step 23; many reflections for quality, step 32) and the open items below.
- Correct any line of the review's text that a real check showed to be wrong (the Gemini note especially), in AGENTS.md and in `gemini.ts` together.
- Then copy AGENTS.md to `prompts/AGENTS.md` (both must be identical: `cmp`).

---

## 7. Rules

- No new package in the app (`package.json` and the lockfile are untouched: `git diff --stat` proves it). `jose` and `supabase-js` live in `deno.json` only. No `any`, and no `deno-lint-ignore`.
- No migration and no policy change. If the code needs a column or a grant that does not exist, stop and ask (step 18 owns the schema).
- No UI change except the developer panel. Crisis: if you are unsure whether a change affects crisis handling, stop and ask.
- **Never print, log, commit or send a secret:** not `.env.local` values, not the Gemini key, not a token. If the user pastes a key into the chat, tell them to revoke it and make a new one.
- Never log or return user content, except the person's own entry in the success response.
- **You do not deploy, log in to Supabase, or run `supabase secrets`.** Those are the user's. A change you make to the function is not live until they deploy it.
- Do not weaken a test to make it pass. If a real check shows a test's assumption was wrong, fix the code and the test together and say so.
- Send the real model only made-up text and the user's own test clip.

---

## 8. Notes for later steps (reported, not edited: reconcile each at its own review)

- **20:** the flow is in `handler.ts` (its "index.ts step 9" is the `reflection.kind` branch); `schema.ts` has `book_name` (a string) and `output.ts` reads `scripture.bookName`, so the switch to `book_id` changes `schema.ts`, `output.ts`, `prompt.ts`, `handler.ts` and `formatReference`; the "total Gemini time" is `stats.ms`, and `GEMINI_DEADLINE_MS` is the budget; local `functions serve` and `FORCE_SCRIPTURE_REF` testing become Deno tests with the fake world and the hosted function.
- **21:** the safety net it replaces is the `crisis` branch of `handler.ts` plus `saveCrisisEntry` in `lifecycle.ts` (keep and reuse the latter). Its flow numbers match `handler.ts`. **Interactions has no `safetySettings` and no `promptFeedback`:** the field is `safety_settings: [{ "type": "dangerous_content", "threshold": "off" }]` (lowercase), a block is an HTTP 400 with an error code (`isBlockedBody` already reads it), and Gemini 3 takes no `temperature`, so its "temperature 0" becomes `generation_config.seed`. Removing `CONTENT_BLOCKED` touches `contracts.ts`, `_shared/errors.ts`, `src/types/index.ts` and the lists in `src/data/mappers.ts` and `response.ts`.
- **22:** the speech budget is `context.startedAt` against 110 seconds; the audio URL is added where `respond()` builds the response; the reclaim of a `LIMIT_REACHED` entry already works through `decideClaim` (any status but ready or fresh processing is claimable).
- **25:** `fromProcessResponse` is not needed, because the response already is the app's `ProcessEntryResponse` (kept equal by `contractParity.ts` and the fixtures). The working call, with its headers and `FunctionsHttpError` handling, is `processEntryCheck.ts`. A path that is not the caller's own is 400, never 401. `ALREADY_PROCESSING` (409) means "still being prepared": wait and ask again with the same id.
- **28:** the `TODO(28)` in `lifecycle.ts` is the `scheduled_for` decision.
- **30, 31, 33:** reuse `_shared/` (errors, cors, env, admin, auth, log); each function needs its own `deno.json` mapping the two imports.
- **32:** `PROMPT_VERSION` is `gen-v1`. There is no `temperature` to compare; the evaluation can vary `thinking_level` or `seed`.
- **35:** the hosted `CLERK_ISSUER` is the development instance. The production Clerk instance has another issuer: it must be set (or both accepted) before a store build, and the hosted `GEMINI_API_KEY` must belong to a billed project.

---

## 9. Verify

### Part A: always (no key, no network beyond the first download)

```bash
D="npx --yes deno@2.9.6"; C="--config supabase/functions/process-entry/deno.json"
$D check --no-lock --node-modules-dir=none $C supabase/functions/process-entry/index.ts
$D lint $C supabase/functions
$D fmt --check --line-width=120 supabase/functions
$D test --no-lock --node-modules-dir=none $C --allow-net --allow-env --allow-read supabase/functions
node supabase/tests/process-entry/parity.cjs
node supabase/tests/profile-sync/run.cjs
npm run typecheck
npm run lint
grep -rnE "TEMP\(|TODO: real" src | wc -l
```

Expected: check, lint and fmt clean (22 files linted, 30 formatted); **90 tests pass**; `7 of 7 fixtures match the app's mapper`; `88 passed, 0 failed`; typecheck and lint exit 0; the last line prints 17. Check real exit codes and read the full output. Then `git status`: only the files of sections 1 and 3 (and AGENTS.md files); no `deno.lock`; `package.json` and the lockfile unchanged.

### Part B: with the key (section 4)

`--shape` matches the expected structure; the full run is `ok` for the written cases; the clip comes back `ready` with a transcript; times, tokens and the cost per reflection recorded; one reflection read by the user.

### Part C: after the deploy (section 5)

Both curl calls answer the function's own 401; the phone check shows the expected lines; the logs hold one JSON line per request and no content.

### Not verified, and said so

iOS and TalkBack (nothing here touches a screen except the developer panel); the production Clerk instance; a recording made by the app (step 23); the free tier's quota under load; quality over many entries (step 32).

---

## 10. Report

Lead with what changed and where, then how it was checked. Include: whether the review's files were found unchanged; the exact outputs of Part A (counts); the `--shape` structure; the table of real results (case, time, attempts, tokens, outcome) and the cost per reflection; whether the crisis sentence was flagged by the model; what the user thought of the voice; the project reference used (not secret) and the secrets listed by name; the curl results (and what the platform's check did); the phone check line by line; the log check; every change made to a review file and why; the dependency check (`package.json` untouched); every `TODO` left for steps 20, 21, 22, 25 and 28 with its file and line; and the open items: a billed Gemini key before step 25, the production Clerk issuer, and the reconciliations in section 8.
