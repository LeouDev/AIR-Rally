-- Phase 6, Part 6: court-owner referral tracking foundation. Additive
-- only. Deliberately minimal per the brief ("only build tracking
-- foundation," "do NOT add rewards yet") — this records who invited
-- whom and how far they got, nothing more. A referral row can never
-- grant role/owner_status/venue permissions by itself (see Part 7 of
-- the plan) — the real approval gate remains
-- approveOwnerApplicationAction, which requireAdmin()-gates a completely
-- separate write path.

-- Every user gets a stable, shareable referral code — same
-- generate-unconditionally-on-insert idiom as
-- generate_booking_confirmation_code() (20260810000004_bookings.sql).
alter table public.profiles add column referral_code text unique;

create or replace function public.generate_profile_referral_code()
returns trigger
language plpgsql
as $$
begin
  new.referral_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
  return new;
end;
$$;

create trigger profiles_generate_referral_code
before insert on public.profiles
for each row execute function public.generate_profile_referral_code();

-- One-time backfill for every profile row that predates this migration
-- (the trigger above only fires on INSERT).
update public.profiles
set referral_code = upper(left(replace(gen_random_uuid()::text, '-', ''), 8))
where referral_code is null;

alter table public.profiles alter column referral_code set not null;

-- One row per referral event. `status` progression: 'started' (the
-- referred person requested owner access with this code attached) ->
-- 'completed' (they submitted their owner_applications row) ->
-- 'approved' (an admin approved that application). 'sent' is reserved
-- for a future phase that tracks anonymous, pre-signup link visits —
-- never written by this phase's code, kept in the CHECK constraint so a
-- later addition doesn't need another migration just to widen it.
create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referral_code text not null,
  referrer_user_id uuid not null references public.profiles (id) on delete cascade,
  referred_user_id uuid references public.profiles (id) on delete set null,
  converted_owner_id uuid references public.profiles (id) on delete set null,
  status text not null default 'started' check (status in ('sent', 'started', 'completed', 'approved')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index referrals_referrer_user_id_idx on public.referrals (referrer_user_id);
create index referrals_referred_user_id_idx on public.referrals (referred_user_id);

create trigger referrals_set_updated_at
before update on public.referrals
for each row execute function public.set_updated_at();

alter table public.referrals enable row level security;

create policy "Referrers can view their own referrals, admins see all"
on public.referrals for select
using (referrer_user_id = auth.uid() or public.is_admin());

-- The referred user (not the referrer) creates the row — it's recorded
-- the moment THEY request owner access with a code attached, resolved
-- server-side from the code to a referrer_user_id (never trusted
-- directly from the client). Pinned to the true starting state, same
-- posture as owner_applications' own insert policy.
create policy "Users can record their own referral event"
on public.referrals for insert
with check (referred_user_id = auth.uid() and status = 'started');

create policy "Users can update their own referral, admins see all"
on public.referrals for update
using (referred_user_id = auth.uid() or public.is_admin())
with check (referred_user_id = auth.uid() or public.is_admin());

-- Same defense-in-depth shape as prevent_reschedule_tampering(): every
-- identity column is immutable for a non-admin, and the one self-service
-- transition allowed is 'started' -> 'completed' (submitting the
-- application). Reaching 'approved' is exclusively an admin action.
create or replace function public.prevent_referral_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  new.referral_code := old.referral_code;
  new.referrer_user_id := old.referrer_user_id;
  new.referred_user_id := old.referred_user_id;
  new.converted_owner_id := old.converted_owner_id;

  if not (old.status = 'started' and new.status = 'completed') then
    new.status := old.status;
  end if;

  return new;
end;
$$;

create trigger referrals_prevent_tampering
before update on public.referrals
for each row execute function public.prevent_referral_tampering();
