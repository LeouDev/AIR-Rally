-- AIR/Rally Credits: internal booking credits used to compensate
-- cancellations without running cash refunds through PayMongo during the
-- QR Ph launch.
--
-- Credits are NOT money. They cannot be withdrawn, transferred between
-- users, purchased, or redeemed outside AIR/Rally. Nothing in this
-- migration creates a path to any of those.
--
-- DESIGN — the ledger is the single source of truth.
--
-- The brief asked for "create a transaction row and update the balance
-- atomically, rolling back if either fails". supabase-js cannot run a
-- multi-statement transaction from application code, so that guarantee
-- can't be made there. Instead `credit_transactions` is the authority and
-- `user_credit_wallets.balance` is derived from it by a trigger that
-- recomputes from source on every ledger change — the same convention
-- posts.like_count / clubs.member_count / events.participant_count
-- already use. The balance therefore *cannot* disagree with the ledger:
-- there is no second write to get out of step.

create table public.user_credit_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references public.profiles (id) on delete cascade,
  -- Never written by application code. Maintained by
  -- recompute_credit_balance() below, and guarded against direct writes
  -- by prevent_credit_balance_tampering().
  balance integer not null default 0 check (balance >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger user_credit_wallets_set_updated_at
before update on public.user_credit_wallets
for each row execute function public.set_updated_at();

-- Immutable ledger. Positive amounts add credit, negative amounts spend
-- it. There is deliberately no UPDATE or DELETE policy for any client
-- role, and no application code path that issues either — a correction is
-- a new compensating row, never an edit, so history stays auditable.
create table public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  amount integer not null check (amount <> 0),
  transaction_type text not null check (
    transaction_type in ('cancellation_compensation', 'admin_adjustment', 'promotion_bonus', 'booking_payment')
  ),
  /** Booking id for booking_payment / cancellation_compensation; null otherwise. */
  reference_id uuid,
  description text,
  created_at timestamptz not null default now()
);

create index credit_transactions_user_created_idx on public.credit_transactions (user_id, created_at desc);
create index credit_transactions_reference_idx on public.credit_transactions (reference_id);

-- === Balance derivation ==================================================

create or replace function public.recompute_credit_balance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_user_id uuid := coalesce(new.user_id, old.user_id);
begin
  perform set_config('air_rally.bypass_credit_balance_guard', 'true', true);

  insert into public.user_credit_wallets (user_id, balance)
  values (
    target_user_id,
    (select coalesce(sum(amount), 0) from public.credit_transactions where user_id = target_user_id)
  )
  on conflict (user_id) do update
    set balance = (select coalesce(sum(amount), 0) from public.credit_transactions where user_id = target_user_id);

  perform set_config('air_rally.bypass_credit_balance_guard', 'false', true);
  return coalesce(new, old);
end;
$$;

create trigger credit_transactions_recompute_balance
after insert or update or delete on public.credit_transactions
for each row execute function public.recompute_credit_balance();

-- Balance is derived, never set. Mirrors prevent_event_count_tampering()
-- in 20260810000030 — the trigger honours a transaction-local bypass that
-- only recompute_credit_balance() sets.
create or replace function public.prevent_credit_balance_tampering()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('air_rally.bypass_credit_balance_guard', true), 'false') = 'true' then
    return new;
  end if;

  if new.balance is distinct from old.balance then
    new.balance := old.balance;
  end if;

  return new;
end;
$$;

create trigger user_credit_wallets_prevent_tampering
before update on public.user_credit_wallets
for each row execute function public.prevent_credit_balance_tampering();

-- === RLS =================================================================

alter table public.user_credit_wallets enable row level security;
alter table public.credit_transactions enable row level security;

create policy "Users read their own wallet"
on public.user_credit_wallets for select
using (user_id = auth.uid() or public.is_admin());

create policy "Users read their own credit history"
on public.credit_transactions for select
using (user_id = auth.uid() or public.is_admin());

-- No INSERT / UPDATE / DELETE policy exists on either table for any
-- client role. Every balance movement goes through the two
-- service_role-only functions below, so a compromised browser session
-- cannot mint, spend, or rewrite credit under any circumstances —
-- including an admin session, which has no more direct table access here
-- than a player does.

