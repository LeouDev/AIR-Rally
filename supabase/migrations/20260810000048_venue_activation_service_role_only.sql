-- Closes a venue self-activation hole, found by the same sweep that found
-- the payment bypass in 20260810000047 and fixed the same way.
--
-- THE HOLE
--
-- sync_venue_paymongo_activation(p_paymongo_account_id, p_activation_status,
-- p_declined_reason) is SECURITY DEFINER with EXECUTE granted to anon and
-- authenticated. Its body validates only that the status is one of three
-- allowed strings, and then:
--
--   perform set_config('air_rally.bypass_venue_paymongo_sync', 'true', true);
--   update public.venues
--      set paymongo_activation_status = p_activation_status, ...
--    where paymongo_account_id = p_paymongo_account_id;
--
-- The bypass GUC it raises exists precisely to stop owners writing these
-- columns, so calling the RPC defeats that guard rather than tripping it.
-- There is no auth.uid() check and no ownership check. The only thing
-- identifying the venue is paymongo_account_id — which the owner supplies
-- during onboarding and can read straight off their own venue row.
--
-- So a venue owner could mark their own venue 'activated' without PayMongo
-- approving anything, which is exactly what Phase 10 said must be
-- impossible ("venue owners cannot mark themselves verified or change
-- payout status; never trust UI restrictions").
--
-- Verified exploitable on staging by
-- scripts/verify-staging-paymongo-activation-authz.ts: the direct column
-- write was correctly rejected, and the same change through this RPC
-- succeeded.
--
-- THE FIX
--
-- The legitimate caller is the PayMongo webhook, and its authority is the
-- verified webhook signature — not expressible in SQL. So the boundary is
-- which code is calling: service_role only, matching 20260810000047 and
-- the credit RPCs. The webhook route moves to createServiceRoleClient()
-- in the same commit.
--
-- The body is deliberately unchanged, keeping this reviewable as purely a
-- permission change.

revoke execute on function public.sync_venue_paymongo_activation(text, text, text) from public;
revoke execute on function public.sync_venue_paymongo_activation(text, text, text) from anon;
revoke execute on function public.sync_venue_paymongo_activation(text, text, text) from authenticated;
grant execute on function public.sync_venue_paymongo_activation(text, text, text) to service_role;

comment on function public.sync_venue_paymongo_activation(text, text, text) is
  'Applies a PayMongo merchant-activation result to a venue. service_role ONLY — '
  'it raises the bypass GUC that otherwise stops owners writing these columns, so '
  'a browser session calling it could self-activate a venue without PayMongo. '
  'The caller''s authority is the verified webhook signature; see migration '
  '20260810000048.';
