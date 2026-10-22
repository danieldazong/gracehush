-- Gracehush base schema self-test (step 17). Run it AFTER supabase/schema.sql, in the same SQL editor.
-- It pretends to be three signed-in users and one signed-out visitor, tries things that must work and things that
-- must be refused, and leaves nothing behind. Every row of the result must say passed = true.
-- It is safe to run again, also when the table already holds real accounts: it touches only ids that start
-- with "selftest_", and all the checks look at a single user's view of the table.

drop table if exists pg_temp.selftest_results;
create temp table selftest_results (position integer, check_name text, passed boolean);

do $$
declare
  n integer;
  refused boolean;
  claims_a constant text := '{"sub":"selftest_a","role":"authenticated"}';
  claims_b constant text := '{"sub":"selftest_b","role":"authenticated"}';
  claims_c constant text := '{"sub":"selftest_c","role":"authenticated"}';
begin
  -- user A creates their own profile, the way the app does: only the id and the reminder times.
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);
  insert into public.users_profile (id, reminder_morning, reminder_afternoon, reminder_evening)
    values ('selftest_a', '07:30', '12:00', '21:00');
  get diagnostics n = row_count;
  reset role;
  insert into selftest_results values (1, 'a user can create their own profile', n = 1);

  -- the same insert again changes nothing and raises no error (the app relies on this)
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);
  insert into public.users_profile (id) values ('selftest_a') on conflict (id) do nothing;
  get diagnostics n = row_count;
  reset role;
  insert into selftest_results values (2, 'creating the same profile twice is harmless', n = 0);

  -- user A reads it back, and the server filled the tier and the dates
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);
  select count(*) into n from public.users_profile where subscription_tier = 'free' and created_at is not null;
  reset role;
  insert into selftest_results values (3, 'a user reads their own profile, tier free', n = 1);

  -- user A cannot create a profile for someone else (42501 is "permission denied" and "row-level security")
  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', claims_a, true);
    insert into public.users_profile (id) values ('selftest_b');
  exception when others then
    refused := (sqlstate = '42501');
  end;
  reset role;
  insert into selftest_results values (4, 'a user cannot create a profile for another user', refused);

  -- user C cannot choose their own tier when creating a profile
  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', claims_c, true);
    insert into public.users_profile (id, subscription_tier) values ('selftest_c', 'pro');
  exception when others then
    refused := (sqlstate = '42501');
  end;
  reset role;
  insert into selftest_results values (5, 'a user cannot set subscription_tier on insert', refused);

  -- user A cannot upgrade themselves
  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', claims_a, true);
    update public.users_profile set subscription_tier = 'pro' where id = 'selftest_a';
  exception when others then
    refused := (sqlstate = '42501');
  end;
  reset role;
  insert into selftest_results values (6, 'a user cannot change subscription_tier', refused);

  -- user A can change their reminder times
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_a, true);
  update public.users_profile set reminder_morning = '06:45' where id = 'selftest_a';
  get diagnostics n = row_count;
  reset role;
  insert into selftest_results values (7, 'a user can change their reminder times', n = 1);

  -- user B sees nothing of user A, and cannot change it
  set local role authenticated;
  perform set_config('request.jwt.claims', claims_b, true);
  select count(*) into n from public.users_profile;
  reset role;
  insert into selftest_results values (8, 'another user sees no rows', n = 0);

  set local role authenticated;
  perform set_config('request.jwt.claims', claims_b, true);
  update public.users_profile set reminder_morning = '05:00' where id = 'selftest_a';
  get diagnostics n = row_count;
  reset role;
  insert into selftest_results values (9, 'another user cannot change the row', n = 0);

  -- nobody can delete a profile from the app
  refused := false;
  begin
    set local role authenticated;
    perform set_config('request.jwt.claims', claims_a, true);
    delete from public.users_profile where id = 'selftest_a';
  exception when others then
    refused := (sqlstate = '42501');
  end;
  reset role;
  insert into selftest_results values (10, 'a user cannot delete a profile', refused);

  -- a signed-out visitor is refused outright
  refused := false;
  begin
    set local role anon;
    perform count(*) from public.users_profile;
  exception when others then
    refused := (sqlstate = '42501');
  end;
  reset role;
  insert into selftest_results values (11, 'a signed-out visitor cannot read the table', refused);

  -- leave nothing behind
  delete from public.users_profile where id like 'selftest\_%';
end $$;

select position, check_name, passed from selftest_results order by position;
