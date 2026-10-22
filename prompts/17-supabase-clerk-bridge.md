# 17-supabase-clerk-bridge.md

Read AGENTS.md first and follow it strictly.

Connect the Gracehush app to Supabase through the signed-in Clerk session, and make the profile and the reminder times real: a `users_profile` row per account that the app creates on first sign-in, reads, and updates (the three reminder times only). Entries, affirmations, prayers, usage, purchases and account actions stay mocked (steps 22 to 31). The three settings Profile saves (Daily Affirmations, ambient sound and volume) have no column until step 18, so they stay on the device, per user.

This step writes no migration, changes no storage policy, deploys no Edge Function and changes no dashboard setting itself. The dashboard work and the one SQL run are yours (next section), and the two SQL files already exist in the repo (created and tested in the review).

Sources, checked in the review on 2026-10-22:

- https://supabase.com/docs/guides/auth/third-party/clerk
- https://clerk.com/docs/guides/development/integrations/databases/supabase
- https://supabase.com/docs/guides/api/api-keys
- the installed `@supabase/supabase-js` 2.118.0 and `@supabase/postgrest-js` 2.118.0 source (`SupabaseClient.ts`, `lib/fetch.ts`, `PostgrestBuilder.ts`, `fetchWithRetry.ts`): every fact about them below was read there or run, not assumed. Supabase's Expo quickstart is **not** followed: it installs `react-native-url-polyfill` and a Supabase auth session, and this app needs neither (decision 2).

---

## What you do yourself (read this first)

The implementer cannot do any of this: these are your own Supabase and Clerk accounts. It takes about 20 minutes. Do A to E in order. The code can be written before you finish, and until `.env.local` has the two Supabase values the app keeps running on the mock profile (decision 6), so nothing breaks while you work.

### Keys: what this step needs (checked in the review)

`.env.local` holds one variable today: `EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY` (a development key, `pk_test_…`, set). This step needs two more, and both are missing:

| Variable | Where it comes from | Safe to ship in the app? |
| --- | --- | --- |
| `EXPO_PUBLIC_SUPABASE_URL` | Supabase dashboard, the **Connect** button: Project URL, `https://<ref>.supabase.co` | Yes |
| `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase dashboard, **Project Settings, API Keys**: the **Publishable key**, `sb_publishable_…` | Yes: row level security is what protects the data |

The **secret key** (`sb_secret_…`) and the old **service_role** key must never be copied anywhere in this project. The app refuses to start if one is pasted by mistake.

### A. Create the Supabase project (a new one, only for Gracehush)

1. Open https://supabase.com/dashboard and sign in. Choose **New project** under your own organization.
2. **Name:** `gracehush`. Do not reuse the project of any other app: the Talebrim reader app in the parent folder has its own, and Gracehush must not share a database with it. Users' prayers live here.
3. **Database password:** use **Generate a password**, and save it in your password manager. Step 18 needs it once (`supabase link`). It never goes in the repo or in `.env.local`.
4. **Region:** **East US (North Virginia)**. V1 is English for US users, and one region near most of them keeps every request fast. Write the region down: it goes into `docs/legal-brief.md` (section 5) and the Privacy Policy draft (`docs/privacy-policy.md`, the provider table), which both still say TODO.
5. Leave every other option at its default. The SQL below sets row level security and the exact permissions itself, so it works whatever a new project grants by default.
6. **Plan:** Free is enough for development. A Free project is paused after 7 days without use (the app then shows its error states until you press **Restore project** in the dashboard). Move to Pro before release for backups and no pausing.
7. Wait until the dashboard says the project is ready (about 2 minutes).

### B. Create the profile table (two SQL runs)

1. In the dashboard open **SQL Editor** and choose **New query**.
2. In VS Code open `supabase/schema.sql`, select everything, copy it, paste it into the editor and press **Run**. Expect "Success. No rows returned". It is safe to run again.
3. Open a **new** query, paste the whole of `supabase/selftest.sql` and press **Run**. Expect 11 rows and `passed = true` on every one (it pretends to be three users and a signed-out visitor, tries what must work and what must be refused, and leaves nothing behind). If any row says false, stop and paste the table in the chat.

### C. Clerk: switch on the Supabase integration (Development instance)

1. Open https://dashboard.clerk.com/setup/supabase and choose your Gracehush application and its **Development** instance, the one your `pk_test_…` key belongs to. The implementer prints the exact domain in the chat when it starts (decoded from your key), so you can check you picked the right instance.
2. Press **Activate Supabase integration**. Clerk now adds `role: "authenticated"` to every session token of that instance.
3. Copy the **Clerk domain** the page shows. It must match the domain printed in the chat. If it does not, you are on the wrong instance.

### D. Supabase: tell it to trust Clerk

1. In the dashboard open **Authentication, Sign In / Providers, Third-Party Auth** (direct link: https://supabase.com/dashboard/project/_/auth/third-party, then pick the project).
2. Press **Add provider**, choose **Clerk**, paste the Clerk domain exactly as Clerk showed it, and save.
3. Do **not** touch the JWT secret or rotate any key. This integration never uses them.

### E. Put the two values in `.env.local`

1. In the dashboard press **Connect** (top of the page): copy the **Project URL**. It ends in `.supabase.co` with nothing after it (no `/rest/v1`). Then open **Project Settings, API Keys** and copy the **Publishable key**.
2. Add two lines to `.env.local` (a file that stays on your computer and is never committed):

   ```
   EXPO_PUBLIC_SUPABASE_URL=https://abcd1234.supabase.co
   EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxxxxxxx
   ```

3. Restart Metro with a cleared cache and reopen Expo Go: `npx expo start -c`. A hot reload does not pick up `.env.local`.

### After the step is verified

- If you ever created a JWT template named `supabase` in Clerk (Configure, JWT templates), delete it. If you never did, there is nothing to delete.
- Before release, repeat C and D for the **Production** Clerk instance (Supabase accepts several Clerk domains), and give the production build the two variables: EAS builds do not see `.env.local`, so step 35's EAS environment must list both.
- If you already have a Supabase project or your own SQL for Gracehush, say so before the implementer starts. The self-test is the judge: if it passes on your database, skip A and B. If your tables differ from `supabase/schema.sql`, your database wins and every difference is reported.

---

## Decisions made in the review (approved with this prompt: strike any you disagree with)

1. **Supabase Third-Party Auth with Clerk.** The old draft stopped to ask "switch from the JWT template?". There is no template to switch from: Gracehush has no Supabase project, and no template was ever made. Third-Party Auth is also the only route Clerk and Supabase still support (the template and the shared JWT secret were deprecated on 1 April 2025). The app sends Clerk's normal session token, `getToken()` with no template. AGENTS.md records this (it was updated in the review: Clerk and Supabase note, Authentication Rules). Do not ask again.
2. **One package: `@supabase/supabase-js`**, with `npx expo install @supabase/supabase-js` (version 2.118.0 at the review). No `react-native-url-polyfill`: Expo SDK 57's runtime already installs spec-compliant `URL` and `URLSearchParams` globals (`node_modules/expo/src/winter/runtime.native.ts`, from `whatwg-url-minimum`), and Supabase's quickstart line predates that. No Supabase auth storage either: Clerk owns the session. The packages have an explicit `react-native` export condition and require no Node built-in module (scanned, all seven).
3. **The base schema is applied by hand, once, by you.** AGENTS.md says "never edit production schema by hand", which is why this is a decision: the project is empty, so the first schema has to come from somewhere. `supabase/schema.sql` (the `users_profile` table, `requesting_user_id()`, three row level security policies, column grants) and `supabase/selftest.sql` were written in the review and run in a real Postgres engine (PGlite): 11 of 11 checks pass, twice in a row, and four deliberately broken variants (table-wide grants back, RLS off, `anon` can read, a `using (true)` policy) each fail exactly the checks they should. From step 18 on, every change is a migration, and step 18 baselines `schema.sql`. The implementer runs no SQL anywhere and never uses a Supabase management token or the `npx clerk config patch` command.
4. **The app can never write the plan.** `schema.sql` revokes everything from `anon` and `authenticated`, then grants `authenticated` INSERT on `id` and the three reminder times and UPDATE on the three reminder times only. `subscription_tier` and `created_at` are not writable by any signed-in user, from day one (the old draft left this to step 18, which would have let a user grant themselves Pro with one request from the moment profile writes went live). The typed client blocks it at compile time too (decision 11). Only the service role changes the plan (step 30).
5. **The profile is local-first.** The old draft read the server on every `getProfile()`, and three screens call it on every focus (Journal, Reflection and Profile, the first and the last also on every foreground): each would wait on a network call it does not need, and fail in airplane mode. Now one place talks to the server (`profileSync`, at sign-in, on foreground and 800 ms after a reminder edit), and `getProfile()` reads what the device already knows: the sign-up date and plan from the last sync, the reminder times from the onboarding store, the three settings from the prefs store. The first call after sign-in waits for the sync that started anyway. No hook, screen or copy file changes.
6. **A development build with no Supabase values runs on the mock profile.** A missing value stops a **release** build; in development it falls back to the step 15 and 16 mock (`getProfileSource()`), so you can finish A to E at your own pace and your phone's running Metro never turns red. A **wrong** value (a malformed address, a secret key) always stops the app.
7. **File paths corrected.** The old draft put the client in `src/lib/supabase.ts` and the error mapper in `src/lib/supabaseErrors.ts`, folders AGENTS.md does not have, and told you to delete a template `src/services/supabaseClient.ts` that never existed. AGENTS.md puts the Supabase client in `src/services/supabaseClient.ts`, so: `src/services/supabaseClient.ts`, `src/utils/supabaseErrors.ts`. Prompts 23, 25 and 33 still say `src/lib/…` (reported, not edited).
8. **No anonymous request can leave the app.** supabase-js sends its API key as the bearer token when the token callback returns `null`. So `getSupabase()` returns `null` while nobody is signed in, and the token callback throws `NoSessionError` instead of returning `null`. The old draft's "check that a token getter is set" did not cover a getter that returns `null`.
9. **Fail fast offline.** postgrest-js retries a failed read 3 times, 1, 2 and 4 seconds apart. Measured on 2.118.0 with a fetch that rejects: **7.0 seconds and 4 attempts** for one read (a write is never retried). Profile would hold its skeleton that long in airplane mode, so the client is created with `db: { retry: false }` (measured: 0.0 seconds, 1 attempt). The screens retry on their next focus.
10. **Unsent edits belong to one account.** The old sync would have pushed an offline edit of account A into account B's row if B signed in next on the same phone. Sign-out (`signOutCleanup`) now drops an unsent edit (`discardUnsyncedReminders`), the sync never runs for a user who changed while a request was away, and the settings kept on the device are keyed by Clerk user id.
11. **Two things the old draft did not cover and the build needs:** the hand-written `Database` type must use `type` aliases, not `interface` (with an interface supabase-js collapses the table to `never`: found when type-checking the draft), and the splash gate must also wait for the new prefs store (a write that lands before a persisted store has loaded is overwritten by its load).

---

## 0. Before you write code

1. Read AGENTS.md (Authentication Rules, Backend rules, Database Rules, the Clerk and Supabase note, the supabase-js note), then: `src/data/journalRepository.ts`, `src/data/mappers.ts`, `src/types/database.ts`, `src/types/index.ts`, `src/store/onboardingStore.ts`, `src/store/devStore.ts`, `src/data/mock/scenario.ts`, `src/hooks/useProfileSettings.ts`, `useJournalHome.ts`, `useReflection.ts`, `src/services/account.ts`, `src/components/dev/DevToolsPanel.tsx`, `src/screens/profile/ProfileScreen.tsx` (the reminder code only), `App.tsx`, `supabase/schema.sql`, `supabase/selftest.sql`, `.env.example` and `package.json`. There is no `src/lib/` and no earlier Supabase client.
2. `.env.local`: print variable **names and set or empty only**, never values (a small Node script). If both Supabase names are set, run the whole Verify. If not, write all the code anyway, finish part A of Verify, and print the "What you do yourself" list again at the end. Do not stop the step.
3. In the chat, print the Clerk domain from the publishable key: the key is `pk_test_` plus base64 of the domain and a final `$`. Decode it and show only the domain (it is not secret) so the user can compare it with the one Clerk shows in step C.
4. `src/data/journalRepository.ts` and `src/components/dev/DevToolsPanel.tsx` have **CRLF** line endings in the working tree (`tr -cd '\r' < file | wc -c` was 287 and 444), the other files are LF. Keep each file's endings. If the Edit tool cannot match a multi-line block in a CRLF file, make the replacement with a small Node script that matches on the LF text and writes CRLF back (the review did exactly this), and check the CR count before and after.
5. The user's Metro hot-reloads every save onto their iPhone. Work in this order, so that no save leaves an unresolved import and the real profile switches on only after the bridge that gives it a session is mounted:
   1. `npx expo install @supabase/supabase-js`
   2. new files that import nothing new: `src/utils/jwt.ts`, `src/constants/env.ts`, `src/utils/supabaseErrors.ts`
   3. `src/types/index.ts`, `src/types/database.ts`
   4. `src/store/onboardingStore.ts`, `src/store/profilePrefsStore.ts`
   5. `src/services/supabaseClient.ts`, `src/data/profileRemote.ts`
   6. `src/data/mock/scenario.ts`, `src/store/devStore.ts`
   7. `src/services/profileSync.ts`
   8. `src/components/SupabaseAuthBridge.tsx`, then `App.tsx` (section 8)
   9. `src/data/journalRepository.ts`, `src/services/account.ts` (this is the edit that turns the real profile on)
   10. `src/components/dev/DevToolsPanel.tsx`
   11. `.env.example`, and delete the `TODO(17)` comment in `ProfileScreen.tsx`

The code below was written in the review and passed `tsc` and `eslint` (the React Compiler rules included) against the real supabase-js types, plus 68 Node checks over a fake PostgREST (env check, error mapping, store migration, the sync cases, offline, a second account). The eight new files below are the exact text that was checked. Copy them, change only what the repo needs at that moment, and say what you changed. If the review's scratch folder still exists, `drafts/` (the new files and patched copies of the existing ones), `make_patched.mjs` (rebuilds those copies from the repo, so you can `diff` them against `src/`) and `harness/run.cjs` (the checks) in the `p17/` folder of the review session's scratchpad hold them; otherwise write your own checks for the same cases (listed in Verify, part A).

---

## 1. Environment and the start-up check

`.env.example` gets two names (this file is committed; values stay in `.env.local`):

```
EXPO_PUBLIC_SUPABASE_URL=
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

