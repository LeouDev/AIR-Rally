-- payout_transfers: the record of an attempt to actually send money.
--
-- NOTHING WRITES 'completed' IN THIS MIGRATION, and nothing in the codebase
-- can execute a transfer — the provider adapter is disabled by default and
-- throws. This table exists so that when transfers ARE enabled, the record
-- of the attempt is created BEFORE the provider is called, not after.
--
-- That ordering is the whole point. The dangerous failure in payouts is not
-- "the transfer failed" — it is "we sent a transfer and then crashed before
-- recording it", because the retry then pays twice. A row written first,
-- carrying our own reference_number, means a crashed attempt is always
-- discoverable afterwards.
--
-- PAYMONGO RESEARCH FINDINGS THAT SHAPED THIS TABLE (August 2026, verified
-- against the live test API — see docs/payments/paymongo-transfers.md):
--
--   * POST /v2/batch_transfers exists and accepts our test key. Probed
--     live: it returned 400 {"code":"invalid_request_body","detail":
--     "transfers is required"}, so the route and auth are genuinely
--     available to this account.
--   * GET /v2/wallets/ returns {"data":[]}. AIR/Rally has NO wallet, so
--     there is no source_account to transfer from. This is the hard
--     blocker: the API is reachable, the capability is not provisioned.
--   * PayMongo documents NO Idempotency-Key header for transfers. The
--     guide instead says to use a NEW unique reference_number on retry,
--     which is the opposite of idempotency. `reference_number` below is
--     therefore UNIQUE in our database and generated once per transfer
--     row, so retry-safety is enforced on our side, where it can be.
--   * Transfer statuses at PayMongo are only pending / succeeded / failed.
--     No reversal or cancellation endpoint is documented anywhere.
--
-- Because PayMongo cannot be relied on for idempotency, this table is what
-- prevents double payment.

create table public.payout_transfers (
  id uuid primary key default gen_random_uuid(),
  payout_batch_id uuid not null references public.payout_batches (id) on delete restrict,
  venue_id uuid not null references public.venues (id) on delete restrict,
  amount integer not null check (amount > 0),
  currency text not null default 'PHP',
  provider text not null default 'paymongo' check (provider in ('paymongo')),

  -- Our own reference, sent to the provider and never reused. This is the
  -- idempotency key PayMongo does not give us.
  reference_number text not null unique,
  -- The provider's id, known only after a request actually reaches them.
  -- Null means "we may or may not have sent this" — see the status notes.
  provider_transfer_id text unique,

  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),

  -- Raw provider response, kept verbatim for reconciliation. A summarised
  -- copy is not good enough when disputing what was sent.
  provider_response jsonb,
  failure_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  failed_at timestamptz,

  -- One live transfer per venue per batch. A second row for the same pair
  -- is exactly the double-payment this table exists to stop.
  constraint payout_transfer_completion_timestamped
    check ((status = 'completed') = (completed_at is not null)),
  constraint payout_transfer_failure_timestamped
    check ((status = 'failed') = (failed_at is not null)),
  -- A completed transfer must name the provider transfer that completed it.
  -- Without this, "completed" could be asserted with no evidence at all.
  constraint payout_transfer_completed_has_provider_id
    check (status <> 'completed' or provider_transfer_id is not null)
);

create unique index payout_transfers_live_per_venue_batch
  on public.payout_transfers (payout_batch_id, venue_id)
  where status in ('pending', 'processing', 'completed');

create index payout_transfers_batch_idx on public.payout_transfers (payout_batch_id);
create index payout_transfers_status_idx on public.payout_transfers (status);

comment on table public.payout_transfers is
  'Record of an attempt to send money to a venue. Nothing can execute transfers yet; the provider adapter is flag-gated and throws. See docs/payments/paymongo-transfers.md.';
comment on column public.payout_transfers.reference_number is
  'Our own unique reference, sent to the provider. PayMongo documents no Idempotency-Key for transfers, so this is where retry-safety lives.';
comment on column public.payout_transfers.provider_transfer_id is
  'Null means we cannot prove the request reached the provider. Look it up before retrying — never retry blindly.';

-- === Status transitions ==================================================
--
-- pending ─→ processing ─→ completed
--    │            └──────→ failed
--    ├──────────────────→ failed
--    └──────────────────→ cancelled
--
-- 'completed' is REFUSED unless the transfer-execution flag is on at the
-- database level too. Application code being disabled is not sufficient
-- protection for a status that asserts a venue was paid: a stray UPDATE, a
-- migration, or a future bug must not be able to claim it either.
create or replace function public.enforce_payout_transfer_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  if new.status = 'completed'
     and coalesce(current_setting('air_rally.allow_transfer_completion', true), 'false') <> 'true' then
    raise exception 'Transfer execution is not enabled — a transfer cannot be marked completed.'
      using errcode = 'feature_not_supported';
  end if;

  if not (
    (old.status = 'pending' and new.status in ('processing', 'failed', 'cancelled'))
    or (old.status = 'processing' and new.status in ('completed', 'failed'))
  ) then
    raise exception 'Cannot move a payout transfer from % to %.', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status = 'completed' then
    new.completed_at := now();
  elsif new.status = 'failed' then
    new.failed_at := now();
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create trigger payout_transfers_enforce_status
before update on public.payout_transfers
for each row execute function public.enforce_payout_transfer_status();

-- A transfer may only be recorded against a batch that has been approved.
-- Preparing a payout and authorising it stay separate steps.
create or replace function public.enforce_payout_transfer_batch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch_status text;
begin
  select status into v_batch_status from public.payout_batches where id = new.payout_batch_id;
  if v_batch_status is distinct from 'approved' then
    raise exception 'Transfers can only be recorded for an approved batch (this one is %).', coalesce(v_batch_status, 'missing')
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

create trigger payout_transfers_enforce_batch
before insert on public.payout_transfers
for each row execute function public.enforce_payout_transfer_batch();

-- === RLS =================================================================
alter table public.payout_transfers enable row level security;

-- Admins review transfers. Nobody creates or edits one from a browser:
-- transfers are initiated by backend service code only, so there is no
-- INSERT/UPDATE/DELETE policy for any client role, including admins.
create policy "Admins read payout transfers"
on public.payout_transfers for select
using (public.is_admin());

-- A venue owner sees transfers destined for their own venue — "your payout
-- was attempted / failed" is information they are entitled to. Read-only,
-- scoped to their venue, so no owner learns anything about another's.
create policy "Owners read transfers for their own venue"
on public.payout_transfers for select
using (
  exists (
    select 1 from public.venues v
    where v.id = payout_transfers.venue_id and v.owner_id = auth.uid()
  )
);