-- === Privileged movement functions =======================================

-- Adds credit. service_role-only (see the REVOKE/GRANT below), so it is
-- reachable exclusively from a server action that has already authorised
-- the caller — the same posture complete_reschedule() uses.
create or replace function public.issue_credit(
  p_user_id uuid,
  p_amount integer,
  p_transaction_type text,
  p_reference_id uuid default null,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'Credit amount must be positive.' using errcode = 'check_violation';
  end if;

  insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description)
  values (p_user_id, p_amount, p_transaction_type, p_reference_id, p_description);

  select balance into v_balance from public.user_credit_wallets where user_id = p_user_id;
  return v_balance;
end;
$$;

-- Spends credit. The `for update` lock is load-bearing: without
-- serialising per wallet, two concurrent checkouts can both read the same
-- sufficient balance and both be admitted, overdrawing the wallet.
create or replace function public.spend_credit(
  p_user_id uuid,
  p_amount integer,
  p_reference_id uuid,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'Spend amount must be positive.' using errcode = 'check_violation';
  end if;

  select balance into v_balance
  from public.user_credit_wallets
  where user_id = p_user_id
  for update;

  if v_balance is null or v_balance < p_amount then
    raise exception 'Insufficient AIR/Rally Credits.' using errcode = 'check_violation';
  end if;

  insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description)
  values (p_user_id, -p_amount, 'booking_payment', p_reference_id, p_description);

  select balance into v_balance from public.user_credit_wallets where user_id = p_user_id;
  return v_balance;
end;
$$;

revoke all on function public.issue_credit(uuid, integer, text, uuid, text) from public, anon, authenticated;
revoke all on function public.spend_credit(uuid, integer, uuid, text) from public, anon, authenticated;
grant execute on function public.issue_credit(uuid, integer, text, uuid, text) to service_role;
grant execute on function public.spend_credit(uuid, integer, uuid, text) to service_role;

-- === Booking integration =================================================

-- 'air_rally_credit' marks a booking paid entirely from the wallet, where
-- no PayMongo session is created at all.
alter table public.bookings drop constraint bookings_payment_provider_check;
alter table public.bookings add constraint bookings_payment_provider_check
  check (payment_provider in ('stripe', 'paymongo', 'air_rally_credit'));

-- How much wallet credit was applied to this booking. Kept on the booking
-- so the amount to return on cancellation is a fact, not a re-derivation
-- from ledger rows that a later correction could disturb.
alter table public.bookings
  add column credit_amount_applied integer not null default 0 check (credit_amount_applied >= 0);

-- Returns applied credit when a booking is cancelled, whatever cancels it
-- — the customer, an admin, or a future scheduled expiry of an abandoned
-- pending booking. Credits therefore can't be stranded by a checkout the
-- user simply walked away from, without needing new infrastructure.
--
-- Idempotent via the reference_id/type guard: a booking that has already
-- been compensated is never compensated twice.
create or replace function public.restore_credit_on_booking_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled'
     and old.status is distinct from 'cancelled'
     and new.credit_amount_applied > 0
     and not exists (
       select 1 from public.credit_transactions
       where reference_id = new.id and transaction_type = 'cancellation_compensation'
     ) then
    insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description)
    values (
      new.user_id,
      new.credit_amount_applied,
      'cancellation_compensation',
      new.id,
      'Credits returned for cancelled booking #' || new.confirmation_code
    );
  end if;

  return new;
end;
$$;

create trigger bookings_restore_credit_on_cancel
after update on public.bookings
for each row execute function public.restore_credit_on_booking_cancel();

-- === Notification ========================================================

-- Only for credit being ADDED. A deduction is something the user just did
-- deliberately at checkout, so telling them about it is noise.
create or replace function public.notify_on_credit_issued()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.amount > 0 then
    insert into public.notifications (user_id, type, title, message)
    values (
      new.user_id,
      'credits_added',
      'AIR/Rally Credits Added',
      '₱' || to_char(new.amount / 100.0, 'FM999999990.00') || ' in credits have been added to your account.'
    );
  end if;

  return new;
end;
$$;

create trigger credit_transactions_notify
after insert on public.credit_transactions
for each row execute function public.notify_on_credit_issued();
