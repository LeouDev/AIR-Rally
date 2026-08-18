-- mark_settlements_payable() (20260810000039_settlement_ledger.sql) was
-- written for exactly this — its own comment already says "a sweep meant
-- to be called on a schedule" and "safe to run every minute" — but nothing
-- in src/ ever calls it, and it's granted service_role-only (20260810000040),
-- so no admin action could either. settlement_status therefore can only
-- ever sit at 'pending': add_settlement_to_payout_batch() refuses anything
-- that isn't 'payable', so the entire payout_batches pipeline has been
-- unreachable since the day it shipped, regardless of how many bookings
-- actually complete.
--
-- Same fix shape as 20260810000062_expire_stale_pending_bookings.sql:
-- pg_cron, running entirely inside Postgres, no new HTTP surface. Every
-- minute rather than every 5 — this sweep only ever promotes a settlement
-- once its booking's court time has actually passed, so there's no
-- equivalent to the payment in-flight window to wait out; the sooner a
-- completed booking's settlement becomes payable, the sooner an admin's
-- payout math is accurate.
create extension if not exists pg_cron;

select cron.schedule(
  'mark-settlements-payable',
  '* * * * *',
  $$select public.mark_settlements_payable()$$
);
