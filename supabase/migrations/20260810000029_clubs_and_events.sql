-- Phase 7.8a: Clubs & Events foundation. Turns the marketplace's one-off
-- booking loop into a recurring community loop.
--
-- Two things this migration deliberately does NOT do:
--   1. It does not create an `events` table — one already exists from
--      Phase 7.1 (20260810000027_court_side.sql) as a simple free RSVP.
--      This ALTERs it into the richer Open Play shape rather than
--      standing up a parallel table.
--   2. It does not give a participant their own `bookings` row. The
--      bookings_no_overlap exclusion constraint (20260810000004) allows
--      exactly one active booking per court per overlapping range, so 32
--      players joining one Open Play cannot each hold a booking. An event
--      holds ONE court reservation, referenced by events.booking_id, and
--      that booking is created by the organizer through the ordinary
--      booking flow — nobody gets privileged court access.

-- === Clubs ===============================================================

create table public.clubs (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles (id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text,
  image_url text,
  location text,
  skill_level text not null default 'mixed'
    check (skill_level in ('beginner', 'intermediate', 'advanced', 'mixed')),
  club_type text not null default 'social'
    check (club_type in ('social', 'competitive', 'training', 'casual')),
  visibility text not null default 'public'
    check (visibility in ('public', 'approval_required', 'private')),
  -- Admin moderation ships in 7.8b, but the column lands now for the same
  -- reason bookings.status carried an unused 'pending' from day one: free
  -- to include here, a migration against live rows to add later.
  status text not null default 'active' check (status in ('active', 'suspended')),
  -- Denormalized, trigger-maintained by recompute-from-source — same
  -- convention as posts.like_count via update_post_like_count().
  member_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index clubs_owner_id_idx on public.clubs (owner_id);
create index clubs_visibility_idx on public.clubs (visibility);

create trigger clubs_set_updated_at
before update on public.clubs
for each row execute function public.set_updated_at();

-- One row per (club, member) — the composite primary key is both the
-- dedup guarantee and the membership-lookup index, same idiom as
-- favorites / post_likes / event_attendees.
create table public.club_members (
  club_id uuid not null references public.clubs (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('owner', 'admin', 'member')),
  status text not null default 'active' check (status in ('active', 'pending', 'blocked')),
  created_at timestamptz not null default now(),
  primary key (club_id, user_id)
);

create index club_members_user_id_idx on public.club_members (user_id);

-- Resolves the caller's role in a club, bypassing RLS.
--
-- This exists to break an RLS recursion cycle, not as a convenience: a
-- `clubs` policy that reads club_members while a `club_members` policy
-- reads clubs recurses infinitely. SECURITY DEFINER short-circuits that,
-- exactly as is_admin() (20260809000001_profiles.sql) already does for
-- the profiles/admin cycle. Returns null for a non-member.
create or replace function public.club_role_of(p_club_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select role
  from public.club_members
  where club_id = p_club_id and user_id = auth.uid() and status = 'active';
$$;

alter table public.clubs enable row level security;

-- Public and approval-required clubs are discoverable by anyone (you have
-- to see a club to ask to join it). Private clubs are visible only to
-- their own active members.
create policy "Clubs are readable unless private"
on public.clubs for select
using (visibility <> 'private' or public.club_role_of(id) is not null or public.is_admin());

-- No role check whatsoever: a plain `player` can create a club. Club
-- ownership is intentionally decoupled from venue ownership — it grants
-- no court, availability, or payout access anywhere in this schema.
create policy "Any signed-in user can create a club they own"
on public.clubs for insert
with check (auth.uid() = owner_id);

create policy "Club owners and club admins can update their club"
on public.clubs for update
using (auth.uid() = owner_id or public.club_role_of(id) = 'admin' or public.is_admin())
with check (auth.uid() = owner_id or public.club_role_of(id) = 'admin' or public.is_admin());

create policy "Club owners can delete their club, admins moderate any"
on public.clubs for delete
using (auth.uid() = owner_id or public.is_admin());

alter table public.club_members enable row level security;

-- The `user_id = auth.uid()` clause matters: it lets someone with a
-- still-pending request see their own row in a club they can't otherwise
-- read into.
create policy "Members can read their club's roster"
on public.club_members for select
using (public.club_role_of(club_id) is not null or user_id = auth.uid() or public.is_admin());

-- Self-join only — you can never insert someone else into a club. The
-- resulting role/status is forced by enforce_club_member_insert() below,
-- so this policy does not have to police them.
create policy "Users can request to join as themselves"
on public.club_members for insert
with check (auth.uid() = user_id);

create policy "Club owners and admins manage membership"
on public.club_members for update
using (public.club_role_of(club_id) in ('owner', 'admin') or public.is_admin())
with check (public.club_role_of(club_id) in ('owner', 'admin') or public.is_admin());

create policy "Members can leave, owners and admins can remove"
on public.club_members for delete
using (
  user_id = auth.uid()
  or public.club_role_of(club_id) in ('owner', 'admin')
  or public.is_admin()
);

-- Forces role and status on the way in, so a joiner can never self-approve
-- into an approval_required club or self-appoint as owner/admin. Same
-- posture as prevent_owner_status_escalation() (20260810000020): the
-- policy decides *whether* you may write, the trigger decides *what* the
-- written row is allowed to say.
create or replace function public.enforce_club_member_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_visibility text;
  v_owner_id uuid;
begin
  select visibility, owner_id into v_visibility, v_owner_id
  from public.clubs
  where id = new.club_id;

  -- The club's own owner row is seeded by create_club_owner_membership()
  -- below; let it through untouched.
  if new.user_id = v_owner_id then
    return new;
  end if;

  new.role := 'member';

  if v_visibility = 'public' then
    new.status := 'active';
  elsif v_visibility = 'approval_required' then
    new.status := 'pending';
  else
    -- Private clubs are invite-only: an owner/admin adds you by updating
    -- an existing row, never by open self-insert.
    raise exception 'This club is invite only.' using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger club_members_enforce_insert
before insert on public.club_members
for each row execute function public.enforce_club_member_insert();

-- Only the club's actual owner may hand out 'admin'. Without this a club
-- admin could promote themselves through the update policy above, which
-- grants admins write access to the roster.
create or replace function public.enforce_club_member_update()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.clubs where id = new.club_id;

  if new.role is distinct from old.role
     and auth.uid() is distinct from v_owner_id
     and not public.is_admin() then
    new.role := old.role;
  end if;

  return new;
end;
$$;

create trigger club_members_enforce_update
before update on public.club_members
for each row execute function public.enforce_club_member_update();

-- Guarantees a club always has its owner on the roster — ownership can
-- never be inconsistent between clubs.owner_id and club_members.
create or replace function public.create_club_owner_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.club_members (club_id, user_id, role, status)
  values (new.id, new.owner_id, 'owner', 'active');
  return new;
end;
$$;

create trigger clubs_create_owner_membership
after insert on public.clubs
for each row execute function public.create_club_owner_membership();

create or replace function public.update_club_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid := coalesce(new.club_id, old.club_id);
begin
  update public.clubs
  set member_count = (
    select count(*) from public.club_members
    where club_id = target_club_id and status = 'active'
  )
  where id = target_club_id;
  return coalesce(new, old);
end;
$$;

create trigger club_members_update_count
after insert or update or delete on public.club_members
for each row execute function public.update_club_member_count();

-- === Events (ALTER — the table already exists from Phase 7.1) ============

-- event_at becomes start_time now that events carry a real duration.
alter table public.events rename column event_at to start_time;

alter table public.events
  add column end_time timestamptz,
  add column club_id uuid references public.clubs (id) on delete set null,
  add column court_id uuid references public.courts (id) on delete set null,
  -- The single court reservation backing this event. Null for an event
  -- with no court held (a social meetup).
  add column booking_id uuid references public.bookings (id) on delete set null,
  add column event_type text not null default 'open_play'
    check (event_type in ('open_play', 'club_meetup', 'training', 'tournament')),
  add column skill_level text
    check (skill_level is null or skill_level in ('beginner', 'intermediate', 'advanced', 'mixed')),
  -- Null means unlimited.
  add column max_players integer check (max_players is null or max_players > 0),
  -- Integer minor units, same convention as bookings.price_amount. In
  -- 7.8a this is DISPLAY ONLY — collected by the organizer at the venue,
  -- never charged online. Online per-seat payment is Phase 7.9, and needs
  -- the payment layer generalized beyond its current Booking shape first.
  add column price_amount integer not null default 0 check (price_amount >= 0),
  add column currency text not null default 'PHP' check (char_length(currency) = 3),
  add column status text not null default 'published'
    check (status in ('draft', 'published', 'cancelled', 'completed')),
  add column participant_count integer not null default 0,
  add column updated_at timestamptz not null default now(),
  add constraint events_end_after_start check (end_time is null or end_time > start_time);

create index events_club_id_idx on public.events (club_id);
create index events_court_id_idx on public.events (court_id);
create index events_status_idx on public.events (status);

create trigger events_set_updated_at
before update on public.events
for each row execute function public.set_updated_at();

-- Replaces Phase 7.1's unconditional insert policy. An event may only
-- hold a court if a real, active booking owned by the event's creator
-- backs it. This single rule covers both creation paths the brief
-- describes — a venue owner hosting on their own court and a club owner
-- renting someone else's both satisfy it by holding a booking — so no new
-- ownership surface is introduced and nobody gets free court time.
drop policy "Users can create events as themselves" on public.events;

create policy "Users create their own events, court-backed by their own booking"
on public.events for insert
with check (
  auth.uid() = creator_id
  and (
    court_id is null
    or exists (
      select 1 from public.bookings b
      where b.id = booking_id
        and b.user_id = auth.uid()
        and b.court_id = events.court_id
        and b.status in ('pending', 'confirmed')
    )
  )
);

-- participant_count is trigger-maintained; a client must never set it.
-- ("Users cannot change attendance counts manually.")
create or replace function public.prevent_event_count_tampering()
returns trigger
language plpgsql
as $$
begin
  if new.participant_count is distinct from old.participant_count then
    new.participant_count := old.participant_count;
  end if;
  return new;
end;
$$;

create trigger events_prevent_count_tampering
before update on public.events
for each row execute function public.prevent_event_count_tampering();

-- === Event attendance (ALTER) ===========================================

-- Joining/leaving becomes a status transition rather than insert/delete,
-- which is what a waitlist requires — a waitlisted row has to persist and
-- keep its queue position.
alter table public.event_attendees
  add column status text not null default 'joined'
    check (status in ('joined', 'waitlisted', 'cancelled'));

create index event_attendees_event_status_idx on public.event_attendees (event_id, status);

-- Users flip their own RSVP between joined/cancelled; the trigger below
-- decides whether a join actually lands a seat or the waitlist.
create policy "Users can update their own RSVP"
on public.event_attendees for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

-- Assigns a seat or the waitlist. The `for update` row lock on the event
-- is load-bearing, not decorative: without serializing per event, two
-- simultaneous joins can both read the same free-seat count and both be
-- admitted, overfilling the event.
create or replace function public.enforce_event_capacity()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max integer;
  v_joined integer;
begin
  if new.status <> 'joined' then
    return new;
  end if;

  -- An already-seated participant staying seated needs no re-check.
  if tg_op = 'UPDATE' and old.status = 'joined' then
    return new;
  end if;

  select max_players into v_max
  from public.events
  where id = new.event_id
  for update;

  if v_max is null then
    return new;
  end if;

  select count(*) into v_joined
  from public.event_attendees
  where event_id = new.event_id
    and status = 'joined'
    and user_id <> new.user_id;

  if v_joined >= v_max then
    new.status := 'waitlisted';
  end if;

  return new;
end;
$$;

create trigger event_attendees_enforce_capacity
before insert or update on public.event_attendees
for each row execute function public.enforce_event_capacity();

-- Frees seat → promotes the longest-waiting person. The promoting UPDATE
-- re-enters enforce_event_capacity() (old.status = 'waitlisted', so it
-- checks capacity, which a seat just freed) but cannot re-enter this
-- function, since a waitlisted→joined transition doesn't match the
-- seat-vacated condition below.
create or replace function public.promote_event_waitlist()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event_id uuid := coalesce(new.event_id, old.event_id);
  v_next_user uuid;
begin
  if not (
    (tg_op = 'DELETE' and old.status = 'joined')
    or (tg_op = 'UPDATE' and old.status = 'joined' and new.status <> 'joined')
  ) then
    return coalesce(new, old);
  end if;

  select user_id into v_next_user
  from public.event_attendees
  where event_id = v_event_id and status = 'waitlisted'
  order by created_at asc
  limit 1;

  if v_next_user is not null then
    update public.event_attendees
    set status = 'joined'
    where event_id = v_event_id and user_id = v_next_user;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger event_attendees_promote_waitlist
after update or delete on public.event_attendees
for each row execute function public.promote_event_waitlist();

create or replace function public.update_event_participant_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  update public.events
  set participant_count = (
    select count(*) from public.event_attendees
    where event_id = target_event_id and status = 'joined'
  )
  where id = target_event_id;
  return coalesce(new, old);
end;
$$;

create trigger event_attendees_update_count
after insert or update or delete on public.event_attendees
for each row execute function public.update_event_participant_count();

-- === Notifications ======================================================
-- Same SECURITY DEFINER shape as notify_on_booking_change()
-- (20260810000024_notifications.sql). No schema change to `notifications`
-- and no client insert policy — every row still originates in a trigger.

create or replace function public.notify_on_club_membership()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
  v_name text;
begin
  select owner_id, name into v_owner_id, v_name from public.clubs where id = new.club_id;
  if v_owner_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'pending' then
    insert into public.notifications (user_id, type, title, message)
    values (
      v_owner_id,
      'club_join_request',
      'New club join request',
      'Someone asked to join ' || v_name || '.'
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending' and new.status = 'active' then
    insert into public.notifications (user_id, type, title, message)
    values (
      new.user_id,
      'club_membership_approved',
      'Club request approved',
      'You are now a member of ' || v_name || '.'
    );
  end if;

  return new;
end;
$$;

create trigger club_members_notify
after insert or update on public.club_members
for each row execute function public.notify_on_club_membership();

create or replace function public.notify_on_event_attendance()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid;
  v_title text;
begin
  select creator_id, title into v_creator_id, v_title from public.events where id = new.event_id;
  if v_creator_id is null then
    return new;
  end if;

  if tg_op = 'INSERT' and new.status = 'joined' then
    insert into public.notifications (user_id, type, title, message)
    values (
      v_creator_id,
      'event_registration',
      'New event registration',
      'A player joined ' || v_title || '.'
    );
  elsif tg_op = 'UPDATE' and old.status = 'waitlisted' and new.status = 'joined' then
    insert into public.notifications (user_id, type, title, message)
    values (
      new.user_id,
      'waitlist_promoted',
      'A spot opened up',
      'You are off the waitlist for ' || v_title || '.'
    );
  end if;

  return new;
end;
$$;

create trigger event_attendees_notify
after insert or update on public.event_attendees
for each row execute function public.notify_on_event_attendance();

create or replace function public.notify_on_event_cancelled()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    insert into public.notifications (user_id, type, title, message)
    select ea.user_id, 'event_cancelled', 'Event cancelled', new.title || ' has been cancelled.'
    from public.event_attendees ea
    where ea.event_id = new.id and ea.status in ('joined', 'waitlisted');
  end if;

  return new;
end;
$$;

create trigger events_notify_on_cancelled
after update on public.events
for each row execute function public.notify_on_event_cancelled();
