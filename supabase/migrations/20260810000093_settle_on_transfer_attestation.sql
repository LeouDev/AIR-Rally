-- Marking a venue's settlements paid when their transfer is attested settled.
--
-- 20260810000039 reserved settlement_status = 'settled' for "the venue has
-- actually been paid" and deliberately left it unwritten, because nothing
-- could pay anyone. 20260810000092 gave a human a way to record that they
-- did. This connects the two — the last write in the chain, and the only
-- one a venue owner ever sees.
--
-- ON 'completed', NEVER ON 'processing'.
--
-- 092's states are: processing = "I uploaded the file to PayMongo",
-- completed = "PayMongo's own report shows it sent". An upload is not a
-- payment — a row inside an uploaded file can still be rejected for a bank
-- name PayMongo won't match, an amount under the PHP 80.00 minimum, or a
-- failure at the receiving bank. Settling at upload time would tell the
-- owner they had been paid and drop their payable to zero, and retracting
-- that is far worse than telling them a day later. PESONet settles same or
-- next banking day, so the wait is small and honest.
--
-- This is also why no revert path exists here and none is needed: 'failed'
-- is a separate terminal state, so a transfer that fails never touches
-- settlement status at all. Nothing is prematurely written, so nothing has
-- to be taken back.
--
-- THE SETTLED AMOUNT IS THE GROSS, NOT THE NET.
--
-- A venue owed PHP 4,940.00 who receives PHP 4,930.00 has still had the
-- full PHP 4,940.00 of settlements satisfied — the PHP 10.00 is a transfer
-- cost, not an unpaid residual. Marking only the net would leave PHP 10.00
-- apparently still owed after every payout, accumulating forever into a
-- balance no one could ever clear. That is why this marks the settlement
-- ROWS rather than doing any arithmetic: their venue_amount is untouched,
-- so the sum satisfied is the gross by construction.
--
-- Nothing about the owner's earnings page needs to change. Its figures are
-- already derived live from settlement_status — 'settled' already feeds the
-- "Paid" card in getOwnerSettlementSummary(), and there is no stored
-- balance anywhere to drift. That half has been built all along and simply
-- never had a way to be exercised.

create or replace function public.attest_payout_settled(p_transfer_id uuid, p_provider_reference text)
returns public.payout_transfers
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row public.payout_transfers;
  v_settled integer;
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

  -- IN THE SAME TRANSACTION as the attestation above, deliberately. Split
  -- across two statements, a failure between them would leave a completed
  -- transfer whose settlements are still payable — which reads as "we paid
  -- them and they are still owed it", the worst of both records.
  --
  -- Written here rather than in a trigger on the status change: a trigger
  -- would fire on ANY path reaching 'completed', including one nobody has
  -- written yet, and settling a venue's earnings is too consequential to
  -- attach as a side effect of a status transition. The GUC guard makes
  -- this RPC the only legitimate way to reach 'completed', so the write
  -- belongs where the decision is made.
  --
  -- Scoped to this transfer's own batch AND venue: a batch may cover
  -- several venues, and attesting one venue's transfer must not settle
  -- another venue's earnings.
  --
  -- settled_at moves with the status because 039's own CHECK
  -- ((settlement_status = 'settled') = (settled_at is not null)) refuses a
  -- row where only one of them is set.
  update public.booking_settlements s
  set settlement_status = 'settled',
      settled_at = now(),
      updated_at = now()
  from public.payout_batch_items i
  where i.settlement_id = s.id
    and i.payout_batch_id = v_row.payout_batch_id
    and i.venue_id = v_row.venue_id
    -- Only live entitlement settles. A settlement reversed or put on hold
    -- between batching and attestation is no longer owed, and must not be
    -- quietly marked paid on its way out.
    and s.settlement_status = 'payable';

  get diagnostics v_settled = row_count;

  -- Not an error: a re-attested transfer, or one whose settlements were
  -- reversed mid-flight, legitimately settles nothing. Recorded so the
  -- count is visible rather than silently zero.
  raise notice 'attest_payout_settled: transfer % settled % settlement(s).', v_row.id, v_settled;

  return v_row;
end;
$$;

revoke all on function public.attest_payout_settled(uuid, text) from public, anon;
grant execute on function public.attest_payout_settled(uuid, text) to authenticated, service_role;
