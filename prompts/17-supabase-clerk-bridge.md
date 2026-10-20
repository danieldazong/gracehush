# 17-supabase-clerk-bridge.md

Read AGENTS.md first and follow it strictly.

Connect the Gracehush app to Supabase using the signed-in Clerk session,
and replace the mocked profile + reminder data with real Supabase reads
and writes. Only the profile and reminders become real in this step.
Entries, affirmations, prayers, usage, purchases and account actions stay
mocked (steps 22–31). Do not create migrations, change RLS or storage
policies, deploy Edge Functions or change any dashboard setting in this
step.

Use these docs as the source of truth and follow them exactly:

- https://supabase.com/docs/guides/auth/third-party/clerk
- https://clerk.com/docs/guides/development/integrations/databases/supabase
- https://supabase.com/docs/guides/getting-started/quickstarts/expo-react-native
- https://supabase.com/docs/reference/javascript/initializing
  (the `accessToken` option)

---

## 0. Auth decision (stop and confirm first)

AGENTS.md describes the Clerk JWT template "supabase" + shared JWT secret.
Clerk and Supabase both deprecated that approach on April 1, 2025. The
recommended approach is Supabase Third-Party Auth with Clerk: the app
sends Clerk's normal session token, Clerk adds `role: "authenticated"`,
and Supabase verifies it with Clerk's public keys. No JWT secret is
shared and no template token is fetched.

Before writing code, show the user this summary and ask:
"Switch to Supabase Third-Party Auth with Clerk (recommended) instead of
the deprecated JWT template?" Wait for a yes. If the user says no, stop
and ask how to proceed. Do not build the template approach on your own.

After approval, print this manual checklist for the user. Never do these
steps yourself, never run `npx clerk config patch`, never use a
Supabase management token:

Clerk Dashboard

1. Open https://dashboard.clerk.com/setup/supabase for the Development
   instance → Activate Supabase integration → copy the Clerk domain.
2. Repeat for the Production instance before release.
3. Delete the old "supabase" JWT template once the app no longer uses
   it (after this step is verified).
   Supabase Dashboard
4. Authentication → Sign In / Providers → Third-Party Auth → Add
   provider → Clerk → paste the Clerk domain.
5. Project Settings → API Keys → copy the Publishable key (or legacy
   anon key) and the project URL.
6. Do NOT rotate or change the JWT secret as part of this step.

Then ask the user to confirm the checklist is done before testing
section 9. Code can be written before that.

Update AGENTS.md:

- Tech Stack / Auth: "Supabase Third-Party Auth with Clerk (session
  token, `role: authenticated`). No JWT template, no shared secret."
- Remove every mention of the "supabase" JWT template, the template body
  and "signing key must match Supabase JWT Secret".
- Known Schema Gaps: add "Client must not be able to write
  users_profile.subscription_tier (fix in step 18)."

---

## 1. Before writing code

1. Read src/data/journalRepository.ts, src/data/mappers.ts,
   src/types/database.ts, src/types/index.ts, src/store/onboardingStore.ts
   (or the step 07 store), src/store/devStore.ts, src/hooks/useProfileSettings.ts,
   src/hooks/useJournalHome.ts, src/services/account.ts, App.tsx,
   supabase/schema.sql and the old src/services/supabaseClient.ts if it
   still exists.
2. In supabase/schema.sql, confirm: users_profile columns and types, the
   requesting_user_id() helper (reads `sub` from request.jwt.claims),
   and the users_profile SELECT / INSERT / UPDATE policies. Report the
   exact policy names. Third-Party Auth fills request.jwt.claims too, so
   these policies keep working. Do not edit them. If there is no INSERT
   policy for users_profile, stop and ask (step 18 must add it first).
3. Check package.json for @supabase/supabase-js. If it's missing, stop
   and ask, then install with `npx expo install @supabase/supabase-js`.
   Install react-native-url-polyfill ONLY if the Supabase Expo quickstart
   for the installed supabase-js version requires it, and ask first.
   Do not install Supabase's AsyncStorage session setup. Clerk owns the
   session, Supabase stores no session here.
4. Confirm @clerk/expo is the installed Clerk package (step 05).

---

## 2. Environment

- .env.local (gitignored) and .env.example:
  EXPO_PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
  EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