`src/utils/jwt.ts` (reads a token's claims without checking it; only for the key check and the dev panel):

```ts
// Reads the claims of a JWT without checking its signature. Only for telling the developer what a token carries
// (the key check at start-up, the Supabase check in the dev panel): the server is what trusts a token, never the app.
export function readJwtPayload(token: string): Record<string, unknown> | null {
  const part = token.split(".")[1];
  if (part === undefined || part === "") return null;
  try {
    const base64 = part.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
    const payload: unknown = JSON.parse(atob(padded));
    return typeof payload === "object" && payload !== null && !Array.isArray(payload)
      ? (payload as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}
```

`src/constants/env.ts` (steps 30 and 34 add their variables here; a variable is always read by its full name, because `process.env[name]` is empty in the app):

```ts
import { readJwtPayload } from "@/utils/jwt";

// EXPO_PUBLIC_* values are put into the bundle when it is built, so each one is read by its full name:
// process.env[name] would be undefined in the app.
export const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_PUBLISHABLE_KEY = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

export type SupabaseEnvCheck = { status: "ok" } | { status: "missing" | "invalid"; message: string };

const FIX = "Fix it in .env.local (see .env.example) and restart Expo with `npx expo start -c`.";

// Pure, so it can be tried with any value. A secret key in an EXPO_PUBLIC_ variable would ship inside the app and
// bypass every row level security policy, so it is refused here as well as in code review.
export function checkSupabaseEnv(url: string, key: string): SupabaseEnvCheck {
  if (url === "") {
    return { status: "missing", message: `EXPO_PUBLIC_SUPABASE_URL is missing. ${FIX}` };
  }
  if (key === "") {
    return { status: "missing", message: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY is missing. ${FIX}` };
  }
  // The base project address, with nothing after the host (no /rest/v1).
  if (!/^https:\/\/[^/\s]+\/?$/.test(url)) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_SUPABASE_URL must be the base project address, like https://abcd1234.supabase.co, with nothing after it (no /rest/v1). ${FIX}`,
    };
  }
  const isSecret =
    key.startsWith("sb_secret_") || readJwtPayload(key)?.role === "service_role";
  if (isSecret) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY holds a secret key. Never put one in the app: use the publishable key (sb_publishable_...) from Settings > API Keys. ${FIX}`,
    };
  }
  // The publishable key, or the older anon key (a JWT whose role is anon).
  const isPublishable = key.startsWith("sb_publishable_") || readJwtPayload(key)?.role === "anon";
  if (!isPublishable) {
    return {
      status: "invalid",
      message: `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY does not look like a Supabase publishable key (sb_publishable_...). ${FIX}`,
    };
  }
  return { status: "ok" };
}

export const supabaseEnv = checkSupabaseEnv(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY);
```

