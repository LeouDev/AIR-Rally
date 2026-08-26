-- Telling the venue owner their payout was sent.
--
-- The last link in the chain: record the transfer (092), attest it sent and
-- settle the earnings (093), and now tell the person whose money it is.
--
-- WRITTEN INSIDE attest_payout_settled(), IN THE SAME TRANSACTION as the
-- settlement write. The announcement and the fact it announces move
-- together or neither happens. Split apart, a failure between them leaves
-- either a venue told they were paid whose earnings still read as owed, or
-- earnings marked paid with nobody told — and the first is worse than
-- saying nothing at all.
--
-- FIRES ONLY AT 'completed', NEVER AT 'processing'. 'processing' means an
-- admin says they uploaded a file; a row inside that file can still be
-- rejected. One announcement, when the send is known to have happened —
-- two messages about one payout is the confusion this was asked for to
-- prevent, and the earlier one would assert something Owner Agreement
-- §3.12 explicitly does not claim.
--
-- THE RECIPIENT IS THE VENUE OWNER, NOT THE ATTESTING ADMIN. Obvious, and
-- worth stating because auth.uid() is right there and is the wrong answer:
-- it would send the founder a payslip about their own admin action.
--
-- WORDING: "sent", never "delivered" or "received". §3.12 commits to
-- sending on time, not to when a bank credits it. The notification and the
-- payslip email it triggers must not claim more than the clause does.
--
-- The email rides on this row: notifications_email_webhook (058) fires on
-- INSERT and posts to /api/webhooks/notification-created, which renders the
-- payslip. That path fires ONCE — pg_net is fire-and-forget and does not
-- retry (verified on production: 72 requests, 72 distinct ids, no
-- redelivery). If a request is lost the outcome is a MISSING email, never a
-- duplicate. That is the correct direction to fail in for money, and it
-- should not be "improved" into a retry without solving deduplication
-- first: a venue receiving two payslips for one payout would reasonably
-- wonder whether they were paid twice.
--
-- link_url is '/list-your-court/earnings' — the web page that actually
-- shows the Available-to-Paid movement. On mobile,
-- resolveNotificationTarget() maps /list-your-court/* to /owner, which is a
-- real earnings screen (not a dead end), though it does not yet show
-- settlement status.

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
      '/list-your-court/earnings'
    );
  end if;

  raise notice 'attest_payout_settled: transfer % settled % settlement(s), notified owner %.', v_row.id, v_settled, v_owner_id;

  return v_row;
end;
$$;

revoke all on function public.attest_payout_settled(uuid, text) from public, anon;
grant execute on function public.attest_payout_settled(uuid, text) to authenticated, service_role;
