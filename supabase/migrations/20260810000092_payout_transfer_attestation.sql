-- Manual payout attestation: recording that a human sent money, honestly.
--
-- 20260810000044 built payout_transfers for an AUTOMATED executor — a
-- PayMongo API call returning a provider_transfer_id, confirmed by webhook.
-- That executor cannot exist: AIR/Rally has no PayMongo wallet, so there is
-- no source account to send from (docs/payments/paymongo-transfers.md).
-- The real mechanism is a person uploading a bulk-transfer file to
-- PayMongo's dashboard, so the table has sat with no write path for any
-- role and zero rows since it shipped.
--
-- THIS RECORDS AN ATTESTATION, NOT A CONFIRMATION.
--
-- Nothing here verifies that money moved. What it records is that a named
-- admin, at a named time, said they uploaded a file. There is no callback
-- on this path — that is precisely why it is manual. The columns are called
-- attested_by/attested_at rather than confirmed_by/confirmed_at so that no
-- future reader can mistake a human's word for a bank's. If a venue ever
-- says "I never received it", the distinction between "we attested sending"
-- and "the transfer settled" is the entire question, and a schema that
-- blurs them destroys the ability to answer it.
--
-- The existing status graph is reused unchanged, not widened — each state
-- simply gains a human meaning in place of its API one:
--
--   pending     row created at export, before the file is uploaded
--   processing  an admin attests "I uploaded this to PayMongo"
--   completed   an admin attests "PayMongo's own report shows it sent"
--   failed      an admin attests it failed, with a reason
--
-- Reversibility falls out of that same graph rather than needing new rules:
-- pending -> cancelled is already permitted and nothing has been announced
-- at that stage, so a misclick is recoverable. Past 'processing' there is
-- no undo — once a venue has been told they were paid, silently un-telling
-- them is worse than a visible correcting record.

-- === The fee ===============================================================
--
-- MONEY IS STORED IN CENTAVOS THROUGHOUT THIS SCHEMA. ₱10.00 IS 1000, NOT 10.
--
-- Verified against a real production settlement rather than assumed:
-- gross_booking_amount 40000 / platform_fee 2000 / venue_amount 38000 at a
-- 5% rate — which is exactly the Venue Owner Agreement §3.2 worked example
-- of a ₱400.00 court price, a ₱20.00 commission and ₱380.00 to the venue.
-- Writing 10 here would mean ten centavos: a silent 100x error on a money
-- line, in the one place nobody looks twice because "10" matches the "₱10"
-- in the clause. This project has already shipped one 100x price error.
--
-- A function rather than a literal at each call site, mirroring
-- platform_fee_percent() from 20260810000039.
--
-- Charged per TRANSFER, not per booking: PayMongo takes ₱10 to send one
-- payment regardless of how many settlements it covers. That is why it
-- cannot live on booking_settlements, and why platform_fee + venue_amount =
-- gross_booking_amount stays untouched — a booking's earnings are unchanged
-- by what it later costs to send them.
create or replace function public.payout_transfer_fee_centavos()
returns integer
language sql
immutable
as $$ select 1000 $$;

comment on function public.payout_transfer_fee_centavos() is
  'PayMongo bulk-transfer fee in CENTAVOS. 1000 = PHP 10.00, charged once per transfer, not per booking.';

alter table public.payout_transfers
  add column provider_fee integer not null default 0 check (provider_fee >= 0),
  add column attested_by uuid references public.profiles (id) on delete restrict,
  add column attested_at timestamptz;

comment on column public.payout_transfers.provider_fee is
  'Provider fee for THIS transfer, in centavos. Net sent = amount - provider_fee. The net is '
  'deliberately not stored: a stored net can drift out of agreement with its own inputs.';
comment on column public.payout_transfers.attested_by is
  'The admin who asserted this transfer was sent. NOT a provider confirmation — nothing on this '
  'path verifies the money moved.';

-- A transfer claiming to be completed must name who claimed it, mirroring
-- 044's own payout_transfer_completed_has_provider_id.
alter table public.payout_transfers
  add constraint payout_transfer_completed_has_attester
    check (status <> 'completed' or (attested_by is not null and attested_at is not null));