`App.tsx` is covered in section 8.

---

## 2. Error mapping and the client

`src/utils/supabaseErrors.ts` (pure: no copy, no logging):

```ts
// Turns what Supabase answered into the failure codes a RepoResult carries. Pure: no copy, no logging.

export const NO_SESSION_ERROR_NAME = "NoSessionError";

// Thrown by the Supabase client's token callback when a request would go out without a signed-in user, so an
// anonymous request can never leave the app (supabase-js would otherwise send its API key as the bearer token).
export class NoSessionError extends Error {
  constructor() {
    super("There is no signed-in session.");
    this.name = NO_SESSION_ERROR_NAME;
  }
}

export type SupabaseFailureCode = "NETWORK" | "UNAUTHORIZED" | "UNKNOWN";

type SupabaseErrorLike = { message?: string | null; code?: string | null };

// `status` is the HTTP status of the answer, or 0 when none came back. postgrest-js 2.118 reports a rejected
// fetch as status 0 with the error's name and message, and that includes a token callback that threw: a failed
// Clerk token request (offline) is NETWORK, and our own NoSessionError is UNAUTHORIZED.
export function toFailureCode(status: number, error: SupabaseErrorLike): SupabaseFailureCode {
  const message = error.message ?? "";
  const code = error.code ?? "";
  if (status === 0) {
    return message.startsWith(NO_SESSION_ERROR_NAME) ? "UNAUTHORIZED" : "NETWORK";
  }
  // 401: the token was refused (PGRST301 to PGRST303). 403 and 42501: row level security or a missing grant.
  if (status === 401 || status === 403 || code.startsWith("PGRST30") || code === "42501") {
    return "UNAUTHORIZED";
  }
  return "UNKNOWN";
}

// What a development warning may say: the table and the error code, never a message, a row, a token or an id.
export function describeFailure(table: string, status: number, error: SupabaseErrorLike): string {
  const reason = error.code || (status === 0 ? "no answer" : `HTTP ${status}`);
  return `${table}: ${reason}`;
}
```

`src/services/supabaseClient.ts`:

```ts
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL, supabaseEnv } from "@/constants/env";
import type { Database } from "@/types/database";
import { readJwtPayload } from "@/utils/jwt";
import { NoSessionError } from "@/utils/supabaseErrors";

// The signed-in Clerk user, set by SupabaseAuthBridge. `getToken` is Clerk's own, called with no template: the
// session token itself is what Supabase verifies (Third-Party Auth), so nothing is cached or shared here.
export type SupabaseSession = {
  userId: string;
  getToken: () => Promise<string | null>;
};

let session: SupabaseSession | null = null;
let client: SupabaseClient<Database> | null = null;

export function setSupabaseSession(next: SupabaseSession | null): void {
  session = next;
}

export function getSupabaseUserId(): string | null {
  return session?.userId ?? null;
}

// The one client of the app, or null when nobody is signed in (or the keys are not set), so a caller has to
// handle "no session" before it can send anything. It is created on first use, because supabase-js asks for a
// token the moment it is created. Never call supabase.auth.* on it: with the accessToken option Clerk owns the
// session and supabase-js throws. TODO(19): Edge Functions verify this same Clerk session token against Clerk's
// JWKS; there is no template token.
export function getSupabase(): SupabaseClient<Database> | null {
  if (session === null || supabaseEnv.status !== "ok") return null;
  client ??= createClient<Database>(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    accessToken: async () => {
      const token = session === null ? null : await session.getToken();
      if (!token) throw new NoSessionError();
      return token;
    },
    // postgrest-js retries a failed read 3 times, 1 s, 2 s and 4 s apart: offline, Profile would hold its
    // skeleton for about 7 seconds. The app is offline-first and its screens retry on focus, so fail at once.
    db: { retry: false },
  });
  return client;
}

export type SessionTokenCheck = "no-session" | "ok" | "no-role-claim" | "unreadable";

// For the dev panel's Supabase check: does the Clerk token carry role = authenticated, the claim the Clerk
// integration adds? Answers a label only. The token and its claims are never returned or logged.
export async function checkSessionToken(): Promise<SessionTokenCheck> {
  if (session === null) return "no-session";
  try {
    const token = await session.getToken();
    if (!token) return "no-session";
    const payload = readJwtPayload(token);
    if (payload === null) return "unreadable";
    return payload.role === "authenticated" ? "ok" : "no-role-claim";
  } catch {
    return "unreadable";
  }
}
```

## 3. Types

`src/types/index.ts`: replace the `RepoResult` block with

```ts
// Used by every repository write added in steps 14, 15, 17, 25 and 29.
export type RepoResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      code: "NOT_FOUND" | "INVALID" | "NETWORK" | "UNAUTHORIZED" | "UNKNOWN";
      message: string;
    };
```

and change the comment above `ProfilePatch` to say the reminder times "live in the onboarding store, and the profile sync (step 17) keeps them in step with users_profile". Adding a member to the union breaks no `switch` (the review type-checked the whole app with it).

`src/types/database.ts`: change `export interface UserProfileRow {` to a type alias, add the new types before `DailyAffirmationRow`, and add one header line saying step 17 added `Database`:

```ts
// A type alias, not an interface: supabase-js only accepts a table whose Row is a plain object type (an interface has
// no implicit index signature, and the whole table then collapses to `never`).
export type UserProfileRow = {
  /* …the same fields as before… */
};

// What the app may send when it creates and changes its own profile row: the same columns supabase/schema.sql
// grants to the `authenticated` role. subscription_tier and created_at are not here on purpose, so sending one
// does not type-check. Type aliases, for the reason above. TODO(18): replaced by the generated types.
export type UserProfileInsert = {
  id: string;
  reminder_morning?: string; // "HH:mm:ss"
  reminder_afternoon?: string;
  reminder_evening?: string;
};

export type UserProfileUpdate = {
  reminder_morning?: string;
  reminder_afternoon?: string;
  reminder_evening?: string;
};

// The shape supabase-js wants. journal_entries and daily_affirmations are not queried until steps 25 and 28.
export type Database = {
  public: {
    Tables: {
      users_profile: {
        Row: UserProfileRow;
        Insert: UserProfileInsert;
        Update: UserProfileUpdate;
        Relationships: [];
      };
    };
    Views: { [_ in never]: never };
    Functions: { [_ in never]: never };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
```

Prove the typing once (then delete the proof): a file that calls `.update({ subscription_tier: "pro" })`, `.upsert({ id: "x", created_at: "…" })`, `.upsert({ reminder_morning: "08:00:00" })` (no id) and `.from("journal_entries")` each under `// @ts-expect-error`, and `tsc` must pass (an unused directive is an error).

---

## 4. Stores

### 4.1 Onboarding store (`src/store/onboardingStore.ts`)

Change only what the sync needs. `remindersDirty` means "an edit the server has not seen"; `remindersSyncedAt` keeps its meaning.

- State and persisted type: add `remindersDirty: boolean`, and the three actions `markRemindersSynced`, `applyServerReminders(times)`, `discardUnsyncedReminders`. Update the comment on `remindersSyncedAt` to "set when the times last matched users_profile (step 17)". `getInitialData()` gets `remindersDirty: false`; `partialize` and `merge` carry it (`remindersDirty: saved.remindersDirty === true`).
- `setReminder` also sets `remindersDirty: true`, then the actions:

```ts
      markRemindersSynced: () =>
        set({ remindersDirty: false, remindersSyncedAt: new Date().toISOString() }),
      applyServerReminders: (times) =>
        set((state) => ({
          reminders: {
            morning: isHHmm(times.morning) ? times.morning : state.reminders.morning,
            afternoon: isHHmm(times.afternoon) ? times.afternoon : state.reminders.afternoon,
            evening: isHHmm(times.evening) ? times.evening : state.reminders.evening,
          },
          remindersDirty: false,
          remindersSyncedAt: new Date().toISOString(),
        })),
      discardUnsyncedReminders: () => set({ remindersDirty: false }),
```

- Persist version 1 to **2**, with this `migrate` (an existing install keeps its times; a time that differs from the default, with nothing ever synced, was changed on this device and is unsent):

