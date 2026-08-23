-- Founder's read-only column-exposure survey (2026-08-23) turned up five columns
-- where an authenticated client can insert or update its OWN row, the RLS policy
-- checks ownership but not which columns are supplied, and the app never sends
-- the column itself — which is exactly why nobody had noticed. Criterion, in the
-- founder's own words: any field affecting ranking, ownership, permissions,
-- booking state, or audit history should be database-controlled, not client-
-- controlled. All five here are database-side; none needs a client change,
-- confirmed by reading every actual call site before writing this.
--
-- INSERT-ONLY vs INSERT-OR-UPDATE is deliberately NOT uniform across these five.
-- Each table's actual UPDATE policy was checked individually — post_reshares has
-- no UPDATE policy at all (INSERT and DELETE only), so an INSERT guard fully
-- closes it. posts, reviews, event_attendees and bookings all have an
-- ownership-only UPDATE policy with no column restriction, so an INSERT-only
-- guard on any of those would leave the same value editable immediately after
-- creation — closing half the door while looking closed.
--
-- NO BACKFILL of existing rows in any of these tables. We don't know which
-- existing values are honest and which were supplied by a client before this
-- landed, and fabricating a "corrected" timestamp or count would be worse than
-- leaving an honest gap — same reasoning as 078's and 080's backfill decisions.

-- =============================================================================
-- 1. bookings.status — BOOKING STATE. Silent on any of the three legal values,
--    loud (23514) on anything outside them.
-- =============================================================================
-- createBooking()'s own signature is `status: input.status ?? "confirmed"` —
-- caller-supplied, defaulting to 'confirmed' if omitted. In practice this
-- default is dead code: both real call sites (checkoutSession.ts:62,
-- reschedules.ts:371) always pass 'pending' explicitly. But dead code in the
-- client is not a database guarantee — a request built directly against
-- PostgREST, bypassing the app entirely, could insert with status='confirmed'
-- on their own row and receive a court with no payment ever having occurred.
-- bookings_no_overlap already prevents double-booking either way (076 covers
-- every non-cancelled status), so this closes payment-bypass, not overbooking.
--
-- UPDATE is already correctly guarded — prevent_booking_tampering() reverts any
-- client-attempted status change outside its one permitted transition. Only
-- INSERT was open, because no BEFORE INSERT trigger existed on this table at all.
create or replace function public.force_pending_booking_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.status := 'pending';
  return new;
end;
$$;

create trigger bookings_force_pending_on_insert
before insert on public.bookings
for each row execute function public.force_pending_booking_status();

-- =============================================================================
-- 2. post_reshares.created_at — RANKING. Silent (no CHECK bounds a timestamp).
-- =============================================================================
-- court_side_feed() orders by effective_at, which for a reshare row IS this
-- column. A future-dated reshare pins itself to the top of every viewer's feed
-- indefinitely. No UPDATE policy exists on this table, so INSERT is the whole
-- surface.
create or replace function public.force_reshare_created_at()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  new.created_at := now();
  return new;
end;
$$;

create trigger post_reshares_force_created_at
before insert on public.post_reshares
for each row execute function public.force_reshare_created_at();

-- =============================================================================
-- 3. posts.like_count / comment_count / reshare_count / created_at — RANKING
--    (created_at) and social-proof integrity (the three counts, which don't map
--    cleanly to one of the five named categories — flagged as such rather than
--    forced into one). Silent: no constraint bounds these to a plausible value.
-- =============================================================================
-- Verified live: an ordinary authenticated user's own INSERT with
-- like_count=99999 succeeds today. The three counts exist to be maintained
-- SOLELY by update_post_like_count() / update_post_comment_count() /
-- update_post_reshare_count(), which recompute from a real COUNT(*) whenever
-- a like/comment/reshare is added or removed — never by the post's own author
-- writing to posts directly. created_at drives feed ordering, same class as
-- finding 2.
--
-- posts HAS an UPDATE policy checking only auth.uid()=user_id (or is_admin()),
-- so an INSERT-only guard would be defeated by a follow-up UPDATE. This one
-- needs BEFORE INSERT OR UPDATE — and because legitimate, SECURITY DEFINER
-- triggers on post_likes/post_comments/post_reshares legitimately update these
-- same columns on this same table, the guard needs a bypass those triggers set
-- for themselves, exactly like prevent_booking_tampering's own pattern.
create or replace function public.prevent_post_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No is_admin() exemption here, deliberately: nothing about being an admin
  -- justifies fabricating a like/comment/reshare count or a post's created_at.
  -- The only legitimate bypass is the internal GUC the count-maintaining
  -- triggers set for themselves below — a real, audited mechanism, not a
  -- role-based blanket exemption.
  if coalesce(current_setting('air_rally.bypass_post_tampering', true), 'false') = 'true' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.like_count := 0;
    new.comment_count := 0;
    new.reshare_count := 0;
    new.created_at := now();
    return new;
  end if;

  -- UPDATE: the counts and created_at are never legitimately touched by the
  -- post's own author — revert any client-attempted change.
  if new.like_count is distinct from old.like_count then
    new.like_count := old.like_count;
  end if;
  if new.comment_count is distinct from old.comment_count then
    new.comment_count := old.comment_count;
  end if;
  if new.reshare_count is distinct from old.reshare_count then
    new.reshare_count := old.reshare_count;
  end if;
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger posts_prevent_tampering
before insert or update on public.posts
for each row execute function public.prevent_post_tampering();

