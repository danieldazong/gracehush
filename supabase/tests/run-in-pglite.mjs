// Runs the Gracehush migrations and self-tests offline in PGlite, a real Postgres engine compiled to WebAssembly: no
// Docker, no network and no Supabase project. It is how the SQL was proven before it was applied to the hosted project.
//
// It stands in for what a Supabase project already has: the three API roles, auth.jwt(), and the storage schema with
// its guard against SQL deletes. It runs the whole suite twice, for both settings of the dashboard option
// "Automatically expose new tables": OFF (a table nobody granted is invisible: this project) and ON (every new table is
// granted to the API roles at creation: the older default). The migrations must end in the same safe state in both.
//
// PGlite is not a dependency of the app. Install it in a scratch folder OUTSIDE the repo, then point PGLITE at it:
//   npm install @electric-sql/pglite@0.5.11            (run in the scratch folder)
//   PGLITE=<scratch>/node_modules/@electric-sql/pglite/dist/index.js node supabase/tests/run-in-pglite.mjs
//   add --negative to also run deliberately broken variants and prove that the tests catch them.
//
// Exit code 0 only when every check passes (and, with --negative, when every broken variant is caught).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const entry = process.env.PGLITE;
if (!entry) {
  console.error("Set PGLITE to the path of @electric-sql/pglite/dist/index.js (see the comment at the top of this file).");
  process.exit(2);
}
const { PGlite } = await import(pathToFileURL(path.resolve(entry)).href);

const supabaseDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => fs.readFileSync(path.join(supabaseDir, relative), "utf8");

const migrations = fs
  .readdirSync(path.join(supabaseDir, "migrations"))
  .filter((name) => name.endsWith(".sql"))
  .sort();
const V1 = migrations.find((name) => name.includes("gracehush_v1_schema"));
const BASELINE = migrations.find((name) => name.includes("baseline"));
const WAV = migrations.find((name) => name.includes("journal_media_accepts_wav"));
const DELETED = migrations.find((name) => name.includes("deleted_devotionals"));
const SUBSCRIPTION = migrations.find((name) => name.includes("subscription_sync"));
const EXPORTS = migrations.find((name) => name.includes("exports_bucket"));
const REALTIME = migrations.find((name) => name.includes("realtime_broadcast"));
const VALIDATION = migrations.find((name) => name.includes("validation_line"));
const HEAVY = migrations.find((name) => name.includes("heavy_moments"));
const VERSES = migrations.find((name) => name.includes("affirmation_verses"));

// The baseline migration is supabase/schema.sql under a short header: if one changes, the other must change with it.
const lf = (text) => text.replace(/\r\n/g, "\n");
if (!lf(read(`migrations/${BASELINE}`)).endsWith(lf(read("schema.sql")))) {
  console.error(`migrations/${BASELINE} is no longer a copy of supabase/schema.sql`);
  process.exit(1);
}

