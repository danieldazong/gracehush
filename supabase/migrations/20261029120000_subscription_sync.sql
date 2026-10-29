-- Gracehush: what the server keeps about a person's subscription, besides the plan itself (step 30).
--
-- RevenueCat is the source of truth for a person's plan. The server re-reads the RevenueCat customer and writes the plan on
-- the profile (subscription_tier, step 17) with two more facts: when the pro entitlement ends, so that process-entry can check
-- a paid plan whose end date has passed before it lets a fourth devotional of the week through, and when the server last read
-- RevenueCat, so that the app's sync-subscription calls a few seconds apart cost one read. Only the Edge Functions write them
-- (syncSubscription in _shared/billing/revenuecat.ts, as service_role).
--
-- No grant changes. The app reads its own row through the table-wide SELECT of the baseline, so it can read both columns; its
-- INSERT and UPDATE grants name their columns (step 18) and do not include these, so it can write neither. service_role keeps
-- its table-wide grants, which cover columns added later.
--
-- It is safe to run again, and it deletes no data.
alter table public.users_profile
  add column if not exists subscription_expires_at timestamptz,
  add column if not exists subscription_synced_at timestamptz;

comment on column public.users_profile.subscription_expires_at is
  'When the pro entitlement ends, grace period included (null: no end, or never synced). Written by the server only.';
comment on column public.users_profile.subscription_synced_at is
  'When the server last read this person''s RevenueCat customer. Written by the server only.';

notify pgrst, 'reload schema';