```ts
      // `merge` validates every field. Version 2 (step 17) added remindersDirty. Before it nothing synced the times, so
      // a time that differs from the default was changed on this device and the server has not seen it. Step 34 extends this.
      migrate: (persisted: unknown, version: number) => {
        const saved: Record<string, unknown> = isRecord(persisted) ? persisted : {};
        if (version >= 2) return saved as OnboardingPersisted;
        const savedReminders: Record<string, unknown> = isRecord(saved.reminders) ? saved.reminders : {};
        const changed = (Object.keys(DEFAULT_REMINDERS) as TimeSlot[]).some(
          (slot) => isHHmm(savedReminders[slot]) && savedReminders[slot] !== DEFAULT_REMINDERS[slot],
        );
        return { ...saved, remindersDirty: changed && saved.remindersSyncedAt == null } as OnboardingPersisted;
      },
```

Nothing else in the store or in the onboarding screens changes.

### 4.2 Profile prefs store (`src/store/profilePrefsStore.ts`, new; AsyncStorage key `gracehush.profilePrefs`, version 1)

```ts
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { AMBIENT_SOUNDS } from "@/constants/app";
import type { AmbientSound, ProfilePatch, SubscriptionTier } from "@/types";

import { safeStorage } from "./safeStorage";

// What the server has no column for yet (the three settings step 15 added) and the two profile fields the app
// shows offline (when the account was created, and the plan). Kept per Clerk user, so a second account on the same
// phone never sees the first one's. TODO(18): the settings become users_profile columns; delete this store then
// (step 24's cache keeps the offline copy of createdAt and the plan).
export type SavedPrefs = {
  affirmationsEnabled?: boolean;
  ambientSound?: AmbientSound;
  ambientVolume?: number; // 0 to 1
};

export type ServerSnapshot = {
  createdAt: string; // ISO
  subscriptionTier: SubscriptionTier;
  syncedAt: string; // ISO, when the server last said so
};

export type ProfileEntry = { prefs: SavedPrefs; snapshot: ServerSnapshot | null };

interface ProfilePrefsState {
  byUser: Record<string, ProfileEntry>;
  savePrefs: (userId: string, patch: ProfilePatch) => void;
  saveSnapshot: (userId: string, snapshot: ServerSnapshot) => void;
  forgetUser: (userId: string) => void; // account deletion
}

const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTimestamp(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

function readPrefs(value: unknown): SavedPrefs {
  const saved = isRecord(value) ? value : {};
  const prefs: SavedPrefs = {};
  if (typeof saved.affirmationsEnabled === "boolean") prefs.affirmationsEnabled = saved.affirmationsEnabled;
  const sound = AMBIENT_SOUNDS.find((item) => item === saved.ambientSound);
  if (sound !== undefined) prefs.ambientSound = sound;
  const volume = saved.ambientVolume;
  if (typeof volume === "number" && Number.isFinite(volume)) {
    prefs.ambientVolume = Math.min(1, Math.max(0, volume));
  }
  return prefs;
}

function readSnapshot(value: unknown): ServerSnapshot | null {
  if (!isRecord(value)) return null;
  const tier = TIERS.find((item) => item === value.subscriptionTier);
  if (!isTimestamp(value.createdAt) || !isTimestamp(value.syncedAt) || tier === undefined) return null;
  return { createdAt: value.createdAt, subscriptionTier: tier, syncedAt: value.syncedAt };
}

const emptyEntry = (): ProfileEntry => ({ prefs: {}, snapshot: null });

export const useProfilePrefsStore = create<ProfilePrefsState>()(
  persist(
    (set) => ({
      byUser: {},
      savePrefs: (userId, patch) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          const prefs: SavedPrefs = { ...entry.prefs };
          if (patch.affirmationsEnabled !== undefined) prefs.affirmationsEnabled = patch.affirmationsEnabled;
          if (patch.ambientSound !== undefined) prefs.ambientSound = patch.ambientSound;
          if (patch.ambientVolume !== undefined) prefs.ambientVolume = patch.ambientVolume;
          return { byUser: { ...state.byUser, [userId]: { ...entry, prefs } } };
        }),
      saveSnapshot: (userId, snapshot) =>
        set((state) => {
          const entry = state.byUser[userId] ?? emptyEntry();
          return { byUser: { ...state.byUser, [userId]: { ...entry, snapshot } } };
        }),
      forgetUser: (userId) =>
        set((state) => ({
          byUser: Object.fromEntries(Object.entries(state.byUser).filter(([id]) => id !== userId)),
        })),
    }),
    {
      name: "gracehush.profilePrefs",
      version: 1,
      storage: createJSONStorage(() => safeStorage),
      partialize: (state) => ({ byUser: state.byUser }),
      // zustand's default merge is shallow, and the saved JSON may be damaged: check every field, and drop what fails.
      merge: (persisted: unknown, current: ProfilePrefsState): ProfilePrefsState => {
        const saved = isRecord(persisted) && isRecord(persisted.byUser) ? persisted.byUser : {};
        const byUser = Object.fromEntries(
          Object.entries(saved).flatMap(([userId, entry]) => {
            if (!isRecord(entry)) return [];
            return [[userId, { prefs: readPrefs(entry.prefs), snapshot: readSnapshot(entry.snapshot) }]];
          }),
        );
        return { ...current, byUser };
      },
      onRehydrateStorage: () => (_state, error) => {
        if (error && __DEV__) {
          console.warn("[profilePrefs] could not load the saved state", error);
        }
      },
    },
  ),
);
```

This is an exception to "sign-out clears Zustand stores" (AGENTS.md records it): the three settings are the user's, keyed by their id, and a Daily Affirmations switch that silently turned back on after a sign-out would be worse than keeping it. Account deletion removes them (section 6).

---

## 5. Reading and writing the profile

### 5.1 `src/data/profileRemote.ts` (new: the only code that sends a request about `users_profile`)

```ts
import { copy } from "@/constants/copy";
import { getSupabase, getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import type { RepoResult, TimeSlot } from "@/types";
import type { UserProfileRow } from "@/types/database";
import { describeFailure, toFailureCode } from "@/utils/supabaseErrors";

// The only code that sends a request about users_profile. Step 17 reads and writes the row's reminder times and
// reads the rest; everything else about the profile is still on this device (TODO(18)).

let lastError: string | null = null;

// For the dev panel's Supabase check: the code of the last failure, or null after a success.
export function getLastProfileError(): string | null {
  return lastError;
}

function unauthorized(): RepoResult<never> {
  lastError = "no session";
  return { ok: false, code: "UNAUTHORIZED", message: copy.profile.errors.load };
}

function fail(status: number, error: { message?: string | null; code?: string | null }): RepoResult<never> {
  const code = toFailureCode(status, error);
  lastError = describeFailure("users_profile", status, error);
  if (__DEV__) {
    // Only the table and the code, never a message, a row, a token or an id.
    console.warn(`[supabase] ${lastError}`);
    if (error.code === "42501") {
      console.warn(
        "[supabase] row level security refused the request: check the Clerk integration and that supabase/schema.sql was run",
      );
    }
  }
  return { ok: false, code, message: copy.profile.errors.load };
}

// "08:00" to the "08:00:00" a TIME column takes.
function toTimeColumn(hhmm: string): string {
  return `${hhmm}:00`;
}

// The signed-in user's row, or null when there is none yet. RLS shows only their own row; the filter is for clarity.
export async function selectProfileRow(): Promise<RepoResult<UserProfileRow | null>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { data, error, status } = await supabase
    .from("users_profile")
    .select("*")
    .eq("id", userId)
    .maybeSingle();
  if (error !== null) return fail(status, error);
  lastError = null;
  return { ok: true, data };
}

// How many rows of users_profile this user can see. Row level security must make it 1 (or 0 before the row exists),
// whatever the table holds: the dev panel's Supabase check shows it.
export async function countVisibleProfileRows(): Promise<RepoResult<number>> {
  const supabase = getSupabase();
  if (supabase === null) return unauthorized();
  const { count, error, status } = await supabase
    .from("users_profile")
    .select("*", { count: "exact", head: true });
  if (error !== null) return fail(status, error);
  lastError = null;
  return { ok: true, data: count ?? 0 };
}

// The row, created from this device's reminder times if the account has none yet. The insert never overwrites a
// row that exists (ON CONFLICT DO NOTHING), so two devices signing in together cannot fight over it. The app can
// send only the columns it has an INSERT grant on (id and the three times): the plan is always the database default.
export async function fetchOrCreateProfileRow(): Promise<RepoResult<UserProfileRow>> {
  const found = await selectProfileRow();
  if (!found.ok) return found;
  if (found.data !== null) return { ok: true, data: found.data };

  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { reminders } = useOnboardingStore.getState();
  const { error, status } = await supabase.from("users_profile").upsert(
    {
      id: userId,
      reminder_morning: toTimeColumn(reminders.morning),
      reminder_afternoon: toTimeColumn(reminders.afternoon),
      reminder_evening: toTimeColumn(reminders.evening),
    },
    { onConflict: "id", ignoreDuplicates: true },
  );
  if (error !== null) return fail(status, error);

  // Read it back: either this insert or another device's made the row.
  const created = await selectProfileRow();
  if (!created.ok) return created;
  return created.data === null
    ? { ok: false, code: "UNKNOWN", message: copy.profile.errors.load }
    : { ok: true, data: created.data };
}

// Writes the three reminder times. An update that changes no row means the row is missing or hidden from this user.
export async function pushReminderColumns(
  times: Record<TimeSlot, string>,
): Promise<RepoResult<UserProfileRow>> {
  const supabase = getSupabase();
  const userId = getSupabaseUserId();
  if (supabase === null || userId === null) return unauthorized();
  const { data, error, status } = await supabase
    .from("users_profile")
    .update({
      reminder_morning: toTimeColumn(times.morning),
      reminder_afternoon: toTimeColumn(times.afternoon),
      reminder_evening: toTimeColumn(times.evening),
    })
    .eq("id", userId)
    .select();
  if (error !== null) return fail(status, error);
  lastError = null;
  const row = data[0];
  return row === undefined
    ? { ok: false, code: "NOT_FOUND", message: copy.profile.errors.load }
    : { ok: true, data: row };
}
```

