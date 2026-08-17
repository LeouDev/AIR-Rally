-- Closes a payment-bypass hole: an authenticated user could confirm their
-- own (or anyone's) booking as paid without paying.
--
-- THE HOLE
--
-- confirm_paymongo_booking_payment() is SECURITY DEFINER, so it bypasses
-- RLS by design, and its body carries no authorization check at all. It
-- validates only that its arguments match the booking row:
--
--     status = 'pending'
--     payment_provider = 'paymongo'
--     paymongo_checkout_session_id = p_paymongo_checkout_session_id
--     price_amount - credit_amount_applied = p_expected_amount
--     currency = p_expected_currency
--
-- Every one of those values is legitimately readable by the booking's own
-- owner: the checkout session id is written onto the pending booking at
-- checkout-creation time (attachPaymongoCheckoutSession), and price,
-- credit and currency are columns the owner selects to render their own
-- booking. The payment_intent id is not checked against anything, so any
-- string is accepted. Nothing in the function asks PayMongo whether money
-- actually arrived.
--
-- EXECUTE was granted to `authenticated` and `anon` (the implicit PUBLIC
-- grant every function gets), so this was reachable straight from a
-- browser session. Verified exploitable on staging by
-- scripts/verify-staging-payment-confirmation-authz.ts: a pending booking
-- went to 'confirmed', with a forged payment_intent id and no payment.
--
-- This is the same shape as the reconcile_settlements leak fixed in
-- 20260810000040 — a SECURITY DEFINER function whose only real protection
-- was the application code that normally calls it.
--
-- THE FIX
--
-- The payment check that matters lives outside the database: the webhook
-- verifies PayMongo's signature, and reconcilePaymongoPendingBooking()
-- retrieves the session from PayMongo and requires a payment with status
-- 'paid'. Neither of those can be expressed in SQL, so the boundary has to
-- be *which code* is calling — exactly the case the service-role-only
-- pattern exists for (issue_credit, spend_credit, apply_credit_to_booking,
-- confirm_credit_only_booking, mark_settlements_payable).
--
-- So: revoke EXECUTE from anon/authenticated, grant to service_role only.
-- The two callers (the webhook route and the confirmation page) move to
-- createServiceRoleClient() in the same commit.
--
-- The function bodies are deliberately NOT changed. Their argument
-- matching is still worth having as a second line of defence, and leaving
-- the bodies alone keeps this migration reviewable as purely a permission
-- change.

-- PayMongo — the live path.
revoke execute on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) from public;
revoke execute on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) from anon;
revoke execute on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) from authenticated;
grant execute on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) to service_role;

-- Stripe — dead since 20260810000035 made PayMongo the only provider, and
-- no booking row carries payment_provider = 'stripe'. Locked down anyway:
-- an unreachable-in-practice function that still confirms payments is not
-- something to leave granted to every browser session.
revoke execute on function public.confirm_booking_payment(uuid, text, text, integer, text) from public;
revoke execute on function public.confirm_booking_payment(uuid, text, text, integer, text) from anon;
revoke execute on function public.confirm_booking_payment(uuid, text, text, integer, text) from authenticated;
grant execute on function public.confirm_booking_payment(uuid, text, text, integer, text) to service_role;

comment on function public.confirm_paymongo_booking_payment(uuid, text, text, integer, text) is
  'Marks a pending PayMongo booking as paid. service_role ONLY — the caller is '
  'responsible for having verified the payment with PayMongo first (webhook '
  'signature, or a retrieved session with a paid payment). Callable from a '
  'browser session this would be a free-booking exploit; see migration '
  '20260810000047.';
