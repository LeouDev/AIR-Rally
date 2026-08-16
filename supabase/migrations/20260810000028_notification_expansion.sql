-- Phase 7.5 notification expansion. Two new SECURITY DEFINER triggers in
-- the same shape 20260810000024_notifications.sql already established —
-- no schema change to `notifications` itself (its `type` column has no
-- CHECK constraint by design, so new types need no migration of their own),
-- and no new client insert policy (every notification row still comes
-- from a trigger).

-- Notifies the venue owner the moment a booking row is CREATED, not just
-- when its status later changes. notify_on_booking_change() only fires
-- AFTER UPDATE, so an owner currently learns about a booking only once
-- payment confirms it — this fills the gap for the pending stage.
-- Deliberately owner-only: the customer just performed this action
-- themselves and is looking at the checkout screen.
create or replace function public.notify_on_booking_created()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select v.owner_id into v_owner_id
  from public.courts c
  join public.venues v on v.id = c.venue_id
  where c.id = new.court_id;

  if v_owner_id is not null then
    insert into public.notifications (user_id, type, title, message)
    values (
      v_owner_id,
      'booking_created',
      'New booking started',
      'A player started a booking (confirmation #' || new.confirmation_code || ').'
    );
  end if;

  return new;
end;
$$;

create trigger bookings_notify_on_created
after insert on public.bookings
for each row execute function public.notify_on_booking_created();

-- Notifies the venue's owner when an admin moves their LISTING through
-- moderation: pending_review -> active ("approved") or -> suspended
-- ("rejected"). Scoped to venue-listing moderation only, never the
-- separate owner-application decision (owner_applications has its own
-- lifecycle — see 20260810000025_owner_approval.sql).
create or replace function public.notify_on_venue_moderation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status and new.owner_id is not null then
    if old.status = 'pending_review' and new.status = 'active' then
      insert into public.notifications (user_id, type, title, message)
      values (
        new.owner_id,
        'venue_approved',
        'Venue approved',
        new.name || ' is now live on Air/Rally.'
      );
    elsif old.status = 'pending_review' and new.status = 'suspended' then
      insert into public.notifications (user_id, type, title, message)
      values (
        new.owner_id,
        'venue_rejected',
        'Venue not approved',
        new.name || ' was not approved. Check your listing details and submit again.'
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger venues_notify_on_moderation_change
after update on public.venues
for each row execute function public.notify_on_venue_moderation_change();
