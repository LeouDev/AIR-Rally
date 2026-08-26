-- ============================================================================
-- Keep the SHIPPED mobile client working across 085's rollout.
--
-- ⚠️ MUST BE APPLIED IN THE SAME TRANSACTION AS 085. Not before — it delegates
-- to functions 085 creates. Not after — a separate migration leaves a window,
-- however brief, in which the signatures the live app calls do not exist and
-- every ranked action fails. Apply 085 → 086 → 087 → 103 as one transaction.
--
-- WHY THIS IS NEEDED AT ALL. The mobile build Apple approved calls:
--
--   supabase.rpc('ensure_my_player_rank', { p_mode: mode })        ranked.ts:564
--   supabase.rpc('ranked_party_spread', { p_user_ids, p_mode })    ranked.ts:569
--
-- Those are 068's mode-aware signatures. 085 DROPS both and replaces them with
-- mode-less versions. Without these shims, applying 085 breaks ranked for
-- every user running the shipped client.
--
-- AND THE ROLLOUT IS NOT ATOMIC. The client ships as JS over OTA, which
-- reaches a user when they next open the app — hours or days later, or never
-- if they don't open it. So there is no moment at which "everyone is on the
-- new client". A coupled deploy cannot work; only compatibility can.
--
-- ARE THE SHIMS HONEST? Yes, and for different reasons:
--
--   ensure_my_player_rank(p_mode) — ensures a rank row exists. After 085 there
--     is ONE row per player rather than one per mode, so an old client calling
--     it for 'singles' and then 'doubles' ensures the same row twice. It is
--     idempotent either way. Ignoring the mode is correct, not a compromise.
--
--   ranked_party_spread(p_user_ids, p_mode) — previews whether a party is
--     within the spread cap. Ignoring the mode returns the unified spread,
--     which is the number create_ranked_match() ACTUALLY ENFORCES after 085.
--     So the shim makes the old client's preview MORE accurate than it is
--     today, where it previews a per-mode figure the server no longer uses.
--
-- WHEN CAN THESE BE DROPPED? Once no client sends p_mode. One client release
-- removes it; no second release is needed. But "everyone has picked up the
-- OTA" is not knowable — a user who does not open the app keeps the old bundle
-- indefinitely. There is no date after which dropping these is provably safe,
-- only a judgement. Two functions that ignore an argument cost nothing.
-- TREAT DROPPING THEM AS OPTIONAL CLEANUP NOBODY NEEDS TO SCHEDULE.
--
-- NOT SHIMMED, DELIBERATELY: create_ranked_match. The client sends five named
-- arguments; after 085+087 only the six-argument form exists, with p_rated
-- defaulting. Adding a five-argument shim would recreate the exact ambiguity
-- that broke production earlier today — PostgreSQL refuses to choose between
-- two candidates and raises 42725. PostgREST resolves a defaulted parameter
-- itself, so no shim is correct here. SEE THE NOTE AT THE END OF THIS FILE:
-- that resolution must be confirmed against the live API before applying.
-- ============================================================================

create or replace function public.ensure_my_player_rank(p_mode text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  -- p_mode is accepted and ignored. After 085 a player has one rating, not one
  -- per mode, so there is nothing for it to select. Kept in the signature only
  -- so the shipped client's call still resolves.
  perform public.ensure_my_player_rank();
end;
$$;

revoke execute on function public.ensure_my_player_rank(text) from public, anon;
grant execute on function public.ensure_my_player_rank(text) to authenticated;

comment on function public.ensure_my_player_rank(text) is
  'COMPATIBILITY SHIM for the pre-085 mobile client, which sends p_mode. '
  'Ignores the mode and delegates to ensure_my_player_rank(). Safe to drop '
  'once no client sends p_mode — see 20260810000103 for why that date is not '
  'knowable.';

create or replace function public.ranked_party_spread(p_user_ids uuid[], p_mode text)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  -- p_mode ignored: the unified spread is what create_ranked_match() enforces.
  select public.ranked_party_spread(p_user_ids);
$$;

grant execute on function public.ranked_party_spread(uuid[], text) to authenticated;

comment on function public.ranked_party_spread(uuid[], text) is
  'COMPATIBILITY SHIM for the pre-085 mobile client, which sends p_mode. '
  'Returns the unified spread — the figure the server actually enforces — so '
  'the old client''s preview is more accurate than before, not less.';

-- ---------------------------------------------------------------------------
-- ⚠️ BEFORE APPLYING THIS ANYWHERE: confirm create_ranked_match resolves.
--
-- The shipped client sends five named arguments to a function that, after
-- 085+087, has six with the last defaulted. PostgREST is expected to resolve
-- that, but this has NOT been verified against a live API — and getting it
-- wrong means ranked match creation fails for every user, which is the exact
-- failure these shims exist to prevent.
--
-- Verify by calling the REST endpoint with the five named arguments the client
-- sends, against a database that has 085+087 applied (staging does), and
-- confirming a match is created rather than a PGRST203 "could not choose the
-- best candidate function". A raw SQL test does NOT answer this — PostgREST
-- has its own argument-matching layer, and today's 42725 showed the two layers
-- can disagree.
-- ---------------------------------------------------------------------------