-- === Recording the transfers for a batch ===================================
--
-- One row per VENUE, not per settlement: a batch of thirty bookings for one
-- venue is one bank transfer charged one fee.
--
-- Idempotent by design, not by accident. Re-running returns the rows that
-- already exist rather than erroring, because an admin who clicks twice
-- should see the same batch, not a unique-violation. The partial unique
-- index from 044 remains the backstop if this logic is ever wrong.
create or replace function public.record_payout_transfers(p_batch_id uuid)
returns setof public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_fee integer := public.payout_transfer_fee_centavos();
begin
  if not public.is_admin() then
    raise exception 'Recording payout transfers is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  select status into v_status from public.payout_batches where id = p_batch_id;
  if v_status is null then
    raise exception 'Payout batch not found.' using errcode = 'no_data_found';
  end if;
  if v_status <> 'approved' then
    raise exception 'Transfers can only be recorded for an approved batch (this one is %).', v_status
      using errcode = 'check_violation';
  end if;

  insert into public.payout_transfers (payout_batch_id, venue_id, amount, currency, reference_number, provider_fee)
  select
    p_batch_id,
    i.venue_id,
    sum(i.amount)::integer,
    'PHP',
    -- Our own reference, generated once and never reused. PayMongo
    -- documents no idempotency key for transfers, so retry-safety lives
    -- here (see 044's header).
    'PT-' || replace(p_batch_id::text, '-', '') || '-' || replace(i.venue_id::text, '-', ''),
    v_fee
  from public.payout_batch_items i
  where i.payout_batch_id = p_batch_id
    -- The idempotent half: a venue already carrying a live transfer for
    -- this batch is skipped rather than colliding. This belongs in WHERE,
    -- before GROUP BY — placed after it, Postgres parses the predicate as
    -- another grouping expression and fails with "argument of AND must be
    -- type boolean". Caught by the control rather than by review.
    and not exists (
      select 1 from public.payout_transfers t
      where t.payout_batch_id = p_batch_id
        and t.venue_id = i.venue_id
        and t.status in ('pending', 'processing', 'completed')
    )
  group by i.venue_id;

  return query
  select * from public.payout_transfers where payout_batch_id = p_batch_id order by venue_id;
end;
$$;

-- === Attestation ===========================================================
--
-- WHY THIS RAISES air_rally.allow_transfer_completion
--
-- 044 refuses status='completed' unless that GUC is true, so that "a stray
-- UPDATE, a migration, or a future bug" could never claim a venue was paid.
-- Its stated premise was that NO EXECUTOR EXISTS. That premise has changed:
-- a human executor now exists. Something had to give, and the alternative —
-- a second terminal state meaning "actually paid" alongside 'completed' —
-- is worse, because two ways to say the same thing is how a ledger becomes
-- unanswerable.
--
-- Raising it transaction-locally preserves exactly what the guard protected:
-- no stray UPDATE, migration or bug raises the GUC, so none of them can
-- write 'completed'. Only this one admin-only, audited call can.
--
-- IT IS RESET TO 'false' BEFORE RETURNING. set_config(..., true) is
-- TRANSACTION-local, not function-local — called from inside a larger
-- transaction it would otherwise stay raised for everything after it. Under
-- PostgREST each call is its own transaction, so today that is harmless;
-- "harmless under the current caller" is the assumption that breaks later
-- without a sign. The reset costs one line and removes the dependency.
create or replace function public.attest_payout_sent(p_transfer_id uuid, p_provider_reference text default null)
returns public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payout_transfers;
begin
  if not public.is_admin() then
    raise exception 'Attesting a payout is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  update public.payout_transfers
  set status = 'processing',
      provider_transfer_id = coalesce(p_provider_reference, provider_transfer_id),
      attested_by = auth.uid(),
      attested_at = now()
  where id = p_transfer_id and status = 'pending'
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No pending transfer with that id — it may already have been attested.'
      using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

create or replace function public.attest_payout_settled(p_transfer_id uuid, p_provider_reference text)
returns public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payout_transfers;
begin
  if not public.is_admin() then
    raise exception 'Attesting a payout is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  if p_provider_reference is null or btrim(p_provider_reference) = '' then
    raise exception 'A provider reference is required to attest a transfer as settled.'
      using errcode = 'check_violation';
  end if;

  perform set_config('air_rally.allow_transfer_completion', 'true', true);

  update public.payout_transfers
  set status = 'completed',
      provider_transfer_id = btrim(p_provider_reference),
      attested_by = auth.uid(),
      attested_at = now()
  where id = p_transfer_id and status = 'processing'
  returning * into v_row;

  -- Reset before every return path, including the failure one.
  perform set_config('air_rally.allow_transfer_completion', 'false', true);

  if v_row.id is null then
    raise exception 'No processing transfer with that id — attest it as sent first.'
      using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

create or replace function public.attest_payout_failed(p_transfer_id uuid, p_reason text)
returns public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payout_transfers;
begin
  if not public.is_admin() then
    raise exception 'Attesting a payout is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to attest a transfer as failed.' using errcode = 'check_violation';
  end if;

  update public.payout_transfers
  set status = 'failed',
      failure_reason = btrim(p_reason),
      attested_by = auth.uid(),
      attested_at = now()
  where id = p_transfer_id and status in ('pending', 'processing')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No live transfer with that id.' using errcode = 'no_data_found';
  end if;
  return v_row;
end;
$$;

revoke all on function public.record_payout_transfers(uuid) from public, anon;
revoke all on function public.attest_payout_sent(uuid, text) from public, anon;
revoke all on function public.attest_payout_settled(uuid, text) from public, anon;
revoke all on function public.attest_payout_failed(uuid, text) from public, anon;
grant execute on function public.record_payout_transfers(uuid) to authenticated, service_role;
grant execute on function public.attest_payout_sent(uuid, text) to authenticated, service_role;
grant execute on function public.attest_payout_settled(uuid, text) to authenticated, service_role;
grant execute on function public.attest_payout_failed(uuid, text) to authenticated, service_role;

-- NOTE: nothing here writes booking_settlements.settlement_status = 'settled'.
-- That remains unwritten anywhere in this schema, deliberately. A settlement's
-- status is the venue-facing truth about whether they have been paid, and
-- wiring it to an attestation — a human's word that they uploaded a file — is
-- a larger claim than the attestation supports. It is a separate decision with
-- a customer-facing consequence and belongs in its own migration.
