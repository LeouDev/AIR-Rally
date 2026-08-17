-- Gives a notification somewhere to go.
--
-- Until now nothing recorded WHAT a notification was about — only its type
-- and a sentence of prose. Tapping one could at best route to the right
-- section. `link_url` stores the actual destination, so an invite opens
-- that game rather than the events list.
--
-- Nullable and unconstrained on purpose: every existing row keeps working,
-- and lib/notificationRoutes.ts falls back to a type-based route when it is
-- null. Older writers can adopt it one at a time rather than all at once.
alter table public.notifications
  add column link_url text;

comment on column public.notifications.link_url is
  'In-app path this notification points at, e.g. /events/<id>. Null falls back to a type-based route — see lib/notificationRoutes.ts.';

-- The invite writer now sets it, so invites route precisely from day one.
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

  if v_event.creator_id is distinct from auth.uid() then
    raise exception 'Only the event organiser can invite players.' using errcode = 'insufficient_privilege';
  end if;

  if v_event.status is distinct from 'published' then
    raise exception 'This event is no longer open.' using errcode = 'check_violation';
  end if;

  if array_length(p_user_ids, 1) is null or array_length(p_user_ids, 1) > 20 then
    raise exception 'Invite between 1 and 20 players at a time.' using errcode = 'check_violation';
  end if;

  select coalesce(display_name, 'A player') into v_inviter_name
  from public.profiles where id = auth.uid();

  foreach v_user_id in array p_user_ids loop
    continue when v_user_id = auth.uid();

    -- One invite per player per event, now keyed on link_url rather than
    -- a LIKE against the message body.
    if not exists (
      select 1 from public.notifications
      where user_id = v_user_id
        and type = 'event_invite'
        and link_url = '/events/' || v_event.id
    ) then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        v_user_id,
        'event_invite',
        v_inviter_name || ' invited you to a game',
        v_inviter_name || ' added you to "' || v_event.title || '". Tap to view and confirm your spot.',
        '/events/' || v_event.id
      );
      v_count := v_count + 1;
    end if;
  end loop;

  return v_count;
end;
$$;
