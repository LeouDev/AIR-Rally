-- notify_on_event_attendance() (20260810000069) never stamped link_url on
-- any of its five notification types — event_join_request,
-- event_registration, event_join_approved, event_join_declined,
-- waitlist_promoted all shipped with link_url null. Tapping one on either
-- app goes nowhere: web's notificationHref() and mobile's
-- resolveNotificationTarget() both only know how to route a real link_url
-- (or, for older writers, a [event:<uuid>] marker embedded in the
-- message — neither exists here). Confirmed live: real rows already sit
-- in production with link_url null from today's testing.
--
-- Fixed the same way 20260810000068's ranked notifications already do it
-- (link_url = '/ranked/match/' || v_match_id) — the newer-writer pattern
-- this function should have used from the start. Existing null rows are
-- not backfilled: there is no event_id on `notifications` itself to
-- recover from, consistent with this codebase's existing posture that
-- pre-link_url notifications don't retroactively gain a destination.
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
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      v_creator_id, 'event_join_request', 'New join request',
      'Someone asked to join ' || v_title || '.', '/events/' || new.event_id
    );
  elsif tg_op = 'INSERT' and new.status = 'joined' and new.user_id <> v_creator_id then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      v_creator_id, 'event_registration', 'New event registration',
      'A player joined ' || v_title || '.', '/events/' || new.event_id
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' and new.status in ('joined', 'waitlisted') then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      new.user_id,
      'event_join_approved',
      'Request approved',
      case when new.status = 'joined'
        then 'You''re in for ' || v_title || '.'
        else 'You''re on the waitlist for ' || v_title || '.'
      end,
      '/events/' || new.event_id
    );
  elsif tg_op = 'UPDATE' and old.status = 'pending_approval' and new.status = 'cancelled' then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      new.user_id, 'event_join_declined', 'Request declined',
      'Your request to join ' || v_title || ' was declined.', '/events/' || new.event_id
    );
  elsif tg_op = 'UPDATE' and old.status = 'waitlisted' and new.status = 'joined' then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      new.user_id, 'waitlist_promoted', 'A spot opened up',
      'You are off the waitlist for ' || v_title || '.', '/events/' || new.event_id
    );
  end if;

  return new;
end;
$$;
