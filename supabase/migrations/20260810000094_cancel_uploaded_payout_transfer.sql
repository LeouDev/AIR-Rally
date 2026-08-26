-- An escape hatch from 'processing' — the state an admin reaches by
-- clicking the low-consequence button.
--
-- THE TRAP THIS REMOVES
--
-- 044's graph allows pending -> processing | failed | cancelled, but from
-- 'processing' only -> completed | failed. So an admin who marks a transfer
-- uploaded before they have actually uploaded it has two exits, and both
-- write a falsehood into the record:
--
--   attest_payout_settled  claims PayMongo confirmed a send that never
--                          happened, AND settles the venue's earnings
--                          (20260810000093) — telling a customer they were
--                          paid when nothing was sent
--   attest_payout_failed   records a failure that did not occur, and marks
--                          the transfer permanently failed
--
-- There is no honest move. And 'processing' is reached by the *casual*
-- action — "mark as uploaded" is the low-stakes button, which is precisely
-- why it gets clicked before the upload actually happens, or on the wrong
-- row. An unrecoverable casual action is a trap.
--
-- WHY THIS TRANSITION IS SAFE, BY THE GRAPH'S OWN REASONING
--
-- pending -> cancelled already exists because nothing has been announced at
-- that stage. Nothing has been announced at 'processing' either: by
-- deliberate design (20260810000093) the first and only announcement — the
-- notification, the email, the settlement write — happens at 'completed'.
-- So the same justification that permitted the existing transition permits
-- this one. Cancelling a transfer nobody has been told about takes nothing
-- back.
--
-- 'completed' remains terminal and uncancellable. Once a venue has been
-- told they were paid and their earnings have moved to Paid, silently
-- un-telling them is worse than a visible correcting record.
--
-- Cancelling also releases the partial unique index from 044
-- (payout_transfers_live_per_venue_batch, which covers only pending /
-- processing / completed), so record_payout_transfers() can create a fresh
-- row for that venue afterwards. The recovery is: cancel the mistake,
-- re-record, upload for real.
--
-- A BUG IN 20260810000092 THAT WOULD HAVE MADE THAT RECOVERY IMPOSSIBLE
--
-- 092 generated reference_number deterministically as
-- 'PT-' || batch_id || '-' || venue_id. That column is UNIQUE across the
-- whole table, not merely among live rows — so cancelling a transfer and
-- re-recording it for the same batch and venue produced the SAME reference
-- and failed on payout_transfers_reference_number_key. The partial index
-- freed up; the unique constraint did not.
--
-- The escape hatch above would therefore have led straight into a wall,
-- and only in the recovery path — the one place someone is already dealing
-- with a mistake. Caught by this migration's own control, not by review.
--
-- Fixed here rather than in a separate migration because 094 is what makes
-- cancel-then-re-record reachable at all: shipping the transition without
-- the fix would be shipping a broken recovery.
--
-- A sequence, mirroring payout_batch_reference_seq from 20260810000041.
-- This also satisfies 044's actual requirement better than the old scheme
-- did: its header asks for a reference "generated once per transfer row and
-- never regenerated on retry", because PayMongo publishes no idempotency
-- key. A per-row sequence value is unique per row by construction. The
-- deterministic scheme could not distinguish a genuinely new attempt from
-- a repeat of an abandoned one — which is exactly the distinction that
-- matters after a cancellation, where the old reference was never
-- transmitted to anyone.
create sequence if not exists public.payout_transfer_reference_seq;

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
    'PT-' || lpad(nextval('public.payout_transfer_reference_seq')::text, 6, '0'),
    v_fee
  from public.payout_batch_items i
  where i.payout_batch_id = p_batch_id
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

revoke all on function public.record_payout_transfers(uuid) from public, anon;
grant execute on function public.record_payout_transfers(uuid) to authenticated, service_role;

-- === What a cancellation was cancelled FROM ================================
--
-- A cancellation from 'pending' and one from 'processing' mean completely
-- different things, and without this they are indistinguishable afterwards
-- — both are simply status = 'cancelled', prior state discarded.
--
--   from 'pending'     nothing ever left the building
--   from 'processing'  a file MAY be at PayMongo carrying this reference
--
-- The second is the single most important fact if a venue is ever paid
-- twice, and "could this reference be live at PayMongo?" is the first
-- question anyone would ask. This does not pretend to knowledge the system
-- lacks — it cannot know whether a file was really uploaded, which is the
-- whole reason 'processing' is an attestation. It records the row's own
-- prior status, which the system definitely holds, and which it was
-- otherwise throwing away.
--
-- failure_reason is the admin's account of WHY, written in a hurry and
-- possibly vague. This is the system's account of WHAT STATE IT WAS IN,
-- which cannot be.
--
-- Populated by the status trigger rather than by cancel_payout_transfer(),
-- so it is recorded on ANY path reaching 'cancelled' — including a raw
-- UPDATE that never goes through the RPC.
alter table public.payout_transfers
  add column cancelled_from_status text;

comment on column public.payout_transfers.cancelled_from_status is
  'The status this transfer was cancelled from. ''processing'' means a file may already be at '
  'PayMongo carrying this reference — the first thing to check if a venue is ever double-paid.';

alter table public.payout_transfers
  add constraint payout_transfer_cancelled_names_prior_status
    check (status <> 'cancelled' or cancelled_from_status is not null);

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
    -- 'cancelled' added here: nothing is announced until 'completed', so a
    -- transfer at 'processing' can still be taken back without contradicting
    -- anything a venue has been told. See this migration's header.
    or (old.status = 'processing' and new.status in ('completed', 'failed', 'cancelled'))
  ) then
    raise exception 'Cannot move a payout transfer from % to %.', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status = 'completed' then
    new.completed_at := now();
  elsif new.status = 'failed' then
    new.failed_at := now();
  elsif new.status = 'cancelled' then
    -- Taken from old.status rather than from a caller-supplied value: the
    -- prior state is a fact of the row, and a caller could get it wrong.
    new.cancelled_from_status := old.status;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

-- The admin entry point. Admin-only with its own is_admin() check per
-- 20260810000040 — the definer function's own guard is the boundary, never
-- the page that happens to call it.
--
-- A reason is required, matching adjust_user_credits() and
-- attest_payout_failed(): this is the only record of why a transfer that
-- was marked uploaded no longer exists, and "it was a mistake" is worth
-- writing down rather than inferring from a gap.
create or replace function public.cancel_payout_transfer(p_transfer_id uuid, p_reason text)
returns public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payout_transfers;
begin
  if not public.is_admin() then
    raise exception 'Cancelling a payout transfer is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required to cancel a payout transfer.' using errcode = 'check_violation';
  end if;

  update public.payout_transfers
  set status = 'cancelled',
      failure_reason = btrim(p_reason),
      attested_by = auth.uid(),
      attested_at = now()
  where id = p_transfer_id and status in ('pending', 'processing')
  returning * into v_row;

  if v_row.id is null then
    raise exception 'No pending or uploaded transfer with that id — a confirmed transfer cannot be cancelled.'
      using errcode = 'no_data_found';
  end if;

  -- Deliberately touches no booking_settlements row. Nothing was settled at
  -- 'pending' or 'processing' (20260810000093 settles only on 'completed'),
  -- so there is nothing to undo — which is the whole reason this transition
  -- is safe.
  return v_row;
end;
$$;

revoke all on function public.cancel_payout_transfer(uuid, text) from public, anon;
grant execute on function public.cancel_payout_transfer(uuid, text) to authenticated, service_role;
