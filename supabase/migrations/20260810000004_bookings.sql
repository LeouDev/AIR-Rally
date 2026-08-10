-- Phase 4A: the bookings table itself, and the ONE non-negotiable
-- guarantee of this phase — two active bookings can never overlap on the
-- same court. Additive only; no existing table/column/policy is touched.

-- Needed so a GiST index can combine plain equality (court_id, a uuid)
-- with the range-overlap operator (&&) in a single exclusion constraint —
-- GiST natively supports range types, but combining it with equality on a
-- non-range column requires the operator classes btree_gist adds.
create extension if not exists btree_gist;

-- Status meanings:
--   pending   — reserved but not yet confirmed. Nothing in Phase 4A
--               produces this status (there is no payment step yet to
--               gate on), but it's included now because Phase 4B's
--               checkout flow needs it on day one, and adding an enum
--               value to a table with real rows later is a bigger deal
--               than including it now at zero cost.
--   confirmed — the actual, real reservation. What Phase 4A's
--               createBooking() actually creates, since nothing blocks
--               confirmation yet.
--   cancelled — released; does NOT hold the court's schedule (see the
--               exclusion constraint's `where` clause below).
-- Deliberately NOT included: `completed` (needs a scheduled job marking
-- past bookings done — no cron infrastructure exists yet) and `expired`
-- (implies a payment-hold TTL — no checkout flow exists yet). Both are
-- real, anticipated additions for a later phase, not omissions.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  court_id uuid not null references public.courts (id),
  user_id uuid not null references public.profiles (id),
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'cancelled')),
  -- Price snapshot at creation time (see lib/services/bookings.ts) — a
  -- later change to courts.hourly_price must never retroactively change
  -- an existing booking's price. Integer minor units (centavos), never a
  -- float, for the same reason money is never represented as a float
  -- anywhere real: floating-point rounding is not acceptable for currency
  -- math.
  price_amount integer not null check (price_amount >= 0),
  currency text not null default 'PHP' check (char_length(currency) = 3),
  -- Human-friendly reference, distinct from the primary key — cheap to
  -- add now (a BEFORE INSERT trigger below generates it unconditionally),
  -- expensive to retrofit onto a table with real rows once a
  -- confirmation screen/email needs one in Phase 4B.
  confirmation_code text not null unique,
  cancelled_at timestamptz,
  cancelled_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_time > start_time)
);

-- Supports: the availability functions' per-court/per-day-window lookup,
-- and general per-court booking listing. (The exclusion constraint's own
-- GiST index below also accelerates overlap-shaped queries, but doesn't
-- serve a plain "give me bookings for this court after this timestamp"
-- prefix scan as well as a btree index does.)
create index bookings_court_start_idx on public.bookings (court_id, start_time);
-- Supports "my bookings" reads.
create index bookings_user_id_idx on public.bookings (user_id);

create trigger bookings_set_updated_at
before update on public.bookings
for each row execute function public.set_updated_at();

-- THE guarantee this entire phase exists to make: Postgres itself refuses
-- to let two active (pending/confirmed) bookings on the same court have
-- overlapping time ranges. This holds unconditionally, regardless of what
-- application code does or gets wrong — it is not an optimization, it is
-- the actual integrity boundary (see ARCHITECTURE.md's Phase 4A section
-- for the full worked-example proof of the range semantics below).
--
-- `'[)'` = half-open range: [start, end). A booking ending at 8:00 and one
-- starting at 8:00 do NOT overlap under this definition — adjacent
-- bookings are allowed, exactly matching real-world scheduling ("the
-- 7-8am slot" and "the 8-9am slot" are back-to-back, not conflicting).
--
-- The `where` clause makes this a *partial* exclusion constraint: a
-- cancelled booking's range is excluded from the check entirely, so
-- cancelling a booking genuinely frees the slot for a new one — this is
-- enforced by the constraint itself, not by application code remembering
-- to filter cancelled rows out of some other check.
alter table public.bookings
  add constraint bookings_no_overlap
  exclude using gist (
    court_id with =,
    tstzrange(start_time, end_time, '[)') with &&
  )
  where (status in ('pending', 'confirmed'));

-- Generates the confirmation code server-side, unconditionally — a client
-- can never choose or guess it, and this also means "the client forgot to
-- set it" is not a real failure mode to defend against.
create or replace function public.generate_booking_confirmation_code()
returns trigger
language plpgsql
as $$
begin
  new.confirmation_code := upper(left(replace(gen_random_uuid()::text, '-', ''), 8));
  return new;
end;
$$;

create trigger bookings_generate_confirmation_code
before insert on public.bookings
for each row execute function public.generate_booking_confirmation_code();

-- Same shape as profiles_prevent_role_change / venues_prevent_status_escalation
-- (see supabase/migrations/20260809000001_profiles.sql and
-- 20260809000002_venues.sql): a BEFORE UPDATE trigger, not a WITH CHECK
-- clause, because the goal is "block specific field changes" not "block
-- the whole update" — a WITH CHECK here would also block a legitimate
-- self-service cancellation from going through at all.
--
-- Non-admins: identity/financial fields (court_id, user_id, price_amount,
-- currency, start_time, end_time) silently revert to their prior value no
-- matter what's sent. The only status transition a non-admin can make is
-- pending|confirmed -> cancelled — and when that happens, cancelled_at/
-- cancelled_by are computed here (now() / auth.uid()), never trusted from
-- whatever the client sent, so there's no field left for a client to
-- tamper with even on the one transition that's actually allowed.
create or replace function public.prevent_booking_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  if new.court_id is distinct from old.court_id then
    new.court_id := old.court_id;
  end if;
  if new.user_id is distinct from old.user_id then
    new.user_id := old.user_id;
  end if;
  if new.price_amount is distinct from old.price_amount then
    new.price_amount := old.price_amount;
  end if;
  if new.currency is distinct from old.currency then
    new.currency := old.currency;
  end if;
  if new.start_time is distinct from old.start_time then
    new.start_time := old.start_time;
  end if;
  if new.end_time is distinct from old.end_time then
    new.end_time := old.end_time;
  end if;

  if new.status is distinct from old.status then
    if old.status in ('pending', 'confirmed') and new.status = 'cancelled' then
      new.cancelled_at := now();
      new.cancelled_by := auth.uid();
    else
      new.status := old.status;
      new.cancelled_at := old.cancelled_at;
      new.cancelled_by := old.cancelled_by;
    end if;
  end if;

  return new;
end;
$$;

create trigger bookings_prevent_tampering
before update on public.bookings
for each row execute function public.prevent_booking_tampering();

alter table public.bookings enable row level security;

create policy "Users can view their own bookings"
on public.bookings for select
using (
  auth.uid() = user_id
  or public.is_admin()
  or exists (
    select 1 from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = bookings.court_id and v.owner_id = auth.uid()
  )
);

create policy "Users can create bookings for themselves"
on public.bookings for insert
with check (auth.uid() = user_id);

-- No delete policy — a booking is only ever cancelled (a status
-- transition), never removed, same posture as every other table in this
-- schema (venues/courts are soft-stated via `status`, not hard-deleted
-- once they matter). Field-level tampering on update is blocked by the
-- bookings_prevent_tampering trigger above, not by this policy — the
-- policy's job is only "who may attempt an update at all."
create policy "Users can update their own bookings"
on public.bookings for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());
