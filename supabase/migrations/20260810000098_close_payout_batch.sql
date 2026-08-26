-- ============================================================================
-- Close a payout batch once every transfer under it has reached a terminal
-- state.
--
-- THE BUG. PB-000001 and PB-000002 sit at status='approved' with
-- completed_at null, while every payout_transfer under them is 'completed'
-- and every booking_settlement is 'settled'. The money is attested as sent
-- and the ledger agrees — but the batch never closes, so the admin list
-- shows two outstanding obligations for money the same database says was
-- already paid.
--
-- WHY IT NEVER CLOSED. 041's enforce_payout_batch_status() refuses any move
-- to 'processing' or 'completed' outright. Its own comment says why:
--
--   "They assert that a payout was executed, and there is no executor -- no
--    PayMongo transfer call exists anywhere in this codebase."
--
-- That was TRUE WHEN WRITTEN and is FALSE NOW. 092/093/094/095 built the
-- executor: record -> upload -> send -> settle -> notify, with a human
-- attestation at each step. The guard was correct; its premise expired.
--
-- Same shape as 044's allow_transfer_completion, and handled the same way:
-- a transaction-local escape hatch that only the attestation path can open,
-- NOT dropping the trigger. An admin clicking around, or a bug, still cannot
-- mark a batch completed -- only the function that just witnessed a transfer
-- reach a terminal state can.
--
-- ---------------------------------------------------------------------------
-- A NEAR-MISS WORTH RECORDING, because this is where someone writes
-- `on delete` and it is one keyword away from a disaster:
--
--   bookings --CASCADE--> booking_settlements <--RESTRICT-- payout_batch_items
--
-- Deleting a booking SILENTLY deletes its settlement. The only thing that
-- stops a routine test-user cleanup from destroying the nine settlements
-- behind PB-000001's PHP 4,940 -- money now attested as paid -- is that
-- payout_batch_items.settlement_id is RESTRICT rather than CASCADE. Nobody
-- chose that guard for this scenario; it happened to be right.
--
-- The same trap exists one level up and is NOT currently protected:
--
--   venues.owner_id -> profiles is CASCADE, and courts, operating hours,
--   amenities, images, favourites, reviews AND venue_payment_accounts (the
--   BANK DETAILS) all CASCADE from venues.
--
-- Today the three live venues are RESTRICT-protected by their settlements.
-- A NEWLY ONBOARDED VENUE THAT HAS TAKEN NO BOOKINGS HAS NO SUCH
-- PROTECTION -- deleting that owner would silently take the venue and its
-- bank details with it. Do not relax any RESTRICT in this chain without
-- deciding what protects a venue that has no financial history yet.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. Let the attestation path -- and only it -- close a batch.
-- ---------------------------------------------------------------------------
create or replace function public.enforce_payout_batch_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = old.status then
    return new;
  end if;

  -- 'processing' and 'completed' assert that a payout was executed. That is
  -- now possible, but ONLY through attest_payout_settled/failed, which set
  -- this transaction-local flag around the update and reset it immediately.
  -- Anything else -- an admin UPDATE, a stray script, a future bug -- still
  -- gets the original refusal.
  if new.status in ('processing', 'completed')
     and coalesce(current_setting('air_rally.allow_batch_completion', true), 'false') <> 'true' then
    raise exception 'Payout execution is not enabled — a batch cannot be marked %.', new.status
      using errcode = 'feature_not_supported';
  end if;

  if not (
    (old.status = 'draft' and new.status in ('reviewing', 'approved', 'cancelled'))
    or (old.status = 'reviewing' and new.status in ('draft', 'approved', 'cancelled'))
    or (old.status = 'approved' and new.status in ('cancelled', 'failed', 'completed'))
  ) then
    raise exception 'Cannot move a payout batch from % to %.', old.status, new.status using errcode = 'check_violation';
  end if;

  if new.status = 'approved' then
    new.approved_at := now();
    new.approved_by := auth.uid();
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- 2. Decide whether a batch is finished, and close it if so.
--
-- THE RULES, and why each one is what it is:
--
--   * A venue with NO live transfer means the batch is not finished. Its
--     money has not been attempted yet.
--   * A live transfer still 'pending' or 'processing' means not finished.
--     This is the case that would otherwise let a batch close early.
--   * 'cancelled' transfers are ignored entirely. 094 exists so a mistaken
--     upload can be cancelled and re-recorded; a cancelled row is a
--     withdrawn attempt, not an outcome.
--   * MIXED completed/failed resolves to 'completed', NOT 'failed'. Money
--     genuinely reached some venues. Marking the batch failed would
--     misrepresent settled payouts and invite someone to send them again.
--     A partially-failed batch needs a re-record for the failed venues, not
--     a re-run of the whole batch.
--   * 'failed' only when EVERY live transfer failed.
--
-- completed_at is max(attested_at) across the completed transfers -- WHEN
-- THE MONEY WAS ATTESTED, not when this function happened to run. Using
-- now() would date a real financial event to whenever a migration was
-- applied, which for the two existing batches would be wrong by hours.
-- ---------------------------------------------------------------------------
create or replace function public.close_payout_batch_if_terminal(p_batch_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status        text;
  v_venues        integer;
  v_with_terminal integer;
  v_completed     integer;
  v_completed_at  timestamptz;
  v_new_status    text;
begin
  select status into v_status from public.payout_batches where id = p_batch_id for update;

  -- Only an approved batch can close. Anything else -- already completed,
  -- cancelled, still in draft -- is left alone rather than forced.
  if v_status is distinct from 'approved' then
    return null;
  end if;

  select count(distinct i.venue_id) into v_venues
  from public.payout_batch_items i
  where i.payout_batch_id = p_batch_id;

  -- Venues whose live (non-cancelled) transfers have ALL reached a terminal
  -- state. A venue with no live transfer contributes 0 and so cannot count.
  select count(*) into v_with_terminal
  from (
    select t.venue_id
    from public.payout_transfers t
    where t.payout_batch_id = p_batch_id
      and t.status <> 'cancelled'
    group by t.venue_id
    having bool_and(t.status in ('completed', 'failed'))
  ) terminal_venues;

  if v_venues = 0 or v_with_terminal < v_venues then
    return null;
  end if;

  select count(*), max(t.attested_at) into v_completed, v_completed_at
  from public.payout_transfers t
  where t.payout_batch_id = p_batch_id and t.status = 'completed';

  v_new_status := case when v_completed > 0 then 'completed' else 'failed' end;

  perform set_config('air_rally.allow_batch_completion', 'true', true);

  update public.payout_batches
  set status       = v_new_status,
      completed_at = case when v_new_status = 'completed'
                          then coalesce(v_completed_at, now()) end,
      updated_at   = now()
  where id = p_batch_id;

  -- Reset on every return path, including this one. set_config(..., true) is
  -- TRANSACTION-scoped, not function-scoped: leaving it raised would disarm
  -- the guard for everything else in the same transaction.
  perform set_config('air_rally.allow_batch_completion', 'false', true);

  raise notice 'close_payout_batch_if_terminal: batch % -> % (completed_at %).',
    p_batch_id, v_new_status, v_completed_at;

  return v_new_status;
end;
$$;

revoke all on function public.close_payout_batch_if_terminal(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Call it from both attestation endpoints.
--
-- Deliberately NOT notifying anyone on batch closure. A batch is an internal
-- admin construct -- venue owners have never been told batches exist, and
-- each of them already received a payslip for their own transfer carrying
-- the net figure and the period. A second message about the same money is
-- the exact repetition the founder objected to elsewhere.
-- ---------------------------------------------------------------------------
create or replace function public.attest_payout_settled(p_transfer_id uuid, p_provider_reference text)
returns public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payout_transfers;
  v_settled integer;
  v_owner_id uuid;
  v_venue_name text;
  v_net integer;
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

  perform set_config('air_rally.allow_transfer_completion', 'false', true);

  if v_row.id is null then
    raise exception 'No processing transfer with that id — attest it as sent first.'
      using errcode = 'no_data_found';
  end if;

  update public.booking_settlements s
  set settlement_status = 'settled',
      settled_at = now(),
      updated_at = now()
  from public.payout_batch_items i
  where i.settlement_id = s.id
    and i.payout_batch_id = v_row.payout_batch_id
    and i.venue_id = v_row.venue_id
    and s.settlement_status = 'payable';

  get diagnostics v_settled = row_count;

  select v.owner_id, v.name into v_owner_id, v_venue_name
  from public.venues v where v.id = v_row.venue_id;

  v_net := v_row.amount - v_row.provider_fee;

  if v_owner_id is not null then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      v_owner_id,
      'payout_sent',
      'Payout sent',
      '₱' || to_char(v_net / 100.0, 'FM999,999,990.00') || ' has been sent to your bank for ' || coalesce(v_venue_name, 'your venue') || '.',
      '/list-your-court/earnings'
    );
  end if;

  perform public.close_payout_batch_if_terminal(v_row.payout_batch_id);

  raise notice 'attest_payout_settled: transfer % settled % settlement(s), notified owner %.', v_row.id, v_settled, v_owner_id;

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

  -- A failure can be the LAST outcome a batch was waiting on, so this must
  -- run here too. Without it, a batch whose final transfer failed would sit
  -- at 'approved' forever.
  perform public.close_payout_batch_if_terminal(v_row.payout_batch_id);

  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 4. Backfill.
--
-- The functions above only close a batch when an attestation happens. Batches
-- already finished before this migration would never see another attestation
-- and would sit at 'approved' forever -- which is the exact bug being fixed.
-- So close them here, using the same function rather than a bespoke UPDATE,
-- so the backfill cannot disagree with the ongoing behaviour.
--
-- Idempotent: close_payout_batch_if_terminal() returns null and changes
-- nothing for any batch that is not approved-and-finished.
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  v_result text;
  v_closed integer := 0;
begin
  for r in select id, batch_reference from public.payout_batches where status = 'approved' order by batch_reference loop
    v_result := public.close_payout_batch_if_terminal(r.id);
    if v_result is not null then
      v_closed := v_closed + 1;
      raise notice 'backfill: % -> %', r.batch_reference, v_result;
    end if;
  end loop;
  raise notice 'backfill: closed % batch(es).', v_closed;
end;
$$;