### 5.2 `src/data/mock/scenario.ts` and `src/store/devStore.ts` (the dev switch)

`scenario.ts`: import `supabaseEnv` from `@/constants/env`, and add next to `getMockScenario`:

```ts
// Where the profile comes from (step 17). A release build always uses Supabase. In development the dev panel
// chooses, and a development build whose .env.local has no Supabase address falls back to the mock, so the app
// still runs before the Supabase project exists.
export type ProfileSource = "supabase" | "mock";

export function getProfileSource(): ProfileSource {
  if (!__DEV__) return "supabase";
  return supabaseEnv.status === "ok" ? useDevStore.getState().profileSource : "mock";
}
```

`devStore.ts`: import the `ProfileSource` type from `@/data/mock/scenario` (type only), and add

```ts
  // Where the profile comes from (step 17): the real Supabase row, or the step 06 mock with its plans and scenarios.
  // Read through getProfileSource(), which also falls back to the mock when .env.local has no Supabase address.
  profileSource: ProfileSource;
  setProfileSource: (source: ProfileSource) => void;
```

with `profileSource: "supabase"` and its setter in the store.

### 5.3 `src/data/journalRepository.ts` (only the profile functions change; every signature stays)

Header comment: `// TEMP(24/25/29): internals move to the SQLite cache and Supabase. Keep the names and argument order; those steps widen some return types to RepoResult. The profile is real since step 17.` Imports to add: `getProfileSource` (from `@/data/mock/scenario`), `syncProfile` (`@/services/profileSync`), `getSupabaseUserId` (`@/services/supabaseClient`), `useProfilePrefsStore` (`@/store/profilePrefsStore`), and `UserProfileRow` (type, from `@/types/database`).

Replace `readProfile` and `getProfile` with:

```ts
// The reminder times are the ones saved on this device, so an edit on Profile reaches the Journal's current
// slot and Reflection's times at once (the profile sync keeps them in step with users_profile).
function readMockProfile(): UserProfile {
  return {
    ...toUserProfile(getMockDb().profile),
    reminders: { ...useOnboardingStore.getState().reminders },
  };
}

// The signed-in user's profile as this device knows it (step 17): the sign-up date and the plan from the last sync,
// the reminder times from the onboarding store, and the settings users_profile has no column for yet. Null until
// the first sync has finished. TODO(18): the settings become columns, and the prefs store goes away.
function readLocalProfile(userId: string): UserProfile | null {
  const entry = useProfilePrefsStore.getState().byUser[userId];
  if (entry === undefined || entry.snapshot === null) return null;
  const { prefs, snapshot } = entry;
  const row: UserProfileRow = {
    id: userId,
    created_at: snapshot.createdAt,
    subscription_tier: snapshot.subscriptionTier,
    reminder_morning: null,
    reminder_afternoon: null,
    reminder_evening: null,
    last_active_at: null,
    ambient_sound: prefs.ambientSound ?? null,
    ambient_volume: prefs.ambientVolume ?? null,
    affirmations_enabled: prefs.affirmationsEnabled ?? null,
  };
  return { ...toUserProfile(row), reminders: { ...useOnboardingStore.getState().reminders } };
}

// Never waits for the network once the account has synced, so Journal, Reflection and Profile open offline and as
// fast as they did on the mock. The first call after sign-in waits for the sync the app already started (one request).
// A failure throws: the hooks that call this already show their error state and retry on the next focus.
export async function getProfile(): Promise<UserProfile> {
  if (getProfileSource() === "mock") {
    await simulateLatency();
    return readMockProfile();
  }
  const userId = getSupabaseUserId();
  if (userId === null) throw new Error("There is no signed-in user.");
  const known = readLocalProfile(userId);
  if (known !== null) return known;
  const synced = await syncProfile();
  const afterSync = synced.ok ? readLocalProfile(userId) : null;
  if (afterSync === null) throw new Error(copy.profile.errors.load);
  return afterSync;
}
```

`failure()` takes `"NOT_FOUND" | "INVALID" | "NETWORK" | "UNAUTHORIZED"`. Replace `updateProfile` (the old `readProfile()` call inside it becomes `readMockProfile()`):

```ts
// The same checks in both modes: an unknown sound or a volume that is not a number is INVALID, and a volume
// outside 0..1 is clamped. An empty patch is fine.
function checkProfilePatch(patch: ProfilePatch): RepoResult<ProfilePatch> {
  const { affirmationsEnabled, ambientSound, ambientVolume } = patch;
  if (affirmationsEnabled !== undefined && typeof affirmationsEnabled !== "boolean") {
    return failure("INVALID", copy.profile.errors.save);
  }
  if (ambientSound !== undefined && !AMBIENT_SOUNDS.includes(ambientSound)) {
    return failure("INVALID", copy.profile.errors.save);
  }
  if (ambientVolume !== undefined && !Number.isFinite(ambientVolume)) {
    return failure("INVALID", copy.profile.errors.save);
  }
  const clean: ProfilePatch = {};
  if (affirmationsEnabled !== undefined) clean.affirmationsEnabled = affirmationsEnabled;
  if (ambientSound !== undefined) clean.ambientSound = ambientSound;
  if (ambientVolume !== undefined) clean.ambientVolume = Math.min(1, Math.max(0, ambientVolume));
  return { ok: true, data: clean };
}

// Saves what Profile can change. Same order as the prayer writes: wait (mock only), the dev failure flag, validate,
// write. The mock mode writes the mock row. Otherwise the three settings are kept on this device for the signed-in
// user, because users_profile has no column for them yet. TODO(18): write the columns, and delete the prefs store.
export async function updateProfile(patch: ProfilePatch): Promise<RepoResult<UserProfile>> {
  const isMock = getProfileSource() === "mock";
  if (isMock) await simulateWrite(PROFILE_CHANGE_MS);
  if (takeMockPrayerMutationFailure()) return failure("NETWORK", copy.profile.errors.save);
  const checked = checkProfilePatch(patch);
  if (!checked.ok) return checked;
  const clean = checked.data;
  if (isMock) {
    const row = getMockDb().profile;
    if (clean.affirmationsEnabled !== undefined) row.affirmations_enabled = clean.affirmationsEnabled;
    if (clean.ambientSound !== undefined) row.ambient_sound = clean.ambientSound;
    if (clean.ambientVolume !== undefined) row.ambient_volume = clean.ambientVolume;
    if (Object.keys(clean).length > 0) row.updated_at = new Date().toISOString();
    return { ok: true, data: readMockProfile() };
  }
  const userId = getSupabaseUserId();
  if (userId === null) return failure("UNAUTHORIZED", copy.profile.errors.save);
  useProfilePrefsStore.getState().savePrefs(userId, clean);
  const saved = readLocalProfile(userId);
  return saved === null ? failure("NOT_FOUND", copy.profile.errors.save) : { ok: true, data: saved };
}
```

`getUsage()`, `setMockSubscriptionTier`, `getMockSubscriptionTier` and `submitEntry` stay as they are, `TEMP(30)` and friends included: **no screen shows `profile.subscriptionTier`**, the plan card and the mock submit read the mock database's tier, so the step 16 purchase mock keeps working in both modes and never writes to Supabase. The old draft's "in-memory tier override" is therefore not needed (prompt 30 mentions it; nothing exists to remove).

