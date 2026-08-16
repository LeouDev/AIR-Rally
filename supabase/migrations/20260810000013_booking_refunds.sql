-- Refund audit trail — server-side/admin-only, deliberately provider-
-- and-amount-only. Does NOT store a platform/venue split reversal
-- breakdown: PayMongo's two-party split-refund accounting is unproven
-- (see the PayMongo Final Verification Report / ARCHITECTURE.md) — this
-- table records that a refund was requested/succeeded/failed and for how
-- much, so platform/venue accounting columns can be added once PayMongo
-- confirms the real behavior, rather than guessing a shape now and
-- migrating it later. Purely additive: no existing table/column/
-- function/policy touched, and PayMongo refund *execution* stays behind
-- the separate PAYMONGO_REFUND_EXECUTION_ENABLED kill switch (see
-- lib/paymongoLaunchGates.ts) regardless of what this table records.
create table public.booking_refunds (
  id uuid primary key default gen_random_uuid(),
  booking_id uuid not null references public.bookings (id) on delete cascade,
  payment_provider text not null check (payment_provider in ('stripe', 'paymongo')),
  -- Snapshotted at request time from the booking's own stored payment
  -- id — verified server-side to actually belong to this booking before
  -- any provider API call, never trusted from client input (see
  -- lib/services/refunds.ts).
  provider_payment_id text not null,
  -- Set only once the provider call actually succeeds — null while
  -- status = 'pending' or if it never reaches the provider at all.
  provider_refund_id text,
  amount integer not null check (amount > 0),
  currency text not null,
  status text not null default 'pending' check (status in ('pending', 'succeeded', 'failed')),
  reason text,
  failure_reason text,
  initiated_by uuid not null references auth.users (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index booking_refunds_booking_id_idx on public.booking_refunds (booking_id);

create trigger booking_refunds_set_updated_at
before update on public.booking_refunds
for each row execute function public.set_updated_at();

-- Defense-in-depth, same posture as every other financial table in this
-- schema: the identity/amount fields of a refund record are immutable
-- once created (they describe what was actually requested), even though
-- only admins can reach this table at all per the RLS policies below —
-- only status/provider_refund_id/failure_reason may ever change, as the
-- real-world refund progresses from pending to succeeded/failed.
create or replace function public.prevent_refund_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  new.booking_id := old.booking_id;
  new.payment_provider := old.payment_provider;
  new.provider_payment_id := old.provider_payment_id;
  new.amount := old.amount;
  new.currency := old.currency;
  new.initiated_by := old.initiated_by;
  return new;
end;
$$;

create trigger booking_refunds_prevent_tampering
before update on public.booking_refunds
for each row execute function public.prevent_refund_tampering();

alter table public.booking_refunds enable row level security;

-- Admins see everything; a customer can see refunds on their own
-- booking (the audit-friendly, eventually customer-facing status this
-- table exists to support) — never anyone else's.
create policy "Admins and the booking's own user can view its refunds"
on public.booking_refunds for select
using (
  public.is_admin()
  or exists (select 1 from public.bookings b where b.id = booking_refunds.booking_id and b.user_id = auth.uid())
);

-- Only admins can create or update refund records — matches this
-- project's "protect PayMongo refund execution behind... admin-only
-- capability" requirement. Unlike the webhook-driven confirm_*_payment()
-- RPCs, an admin always has a real authenticated session when this path
-- runs, so a plain RLS-gated policy is sufficient here rather than a
-- SECURITY DEFINER bypass function.
create policy "Only admins can create refund records"
on public.booking_refunds for insert
with check (public.is_admin());

create policy "Only admins can update refund records"
on public.booking_refunds for update
using (public.is_admin())
with check (public.is_admin());

-- No delete policy — refund records are a permanent audit trail.
