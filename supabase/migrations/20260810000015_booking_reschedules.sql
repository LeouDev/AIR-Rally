-- V1 booking rescheduling. Additive only: no existing table/column/
-- function/policy is altered or dropped. Deliberately NOT a generic
-- ledger — this is one audit table connecting exactly two bookings, the
-- same "duplication over a shared risky abstraction" posture already
-- used throughout this schema (booking_refunds, the Stripe/PayMongo
-- column pairs, etc.).
--
-- V1 business rules this schema enforces (see the design report):
--   - a booking may be rescheduled at most once (enforced in application
--     eligibility logic against `bookings.status`, not here — a
--     completed reschedule cancels the original, and `status='confirmed'`
--     is already a precondition every reschedule attempt re-checks)
--   - a replacement booking may not itself be rescheduled (enforced in
--     application logic via `exists(... where new_booking_id = :id)`)
--   - only one IN-FLIGHT reschedule per original booking at a time (the
--     actual new guarantee this migration adds — see the partial unique
--     index below)
--   - gross-only refunds only (refund_basis is always 'gross_only' for a
--     V1 price-decrease reschedule — enforced in application code, not
--     re-litigated at the schema level)
--
-- Revised after the V1 production-readiness audit to close three
-- database-level gaps the first draft left open (see findings B1/B2/B3):
--   - complete_reschedule()/mark_reschedule_failed()/
--     record_reschedule_refund_success() are now service_role-only (not
--     anon/authenticated) — see the long comment just above
--     complete_reschedule()'s definition for exactly why a client-side
--     ownership check alone can't substitute for restricting WHO can
--     call these functions.
--   - the INSERT policy now pins new rows to `status='pending_payment',
--     refund_id is null` — a plain client insert can no longer fabricate
--     a row that already claims to be completed/failed or already
--     carries a refund_id.
--   - `pending_refund` (declared in the CHECK constraint from the start,
--     previously never actually written) is now a real, durable
--     checkpoint set by record_reschedule_refund_success() the moment a
--     decrease reschedule's refund succeeds — see that function's own
--     comment for why this exists.
--   - a new AFTER UPDATE trigger on `bookings`
--     (reconcile_reschedule_on_booking_cancel) auto-fails any
--     'pending_payment' reschedule whose original or replacement booking
--     gets cancelled through ANY path, so nothing can permanently orphan
--     the one-in-flight-reschedule unique index below.