---

## 6. The sync, the bridge and sign-out

### 6.1 `src/services/profileSync.ts` (new)

```ts
import { toUserProfile } from "@/data/mappers";
import { getProfileSource } from "@/data/mock/scenario";
import { fetchOrCreateProfileRow, pushReminderColumns } from "@/data/profileRemote";
import { copy } from "@/constants/copy";
import { getSupabaseUserId } from "@/services/supabaseClient";
import { useOnboardingStore } from "@/store/onboardingStore";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
import type { RepoResult, SubscriptionTier, TimeSlot } from "@/types";

// Keeps this device and users_profile in step (step 17): it makes sure the account has a row, remembers what the
// server says about the plan and the sign-up date, and moves the reminder times whichever way is newer.
// Nothing here shows an error to the user: a failure leaves the edit marked unsent and the next trigger tries again.

const REMINDER_SYNC_DEBOUNCE_MS = 800;
const FOREGROUND_SYNC_GAP_MS = 30_000;

const SLOTS: readonly TimeSlot[] = ["morning", "afternoon", "evening"];
const TIERS: readonly SubscriptionTier[] = ["free", "trial", "pro"];

type Times = Record<TimeSlot, string>;
export type ReminderAction = "mark-synced" | "push" | "apply-server";

export function sameTimes(a: Times, b: Times): boolean {
  return SLOTS.every((slot) => a[slot] === b[slot]);
}

// Equal: nothing to move. Different, and this device holds an edit the server has not seen: the edit wins, it is the
// newest thing the user did. Different and nothing unsent: the server has the newest times (another phone, or the
// table editor).
export function decideReminderSync(server: Times, local: Times, dirty: boolean): ReminderAction {
  if (sameTimes(server, local)) return "mark-synced";
  return dirty ? "push" : "apply-server";
}

function unauthorized(): RepoResult<never> {
  return { ok: false, code: "UNAUTHORIZED", message: copy.profile.errors.load };
}

let running: Promise<RepoResult<null>> | null = null;
let runAgain = false;
let lastOkAt = 0;
let timer: ReturnType<typeof setTimeout> | null = null;

async function runOnce(): Promise<RepoResult<null>> {
  const userId = getSupabaseUserId();
  if (userId === null) return unauthorized();
  // The mock profile needs no network.
  if (getProfileSource() !== "supabase") return { ok: true, data: null };

  const fetched = await fetchOrCreateProfileRow();
  if (!fetched.ok) return fetched;
  // The user may have signed out, or another account signed in, while the request was away.
  if (getSupabaseUserId() !== userId) return unauthorized();

  const row = fetched.data;
  const tier = TIERS.find((item) => item === row.subscription_tier) ?? "free";
  useProfilePrefsStore.getState().saveSnapshot(userId, {
    createdAt: row.created_at,
    subscriptionTier: tier,
    syncedAt: new Date().toISOString(),
  });

  const server = toUserProfile(row).reminders;
  const onboarding = useOnboardingStore.getState();
  const action = decideReminderSync(server, onboarding.reminders, onboarding.remindersDirty);

  if (action === "apply-server") {
    onboarding.applyServerReminders(server);
    // TODO(28): reschedule the affirmation notifications for the new times
  } else if (action === "mark-synced") {
    if (onboarding.remindersDirty || onboarding.remindersSyncedAt === null) {
      onboarding.markRemindersSynced();
    }
  } else {
    const pushed = { ...onboarding.reminders };
    const written = await pushReminderColumns(pushed);
    if (!written.ok) return written;
    if (getSupabaseUserId() !== userId) return unauthorized();
    const latest = useOnboardingStore.getState();
    // An edit made while the request was away is not on the server yet: it stays unsent and goes in a moment.
    if (sameTimes(latest.reminders, pushed)) latest.markRemindersSynced();
    else scheduleReminderSync();
  }
  lastOkAt = Date.now();
  return { ok: true, data: null };
}

// One sync at a time. A call that arrives while one is running asks for another run right after it, so an edit
// that came in too late for the running one is never skipped.
export function syncProfile(): Promise<RepoResult<null>> {
  if (running !== null) {
    runAgain = true;
    return running;
  }
  running = (async () => {
    let result = await runOnce();
    while (runAgain) {
      runAgain = false;
      result = await runOnce();
    }
    return result;
  })().finally(() => {
    running = null;
  });
  return running;
}

export function scheduleReminderSync(): void {
  cancelReminderSync();
  timer = setTimeout(() => {
    timer = null;
    syncProfile();
  }, REMINDER_SYNC_DEBOUNCE_MS);
}

export function cancelReminderSync(): void {
  if (timer !== null) {
    clearTimeout(timer);
    timer = null;
  }
}

// Called when the app comes back to the foreground: at once when an edit is unsent, otherwise at most every 30 s.
export function syncProfileOnForeground(): void {
  if (useOnboardingStore.getState().remindersDirty || Date.now() - lastOkAt >= FOREGROUND_SYNC_GAP_MS) {
    syncProfile();
  }
}

// Sends a reminder edit 800 ms after the last change. Returns the function that stops watching.
export function startReminderSync(): () => void {
  const unsubscribe = useOnboardingStore.subscribe((state, previous) => {
    if (state.remindersDirty && state.reminders !== previous.reminders) scheduleReminderSync();
  });
  return () => {
    unsubscribe();
    cancelReminderSync();
  };
}
```