// What a Supabase project has before our SQL runs.
const STUB = `
  create role anon nologin;
  create role authenticated nologin;
  create role service_role nologin bypassrls;

  create schema auth;
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claim', true), ''),
      nullif(current_setting('request.jwt.claims', true), '')
    )::jsonb
  $$;
  grant usage on schema public, auth to anon, authenticated, service_role;
  grant execute on function auth.jwt() to anon, authenticated, service_role;

  create schema storage;
  create table storage.buckets (
    id text primary key, name text not null, public boolean default false,
    file_size_limit bigint, allowed_mime_types text[], created_at timestamptz default now());
  create table storage.objects (
    id uuid primary key default gen_random_uuid(), bucket_id text references storage.buckets (id),
    name text, owner_id text, created_at timestamptz default now(), metadata jsonb);
  alter table storage.objects enable row level security;
  create function storage.foldername(name text) returns text[] language plpgsql as $$
  declare _parts text[];
  begin
    select string_to_array(name, '/') into _parts;
    return _parts[1:array_length(_parts, 1) - 1];
  end
  $$;
  -- The guard a hosted project puts on storage tables: a SQL delete is refused, whatever the policies say.
  create function storage.protect_delete() returns trigger language plpgsql as $$
  begin
    raise exception 'Direct deletion from storage tables is not allowed. Use the Storage API instead.';
  end
  $$;
  create trigger protect_objects_delete before delete on storage.objects
    for each statement execute function storage.protect_delete();
  grant usage on schema storage to anon, authenticated, service_role;
  grant all on all tables in schema storage to anon, authenticated, service_role;

  -- Realtime (step 33): realtime.messages, realtime.topic() and realtime.send() as Supabase defines them (github.com/supabase/realtime,
  -- lib/realtime/tenants/repo/migrations, read 2026-10-31), with the same grants on the table. send adds an id to a payload that has
  -- none, sets realtime.topic, writes a broadcast row and turns any error into a warning. Two differences for the tests: the table
  -- is not partitioned by day (so a message can always be written), and while test.realtime_send_fails is on, send raises instead,
  -- so that a trigger's own net can be proven.
  create schema realtime;
  create table realtime.messages (
    id uuid not null default gen_random_uuid(),
    topic text not null,
    extension text not null,
    event text,
    payload jsonb,
    private boolean default false,
    inserted_at timestamp not null default timezone('utc', clock_timestamp()),
    updated_at timestamp not null default timezone('utc', clock_timestamp()),
    primary key (id, inserted_at));
  alter table realtime.messages enable row level security;
  create function realtime.topic() returns text language sql stable as $$
    select nullif(current_setting('realtime.topic', true), '')::text
  $$;
  create function realtime.send(payload jsonb, event text, topic text, private boolean default true) returns void
  language plpgsql as $$
  declare
    generated_id uuid := gen_random_uuid();
  begin
    if current_setting('test.realtime_send_fails', true) = 'on' then
      raise exception 'realtime.send fails on purpose (test)' using errcode = '55000';
    end if;
    begin
      perform set_config('realtime.topic', topic, true);
      insert into realtime.messages (id, payload, event, topic, private, extension)
      values (generated_id,
              case when payload ? 'id' then payload else jsonb_set(payload, '{id}', to_jsonb(generated_id)) end,
              event, topic, private, 'broadcast');
    exception when others then
      raise warning 'WarnSendingBroadcastMessage: %', sqlerrm;
    end;
  end
  $$;
  grant usage on schema realtime to anon, authenticated, service_role;
  grant select, insert, update on realtime.messages to anon, authenticated, service_role;
`;

// A hosted project on a day no client has connected to Realtime yet: there is no message table for the day, so writing a message
// fails as a missing partition does (23514).
const NO_MESSAGE_TABLE_TODAY = `
  create function realtime.no_table_today() returns trigger language plpgsql as $$
  begin
    raise exception 'no partition of relation "messages" found for row' using errcode = '23514';
  end
  $$;
  create trigger no_table_today before insert on realtime.messages
    for each row execute function realtime.no_table_today();
`;

// "Automatically expose new tables" ON: every table, function and sequence made later is granted to the API roles.
const EXPOSE_NEW_OBJECTS = `
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
`;

const MODELS = [
  { id: "off", label: 'Automatically expose new tables: OFF (this project)', setup: "" },
  { id: "on", label: 'Automatically expose new tables: ON (the older default)', setup: EXPOSE_NEW_OBJECTS },
];

// `extraStub` changes what the project has before our SQL runs (a broken variant of the project, not of a migration).
async function freshDatabase(model, extraStub = "") {
  const db = new PGlite();
  await db.exec(STUB);
  if (extraStub) await db.exec(extraStub);
  if (model.setup) await db.exec(model.setup);
  return db;
}

// `transforms` maps a migration's file name to a function that changes its SQL (the broken variants below).
async function applyMigrations(db, { transforms = {}, twice = false } = {}) {
  for (const name of migrations) {
    const transform = transforms[name];
    const sql = transform ? transform(read(`migrations/${name}`)) : read(`migrations/${name}`);
    await db.exec(sql);
    if (twice) await db.exec(sql);
  }
}

async function runSqlFile(db, file) {
  const results = await db.exec(read(file));
  return results[results.length - 1].rows;
}

// A check says passed = null when it could not run (step 33: no message table today). Offline that never happens, so it counts as
// a problem here like a failure.
function printRows(rows) {
  for (const row of rows) {
    const verdict = row.passed === true ? "PASS" : row.passed === null ? "SKIP" : "FAIL";
    console.log(`  ${String(row.position).padStart(2)} ${verdict}  ${row.check_name}`);
  }
}

let failures = 0;

