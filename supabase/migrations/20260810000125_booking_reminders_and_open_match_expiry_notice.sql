-- Two notifications nobody was sending.
--
-- 1. Booking reminders, from the server, so they reach every confirmed
--    booking — including the ones made on the website, which the app's own
--    local reminders (mobile lib/booking-reminders.ts) never knew about. Same
--    wording, lead time and link as those local reminders, so the app can
--    retire its copy once this is live. Every 5 minutes, a confirmed booking
--    starting within the next 2 hours gets one reminder, once.
--
-- 2. A notice when an Open Match expires short of players at kickoff.
--    resolve_open_matches_at_kickoff() (migration 120) set status = 'expired'
--    and told nobody: the host and whoever had joined just found the game
--    gone. It now tells each of them. Same link_url as the Open Match
--    broadcast (migration 119), which the app routes to its Play tab.
--
-- Both ride the existing notifications pipeline (push + email webhooks).
-- Both types carry a link_url, so neither client needs a new route for them.
begin;

-- A nullable timestamp: a new column is invisible to old clients.
alter table public.bookings add column if not exists reminder_sent_at timestamptz;

create or replace function public.send_booking_reminders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  -- Marked and notified in one statement, so an overlapping run can't remind
  -- twice: it waits on the row lock, then finds reminder_sent_at set.
  with due as (
    update public.bookings b
    set reminder_sent_at = now()
    from public.courts c
    join public.venues v on v.id = c.venue_id
    where c.id = b.court_id
      and b.status = 'confirmed'
      and b.reminder_sent_at is null
      and b.start_time > now()
      and b.start_time <= now() + interval '2 hours'
      -- Only bookings that already existed at the two-hour mark: a court
      -- booked an hour ahead needs no reminder of itself.
      and b.created_at <= b.start_time - interval '2 hours'
    returning b.id, b.user_id, b.start_time, c.name as court_name, v.name as venue_name, v.timezone
  )
  insert into public.notifications (user_id, type, title, message, link_url)
  select
    user_id,
    'booking_reminder',
    'Your court is in 2 hours',
    format('%s · %s at %s', venue_name, court_name, to_char(start_time at time zone timezone, 'FMHH12:MI AM')),
    format('/bookings/%s/confirmation', id)
  from due;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke execute on function public.send_booking_reminders() from public, anon, authenticated;

select cron.schedule(
  'send-booking-reminders',
  '*/5 * * * *',
  $$select public.send_booking_reminders()$$
);

-- Migration 120's kickoff sweep, unchanged except for the notice on expiry.
create or replace function public.resolve_open_matches_at_kickoff()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
  v_count integer := 0;
  v_accepted integer;
begin
  for v_row in
    select id from public.open_matches
    where status = 'open' and scheduled_at <= now()
    for update skip locked
  loop
    v_accepted := public.open_match_accepted_count(v_row.id);
    if v_accepted = 2 then
      perform public.convert_open_match_to_singles(v_row.id);
    elsif v_accepted = 4 then
      perform public.convert_open_match_to_doubles(v_row.id);
    else
      update public.open_matches set status = 'expired' where id = v_row.id;

      insert into public.notifications (user_id, type, title, message, link_url)
      select
        player.user_id,
        'open_match_expired',
        'Your Open Match didn''t fill',
        'Not enough players joined by kickoff, so the game was called off.',
        '/ranked/open/' || v_row.id
      from (
        select host_id as user_id from public.open_matches where id = v_row.id
        union
        select user_id from public.open_match_join_requests
        where open_match_id = v_row.id and status = 'accepted'
      ) as player;
    end if;
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke execute on function public.resolve_open_matches_at_kickoff() from public, anon, authenticated;

commit;