- Base project URL only, never with /rest/v1.
- The publishable (or legacy anon) key is client-safe. The service-role
  / secret key must never appear in the app, .env.example or any
  EXPO*PUBLIC* variable. If you find one anywhere in client code, stop
  and tell the user.
- Read both values in src/constants/env.ts (create it if missing) and
  throw a clear error at startup if either is missing.

---

## 3. Supabase client: src/lib/supabase.ts

One client for the whole app (not one per render):

let tokenGetter: (() => Promise<string | null>) | null = null;
export function setSupabaseTokenGetter(fn: (() => Promise<string | null>) | null)

export const supabase = createClient<Database>(URL, KEY, {
accessToken: async () => (tokenGetter ? await tokenGetter() : null),
});

Rules:

- Use Clerk's normal session token: `getToken()` with NO template.
- Never call supabase.auth.\* anywhere (it is unavailable with
  `accessToken` and Clerk owns auth).
- Type the client with a `Database` type built from the hand-written
  row types in src/types/database.ts (step 06). Do not run
  `supabase gen types` in this step. // TODO(18): replace with generated
  types after the migration.
- Delete the old src/services/supabaseClient.ts (template version) after
  moving any callers. Report every file that imported it.

Bridge component: src/components/SupabaseAuthBridge.tsx

- Rendered once inside <ClerkProvider>, above the navigator, renders
  nothing.
- Uses useAuth(): when isSignedIn, setSupabaseTokenGetter(() => getToken());
  when signed out, setSupabaseTokenGetter(null).
- On sign-in (userId changes from null to a value) it runs
  ensureProfile() then syncReminders() (section 5), once per userId.
  Errors never block navigation; they are retried on the next app
  foreground (AppState 'active').
- Clears the getter on unmount.

---

## 4. Repository: real profile functions

In journalRepository.ts, replace ONLY the profile internals. Keep every
signature. Remove their // TEMP(17) markers. Everything else keeps its
existing TEMP marker.

Add 'UNAUTHORIZED' to the RepoResult error code union.

Guard: every Supabase call first checks that a token getter is set. If
not, return { ok: false, code: 'UNAUTHORIZED', message } without sending
a request. Never send an anonymous request for user data.

ensureProfile(userId: string): Promise<RepoResult<UserProfile>>

- Insert with ON CONFLICT DO NOTHING:
  supabase.from('users_profile').upsert(
  { id: userId, reminder_morning, reminder_afternoon, reminder_evening },
  { onConflict: 'id', ignoreDuplicates: true })
  Send only columns that exist in schema.sql. Never send
  subscription_tier (the database default sets it).
- Reminder values come from the onboarding store, as "HH:mm:00".
- Then select the row and return toUserProfile(row).
- Return `created: boolean` (whether the insert happened) through an
  internal helper, so syncReminders knows who wins.

getProfile(): Promise<RepoResult<UserProfile>> (or the step 06 shape)

- Select the signed-in user's row with .eq('id', userId).maybeSingle().
  RLS also restricts it; filter anyway for clarity.
- No row → call ensureProfile once, then return it.

updateReminders(times: Record<TimeSlot, string>):
Promise<RepoResult<UserProfile>>

- Update only reminder_morning / reminder_afternoon / reminder_evening.
- "HH:mm" → "HH:mm:00" on write; mappers already trim "HH:mm:ss" →
  "HH:mm" on read.

updateProfile(patch) from step 15:

- Its fields (affirmationsEnabled, ambientSound, ambientVolume) are
  planned columns that don't exist until step 18. Keep these values
  device-only: a small persisted Zustand slice
  src/store/profilePrefsStore.ts (AsyncStorage key
  `gracehush.profilePrefs`, version 1), keyed by userId so a second
  account on the same phone doesn't inherit them. getProfile merges
  these values over the mapper defaults.
  // TODO(18): move to users_profile columns and delete this store.

Never written by the client: id after insert, subscription_tier,
created_at. // TODO(18): enforce with column privileges or a trigger;
// TODO(30): tier set only by the RevenueCat webhook.

Error mapping (src/lib/supabaseErrors.ts, pure function):

- TypeError / fetch failure → NETWORK
- PostgREST 'PGRST301' or HTTP 401 (bad/expired JWT) → UNAUTHORIZED
- '42501' (RLS violation) → UNAUTHORIZED, plus a **DEV** warning that
  the Clerk integration or policies are misconfigured
