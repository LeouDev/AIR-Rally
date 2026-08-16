-- Safe, non-money-moving scaffolding for the PayMongo Refund &
-- Cancellation Accounting Design Report. Purely additive: no existing
-- column is altered or dropped, no existing constraint's *meaning* is
-- narrowed (the status check only gains one more allowed value), no
-- ledger/venue_liability/double-entry table is introduced.
--
-- Does NOT enable any money movement by itself. PAYMONGO_REFUND_
-- EXECUTION_ENABLED and PAYMONGO_MARKETPLACE_SPLIT_ENABLED remain the
-- real gates, entirely unaffected by this migration. The business
-- decision (Option A/B/C/D in the design report — how a refund's total
-- is chosen) is NOT made here or anywhere in this migration; the new
-- refund_basis column exists only so that decision has somewhere safe
-- to be recorded once made, and stays null until then.

-- booking_refunds: audit-trail columns for a refund's actual PayMongo
-- split_refund response. Deliberately populated ONLY from a genuine
-- provider response (see lib/services/refunds.ts) — never computed
-- locally from AIR/Rally's own 5%/95% commission formula. This is the
-- corrected mirror of the deliberate omission documented in
-- 20260810000013_booking_refunds.sql: that omission was correct at the
-- time (refund-split behavior was unproven), and remains correct in
-- spirit — the values are still never invented, only ever recorded
-- verbatim from what PayMongo actually reports.
alter table public.booking_refunds
  add column refund_basis text check (refund_basis in ('gross_only', 'gross_plus_fee')),
  add column platform_refund_amount integer,
  add column venue_refund_amount integer,
  add column provider_available_at timestamptz;

-- Widen the existing status check to also allow 'provider_unavailable' —
-- a refund request whose payment method PayMongo does not support
-- refunding at all (confirmed for QR Ph: "Refunds are not allowed for
-- payments with source type qrph"). This state is reached WITHOUT ever
-- calling PayMongo's refund endpoint — it exists to preserve enough
-- information for an admin/manual refund workflow, never to trigger one
-- automatically. Every existing status value (pending/succeeded/failed)
-- and its existing meaning is unchanged.
alter table public.booking_refunds drop constraint booking_refunds_status_check;
alter table public.booking_refunds
  add constraint booking_refunds_status_check
  check (status in ('pending', 'provider_unavailable', 'succeeded', 'failed'));

-- DB-enforced protection against two concurrent refund requests for the
-- same booking racing past the application-level "recompute refundable
-- amount fresh" check before either has written its row. Mirrors this
-- project's own established precedent (bookings_no_overlap): the
-- database is the real guarantee, the app-layer check is UX. A second
-- concurrent insert while one is already 'pending' fails with 23505,
-- mapped by lib/services/refunds.ts to a clean "a refund is already in
-- progress" error rather than a raw database error. Does not restrict
-- 'succeeded'/'failed'/'provider_unavailable' rows — a booking may
-- accumulate any number of resolved refund attempts over time, only
-- never more than one *pending* attempt at once.
create unique index booking_refunds_one_pending_per_booking
  on public.booking_refunds (booking_id)
  where status = 'pending';

-- bookings: purely informational settlement timestamps, persisted
-- opportunistically when a real PayMongo payment retrieval happens to
-- include them (see reconcilePaymongoPendingBooking() in
-- lib/services/bookings.ts) — never required for any correctness check,
-- and never used to gate refund eligibility. PayMongo's own live
-- refund-attempt response remains the sole authority on whether a
-- refund can proceed; a populated timestamp here is not a claim that
-- settlement has actually occurred, only that PayMongo reported an
-- estimate for it. Self-service, not bypass-only or trigger-guarded —
-- same posture as paymongo_checkout_session_id, since these carry no
-- security consequence: nothing in the app currently reads them to make
-- a decision, only to display them.
alter table public.bookings
  add column paymongo_available_at timestamptz,
  add column paymongo_credited_at timestamptz;

-- RLS impact: none. Every new booking_refunds column is covered by the
-- existing admin-only insert/update policies and the existing
-- prevent_refund_tampering() trigger's default behavior (columns it
-- doesn't explicitly guard pass through unguarded for an admin, exactly
-- like every other column already added after that trigger was
-- written — the trigger's guard list already only concerns the
-- identity/amount fields set at request time, not fields populated
-- later from a provider response). Every new bookings column is
-- covered by the existing "own booking" update policy; the
-- bookings_prevent_tampering trigger does not reference these two new
-- column names, so it does not need to be touched to add them.
--
-- Idempotency impact: the new unique index is the actual new guarantee
-- described above. No existing idempotency mechanism (confirm_booking_
-- payment's conditional UPDATE, confirm_paymongo_booking_payment's
-- same pattern, getRefundableAmount's fresh recomputation) is altered.
