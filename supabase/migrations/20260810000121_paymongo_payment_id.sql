-- Every PayMongo refund has always failed. `requestRefund()` calls
-- GET /v1/payments/{id} using `bookings.paymongo_payment_intent_id` —
-- but that column correctly holds a PaymentIntent id, and that endpoint
-- needs a Payment id, a different object PayMongo creates once a
-- PaymentMethod actually succeeds or fails against the intent.
-- PayMongo returns "No such Payment." every time. Proven end to end by
-- `95` tonight with a real test-mode payment, not inferred from the
-- code alone. The refund flag being off in production is the only
-- reason nobody has hit this yet — the reschedule-refund path is live
-- in shipping build 9 today.
--
-- New column, not a repurposed one: `paymongo_payment_intent_id` is
-- correctly named for what it holds. Overwriting it would leave a
-- column whose name and contents disagree, and lose the intent
-- reference entirely. `paymongo_payment_id` is the Payment id
-- `requestRefund()` actually needs.
--
-- Populated at webhook time from `paidPayment.id` — the webhook route
-- already computes `paidPayment` (the one Payment on the intent with
-- status 'paid') for its own amount check and currently discards the
-- id. No new selection logic on a money path, just persisting a value
-- already derived. That selection logic itself assumes at most one
-- Payment per intent ever reaches 'paid' — supported by PayMongo's
-- state machine (succeeded is terminal, failures loop back to
-- awaiting_payment_method for retry) but not stated outright in their
-- docs, which is why the application code alerts at critical severity
-- if that assumption is ever violated, rather than silently picking
-- one.
--
-- No backfill: production has zero bookings. Staging's 19 rows have no
-- real PayMongo payment behind any of them except one created earlier
-- tonight, which will get the real value the moment the new webhook
-- code runs a fresh checkout — not backfilled here.
--
-- This column alone does not fix the refund bug — the webhook route
-- and requestRefund() still need to write and read it, which is `95`'s
-- half, not built in this migration.
begin;

alter table public.bookings
  add column paymongo_payment_id text;

comment on column public.bookings.paymongo_payment_id is
  'The PayMongo Payment id (not PaymentIntent) — what GET /v1/payments/{id} '
  'and refund calls actually need. Populated at webhook confirmation time '
  'from the intent''s one Payment with status=paid. '
  'paymongo_payment_intent_id is a different, correctly-named column and is '
  'not this value.';

commit;