create table public.booking_reschedules (
  id uuid primary key default gen_random_uuid(),
  original_booking_id uuid not null references public.bookings (id),
  new_booking_id uuid not null references public.bookings (id),
  -- Signed: new_booking.price_amount - original_booking.price_amount.
  -- Positive = price increase (a new payment is owed), negative = price
  -- decrease (a gross-only refund is owed), zero = no financial step.
  price_difference integer not null,
  status text not null default 'pending_payment' check (status in ('pending_payment', 'pending_refund', 'completed', 'failed', 'provider_unavailable')),
  -- Set only once a refund has actually been attempted for a
  -- price-decrease reschedule (never guessed, never set before
  -- lib/services/refunds.ts's requestRefund() actually runs) — lets the
  -- admin UI join straight to the real booking_refunds row instead of
  -- trying to infer which refund belongs to which reschedule.
  refund_id uuid references public.booking_refunds (id),
  initiated_by uuid not null references auth.users (id),
  reason text,
  failure_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_reschedules_original_booking_id_idx on public.booking_reschedules (original_booking_id);
create index booking_reschedules_new_booking_id_idx on public.booking_reschedules (new_booking_id);

-- The real, DB-enforced guarantee behind "two simultaneous reschedule
-- requests for the same booking cannot both succeed" — mirrors
-- booking_refunds_one_pending_per_booking exactly (see
-- 20260810000014_paymongo_refund_accounting_scaffolding.sql). Does NOT
-- prevent a *second, later* reschedule attempt after a prior one
-- resolved to 'failed' (a real, intended retry path — see rule 13 in the
-- design report) — only restricts concurrently-in-flight attempts.
create unique index booking_reschedules_one_pending_per_original
  on public.booking_reschedules (original_booking_id)
  where status in ('pending_payment', 'pending_refund');

create trigger booking_reschedules_set_updated_at
before update on public.booking_reschedules
for each row execute function public.set_updated_at();

-- Same defense-in-depth posture as prevent_refund_tampering(): the
-- identity fields of a reschedule record are immutable once created:
-- only status/failure_reason/refund_id may ever change, and only through
-- the bypass (set by the trusted RPC functions below), never a plain
-- client update.
create or replace function public.prevent_reschedule_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  new.original_booking_id := old.original_booking_id;
  new.new_booking_id := old.new_booking_id;
  new.price_difference := old.price_difference;
  new.initiated_by := old.initiated_by;
  new.reason := old.reason;

  if coalesce(current_setting('air_rally.bypass_reschedule_tampering', true), 'false') <> 'true' then
    new.status := old.status;
    new.failure_reason := old.failure_reason;
    new.refund_id := old.refund_id;
  end if;

  return new;
end;
$$;

create trigger booking_reschedules_prevent_tampering
before update on public.booking_reschedules
for each row execute function public.prevent_reschedule_tampering();

alter table public.booking_reschedules enable row level security;

-- Admins see everything; a customer sees a reschedule if they initiated
-- it or if either linked booking is theirs — same "self or admin" shape
-- every other table in this schema already uses.
create policy "Users can view their own reschedules, admins see all"
on public.booking_reschedules for select
using (
  public.is_admin()
  or initiated_by = auth.uid()
  or exists (select 1 from public.bookings b where b.id = booking_reschedules.original_booking_id and b.user_id = auth.uid())
  or exists (select 1 from public.bookings b where b.id = booking_reschedules.new_booking_id and b.user_id = auth.uid())
);

-- Unlike booking_refunds (admin-only insert, since refunds are
-- admin-initiated), a reschedule is CUSTOMER-initiated — the initial row
-- is a plain, ordinary self-service insert under RLS, exactly like
-- createBooking()'s own "Users can create bookings for themselves"
-- policy. `with check` re-verifies server-side that the caller actually
-- owns the original booking, never trusting a client-supplied
-- original_booking_id blindly.
--
-- `status = 'pending_payment' and refund_id is null` closes a real gap
-- found during the production-readiness audit: without this, nothing
-- stopped a client from INSERTing a row with status='completed' (or any
-- other value) directly, or attaching an arbitrary refund_id at create
-- time — a misleading, fabricated audit row. The only legitimate way to
-- create a reschedule is at its true starting state; every later
-- transition goes through complete_reschedule()/mark_reschedule_failed()/
-- record_reschedule_refund_success() below, none of which are reachable
-- by a plain client insert/update.
create policy "Users can create reschedules for their own bookings"
on public.booking_reschedules for insert
with check (
  initiated_by = auth.uid()
  and status = 'pending_payment'
  and refund_id is null
  and exists (select 1 from public.bookings b where b.id = original_booking_id and b.user_id = auth.uid())
);

-- No client update/delete policy for any role — every status transition
-- goes through complete_reschedule()/mark_reschedule_failed()/
-- record_reschedule_refund_success() below, all SECURITY DEFINER.
--
-- SECURITY MODEL (see the production-readiness audit's finding B1):
-- unlike confirm_booking_payment(), which is safe to leave callable by
-- anon/authenticated because its WHERE clause requires the caller to
-- already know a real, provider-generated checkout session id tied to
-- THAT SPECIFIC booking, complete_reschedule() has no equivalent value
-- to check — a customer legitimately already knows their own
-- reschedule_id (it's returned to them by the very action that creates
-- it), so an ownership check alone (initiated_by = auth.uid()) would
-- NOT stop that same customer from calling complete_reschedule()
-- directly and activating an unpaid increase, or a decrease whose refund
-- never actually ran. There is no client-suppliable value that proves a
-- real payment/refund succeeded — only the application code that
-- verifies a signed webhook payload or makes a live, secret-key-
-- authenticated provider API call can know that. So the trust boundary
-- has to be WHICH CODE calls these functions, not what parameters it
-- passes. All three functions below are therefore granted ONLY to
-- service_role (see lib/supabase/serviceRole.ts) and called exclusively
-- from lib/services/reschedules.ts's own trusted helpers — never
-- reachable with a customer's own anon-key session, directly or through
-- any Server Action.

-- The one function that atomically finalizes a reschedule once its
-- financial step has actually succeeded (a webhook-confirmed difference
-- payment for an increase, a checkpointed succeeded refund for a
-- decrease — see record_reschedule_refund_success() below — or
-- immediately for a zero-difference reschedule). Idempotent by
-- construction, same mechanism as confirm_booking_payment(): the WHERE
-- clauses only match rows still in a pending state, so a duplicate call
-- (e.g. both the webhook and the confirmation-page fallback firing, or a
-- retried completion after a prior call threw) is a safe no-op.
create or replace function public.complete_reschedule(
  p_reschedule_id uuid,
  p_refund_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reschedule record;
begin
  select * into v_reschedule
  from public.booking_reschedules
  where id = p_reschedule_id and status in ('pending_payment', 'pending_refund');

  if not found then
    return false;
  end if;

  -- Defense in depth: even restricted to service_role, a supplied
  -- refund_id must still correspond to a REAL, succeeded refund for the
  -- correct original booking before it's ever attached — the database
  -- enforces this itself rather than trusting the caller's parameter,
  -- per the audit's explicit requirement.
  if p_refund_id is not null then
    if not exists (
      select 1 from public.booking_refunds
      where id = p_refund_id
        and booking_id = v_reschedule.original_booking_id
        and status = 'succeeded'
    ) then
      raise exception 'complete_reschedule: refund % is not a succeeded refund for booking %', p_refund_id, v_reschedule.original_booking_id;
    end if;
  end if;

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  -- Only ever transitions a still-pending replacement booking — this is
  -- the ONLY thing that ever confirms a reschedule's replacement, for all
  -- three price cases. A price increase deliberately does NOT go through
  -- confirm_booking_payment()/confirm_paymongo_booking_payment(): those
  -- check price_amount = the charged amount, but the customer is only
  -- ever charged the DIFFERENCE, never the replacement's full price, so
  -- that check could never pass. See lib/services/reschedules.ts's
  -- maybeCompleteReschedule()/maybeCompleteRescheduleFromProvider().
  update public.bookings
  set status = 'confirmed', paid_at = coalesce(paid_at, now())
  where id = v_reschedule.new_booking_id and status = 'pending';

  -- Cancels the original exactly like a normal self-cancellation would
  -- (same trigger branch, same cancelled_at semantics) — attributed to
  -- whoever actually initiated the reschedule, not the system. A no-op
  -- (0 rows) if the original was already independently cancelled by the
  -- customer through some other action in the meantime — safe either
  -- way, never leaves two active bookings.
  update public.bookings
  set status = 'cancelled', cancelled_at = now(), cancelled_by = v_reschedule.initiated_by
  where id = v_reschedule.original_booking_id and status = 'confirmed';

  update public.booking_reschedules
  set status = 'completed',
      refund_id = coalesce(p_refund_id, refund_id)
  where id = p_reschedule_id and status in ('pending_payment', 'pending_refund');

  return true;
end;
$$;

revoke all on function public.complete_reschedule(uuid, uuid) from public, anon, authenticated;
grant execute on function public.complete_reschedule(uuid, uuid) to service_role;

-- The failure counterpart — marks a reschedule attempt resolved without
-- ever touching either booking (the original was never modified in the
-- first place under this design; the pending replacement, if any, is
-- released by the caller through the existing cancelBooking() path, the
-- same plain self-service transition every abandoned pending booking
-- already uses — no bypass needed for that part).
--
-- Deliberately restricted to `status = 'pending_payment'` only — NOT
-- 'pending_refund'. Once a reschedule reaches 'pending_refund' (see
-- record_reschedule_refund_success() below), a real refund has already
-- succeeded; the only safe forward path from there is completing the
-- reschedule (possibly via a retry), never declaring it "failed" and
-- abandoning a refund that already happened. See the audit's finding B3.
create or replace function public.mark_reschedule_failed(
  p_reschedule_id uuid,
  p_status text,
  p_failure_reason text,
  p_refund_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reschedule record;
begin
  if p_status not in ('failed', 'provider_unavailable') then
    raise exception 'mark_reschedule_failed: invalid status %', p_status;
  end if;

  select * into v_reschedule
  from public.booking_reschedules
  where id = p_reschedule_id and status = 'pending_payment';

  if not found then
    return false;
  end if;

  if p_refund_id is not null then
    if not exists (
      select 1 from public.booking_refunds
      where id = p_refund_id
        and booking_id = v_reschedule.original_booking_id
        and status in ('provider_unavailable', 'failed')
    ) then
      raise exception 'mark_reschedule_failed: refund % is not a failed/provider_unavailable refund for booking %', p_refund_id, v_reschedule.original_booking_id;
    end if;
  end if;

  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  update public.booking_reschedules
  set status = p_status,
      failure_reason = p_failure_reason,
      refund_id = coalesce(p_refund_id, refund_id)
  where id = p_reschedule_id and status = 'pending_payment';

  return true;
end;
$$;

revoke all on function public.mark_reschedule_failed(uuid, text, text, uuid) from public, anon, authenticated;
grant execute on function public.mark_reschedule_failed(uuid, text, text, uuid) to service_role;

-- The durable checkpoint for a decrease reschedule's refund (see the
-- audit's finding B3). A price-decrease reschedule's refund executes
-- synchronously inside createReschedule() — without this checkpoint, if
-- the subsequent complete_reschedule() call itself throws (a transient
-- DB/network failure, not a "the refund failed" outcome), there would be
-- no durable record that the refund already succeeded, making a safe
-- retry impossible to distinguish from "should we refund again?". This
-- function records exactly that fact, and ONLY that fact — it never
-- touches either booking. `status = 'pending_refund'` afterward signals
-- "a real refund has succeeded; only completion (possibly retried)
-- remains" — never re-attempted by requestRefund() again, since nothing
-- in this application ever re-calls it once refund_id is durably
-- attached here.
create or replace function public.record_reschedule_refund_success(
  p_reschedule_id uuid,
  p_refund_id uuid
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_reschedule record;
begin
  select * into v_reschedule
  from public.booking_reschedules
  where id = p_reschedule_id and status = 'pending_payment';

  if not found then
    return false;
  end if;

  if not exists (
    select 1 from public.booking_refunds
    where id = p_refund_id
      and booking_id = v_reschedule.original_booking_id
      and status = 'succeeded'
  ) then
    raise exception 'record_reschedule_refund_success: refund % is not a succeeded refund for booking %', p_refund_id, v_reschedule.original_booking_id;
  end if;

  perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

  update public.booking_reschedules
  set status = 'pending_refund',
      refund_id = p_refund_id
  where id = p_reschedule_id and status = 'pending_payment';

  return true;
end;
$$;

revoke all on function public.record_reschedule_refund_success(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_reschedule_refund_success(uuid, uuid) to service_role;

-- The orphan-recovery guarantee (see the audit's finding B2). Fires on
-- EVERY booking cancellation regardless of which application code path
-- performed it (the ordinary cancelBookingAction/cancelBooking() self-
-- service flow, a future admin tool, anything) — so there is no
-- "alternate path" that can leave a reschedule permanently stuck. Only
-- ever touches a 'pending_payment' row (nothing has succeeded
-- financially yet, so declaring it failed and releasing the original for
-- another attempt is always safe) — deliberately NEVER 'pending_refund'
-- (a real refund already succeeded there; see mark_reschedule_failed()'s
-- own comment for why that state must only ever move forward to
-- 'completed', not backward to 'failed').
--
-- Guarded by the SAME bypass flag complete_reschedule() itself sets:
-- without this check, complete_reschedule()'s own cancellation of the
-- original (its second UPDATE) would fire this trigger WHILE the
-- reschedule row is still 'pending_payment' (its own third UPDATE, which
-- sets 'completed', hasn't run yet) — incorrectly racing this trigger's
-- "mark it failed" against complete_reschedule()'s "mark it completed"
-- and non-deterministically leaving the reschedule 'failed' even on a
-- fully successful completion. Skipping whenever
-- bypass_reschedule_tampering is already 'true' means "a trusted
-- reschedule RPC is already orchestrating this transaction's bookings
-- writes — let it finish, don't second-guess it" — that GUC is ONLY ever
-- set by complete_reschedule()/mark_reschedule_failed()/
-- record_reschedule_refund_success() themselves, never by an ordinary
-- cancelBooking() call, so this trigger still fires normally for every
-- customer-initiated or other non-reschedule-RPC cancellation.
create or replace function public.reconcile_reschedule_on_booking_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce(current_setting('air_rally.bypass_reschedule_tampering', true), 'false') = 'true' then
    return new;
  end if;

  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    perform set_config('air_rally.bypass_reschedule_tampering', 'true', true);

    update public.booking_reschedules
    set status = 'failed',
        failure_reason = coalesce(failure_reason, 'The associated booking was cancelled before this reschedule could complete.')
    where status = 'pending_payment'
      and (new_booking_id = new.id or original_booking_id = new.id);
  end if;
  return new;
end;
$$;

create trigger bookings_reconcile_reschedule_on_cancel
after update on public.bookings
for each row execute function public.reconcile_reschedule_on_booking_cancel();

-- RLS impact: none on any existing table beyond booking_reschedules'
-- own tightened INSERT check (see above) and the new completion RPCs'
-- restricted grants — no existing policy on bookings/booking_refunds/
-- venues/courts is altered. bookings_no_overlap is not touched — the
-- replacement booking is created through the existing createBooking()
-- path and is subject to that exclusion constraint exactly like any
-- other booking, which is what gives rescheduling its real
-- double-booking guarantee (see the design report's §9).
--
-- Idempotency impact: complete_reschedule()'s own WHERE clauses are the
-- core mechanism, structurally identical to confirm_booking_payment()'s
-- existing one. mark_reschedule_failed() and
-- record_reschedule_refund_success() are similarly guarded (each only
-- matches a row still in 'pending_payment'). None of the three functions
-- can be called twice with different effect. The new AFTER UPDATE
-- trigger only ever matches a 'pending_payment' row too, so it cannot
-- race against or double-apply on top of a completion that already
-- happened.
