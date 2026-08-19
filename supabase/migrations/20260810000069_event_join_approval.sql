-- Open Play joins now require the event's creator to approve them — for
-- every event, not only ones shared into COURT/Side. Previously a join
-- landed as 'joined' (or 'waitlisted' once full) unconditionally; this
-- adds a 'pending_approval' status that every non-creator join starts
-- at, mirroring how enforce_club_member_insert() (20260810000029) gates
-- club membership on the club's own visibility.
--
-- Existing rows are untouched: anything already 'joined'/'waitlisted'
-- was seated under the old unconditional-join rules and stays seated.

alter table public.event_attendees drop constraint event_attendees_status_check;
alter table public.event_attendees add constraint event_attendees_status_check
  check (status in ('pending_approval', 'joined', 'waitlisted', 'cancelled'));

-- Runs BEFORE enforce_event_capacity() — trigger names fire in
-- alphabetical order, and "enforce_approval" sorts before
-- "enforce_capacity" — so capacity is only ever checked once a join is
-- actually approved, never while it's pending.
create or replace function public.enforce_event_join_approval()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_creator_id uuid;
begin
  -- Guards writes landing on EITHER seated status — not just 'joined'.
  -- A write straight to 'waitlisted' still has to clear approval first;
  -- otherwise a non-creator could insert directly as 'waitlisted' (which
  -- the old guard let through untouched) and then update to 'joined',
  -- landing on the joined/waitlisted reaffirm bypass below with no
  -- approval ever having happened.
  if new.status not in ('joined', 'waitlisted') then
    return new;
  end if;

  select creator_id into v_creator_id from public.events where id = new.event_id;

  -- The organiser doesn't need to approve themselves.
  if new.user_id = v_creator_id then
    return new;
  end if;

  -- The actual approval action: the event's own creator moving someone
  -- else's pending request into a seat or the waitlist, under the new
  -- "Event creators can approve or reject join requests" policy. Keyed
  -- on auth.uid(), not new.user_id — this is the one case where the
  -- acting user and the row's own user differ. Without this bypass the
  -- approval UPDATE falls through to the pending-approval reset below
  -- and silently never seats anyone.
  if tg_op = 'UPDATE' and old.status = 'pending_approval' and auth.uid() = v_creator_id then
    return new;
  end if;

  -- An already-seated player re-affirming their status — joinEvent()'s
  -- idempotent re-insert-conflict-then-update path, or
  -- promote_event_waitlist() moving someone off the waitlist — doesn't
  -- get bounced back to pending.
  if tg_op = 'UPDATE' and old.status in ('joined', 'waitlisted') then
    return new;
  end if;

  new.status := 'pending_approval';
  return new;
end;
$$;

create trigger event_attendees_enforce_approval
before insert or update on public.event_attendees
for each row execute function public.enforce_event_join_approval();

-- Lets an event's creator act on requests for their own event — approve
-- into enforce_event_capacity()'s normal joined/waitlisted split, or
-- reject by setting the row to 'cancelled'. Same "authority figure gets
-- a broad update grant" shape as "Club owners and admins manage
-- membership" (20260810000029). Multiple permissive UPDATE policies on
-- one table are OR'd together, so this adds to — never replaces — "Users
-- can update their own RSVP".
create policy "Event creators can approve or reject join requests"
on public.event_attendees for update
using (
  exists (select 1 from public.events e where e.id = event_attendees.event_id and e.creator_id = auth.uid())
)
with check (
  exists (select 1 from public.events e where e.id = event_attendees.event_id and e.creator_id = auth.uid())
);

-- A pending request is private to the requester and the event's creator
-- (plus admins) — everyone else still sees ordinary joined/waitlisted/
-- cancelled rows exactly as before. Same posture as club_members' "Members
-- can read their club's roster" (20260810000029) for its own 'pending' rows.
drop policy "Event attendees are publicly readable" on public.event_attendees;
create policy "Event attendees are publicly readable, pending requests are private"
on public.event_attendees for select
using (
  status <> 'pending_approval'
  or user_id = auth.uid()
  or exists (select 1 from public.events e where e.id = event_attendees.event_id and e.creator_id = auth.uid())
  or public.is_admin()
);

-- notify_on_event_attendance() (20260810000029) assumed every insert
-- landed as 'joined'. Replaced to notify on the request itself and on
-- the approve/decline decision; the existing waitlist-promotion branch
-- is unchanged.
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

  if new.status = 'pending_approval' and (tg_op = 'INSERT' or old.status is distinct from 'pending_approval') then
    -- Covers a first-time join (INSERT) and a rejoin after leaving —
    -- joinEvent()'s insert-conflict-then-UPDATE path re-gates a
    -- previously 'cancelled' row back to 'pending_approval' the same as
    -- a fresh request, and the creator needs to hear about that too.
    insert into public.notifications (user_id, type, title, message)
    values (v_creator_id, 'event_join_request', 'New join request', 'Someone asked to join ' || v_title || '.');
  elsif tg_op = 'INSERT' and new.status = 'joined' and new.user_id <> v_creator_id then
    -- Only reachable for a direct 'joined' insert that isn't the
    -- organiser's own seat — nothing in this codebase does that today
    -- (every non-creator insert lands pending above); kept so a future
    -- caller with its own bypass isn't silently unnotified.
    insert into public.notifications (user_id, type, title, message)
    values (v_creator_id, 'event_registration', 'New event registration', 'A player joined ' || v_title || '.');
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' and new.status in ('joined', 'waitlisted') then
    insert into public.notifications (user_id, type, title, message)
    values (
      new.user_id,
      'event_join_approved',
      'Request approved',
      case when new.status = 'joined'
        then 'You''re in for ' || v_title || '.'
        else 'You''re on the waitlist for ' || v_title || '.'
      end
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' and new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, message)
    values (new.user_id, 'event_join_declined', 'Request declined', 'Your request to join ' || v_title || ' was declined.');
  elsif tg_op = 'UPDATE' and old.status = 'waitlisted' and new.status = 'joined' then
    insert into public.notifications (user_id, type, title, message)
    values (new.user_id, 'waitlist_promoted', 'A spot opened up', 'You are off the waitlist for ' || v_title || '.');
  end if;

  return new;
end;
$$;