// ---- 1. the real thing: each migration twice, then both self-tests twice each, for both settings of the option
for (const model of MODELS) {
  console.log(`\n===== ${model.label} =====`);
  const db = await freshDatabase(model);
  await applyMigrations(db, { twice: true });
  console.log(`migrations applied twice without an error: ${migrations.join(", ")}`);

  for (const [label, file] of [
    ["step 17 selftest.sql (users_profile)", "selftest.sql"],
    ["step 18 tests/rls_selftest.sql", "tests/rls_selftest.sql"],
  ]) {
    for (let run = 1; run <= 2; run++) {
      const rows = await runSqlFile(db, file);
      const failed = rows.filter((row) => row.passed !== true);
      console.log(`${label}, run ${run}: ${rows.length - failed.length} of ${rows.length} passed`);
      if (failed.length > 0) printRows(failed);
      failures += failed.length;
    }
  }

  const left = await db.query(
    `select (select count(*) from public.users_profile)::int as profiles,
            (select count(*) from public.journal_entries)::int as entries,
            (select count(*) from public.daily_affirmations)::int as affirmations,
            (select count(*) from public.deleted_devotionals)::int as deleted_devotionals,
            (select count(*) from storage.objects)::int as objects,
            (select count(*) from realtime.messages)::int as messages`,
  );
  console.log("rows left behind by the tests:", JSON.stringify(left.rows[0]));
  if (Object.values(left.rows[0]).some((count) => count !== 0)) failures += 1;

  if (model.id === "off") {
    // The preflight is read-only and must run on a migrated database as well as on a bare one.
    const preflight = await db.exec(read("tests/preflight.sql"));
    console.log(`tests/preflight.sql ran on the migrated database: ${preflight[preflight.length - 1].rows.length} rows`);

    const grants = await db.query(`
      select table_name, grantee, privilege_type,
             (select string_agg(c.column_name, ', ' order by c.column_name)
                from information_schema.column_privileges c
               where c.table_schema = 'public' and c.table_name = g.table_name and c.grantee = g.grantee
                 and c.privilege_type = g.privilege_type) as columns
        from (select distinct table_name, grantee, privilege_type from information_schema.column_privileges
               where table_schema = 'public' and grantee in ('anon', 'authenticated', 'service_role')) g
       order by table_name, grantee, privilege_type`);
    console.log("what each API role may do (SELECT, INSERT and UPDATE are listed per column; DELETE is proven by check 34):");
    for (const row of grants.rows) {
      const columns = row.columns.split(", ");
      console.log(`  ${row.table_name.padEnd(20)} ${row.grantee.padEnd(14)} ${row.privilege_type.padEnd(11)} ${columns.length > 8 ? "(all columns)" : columns.join(", ")}`);
    }
  }
  await db.close();
}

// ---- 2. a bare database: the preflight must work before anything is applied (no tables, no bucket)
{
  const db = await freshDatabase(MODELS[0]);
  const preflight = await db.exec(read("tests/preflight.sql"));
  console.log(`\ntests/preflight.sql ran on a bare database: ${preflight[preflight.length - 1].rows.length} rows`);
  await db.close();
}

