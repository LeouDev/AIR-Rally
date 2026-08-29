-- ============================================================================
-- Lets a calibrated player who taps "Find match" with no bookable court
-- get a confirmation dialog once ("this won't count, play anyway?"), then
-- only a quiet on-screen line after that — founder-approved. The
-- acknowledgement has to persist per PLAYER, not per device: AsyncStorage
-- was rejected because a reinstall or a second device would re-show a
-- decision the player already made.
--
-- No preferences/settings table exists in this schema (checked: no
-- user_preferences/user_settings, live or in any migration) — the
-- established pattern for a single per-player fact is an ad-hoc column on
-- profiles (referral_code, deleted_at, email_notifications_enabled,
-- is_internal). This is a fourth. If a fifth or sixth of these shows up,
-- that's the signal a real preferences table is overdue — not this one.
--
-- A nullable timestamptz, not a boolean: null means "never acknowledged",
-- a value means "acknowledged, and when" — free information a flag
-- can't carry, and occasionally useful (e.g. "did they acknowledge before
-- or after we changed the copy").
--
-- Named for the fact, not the dialog: what's recorded is "this player has
-- acknowledged that a match without a bookable court won't count toward
-- calibration" — not "saw the Find-match dialog". The dialog's wording or
-- trigger can change; this is still true or not.
--
-- ⚠️ THIS WHOLE STATE IS TEMPORARY BY DESIGN, NOT DORMANT BY NEGLECT.
-- The dialog (and the quiet line that follows it) only ever appears for a
-- CALIBRATED player when NO bookable court exists. The moment a bookable
-- court exists for them, the condition stops applying and both the
-- dialog and the line disappear on their own — nothing here needs to be
-- revisited when that happens. Whoever finds this column unused later
-- (calibrated players with a bookable court never touch it) should read
-- that as the feature correctly not firing, not as dead code. Migration
-- 20260810000095's stale comment cost a whole evening for exactly the
-- inverse mistake — believing something was current when it wasn't; this
-- note exists so nobody makes the opposite one here.
-- ============================================================================

alter table public.profiles
  add column if not exists unbooked_play_ack_at timestamptz;

comment on column public.profiles.unbooked_play_ack_at is
  'When this player acknowledged that a ranked match played without a '
  'bookable court will not count toward calibration. Null = never '
  'acknowledged. Set once, on first tap of "play anyway" in the '
  'confirmation dialog; read on every subsequent Find-match tap to decide '
  'dialog vs. quiet line. Only meaningful for a calibrated player with no '
  'bookable court right now — see this migration''s header for why an '
  'unused value here is dormant, not dead.';
