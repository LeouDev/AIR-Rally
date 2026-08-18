-- Nothing ever expired a `pending` booking on its own. The exclusion
-- constraint (20260810000004_bookings.sql) holds a court/time slot for as
-- long as a booking stays 'pending' — permanently, if the customer
-- abandons checkout before PayMongo's webhook (or confirm_credit_only_
-- booking()) ever fires. The only cleanup that existed was inside
-- createCheckoutSessionAction, and only when creating the PayMongo
-- session itself throws — never for "the customer just closed the tab."
-- 20260810000037's own comment already assumed a sweep like this existed
-- ("any future expiry sweep cancels the pending row and the credits come
-- back automatically"); this is that sweep.
--
-- Reuses the ordinary cancellation path (status -> 'cancelled') rather
-- than a new status, deliberately: adding an enum value to bookings.status
-- means touching every consumer of it across the app, and nothing here
-- needs that. restore_credit_on_booking_cancel() already refunds
-- credit_amount_applied on any transition into 'cancelled',
-- reverse_booking_settlement() is a safe no-op (a pending booking never
-- had a settlement row to reverse), and notify_on_booking_change() already
-- tells the customer their booking was cancelled — exactly the right
-- message for an abandoned checkout too.
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

  -- Same idiom confirm_paymongo_booking_payment()/apply_credit_to_booking()
  -- use: the bypass flag lets this function's own UPDATE through
  -- prevent_booking_tampering() while every client-initiated path stays
  -- blocked exactly as before.
  perform set_config('air_rally.bypass_booking_tampering', 'true', true);

  return query
  update public.bookings
  set status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = null
  where status = 'pending'
    and created_at < now() - (p_older_than_minutes || ' minutes')::interval
  returning id;
end;
$$;

revoke all on function public.expire_stale_pending_bookings(integer) from public, anon, authenticated;
grant execute on function public.expire_stale_pending_bookings(integer) to service_role;

-- Runs entirely inside Postgres — no Vercel Cron dependency (whose
-- frequency limits vary by plan tier), no new HTTP surface, no new
-- shared secret. Matches this schema's existing posture of putting the
-- actual guarantee in the database itself, not in application code that
-- has to remember to call it.
create extension if not exists pg_cron;

-- Every 5 minutes, expiring anything older than 10 minutes — matching
-- PAYMONGO_PAYMENT_IN_FLIGHT_WINDOW_MINUTES in lib/booking-config.ts, the
-- same threshold reconcilePaymongoPendingBooking() already uses to decide
-- a payment is no longer "in flight". Kept in sync by convention: a SQL
-- migration can't import a TypeScript constant. cron.schedule() upserts
-- by job name, so re-running this migration updates the existing job
-- rather than creating a duplicate.
select cron.schedule(
  'expire-stale-pending-bookings',
  '*/5 * * * *',
  $$select public.expire_stale_pending_bookings(10)$$
);