// ---- 3. deliberately broken variants: each must make the checks it should fail
if (process.argv.includes("--negative")) {
  const dropLine = (text) => (sql) => sql.replace(text, "");
  const variants = [
    ["no service_role grants", "off", dropLine(/grant select, insert, update, delete\s+on public\.users_profile, public\.journal_entries, public\.daily_affirmations to service_role;/), [34, 35]],
    ["table-wide UPDATE for authenticated on journal_entries", "off", (sql) => sql + "\ngrant update on public.journal_entries to authenticated;", [15]],
    ["row level security off on daily_affirmations", "off", (sql) => sql + "\nalter table public.daily_affirmations disable row level security;", [23, 26]],
    ["storage insert policy lets anyone upload anywhere", "off", (sql) => sql.replace(/with check \(\s*bucket_id = 'journal_media'\s*and \(storage\.foldername\(name\)\)\[1\] = \(select public\.requesting_user_id\(\)\)\s*and \(storage\.foldername\(name\)\)\[2\] = 'raw'\s*and array_length\(storage\.foldername\(name\), 1\) = 2\s*\)/, "with check (true)"), [38, 39]],
    ["a delete policy for the app on storage (masked by the hosted guard)", "off", (sql) => sql + "\ncreate policy journal_media_delete_own on storage.objects for delete to authenticated using (bucket_id = 'journal_media' and (storage.foldername(name))[1] = (select public.requesting_user_id()));", [41]],
    ["the app may insert entries", "off", (sql) => sql + "\ngrant insert on public.journal_entries to authenticated;\ncreate policy journal_entries_insert_any on public.journal_entries for insert to authenticated with check (true);", [13]],
    ["the bucket is public", "off", (sql) => sql.replace("values ('journal_media', 'journal_media', false,", "values ('journal_media', 'journal_media', true,").replace("      public = false,", "      public = true,"), [36]],
    ["no unique (entry_id, time_slot)", "off", dropLine(/constraint daily_affirmations_entry_slot_key unique \(entry_id, time_slot\),/), [29]],
    ["no composite owner key on affirmations", "off", (sql) => sql.replace(/constraint daily_affirmations_entry_user_fkey foreign key \(entry_id, user_id\)\s*references public\.journal_entries \(id, user_id\) on delete cascade/, "constraint daily_affirmations_entry_fkey foreign key (entry_id) references public.journal_entries (id) on delete cascade"), [28]],
    ["the app may change the plan again", "off", (sql) => sql + "\ngrant update (subscription_tier) on public.users_profile to authenticated;", [3, 35]],
    ["no rule that an answered prayer has its date", "off", (sql) => sql.replace("answered_fields_match check (is_answered = (answered_at is not null))", "answered_fields_match check (true)"), [43]],
    ["no limit on the gratitude note", "off", (sql) => sql.replace("answered_note_length check (answered_notes is null or char_length(answered_notes) <= 1000)", "answered_note_length check (true)"), [43]],
    ["verified scripture without its text", "off", (sql) => sql.replace("check (not scripture_verified or (scripture_reference is not null and scripture_text is not null))", "check (true)"), [45]],
    ["the bucket does not take WAV (the migration adds another type instead)", "off", (sql) => sql.replaceAll("'audio/wav'", "'audio/flac'"), [46], WAV],
    ["ON: the new tables keep anon's default grants", "on", dropLine("revoke all on public.users_profile, public.journal_entries, public.daily_affirmations from anon;"), [33]],
    // An insert stays refused by row level security (no insert policy), so check 13 still passes: the grants are the
    // first lock and the policies the second, and the checks insist on both.
    ["ON: the new tables keep authenticated's default grants", "on", dropLine("revoke all on public.journal_entries, public.daily_affirmations from authenticated;"), [15, 17, 25, 27]],
    // The record of deleted devotionals (step 29b, its own migration).
    ["the app may read the record (grant and policy)", "off", (sql) => sql + "\ngrant select on public.deleted_devotionals to authenticated;\ncreate policy deleted_devotionals_read_all on public.deleted_devotionals for select to authenticated using (true);", [47, 50], DELETED],
    ["ON: the record keeps the API roles' default grants", "on", dropLine("revoke all on public.deleted_devotionals from anon, authenticated;"), [47], DELETED],
    ["row level security off on the record", "off", (sql) => sql.replace("enable row level security", "disable row level security"), [50], DELETED],
    ["no primary key on the record's entry_id", "off", (sql) => sql.replace("uuid        primary key,", "uuid        not null,"), [48], DELETED],
    ["the record is tied to the reflection (it would vanish with it)", "off", (sql) => sql + "\nalter table public.deleted_devotionals add constraint deleted_devotionals_entry_fkey foreign key (entry_id) references public.journal_entries (id) on delete cascade;", [48, 49], DELETED],
    ["the record does not follow the account", "off", (sql) => sql.replace("references public.users_profile (id) on delete cascade", "references public.users_profile (id)"), [49], DELETED],
    // The subscription columns (step 30, their own migration). A column-level REVOKE is ignored while a table-wide GRANT
    // exists, so the server's grant is taken away table-wide (checks 34 and 35 fail with it).
    ["the app may write when its plan ends", "off", (sql) => sql + "\ngrant update (subscription_expires_at) on public.users_profile to authenticated;", [51], SUBSCRIPTION],
    ["the app may write when its plan was last checked", "off", (sql) => sql + "\ngrant update (subscription_synced_at) on public.users_profile to authenticated;", [52], SUBSCRIPTION],
    ["the server may not write the plan's columns", "off", (sql) => sql + "\nrevoke update on public.users_profile from service_role;", [53], SUBSCRIPTION],
    // The exports bucket (step 31, its own migration): only the server reads and writes it, and people get signed links.
    ["the exports bucket is public", "off", (sql) => sql.replace("values ('exports', 'exports', false,", "values ('exports', 'exports', true,").replace("      public = false,", "      public = true,"), [54], EXPORTS],
    ["the app may read and list the exports bucket", "off", (sql) => sql + "\ncreate policy exports_select_own on storage.objects for select to authenticated using (bucket_id = 'exports' and (storage.foldername(name))[1] = (select public.requesting_user_id()));", [55], EXPORTS],
    ["the app may upload into the exports bucket", "off", (sql) => sql + "\ncreate policy exports_insert_own on storage.objects for insert to authenticated with check (bucket_id = 'exports' and (storage.foldername(name))[1] = (select public.requesting_user_id()));", [55], EXPORTS],
    ["visitors may read the exports bucket", "off", (sql) => sql + "\ncreate policy exports_select_anyone on storage.objects for select to anon using (bucket_id = 'exports');", [56], EXPORTS],
    // Realtime messages and the run of reflection days (step 33, its own migration).
    ["the entry trigger without its own net for a failed send", "off", (sql) => sql.replace(/ {2}begin\s+(perform realtime\.send\(\s+payload => jsonb_build_object\(\s+'id', r\.id[\s\S]*?private => true\);)\s+exception when others then\s+--[^\n]*\n\s+raise warning 'broadcast_entry_change: not sent';\s+end;/, "  $1"), [59], REALTIME],
    ["a broadcast function runs as the caller", "off", (sql) => sql.replace("security definer", "security invoker"), [58], REALTIME],
    ["a broadcast function without its empty search path", "off", (sql) => sql.replace(/(function public\.broadcast_affirmations_change\(\)\s+returns trigger\s+language plpgsql\s+security definer\s+)set search_path = ''\s+/, "$1"), [58], REALTIME],
    ["the app may call a broadcast function", "off", (sql) => sql + "\ngrant execute on function public.broadcast_entry_change() to authenticated;", [58], REALTIME],
    ["the entry message carries the transcript", "off", (sql) => sql.replace("'updated_at', r.updated_at)", "'updated_at', r.updated_at, 'transcript', r.transcript)"), [60], REALTIME],
    ["the entry message goes to a shared topic", "off", (sql) => sql.replace("topic => 'user:' || r.user_id,", "topic => 'entries',"), [60], REALTIME],
    ["the entry message is public", "off", (sql) => sql.replace(/(event => 'entry_changed',\s+topic => 'user:' \|\| r\.user_id,\s+)private => true/, "$1private => false"), [60], REALTIME],
    ["the affirmations message carries the headline", "off", (sql) => sql.replace("jsonb_build_object('id', new.id, 'entry_id', new.entry_id)", "jsonb_build_object('id', new.id, 'entry_id', new.entry_id, 'headline', new.headline)"), [61], REALTIME],
    ["anyone signed in may join any topic", "off", (sql) => sql.replace(/using \(\s+\(select realtime\.topic\(\)\) = 'user:' \|\| \(select public\.requesting_user_id\(\)\)\s+and realtime\.messages\.extension = 'broadcast'\s+\);/, "using (true);"), [62], REALTIME],
    ["the app may send on its own topic", "off", (sql) => sql + "\ncreate policy user_broadcast_insert_own on realtime.messages for insert to authenticated with check ((select realtime.topic()) = 'user:' || (select public.requesting_user_id()));", [63], REALTIME],
    ["the entry trigger misses deletes", "off", (sql) => sql.replace("after insert or update or delete on public.journal_entries", "after insert or update on public.journal_entries"), [57, 60], REALTIME],
    // The validation line (step 36, its own migration).
    ["a validation line of any length", "off", dropLine(/alter table public\.journal_entries add constraint validation_line_length\s+check \(validation_line is null or char_length\(validation_line\) <= 240\);/), [65], VALIDATION],
    ["the app may write the validation line", "off", (sql) => sql + "\ngrant update (validation_line) on public.journal_entries to authenticated;", [66], VALIDATION],
    // Heavy moments (2026-11-08, their own migration): each rule that kept a crisis entry empty, left in place, and the run of
    // reflection days, which this migration defines last (so the variants of step 33's function are made here).
    ["the crisis check stays (a heavy moment cannot hold its reflection)", "off", dropLine("alter table public.journal_entries drop constraint if exists journal_entries_crisis_check;"), [21, 67], HEAVY],
    ["a heavy moment is never a prayer (crisis_not_prayer stays)", "off", dropLine("alter table public.journal_entries drop constraint if exists crisis_not_prayer;"), [44, 67], HEAVY],
    ["a heavy moment has no first line (validation_line_crisis stays)", "off", dropLine("alter table public.journal_entries drop constraint if exists validation_line_crisis;"), [65, 67], HEAVY],
    ["a heavy moment gets no affirmations (the old trigger stays)", "off", (sql) => sql.replace("drop trigger if exists daily_affirmations_no_crisis on public.daily_affirmations;", "").replace("drop function if exists public.reject_affirmation_for_crisis_entry();", ""), [31, 67], HEAVY],
    ["the run skips heavy moments", "off", (sql) => sql.replace("and e.devotional_script is not null", "and not e.is_crisis"), [64], HEAVY],
    ["the run counts entries with no devotional", "off", (sql) => sql.replace(/\s+and e\.devotional_script is not null/, ""), [64], HEAVY],
    ["the run counts every day with a reflection", "off", (sql) => sql.replace("(select count(*)::int from ranked where local_day = start_day - (n - 1))", "(select count(*)::int from days)"), [64], HEAVY],
    ["visitors may ask for the run of reflection days", "off", (sql) => sql + "\ngrant execute on function public.reflection_streak_days(text) to anon;", [64], HEAVY],
    // Affirmation verses (step 37, its own migration).
    ["a verse with no reference, or a reference with no words", "off", dropLine(/alter table public\.daily_affirmations add constraint affirmation_verse_pair\s+check \(\(verse_reference is null\) = \(verse_text is null\)\);/), [68], VERSES],
    ["a verse of any length", "off", (sql) => sql.replace("char_length(verse_text) between 1 and 200", "true").replace("char_length(verse_reference) between 1 and 60", "true"), [68], VERSES],
    ["the app may write an affirmation's verse", "off", (sql) => sql + "\ngrant update (verse_reference, verse_text) on public.daily_affirmations to authenticated;", [69], VERSES],
    // Not a broken migration: the hosted project before the day's first Realtime connection. Nothing may fail, the checks that need
    // a message table say skipped, and a change is still saved (59).
    ["no message table today (nobody has connected yet)", "off", null, { skipped: [60, 61, 62], passed: [59, 63, 64] }, REALTIME, { stub: NO_MESSAGE_TABLE_TODAY }],
  ];
  console.log("\n===== broken variants (every one must be caught) =====");
  for (const [label, modelId, transform, expected, file = V1, options = {}] of variants) {
    const model = MODELS.find((item) => item.id === modelId);
    const original = read(`migrations/${file}`);
    if (transform !== null && transform(original) === original) {
      console.log(`  ${label.padEnd(66)} RUNNER BUG: the variant changed nothing`);
      failures += 1;
      continue;
    }
    const db = await freshDatabase(model, options.stub);
    let outcome;
    try {
      await applyMigrations(db, { transforms: transform === null ? {} : { [file]: transform } });
      const rows = await runSqlFile(db, "tests/rls_selftest.sql");
      const failed = rows.filter((row) => row.passed === false).map((row) => row.position);
      const skipped = rows.filter((row) => row.passed === null).map((row) => row.position);
      const skippedText = skipped.length > 0 ? `, skipped: [${skipped.join(", ")}]` : "";
      if (Array.isArray(expected)) {
        const caught = expected.every((position) => failed.includes(position));
        outcome = `${caught ? "CAUGHT" : "MISSED"}  failing: [${failed.join(", ")}]${skippedText}, expected at least [${expected.join(", ")}]`;
        if (!caught) failures += 1;
      } else {
        const passed = rows.filter((row) => row.passed === true).map((row) => row.position);
        const right =
          failed.length === 0 &&
          skipped.join() === expected.skipped.join() &&
          expected.passed.every((position) => passed.includes(position));
        outcome = `${right ? "AS EXPECTED" : "WRONG"}  failing: [${failed.join(", ")}]${skippedText}, expected none failing and [${expected.skipped.join(", ")}] skipped`;
        if (!right) failures += 1;
      }
    } catch (error) {
      outcome = `CAUGHT  (the SQL itself raised: ${String(error.message).split("\n")[0].slice(0, 90)})`;
    }
    console.log(`  ${label.padEnd(66)} ${outcome}`);
    await db.close();
  }
}

console.log(failures === 0 ? "\nALL GOOD" : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
