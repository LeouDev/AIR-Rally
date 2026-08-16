-- PayMongo becomes the platform's only payment provider.
--
-- The Stripe client, its webhook route, and every Stripe branch in
-- checkout / reschedules / refunds were removed from the application in
-- the same change. What stays here is deliberate:
--
--   * `payment_provider` keeps its CHECK accepting both values. No row
--     has ever been written with 'stripe' (the table was empty at the
--     time of this change), but keeping the value legal means a
--     historical row from another environment would still read rather
--     than violate a constraint on SELECT-then-UPDATE paths.
--
--   * The stripe_checkout_session_id / stripe_payment_intent_id columns
--     stay. They are empty and unwritten. Dropping them would ripple
--     through the booking, refund, reschedule, earnings and admin
--     services for no functional gain, and would foreclose reading any
--     historical row.
--
-- Only the default changes, so a booking created without an explicit
-- provider is a PayMongo booking.

alter table public.bookings alter column payment_provider set default 'paymongo';

comment on column public.bookings.payment_provider is
  'Always ''paymongo'' for rows created after 20260810000035. ''stripe'' remains legal only so historical rows stay readable; nothing writes it.';

comment on column public.bookings.stripe_checkout_session_id is
  'Dormant. Stripe was removed as a provider in 20260810000035 — retained so any historical row remains readable.';

comment on column public.bookings.stripe_payment_intent_id is
  'Dormant. Stripe was removed as a provider in 20260810000035 — retained so any historical row remains readable.';
