-- The write path for the marketplace split snapshot:
-- bookings.platform_fee_amount / venue_amount / paymongo_venue_account_id.
--
-- HOW THESE COLUMNS LOST THEIR WRITER
--
-- 20260810000009 added the three columns and guarded all three in
-- prevent_booking_tampering(). 20260810000011 deliberately REMOVED those
-- three guard clauses, arguing they were an owner-written audit snapshot
-- that nothing read back. 20260810000038 then re-declared the whole
-- function to guard credit_amount_applied, stating it reproduced "every
-- clause from 20260810000009 verbatim" — which is exactly what it did,
-- copying the three clauses 011 had removed back in. 038 never mentions
-- them, so the revert of 011 was silent, and 038 is the live definition.
--
-- Verified against staging rather than assumed (see
-- scripts/verify-staging-marketplace-split-snapshot.ts): the write
-- attachPaymongoCheckoutSession() issues returns NO error and leaves all
-- three columns NULL, both as the booking's owner AND as service_role.
-- The trigger reverts values instead of raising, and its escape hatches
-- are is_admin() or the bypass GUC — is_admin() resolves auth.uid(),
-- which is null for a service-role PostgREST call, so service_role is
-- guarded here exactly like a browser session. The unguarded columns in
-- that same UPDATE (payment_provider, paymongo_checkout_session_id) do
-- persist, which is what makes the failure invisible to the caller.
--
-- WHY THE FIX IS A WRITER, NOT A WEAKER GUARD
--
-- 011's reasoning rests on these columns being a snapshot nothing reads
-- back. That is no longer true. They are not the payout amount itself —
-- create_booking_settlement() in 20260810000039 recomputes the fee from
-- gross and payout batches pay against booking_settlements.venue_amount,
-- a different column — but they are now read by:
--
--   * deriveReconciliationFlags() in lib/services/adminPayments.ts, which
--     flags a booking when platform_fee_amount + venue_amount does not sum
--     to price_amount. Owner-writable inputs to an integrity check mean the
--     check can be silenced by the party it is meant to catch.
--   * lib/services/venueEarnings.ts, which sums venue_amount into
--     owner-facing earnings figures.
--
-- So the guard stays and the write moves behind a privileged function,
-- rather than re-removing the three clauses 011 removed.
--
-- Same shape and the same justification as
-- set_booking_processing_fee() in 20260810000055 and
-- apply_credit_to_booking() in 20260810000038: a SECURITY DEFINER
-- function that sets the bypass GUC, granted to service_role only,
-- because the authority is *which code is calling* — a server action that
-- already identified the user — not any value in the request.
--
-- This bug is currently LATENT: the writes only happen when checkout
-- computes a marketplaceSplit, which needs both
-- PAYMONGO_MARKETPLACE_SPLIT_ENABLED (off) and an activated venue
-- PayMongo account. Nothing in production has a wrong split snapshot
-- today; enabling the gate without this migration is what would produce
-- one.

create or replace function public.set_booking_marketplace_split(
  p_booking_id uuid,
  p_platform_fee_amount integer,
  p_venue_amount integer,
  p_paymongo_venue_account_id text
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if p_platform_fee_amount is null or p_platform_fee_amount < 0 then
    raise exception 'Platform fee must be a non-negative amount.' using errcode = 'check_violation';
  end if;
  if p_venue_amount is null or p_venue_amount < 0 then
    raise exception 'Venue amount must be a non-negative amount.' using errcode = 'check_violation';
  end if;
  -- The account id is the payout destination. A null or blank one would
  -- record a split whose venue share has nowhere to go, which
  -- reconciliation would surface much later as an unattributable balance.
  if p_paymongo_venue_account_id is null or btrim(p_paymongo_venue_account_id) = '' then
    raise exception 'A PayMongo venue account id is required to record a split.' using errcode = 'check_violation';
  end if;

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  update public.bookings
  set platform_fee_amount = p_platform_fee_amount,
      venue_amount = p_venue_amount,
      paymongo_venue_account_id = p_paymongo_venue_account_id
  where id = p_booking_id
    -- Only before payment. Re-attaching a checkout session on a still-
    -- pending booking is a real flow (resumeRescheduleCheckout), so this
    -- may legitimately overwrite its own earlier snapshot. Once confirmed,
    -- the split is what settlement was built from and moving it would
    -- retroactively change payout accounting.
    and status = 'pending'
    -- A split can never promise out more than the booking's gross price.
    -- Deliberately loose rather than an equality check: the reschedule
    -- path splits only the price DIFFERENCE while attaching the snapshot
    -- to the replacement booking, whose price_amount is the full new
    -- price, and the checkout path splits price_amount minus any credit
    -- applied. This bound exists so that no single wrong call can put an
    -- arbitrary figure into settlement, not to re-derive the split.
    and p_platform_fee_amount + p_venue_amount <= price_amount
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

comment on function public.set_booking_marketplace_split(uuid, integer, integer, text) is
  'Records the PayMongo marketplace split snapshot (platform_fee_amount, venue_amount, '
  'paymongo_venue_account_id) on a pending booking. service_role ONLY — these columns feed '
  'admin reconciliation (adminPayments.ts flags platform_fee + venue_amount <> price_amount) '
  'and owner-facing earnings reporting (venueEarnings.ts), so a caller able to set them freely '
  'could silence the check meant to catch them. All three are guarded by '
  'prevent_booking_tampering(), which reverts '
  'silently rather than raising, so this function exists because there is otherwise NO path '
  'that can write them — not even service_role. Returns false when the booking is not pending '
  'or the split exceeds price_amount.';

revoke all on function public.set_booking_marketplace_split(uuid, integer, integer, text) from public, anon, authenticated;
grant execute on function public.set_booking_marketplace_split(uuid, integer, integer, text) to service_role;
