-- Gives the customer's booking_confirmed notification a link_url pointing
-- at its own confirmation page, so the notification-email webhook
-- (src/app/api/webhooks/notification-created/route.ts) can look the
-- booking back up and render an actual receipt — confirmation code,
-- court, venue, date/time, amount paid — instead of the generic
-- title+message template every other notification type gets.
--
-- Deliberately NOT applied to the owner's booking_received notification:
-- /bookings/{id}/confirmation is the CUSTOMER's own receipt page and
-- explicitly 404s for anyone else, even the venue owner (see that page's
-- own "Own-booking check is stricter than what RLS alone permits" comment)
-- — linking the owner there would send them to a page that refuses them.
--
-- Full function body reproduced from 20260810000024_notifications.sql;
-- this is the first change to it since, confirmed by grep across every
-- migration that mentions notify_on_booking_change() — the other three
-- hits are comments, not redefinitions.
create or replace function public.notify_on_booking_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  if new.status is distinct from old.status then
    select v.owner_id into v_owner_id
    from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = new.court_id;

    if old.status = 'pending' and new.status = 'confirmed' then
      insert into public.notifications (user_id, type, title, message, link_url)
      values (
        new.user_id,
        'booking_confirmed',
        'Booking confirmed',
        'Your booking (confirmation #' || new.confirmation_code || ') is confirmed.',
        '/bookings/' || new.id || '/confirmation'
      );

      if v_owner_id is not null then
        insert into public.notifications (user_id, type, title, message)
        values (
          v_owner_id,
          'booking_received',
          'New booking received',
          'You have a new booking (confirmation #' || new.confirmation_code || ').'
        );
      end if;
    elsif new.status = 'cancelled' then
      insert into public.notifications (user_id, type, title, message)
      values (
        new.user_id,
        'booking_cancelled',
        'Booking cancelled',
        'Your booking (confirmation #' || new.confirmation_code || ') has been cancelled.'
      );

      if v_owner_id is not null then
        insert into public.notifications (user_id, type, title, message)
        values (
          v_owner_id,
          'booking_cancelled',
          'Booking cancelled',
          'A booking (confirmation #' || new.confirmation_code || ') has been cancelled.'
        );
      end if;
    end if;
  end if;

  return new;
end;
$$;
