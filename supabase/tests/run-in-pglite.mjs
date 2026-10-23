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

async function freshDatabase(model) {
  const db = new PGlite();
  await db.exec(STUB);
  if (model.setup) await db.exec(model.setup);
  return db;
}

async function applyMigrations(db, { v1Transform = (sql) => sql, twice = false } = {}) {
  for (const name of migrations) {
    const sql = name === V1 ? v1Transform(read(`migrations/${name}`)) : read(`migrations/${name}`);
    await db.exec(sql);
    if (twice) await db.exec(sql);
  }
}

async function runSqlFile(db, file) {
  const results = await db.exec(read(file));
  return results[results.length - 1].rows;
}

function printRows(rows) {
  for (const row of rows) console.log(`  ${String(row.position).padStart(2)} ${row.passed ? "PASS" : "FAIL"}  ${row.check_name}`);
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
      const failed = rows.filter((row) => !row.passed);
      console.log(`${label}, run ${run}: ${rows.length - failed.length} of ${rows.length} passed`);
      if (failed.length > 0) printRows(failed);
      failures += failed.length;
    }
  }

  const left = await db.query(
    `select (select count(*) from public.users_profile)::int as profiles,
            (select count(*) from public.journal_entries)::int as entries,
            (select count(*) from public.daily_affirmations)::int as affirmations,
            (select count(*) from storage.objects)::int as objects`,
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
    ["no crisis trigger on affirmations", "off", dropLine(/create trigger daily_affirmations_no_crisis[\s\S]*?execute function public\.reject_affirmation_for_crisis_entry\(\);/), [31]],
    ["storage insert policy lets anyone upload anywhere", "off", (sql) => sql.replace(/with check \(\s*bucket_id = 'journal_media'\s*and \(storage\.foldername\(name\)\)\[1\] = \(select public\.requesting_user_id\(\)\)\s*and \(storage\.foldername\(name\)\)\[2\] = 'raw'\s*and array_length\(storage\.foldername\(name\), 1\) = 2\s*\)/, "with check (true)"), [38, 39]],
    ["a delete policy for the app on storage (masked by the hosted guard)", "off", (sql) => sql + "\ncreate policy journal_media_delete_own on storage.objects for delete to authenticated using (bucket_id = 'journal_media' and (storage.foldername(name))[1] = (select public.requesting_user_id()));", [41]],
    ["the app may insert entries", "off", (sql) => sql + "\ngrant insert on public.journal_entries to authenticated;\ncreate policy journal_entries_insert_any on public.journal_entries for insert to authenticated with check (true);", [13]],
    ["the bucket is public", "off", (sql) => sql.replace("values ('journal_media', 'journal_media', false,", "values ('journal_media', 'journal_media', true,").replace("      public = false,", "      public = true,"), [36]],
    ["no unique (entry_id, time_slot)", "off", dropLine(/constraint daily_affirmations_entry_slot_key unique \(entry_id, time_slot\),/), [29]],
    ["no composite owner key on affirmations", "off", (sql) => sql.replace(/constraint daily_affirmations_entry_user_fkey foreign key \(entry_id, user_id\)\s*references public\.journal_entries \(id, user_id\) on delete cascade/, "constraint daily_affirmations_entry_fkey foreign key (entry_id) references public.journal_entries (id) on delete cascade"), [28]],
    ["the app may change the plan again", "off", (sql) => sql + "\ngrant update (subscription_tier) on public.users_profile to authenticated;", [3, 35]],
    ["no rule that an answered prayer has its date", "off", (sql) => sql.replace("answered_fields_match check (is_answered = (answered_at is not null))", "answered_fields_match check (true)"), [43]],
    ["no limit on the gratitude note", "off", (sql) => sql.replace("answered_note_length check (answered_notes is null or char_length(answered_notes) <= 1000)", "answered_note_length check (true)"), [43]],
    ["a crisis entry may be a prayer", "off", (sql) => sql.replace(/constraint crisis_not_prayer\s+check \(not is_crisis or \([\s\S]*?prayer_summary is null\)\)/, "constraint crisis_not_prayer check (true)"), [44]],
    ["verified scripture without its text", "off", (sql) => sql.replace("check (not scripture_verified or (scripture_reference is not null and scripture_text is not null))", "check (true)"), [45]],
    ["ON: the new tables keep anon's default grants", "on", dropLine("revoke all on public.users_profile, public.journal_entries, public.daily_affirmations from anon;"), [33]],
    // An insert stays refused by row level security (no insert policy), so check 13 still passes: the grants are the
    // first lock and the policies the second, and the checks insist on both.
    ["ON: the new tables keep authenticated's default grants", "on", dropLine("revoke all on public.journal_entries, public.daily_affirmations from authenticated;"), [15, 17, 25, 27]],
  ];
  console.log("\n===== broken variants (every one must be caught) =====");
  for (const [label, modelId, transform, expected] of variants) {
    const model = MODELS.find((item) => item.id === modelId);
    const original = read(`migrations/${V1}`);
    if (transform(original) === original) {
      console.log(`  ${label.padEnd(66)} RUNNER BUG: the variant changed nothing`);
      failures += 1;
      continue;
    }
    const db = await freshDatabase(model);
    let outcome;
    try {
      await applyMigrations(db, { v1Transform: transform });
      const rows = await runSqlFile(db, "tests/rls_selftest.sql");
      const failed = rows.filter((row) => !row.passed).map((row) => row.position);
      const caught = expected.every((position) => failed.includes(position));
      outcome = `${caught ? "CAUGHT" : "MISSED"}  failing: [${failed.join(", ")}], expected at least [${expected.join(", ")}]`;
      if (!caught) failures += 1;
    } catch (error) {
      outcome = `CAUGHT  (the SQL itself raised: ${String(error.message).split("\n")[0].slice(0, 90)})`;
    }
    console.log(`  ${label.padEnd(66)} ${outcome}`);
    await db.close();
  }
}

console.log(failures === 0 ? "\nALL GOOD" : `\n${failures} PROBLEM(S)`);
process.exit(failures === 0 ? 0 : 1);