How the cases come out (all run in the review's harness): a **new account** keeps this phone's times (the insert used them, so server and phone agree: nothing is pushed). An **existing account on a new phone** takes the server's times (nothing unsent). An **unsent edit** is pushed, then marked synced; a failed push leaves it unsent and the next trigger retries. An edit made **while a push is away** is not lost (the post-push comparison keeps it unsent and schedules another run). Signing out or switching account **mid-request** writes nothing.

### 6.2 `src/components/SupabaseAuthBridge.tsx` (new; renders nothing)

```tsx
import { useAuth } from "@clerk/expo";
import { useEffect, useLayoutEffect } from "react";
import { AppState } from "react-native";

import { startReminderSync, syncProfile, syncProfileOnForeground } from "@/services/profileSync";
import { setSupabaseSession } from "@/services/supabaseClient";

// Connects the signed-in Clerk user to Supabase and renders nothing. It sits above the navigator, inside
// ClerkProvider and after the splash gate, so the stores it uses have loaded.
export function SupabaseAuthBridge() {
  const { isSignedIn, userId, getToken } = useAuth();
  const signedInUserId = isSignedIn && userId ? userId : null;

  // A layout effect, so the session is set before any screen's own effect asks the repository for the profile.
  useLayoutEffect(() => {
    setSupabaseSession(
      signedInUserId === null ? null : { userId: signedInUserId, getToken: () => getToken() },
    );
    return () => setSupabaseSession(null);
  }, [signedInUserId, getToken]);

  // The work that follows a sign-in, and again when the app returns to the foreground. A failure blocks nothing:
  // the next foreground tries again. Later steps add their lines here (24 opens the user's database, 30 sets up
  // purchases, 33 starts realtime).
  useEffect(() => {
    if (signedInUserId === null) return;
    syncProfile();
    const stopReminderSync = startReminderSync();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") syncProfileOnForeground();
    });
    return () => {
      subscription.remove();
      stopReminderSync();
    };
  }, [signedInUserId]);

  return null;
}
```

`getToken()` is Clerk's, called with **no** template and no options. It returns `null` when signed out and the live token when signed in (`@clerk/react` `createGetToken` reads the session at call time and `useAuth` keeps its identity stable), which is why the callback in the client throws on `null`.

### 6.3 `src/services/account.ts`

Import `cancelReminderSync` (`@/services/profileSync`), `getSupabaseUserId` (`@/services/supabaseClient`), `useOnboardingStore` and `useProfilePrefsStore`. In `signOutCleanup`, replace the `TODO(17)` line with:

```ts
  // A reminder edit that has not reached the server belongs to the account that made it: it must never be sent to
  // the next account that signs in on this phone.
  cancelReminderSync();
  useOnboardingStore.getState().discardUnsyncedReminders();
```

In `deleteAccount`, read the id before the cleanup and forget the device's copy after it:

```ts
  const userId = getSupabaseUserId();
  await signOutCleanup();
  // The settings kept on this device for the account go with it.
  if (userId !== null) useProfilePrefsStore.getState().forgetUser(userId);
```

The comment above `signOutCleanup` ("Steps 17, 24, …") keeps its list. The bridge sets the session to `null` itself when Clerk signs out.

---

## 7. The dev panel (`src/components/dev/DevToolsPanel.tsx`; dev-only, so strings stay inline)

Add, then wire:

1. Imports: `supabaseEnv` (`@/constants/env`), `countVisibleProfileRows`, `getLastProfileError`, `selectProfileRow` (`@/data/profileRemote`), the `ProfileSource` type (from `@/data/mock/scenario`), and `checkSessionToken`, `getSupabaseUserId`, `type SessionTokenCheck` (`@/services/supabaseClient`).
2. Constants next to `PLANS`:

```ts
const PROFILE_SOURCES: ProfileSource[] = ["supabase", "mock"];
const TOKEN_LABELS: Record<SessionTokenCheck, string> = {
  ok: "has role = authenticated",
  "no-role-claim": "NO role claim: activate the Supabase integration in Clerk",
  "no-session": "none",
  unreadable: "could not read it (offline?)",
};
```

3. The check (module level, before `DevButton`):

```ts
// What the Supabase check shows on screen: yes or no and a code, never an id, a token or a row.
async function runSupabaseCheck(source: ProfileSource): Promise<string[]> {
  const signedIn = getSupabaseUserId() !== null;
  const lines = [
    `Supabase keys in .env.local: ${supabaseEnv.status === "ok" ? "yes" : "no"}`,
    `profile source: ${source}`,
    `signed in: ${signedIn ? "yes" : "no"}`,
  ];
  if (supabaseEnv.status !== "ok" || !signedIn) return lines;
  lines.push(`Clerk token: ${TOKEN_LABELS[await checkSessionToken()]}`);
  const found = await selectProfileRow();
  lines.push(
    `profile row: ${found.ok ? (found.data === null ? "not found" : "found") : `error ${found.code}`}`,
  );
  // Row level security: this must say 1 (or 0 before the row exists) even when the table holds other accounts.
  const visible = await countVisibleProfileRows();
  lines.push(`rows this user can see: ${visible.ok ? visible.data : `error ${visible.code}`}`);
  lines.push(`last error: ${getLastProfileError() ?? "none"}`);
  return lines;
}
```

4. `loadDataCheck` must survive a failing profile (the panel is shown in every Profile state): `getProfile().catch(() => null)` in the `Promise.all`; `getCurrentSlot(now, profile?.reminders ?? useOnboardingStore.getState().reminders)`; and `profile ? formatMonthYear(profile.createdAt) : "no profile"` in the `format:` line.
5. In `DevToolsContent`: read `profileSource` and `setProfileSource` from the dev store, with `const profileSource: ProfileSource = supabaseEnv.status === "ok" ? chosenProfileSource : "mock";` (what the app really uses); state `supabaseLines` (`string[]`) and `checking` (`boolean`); and

```tsx
  // Profile and this panel reload through the mock profile version, as for a mock plan change.
  function changeProfileSource(next: ProfileSource) {
    setProfileSource(next);
    setSupabaseLines([]);
    bumpMockProfileVersion();
  }

  async function checkSupabase() {
    setChecking(true);
    setSupabaseLines(await runSupabaseCheck(profileSource));
    setChecking(false);
  }
```

6. The controls, in the buttons column just above "Mock plan (dev)":

```tsx
        <View className="gap-2">
          <Text className="text-center text-body-sm text-mauve">Profile source (dev)</Text>
          <View className="flex-row flex-wrap justify-center gap-2">
            {PROFILE_SOURCES.map((name) => (
              <DevButton
                key={name}
                label={name}
                accessibilityLabel={`Profile source ${name} (dev)`}
                selected={name === profileSource}
                onPress={() => changeProfileSource(name)}
              />
            ))}
          </View>
          {supabaseEnv.status !== "ok" ? (
            <Text className="text-center text-body-sm text-mauve">
              No Supabase address in .env.local, so the profile uses the mock.
            </Text>
          ) : null}
          <View className="items-center gap-2">
            <DevButton label="Supabase check (dev)" disabled={checking} onPress={checkSupabase} />
            {supabaseLines.map((line) => (
              <Text key={line} className="text-center text-body-sm text-ink">
                {line}
              </Text>
            ))}
          </View>
        </View>
```

Nothing the panel shows, logs or warns may contain a token, a Clerk id, an email or a row.

---

## 8. `App.tsx` (right after the bridge exists, and before the repository edit)

```tsx
import { SupabaseAuthBridge } from "@/components/SupabaseAuthBridge";
import { supabaseEnv } from "@/constants/env";
import { useProfilePrefsStore } from "@/store/profilePrefsStore";
```

In `AppShell`: `const prefsHydrated = useStoreHydrated(useProfilePrefsStore);` next to the onboarding one; the hide-splash effect and the early return both also require `prefsHydrated` (update the comment: the fonts, Clerk and the two saved stores load in parallel, and the profile sync never writes to a store that is still loading); render `<SupabaseAuthBridge />` as the first child of `SafeAreaProvider`, before `NavigationContainer`. In `App()`, after the Clerk key check:

```tsx
  // A wrong Supabase value always stops the app (a secret key in an EXPO_PUBLIC_ variable would ship inside it).
  // A missing one stops a release build only: in development the profile falls back to the mock, so the app runs
  // before the Supabase project exists (getProfileSource).
  if (supabaseEnv.status === "invalid" || (supabaseEnv.status === "missing" && !__DEV__)) {
    throw new Error(supabaseEnv.message);
  }
  if (__DEV__ && supabaseEnv.status === "missing") {
    console.info(`[supabase] ${supabaseEnv.message} Until then the profile uses the mock.`);
  }
```

(`console.info` on purpose: a `warn` raises a LogBox toast over the lower screen, and Clerk's development-key toast is already there.)

---

## 9. Rules

- One new dependency, `@supabase/supabase-js`, and nothing else. No `any`, no `@ts-ignore`. No change to any screen, hook, copy string or layout (the dev panel is dev UI; the only `ProfileScreen.tsx` change is deleting its `TODO(17)` comment).
- No migration, no RLS or storage change, no Edge Function, no dashboard setting, no Supabase management token, no `npx clerk config patch`.
- The service-role or secret key never appears in the app, in `.env.example`, in an `EXPO_PUBLIC_` variable or in a log. If you find one anywhere in the client, stop and tell the user. Never call `supabase.auth.*`.
- Never log a token, a Clerk user id, an email or a row. A development warning may carry the table name and an error code only.
- Every new mock-like thing carries its marker (the release gate greps `TEMP(` and `TODO: real`). This step adds none and removes two `TEMP(17)` comment lines.
- Markers to leave: `TODO(18)` (the three settings become columns; delete `profilePrefsStore.ts`; the generated types replace `Database`), `TODO(19)` (Edge Functions verify the Clerk session token), `TODO(28)` (reschedule notifications after the sync applies new times), `TEMP(30)` on the mock tier stays where it is.

---

## 10. AGENTS.md updates

Already applied in the review (do not redo; check they still read right): the Clerk and Supabase note, the supabase-js note, the Authentication Rules (client location, Third-Party Auth, no template, the RLS and grants rule, and the sign-out exception for the prefs store, the reminder debounce and an unsent edit), the client-safe env variable names, Mandatory Fix 1, and Database Rules (the base schema, the one "by hand" exception, the plan lock).

Do now, in the same step:

- **Architecture tree:** `constants/env.ts`; `components/SupabaseAuthBridge`; `services/supabaseClient.ts` and `profileSync.ts` (replace "Planned: … supabaseClient.ts"); `data/profileRemote.ts`; `store/profilePrefsStore.ts`; `utils/jwt.ts` and `supabaseErrors.ts`; `types/database.ts` now holds `Database`; a `supabase/` entry for `schema.sql` and `selftest.sql`; the `journalRepository.ts` line (`getProfile` is local-first since step 17 and `updateProfile` keeps the three settings per user on the device until step 18).
- **Onboarding spec and store paragraph** (Screen Spec 1 step 2, "Onboarding store (step 07)"): version 2, `remindersDirty` and the three actions, the sync rule (an unsent edit wins, otherwise the server's times win, a sign-out drops an unsent edit), and that `remindersSyncedAt` is set when the times last matched the server.
- **Dev store paragraph:** `profileSource`. **Release gate:** it printed 19 lines before this step and prints 17 after (the two `TEMP(17)` comment lines left `journalRepository.ts`); update the number and the date.
- **Log entry** "Step 17 — Supabase and Clerk (date)": decisions (copy the numbered list above, shortened), packages with the installed version, what was added and changed, the measured values (7.0 s and 4 attempts without `retry: false`, 0.0 s with it; the sign-in to Journal time you measured), what was verified and what was not, the open items, and the markers.
- Then `cp AGENTS.md prompts/AGENTS.md` and `cmp` them. Update the memory notes if you learned something the next prompt needs.

---

## 11. Verify

### Part A: always (no Supabase project needed)

1. `npm run lint` and `npm run typecheck` exit 0 (read the whole output; no piping to `tail`). `npx expo install --check` is up to date and `npx expo-doctor` is 21/21. `npx expo export` for Android, then for iOS (one platform at a time, `NODE_OPTIONS=--max-old-space-size=3072`, output folder outside the repo): both exit 0 (for the search, export Android once more with `--no-bytecode --no-minify` and look for `X-Client-Info`, which proves `supabase-js` is in the bundle).
2. The typing proof from section 3 (four `@ts-expect-error` lines), then delete the proof file.
3. Checks in Node (a scratch folder outside the repo: transpile the TypeScript with the repo's `typescript`, map `@/`, fake `fetch`): `checkSupabaseEnv` (ok, missing, `/rest/v1`, `http`, a secret key in both formats, an anon JWT, junk, and that no message repeats the key); `toFailureCode` for status 0 (offline, `NoSessionError`), 401, 403, `PGRST303`, `42501`, 500, 429; `readJwtPayload` with junk and an array payload; the onboarding store migration from version 1 (default times, a changed time unsynced, a changed time already synced, garbage); `profilePrefsStore` repair of damaged JSON and a `__proto__` user id; `decideReminderSync` over its four cases; `syncProfile` for a new account, an existing account on a new phone, an unsent edit, a failed push, an edit made while the push is away, a user change mid-request, two calls at once, the debounce (one run 800 ms after the last edit) and the foreground gap; the client against a fake PostgREST: no session sends nothing, a null token fails in under 0.5 s with no request, create-then-find sends exactly `GET, POST, GET` with only `id` and the three times in the body and the Clerk token (not the key) as the bearer, offline is `NETWORK` in under 0.5 s with one attempt, HTTP 401, 403 and 500 map right, and `supabase.auth` throws.
4. With `.env.local` lacking the Supabase values (or the dev switch on `mock`): the app starts without a red screen, the dev panel says "No Supabase address in .env.local, so the profile uses the mock", and the step 15 and 16 flows behave as before: a reminder change on Profile moves Journal's affirmation slot, the Mock plan buttons change the plan card, the ambient and affirmations switches save, the purchase mock still works.
5. `grep -rnE "service_role|SERVICE_ROLE|sb_secret_" src App.tsx .env.example` finds only the guard in `src/constants/env.ts`; `grep -rn "supabase\.auth" src App.tsx` finds only the explanatory comment in `supabaseClient.ts`; `grep -rn "template:" src` finds nothing; `grep -rnE "TEMP\(|TODO: real" src` prints 17 lines (was 19).
6. The two files `supabase/schema.sql` and `supabase/selftest.sql` are unchanged (`git diff`), and no `ios/`, `android/` or migration folder appeared.

### Part B: after A to E (Expo Go on the emulator; Supabase adds no native module, so the iPhone in Expo Go works too and is the user's check)

Sign in with a Clerk test address (the development instance accepts any `+clerk_test` address with the code `424242`): `gracehush17a+clerk_test@example.com`. Follow AGENTS.md "Verifying on this machine" for Metro, the emulator and the traps (the Clerk toast, Back at the tab root, a size change resetting the dev store).

1. **Supabase check (dev)** on Profile, bottom: keys yes, profile source supabase, signed in yes, Clerk token has role = authenticated, profile row found, rows this user can see 1, last error none. (The user opens the Table Editor and confirms **one** `users_profile` row: `id` is the Clerk id `user_…`, `subscription_tier` is `free`, the reminder times are the ones from onboarding.)
2. Sign out and in again: the same check, still one row, the tier and times unchanged.
3. Change a reminder in Profile, wait 2 seconds: the user sees the new time in the Table Editor. Force-stop Expo Go and reopen: the time is kept, still one row.
4. In the Table Editor change `reminder_morning`. Come back to the app after 30 seconds (or force-stop and reopen): Profile's Daily Reminders summary and the Journal's affirmation slot follow the server's time.
5. Airplane mode (`adb shell cmd connectivity airplane-mode enable`): open the app, Journal and Profile load at once with no multi-second skeleton; change a reminder, no error appears anywhere; turn airplane mode off and bring the app to the foreground: the row updates in the Table Editor and the edit is no longer unsent. (Measure and report how long Profile took to appear offline.)
6. A second account (`gracehush17b+clerk_test@example.com`): its own row (the times on the phone are its starting point), the Table Editor now shows two rows, and the check on each account says **rows this user can see: 1**. The ambient sound set on account A is Off on account B and is still set when A signs back in.
7. Signed out (before the first sign-in, or after Sign out): the check says `signed in: no` and stops there; nothing was sent.
8. Dev store `profileSource` on `mock`: the step 15 and 16 scenarios work; back on `supabase` the real profile returns. Buying the mock trial changes the plan card and writes nothing to Supabase (the tier in the Table Editor stays `free`).
9. Logs: `adb logcat -d -s ReactNativeJS:V` and Metro's output hold no token, Clerk id, email or row from this step, only `[supabase] users_profile: <code>` lines if something failed.
10. The user's iPhone (Expo Go, after `npx expo start -c`): items 1, 3 and 5 (airplane mode from Control Center), and a look at Journal, Reflection and Profile: nothing should look different from before this step.

### Troubleshooting (for the user and for the implementer)

| What you see | Cause | Fix |
| --- | --- | --- |
| The app stops at launch with "EXPO_PUBLIC_SUPABASE_… is missing / must be / holds a secret key" | a wrong or missing value in `.env.local` | fix it, then `npx expo start -c` |
| Check: "Clerk token: NO role claim" | the Clerk integration is not active on this instance (step C) | do C, then sign out and in again |
| "profile row: error UNAUTHORIZED", last error `users_profile: PGRST301` or `HTTP 401` | Supabase does not trust the token: step D missing, or the domain pasted differs from the one in your key | redo D with the exact domain |
| last error `users_profile: 42501` | `schema.sql` was not run, or only part of it | run `schema.sql` and `selftest.sql` again |
| error `NETWORK` | offline, a typo in the URL, or a paused Free project | check the address; Dashboard, **Restore project** |
| "rows this user can see" is 2 or more | row level security is off or wrong | stop; run `selftest.sql` and paste the table in the chat |
| Profile shows its error card on the very first launch after sign-in | the first sync has not finished and there is no network | connect, then Try again; later launches work offline |

---

## 12. Report

Auth decision (approved in the review, nothing changed); the package and installed version; files created, changed and deleted (none deleted); the `Supabase check` output on screen at each step of part B (without ids); the measured offline Profile time and the sign-in to Journal time; what the user confirmed in the Table Editor; the onboarding store migration; which settings are still device-only and where (`profilePrefsStore`); the markers left for steps 18, 19, 28 and 30; and these mismatches in later prompts (reported, not edited):

- **18** expects `supabase/schema.sql` to document `journal_entries`, `daily_affirmations`, the `journal_media` bucket and a draft `process-entry`, but this step's `schema.sql` holds only `users_profile` and `requesting_user_id()`: step 18 must create the other base tables itself (or ask for them). `requesting_user_id()` already has the body 18 section 3 wants, the three `users_profile` policies are named `users_profile_select_own`, `users_profile_insert_own` and `users_profile_update_own`, and the column grants already exist (18 extends the insert and update lists with `timezone`, `affirmations_enabled`, `ambient_sound` and `ambient_volume`, and never grants the tier). 18's "one-time move in profileSync" reads `useProfilePrefsStore.getState().byUser[userId].prefs`, and deleting the store also removes the offline copy of the sign-up date and plan: step 18 or 24 must keep one.
- **23, 25 and 33** read `src/lib/supabase.ts` and `src/lib/supabaseErrors.ts` (25 also creates `src/lib/edgeFunctions.ts`; AGENTS.md says `src/api/`). The files are `src/services/supabaseClient.ts` (`getSupabase()` returns `null` while signed out, so their code handles `null` instead of using a `supabase` constant) and `src/utils/supabaseErrors.ts` (`toFailureCode`, `NoSessionError`).
- **24, 30 and 33** add their lines in `SupabaseAuthBridge` (the sign-in effect); **30** line 304 removes "the step 17 in-memory tier override": none exists, the mock tier lives in the mock database; **31** inherits `forgetUser` in `deleteAccount`; **34** reads `src/constants/env.ts` (read each variable by its full name); **35**'s EAS environment must list `EXPO_PUBLIC_SUPABASE_URL` and `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
