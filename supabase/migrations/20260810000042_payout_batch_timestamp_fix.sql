-- Fixes payout_batch_approval_timestamped, which made cancelling an
-- already-approved batch impossible.
--
-- THE BUG (found by scripts/verify-staging-payout-readiness.ts):
-- 20260810000041 wrote the constraint as a biconditional —
--
--   (status in ('approved','processing','completed')) = (approved_at is not null)
--
-- which asserts BOTH "approved implies a timestamp" AND "a timestamp
-- implies still approved". The second half is wrong. Cancelling an
-- approved batch is a legitimate and expected action, and it leaves
-- status='cancelled' with approved_at still set — which the constraint
-- then rejected, making an approved batch impossible to cancel.
--
-- Losing that history to satisfy the constraint would be worse than the
-- bug: "this batch WAS approved, by this admin, at this time, and was then
-- cancelled" is exactly the audit trail a financial control layer exists
-- to keep. So the fix keeps the timestamp and weakens the constraint to
-- the implication that was actually intended.
--
-- Same treatment for completed_at, for the same reason and so the two
-- read consistently.

alter table public.payout_batches drop constraint payout_batch_approval_timestamped;
alter table public.payout_batches drop constraint payout_batch_completion_timestamped;

-- "Reaching approval or beyond requires a timestamp" — but a timestamp
-- does not pin the batch to those states forever.
alter table public.payout_batches add constraint payout_batch_approval_timestamped
  check (status not in ('approved', 'processing', 'completed') or approved_at is not null);

alter table public.payout_batches add constraint payout_batch_completion_timestamped
  check (status <> 'completed' or completed_at is not null);
