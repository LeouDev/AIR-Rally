-- Fixes a bug in 20260810000029: events.participant_count always settled
-- back to 0.
--
-- prevent_event_count_tampering() (BEFORE UPDATE on events) reverted any
-- change to participant_count — including the legitimate write from
-- update_event_participant_count(), which is itself an UPDATE on events
-- fired from the event_attendees trigger. The guard could not tell the
-- system's own write from a client's.
--
-- Resolved with the transaction-local bypass flag this schema already
-- uses for exactly this problem: see prevent_booking_tampering() and
-- confirm_paymongo_booking_payment() in 20260810000007/20260810000008,
-- where the privileged writer sets the flag and the guard honours it.
--
-- The same guard is extended to clubs.member_count, which 029 left
-- client-writable — a club owner can update their own club row, so
-- without this they could inflate their own member count.

create or replace function public.prevent_event_count_tampering()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('air_rally.bypass_community_counts', true), 'false') = 'true' then
    return new;
  end if;

  if new.participant_count is distinct from old.participant_count then
    new.participant_count := old.participant_count;
  end if;

  return new;
end;
$$;

create or replace function public.update_event_participant_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_event_id uuid := coalesce(new.event_id, old.event_id);
begin
  perform set_config('air_rally.bypass_community_counts', 'true', true);

  update public.events
  set participant_count = (
    select count(*) from public.event_attendees
    where event_id = target_event_id and status = 'joined'
  )
  where id = target_event_id;

  perform set_config('air_rally.bypass_community_counts', 'false', true);
  return coalesce(new, old);
end;
$$;

-- clubs.member_count gets the same protection: trigger-maintained only.
create or replace function public.prevent_club_count_tampering()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('air_rally.bypass_community_counts', true), 'false') = 'true' then
    return new;
  end if;

  if new.member_count is distinct from old.member_count then
    new.member_count := old.member_count;
  end if;

  return new;
end;
$$;

create trigger clubs_prevent_count_tampering
before update on public.clubs
for each row execute function public.prevent_club_count_tampering();

create or replace function public.update_club_member_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_club_id uuid := coalesce(new.club_id, old.club_id);
begin
  perform set_config('air_rally.bypass_community_counts', 'true', true);

  update public.clubs
  set member_count = (
    select count(*) from public.club_members
    where club_id = target_club_id and status = 'active'
  )
  where id = target_club_id;

  perform set_config('air_rally.bypass_community_counts', 'false', true);
  return coalesce(new, old);
end;
$$;
