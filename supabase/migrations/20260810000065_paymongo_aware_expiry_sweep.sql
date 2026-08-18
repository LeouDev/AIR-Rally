-- Closes a real race expire_stale_pending_bookings() (20260810000062)
-- introduced: it cancelled ANY pending booking past 10 minutes, with no
-- regard for whether a PayMongo payment was genuinely still in flight.
-- PAYMONGO_PAYMENT_IN_FLIGHT_WINDOW_MINUTES's own comment already flags
-- 10 as "a reasonable guess, not a measured figure" — QR Ph completion
-- can genuinely take longer. If the webhook later arrives reporting a
-- real payment, confirm_paymongo_booking_payment() requires
-- status = 'pending' and matches zero rows: the customer has paid, the
-- booking is cancelled, and QR Ph cannot be refunded through PayMongo's
-- API at all (see refunds.ts). Recovery is a manual bank transfer.
--
-- Split by risk instead of just widening the window, because widening
-- alone narrows the race without closing it — a customer who takes
-- longer than whatever number is chosen still hits the same bug:
--
--   * No PayMongo session at all (credit-only, or checkout creation
--     never completed) — nothing external to check, still genuinely safe
--     to cancel on elapsed time alone. expire_stale_pending_bookings()
--     is narrowed to exactly this case; its 10-minute cadence is
--     unchanged, since there is no live payment it could ever cut off.
--   * A real PayMongo session exists — now handled by asking PayMongo
--     directly before cancelling anything, via the app layer
--     (retrievePayMongoCheckoutSession() in lib/services/paymongo.ts is
--     the one place this codebase calls PayMongo; a SQL function calling
--     it directly would duplicate that and the secret it needs). This
--     migration adds the trigger side only — a pg_cron job posting to a
--     new app route — same pg_net + vault pattern as
--     20260810000058_notification_email_webhook.sql.
create or replace function public.expire_stale_pending_bookings(p_older_than_minutes integer)
returns setof uuid
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_older_than_minutes <= 0 then
    raise exception 'p_older_than_minutes must be positive.' using errcode = 'check_violation';
  end if;

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);

  return query
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = null
  where status = 'pending'
    and created_at < now() - (p_older_than_minutes || ' minutes')::interval
    and paymongo_checkout_session_id is null
  returning id;
end;
$$;

-- Cancels exactly one booking, by id, after the app layer has already
-- confirmed — against PayMongo's own API — that no non-failed payment
-- attempt exists for it. Same bypass idiom and guarantees as
-- expire_stale_pending_bookings() above, scoped to a single row because
-- the eligibility decision now depends on an external API call this
-- function cannot make itself. status = 'pending' in the WHERE clause
-- keeps it idempotent and harmless if called twice for the same booking.
create or replace function public.expire_specific_pending_booking(p_booking_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  perform set_config('air_rally.bypass_booking_tampering', 'true', true);

  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = null
  where id = p_booking_id
    and status = 'pending'
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

revoke all on function public.expire_specific_pending_booking(uuid) from public, anon, authenticated;
grant execute on function public.expire_specific_pending_booking(uuid) to service_role;

-- Posts to /api/cron/expire-stale-paymongo-bookings every 5 minutes, same
-- cadence as the no-session sweep. Secret created out-of-band via
-- vault.create_secret(), named 'expire_paymongo_bookings_webhook_secret'
-- — never committed here, same reasoning as 20260810000058. A missing
-- secret is a silent no-op (matches notify_email_on_notification_insert's
-- own posture): a not-yet-configured deployment must never turn into a
-- 500 or a retry storm, it just means this sweep doesn't run yet.
create or replace function public.trigger_expire_stale_paymongo_bookings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'expire_paymongo_bookings_webhook_secret'
  limit 1;

  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := 'https://air-rally.com/api/cron/expire-stale-paymongo-bookings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 20000
  );
end;
$$;

select cron.schedule(
  'expire-stale-paymongo-bookings',
  '*/5 * * * *',
  $$select public.trigger_expire_stale_paymongo_bookings()$$
);