-- The three count-maintaining functions now need to identify themselves to the
-- guard above, the same way expire_stale_pending_bookings() and
-- complete_reschedule() already identify themselves to
-- prevent_booking_tampering(). Re-declared here with one added line each;
-- everything else is unchanged from 20260810000027 / 20260810000032.
create or replace function public.update_post_like_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  perform set_config('air_rally.bypass_post_tampering', 'true', true);
  update public.posts
  set like_count = (select count(*) from public.post_likes where post_id = target_post_id)
  where id = target_post_id;
  -- Reset immediately rather than leaving the bypass live for whatever else
  -- happens to run later in the same transaction. A single PostgREST request
  -- is one transaction ending right after this trigger fires, so in practice
  -- nothing else would see it lingering — but resetting explicitly removes
  -- the question entirely rather than relying on that being true forever.
  perform set_config('air_rally.bypass_post_tampering', 'false', true);
  return coalesce(new, old);
end;
$$;

create or replace function public.update_post_comment_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  perform set_config('air_rally.bypass_post_tampering', 'true', true);
  update public.posts
  set comment_count = (select count(*) from public.post_comments where post_id = target_post_id)
  where id = target_post_id;
  -- Reset immediately rather than leaving the bypass live for whatever else
  -- happens to run later in the same transaction. A single PostgREST request
  -- is one transaction ending right after this trigger fires, so in practice
  -- nothing else would see it lingering — but resetting explicitly removes
  -- the question entirely rather than relying on that being true forever.
  perform set_config('air_rally.bypass_post_tampering', 'false', true);
  return coalesce(new, old);
end;
$$;

create or replace function public.update_post_reshare_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_post_id uuid := coalesce(new.post_id, old.post_id);
begin
  perform set_config('air_rally.bypass_post_tampering', 'true', true);
  update public.posts
  set reshare_count = (select count(*) from public.post_reshares where post_id = target_post_id)
  where id = target_post_id;
  -- Reset immediately rather than leaving the bypass live for whatever else
  -- happens to run later in the same transaction. A single PostgREST request
  -- is one transaction ending right after this trigger fires, so in practice
  -- nothing else would see it lingering — but resetting explicitly removes
  -- the question entirely rather than relying on that being true forever.
  perform set_config('air_rally.bypass_post_tampering', 'false', true);
  return coalesce(new, old);
end;
$$;

-- =============================================================================
-- 4. reviews.created_at — RANKING, and the highest-stakes of the three ordering
--    siblings: a venue's review list is a trust signal a prospective customer
--    reads before booking, not a feed a user idly scrolls. Silent.
-- =============================================================================
-- reviews HAS an UPDATE policy (auth.uid()=user_id OR is_admin()), same
-- ownership-only shape as posts, no column restriction — needs INSERT OR
-- UPDATE. No legitimate trigger touches reviews.created_at, so no bypass beyond
-- is_admin() is required.
create or replace function public.prevent_review_created_at_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No is_admin() exemption, deliberately: there is no legitimate admin need
  -- to backdate a review, and this morning's finding was exactly an admin
  -- exemption skipping something it was never meant to touch. Not repeating
  -- that shape here without a reason for it.
  if tg_op = 'INSERT' then
    new.created_at := now();
    return new;
  end if;
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger reviews_prevent_created_at_tampering
before insert or update on public.reviews
for each row execute function public.prevent_review_created_at_tampering();

-- =============================================================================
-- 5. event_attendees.created_at — AUDIT HISTORY, with a direct, verified
--    consequence: promote_event_waitlist() (20260810000029) orders candidates
--    by `created_at asc`. A backdated RSVP guarantees first position in every
--    future promotion on every event, permanently and invisibly — nobody
--    ever sees this timestamp, so the victim experiences it as bad luck, not
--    as the queue having been rigged. Silent, and the only one of the five
--    with a direct fairness impact on another real person rather than vanity
--    or social proof.
-- =============================================================================
-- Verified live: an authenticated user's own INSERT with
-- created_at='2000-01-01' succeeds today. event_attendees HAS an ownership-only
-- UPDATE policy ("Users can update their own RSVP"), same shape as posts and
-- reviews — needs INSERT OR UPDATE. Neither promote_event_waitlist() nor
-- enforce_event_join_approval() ever sets created_at themselves, so no bypass
-- beyond is_admin() is required.
create or replace function public.prevent_event_attendee_created_at_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- No is_admin() exemption, same reasoning as reviews above.
  if tg_op = 'INSERT' then
    new.created_at := now();
    return new;
  end if;
  if new.created_at is distinct from old.created_at then
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger event_attendees_prevent_created_at_tampering
before insert or update on public.event_attendees
for each row execute function public.prevent_event_attendee_created_at_tampering();