- '23505' → treat as success inside ensureProfile only
- anything else → UNKNOWN
- **DEV** warnings may include the error code and table name only.
  Never log tokens, user id, email or row contents.

---

## 5. Reminder sync

Onboarding store changes (src/store/onboardingStore.ts):

- Add `remindersDirty: boolean`. The existing reminder setter sets
  remindersDirty = true and remindersSyncedAt = null (as now).
- Add markRemindersSynced(at: string) and applyServerReminders(times)
  (sets times, remindersDirty false, remindersSyncedAt now).
- Bump the persist version 1 → 2 with a `migrate` that sets
  remindersDirty = (remindersSyncedAt === null && times differ from
  DEFAULT_REMINDERS). Existing installs must keep their times.
- Do not change anything else in the store or the onboarding UI.

syncReminders() in src/services/profileSync.ts:

- Profile just created → push local times (they were sent in the
  insert) → markRemindersSynced.
- Profile existed and remindersDirty → updateReminders(local) →
  markRemindersSynced.
- Profile existed and not dirty → applyServerReminders(server times).
- Runs: after sign-in (bridge), on app foreground if remindersDirty, and
  ~800ms after the last reminder edit in Profile (debounced, cancelled
  on unmount/sign-out).
- Failure: leave remindersDirty true; retry on next foreground.
  Profile shows no error for a background sync failure.
- // TODO(28): reschedule notifications after applyServerReminders and
  after local edits.

---

## 6. Dev switch (keeps steps 15–16 testable)

devStore: add `profileSource: 'supabase' | 'mock'` (**DEV** only,
default 'supabase'; production always 'supabase').

- 'mock' → profile functions use the step 06 mock and scenarios exactly
  as before (free / trial / pro testing, purchase mock tier changes).
- 'supabase' → real profile. The step 16 mock purchase may override the
  tier in memory for the session only (never written to Supabase):
  // TEMP(30).
- Add the switch to DevToolsPanel, plus a "Supabase check" button that
  shows (on screen, never logged): signed-in yes/no, profile row found
  yes/no, last error code. No ids, no tokens.

---

## 7. Sign out

- signOutCleanup (step 15) also: cancels the pending reminder debounce
  and clears in-memory profile cache. The bridge sets the token getter
  to null when Clerk signs out.
- profilePrefsStore keeps other users' entries (keyed by userId).
  Device onboarding stays (AGENTS.md exception).

---

## 8. Rules

- Only one new dependency is allowed (@supabase/supabase-js), and only
  after asking. No `any`. No changes to UI, copy or layout.
- No migrations, RLS, storage, Edge Function or dashboard changes.
- Never log tokens, Clerk user id, email or profile rows.
- // TODO(19): Edge Functions verify the Clerk session token (Third-Party
  Auth) — the old template token will no longer be sent.
- // TODO(22/25): getUsage and entries stay mocked.

---

## 9. Verify

Run `npx expo start -c`, `npm run lint` and `npm run typecheck`. After
the user confirms the dashboard checklist, on a dev build:

1. Sign in with a new account: one users_profile row appears with
   id = the Clerk user id, tier 'free' and the onboarding reminder times.
2. Sign out and in again: no second row; tier and times unchanged.
3. Change a reminder in Profile, wait 1s: the row updates. Kill and
   reopen: the time is kept.
4. Edit the row's reminder in the Supabase table editor, reopen the
   app without local edits: the app shows the server time.
5. Airplane mode, edit a reminder, reconnect, foreground: it syncs.
6. Second account on the same phone: sees only its own profile and its
   own ambient/affirmation prefs.
7. RLS check: in **DEV**, a temporary query for another user's id
   returns no row (then remove the query).
8. Signed out: the "Supabase check" shows no request was sent.
9. devStore profileSource 'mock': the free/trial/pro scenarios from
   steps 15–16 still work.
10. grep the repo: no `template: 'supabase'`, no service-role key, no
    supabase.auth calls in client code.

Report: auth decision confirmed; files created, changed, deleted; the
users_profile policy names found; the onboarding store migration;
which fields are still device-only; and every TODO left for steps 18,
19, 22, 25, 28 and 30.
