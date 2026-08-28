-- ---------------------------------------------------------------------------
-- Carries the transfer id in link_url so the real send can build the real
-- payslip — and corrects a stale claim in migration 095's own comment.
--
-- 095's header said "notifications_email_webhook fires on INSERT and posts
-- to /api/webhooks/notification-created, which renders the payslip." That
-- was never true: renderPayoutPayslipEmail() had exactly one call site
-- before this change, an admin-only preview action
-- (src/lib/actions/payslipPreview.ts) that never wrote a notification row
-- at all. A real payout_sent notification fell through to the generic
-- title+message template — no line items, no period, nothing an owner
-- could reconcile against beyond the one-line amount. See
-- [[payslip-never-actually-sent]] for the full trace.
--
-- SAME URL SHAPE, ONE ADDED QUERY PARAM. '/list-your-court/earnings' stays
-- the human-facing destination — mobile's resolveNotificationTarget()
-- matches it with startsWith('/list-your-court/earnings'), a prefix check,
-- so appending '?transfer=<uuid>' changes nothing there. The webhook route
-- parses the id back out with a regex, exactly the way
-- tryBuildBookingReceiptEmail() already parses a booking id out of
-- booking_confirmed's own link_url — same established pattern, not a new
-- one. On any parse or lookup failure the route falls back to the generic
-- template; a payslip that fails to build must never swallow the "your
-- money was sent" notification itself.
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

  -- Settle exactly what the BATCH covered, joined from payout_batch_items
  -- rather than re-derived from venue plus status: settlements routinely
  -- become payable between batch creation and attestation, and settling
  -- "this venue's payable settlements" would mark rows paid that were never
  -- in the uploaded file.
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

  -- Net of the provider fee: this is what actually reaches their bank, and
  -- it is the number they will look for on their statement. The gross is
  -- what was settled against their earnings, and the payslip email shows
  -- both — but a one-line notification should carry the figure they can
  -- reconcile against, not the one that needs a footnote.
  v_net := v_row.amount - v_row.provider_fee;

  if v_owner_id is not null then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      v_owner_id,
      'payout_sent',
      'Payout sent',
      '₱' || to_char(v_net / 100.0, 'FM999,999,990.00') || ' has been sent to your bank for ' || coalesce(v_venue_name, 'your venue') || '.',
      '/list-your-court/earnings?transfer=' || v_row.id
    );
  end if;

  -- Carried forward from migration 20260810000098 — this function has been
  -- create-or-replace'd four times (092, 093, 095, 098) before this one,
  -- and this call was added in the LATEST of those, not the one this
  -- migration's diff was first drafted against. Dropping it here would
  -- have been a real regression: a batch whose last transfer just
  -- completed would stop closing automatically. Caught before this
  -- migration was applied to production — see the entitlement-question
  -- exchange in [[payslip-never-actually-sent]] for how.
  perform public.close_payout_batch_if_terminal(v_row.payout_batch_id);

  raise notice 'attest_payout_settled: transfer % settled % settlement(s), notified owner %.', v_row.id, v_settled, v_owner_id;

  return v_row;
end;
$$;

revoke all on function public.attest_payout_settled(uuid, text) from public, anon;
grant execute on function public.attest_payout_settled(uuid, text) to authenticated, service_role;
