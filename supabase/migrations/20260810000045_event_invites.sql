-- Event invites: lets an organiser ask specific players to join their game.
--
-- Deliberately an INVITATION, not an enrolment. event_attendees' RLS only
-- lets a user insert their own row, and that stays exactly as it is — being
-- added to someone's game without agreeing to it is wrong socially before
-- it is wrong technically, and a roster of people who never consented is
-- worth nothing anyway. The invite notifies; the player joins with one tap,
-- which runs the ordinary capacity/waitlist trigger under their own
-- identity.
--
-- Notifications have no client INSERT policy (every row originates in a
-- SECURITY DEFINER trigger), so the invite needs this RPC as its sanctioned
-- write path — the same posture the engagement notifications already use.
create or replace function public.invite_event_players(p_event_id uuid, p_user_ids uuid[])
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_event public.events%rowtype;
  v_inviter_name text;
  v_count integer := 0;
  v_user_id uuid;
begin
  select * into v_event from public.events where id = p_event_id;
  if v_event.id is null then
    raise exception 'Event not found.' using errcode = 'no_data_found';
  end if;

  -- Only the organiser invites. auth.uid() rather than a parameter, so the
  -- caller cannot invite on someone else's behalf.
  if v_event.creator_id is distinct from auth.uid() then
    raise exception 'Only the event organiser can invite players.' using errcode = 'insufficient_privilege';
  end if;

  if v_event.status is distinct from 'published' then
    raise exception 'This event is no longer open.' using errcode = 'check_violation';
  end if;

  -- A cap on one call, so a compromised session cannot notification-bomb
  -- the whole user table through this function.
  if array_length(p_user_ids, 1) is null or array_length(p_user_ids, 1) > 20 then
    raise exception 'Invite between 1 and 20 players at a time.' using errcode = 'check_violation';
  end if;

  select coalesce(display_name, 'A player') into v_inviter_name
  from public.profiles where id = auth.uid();

  foreach v_user_id in array p_user_ids loop
    -- Self-invites are silently skipped rather than an error — a UI that
    -- includes the organiser in a "party" selection shouldn't blow up.
    continue when v_user_id = auth.uid();

    -- One invite per player per event. Re-inviting is a no-op, not a
    -- second notification — this is what stops invite spam to one person.
    if not exists (
      select 1 from public.notifications
      where user_id = v_user_id
        and type = 'event_invite'
        and message like '%' || v_event.id || '%'
    ) then
      insert into public.notifications (user_id, type, title, message)
      values (
        v_user_id,
        'event_invite',
        v_inviter_name || ' invited you to a game',
        v_inviter_name || ' added you to "' || v_event.title || '". Tap to view and confirm your spot. [event:' || v_event.id || ']'
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;

revoke all on function public.invite_event_players(uuid, uuid[]) from public, anon;
grant execute on function public.invite_event_players(uuid, uuid[]) to authenticated, service_role;
