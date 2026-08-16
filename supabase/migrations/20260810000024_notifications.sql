-- Phase 5.3: notification foundation. Additive only — no existing
-- table/column/policy/function is touched. Deliberately minimal per the
-- brief ("do not overbuild"): no Realtime subscription, no email/push,
-- no per-notification deep-linking. Just durable rows, RLS, and the
-- trigger-driven writes described below.
create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- Fixed slugs, not a free-form string — 'booking_confirmed' |
  -- 'booking_received' | 'booking_cancelled' | 'reschedule_completed' |
  -- 'review_received'. Not a CHECK constraint: a later event type is a
  -- routine addition, not a schema change worth gating on.
  type text not null,
  title text not null,
  message text not null,
  read_at timestamptz,
  created_at timestamptz not null default now()
);

-- Serves both "my unread count" and "my recent notifications, unread
-- first" — the two reads the bell UI actually needs.
create index notifications_user_id_read_at_idx on public.notifications (user_id, read_at);

alter table public.notifications enable row level security;

create policy "Users can view their own notifications, admins see all"
on public.notifications for select
using (auth.uid() = user_id or public.is_admin());

-- App layer only ever sets read_at (see markAsRead()/markAllAsRead() in
-- lib/services/notifications.ts) — the trigger below is the actual
-- enforcement of that, same defense-in-depth posture as
-- prevent_booking_tampering()/prevent_reschedule_tampering(): a client
-- could otherwise rewrite their own notification's title/message, which
-- would let a customer fabricate a fake "Booking confirmed" or spoof
-- text that never came from this system.
create policy "Users can update their own notifications"
on public.notifications for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

create or replace function public.prevent_notification_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_admin() then
    return new;
  end if;

  new.user_id := old.user_id;
  new.type := old.type;
  new.title := old.title;
  new.message := old.message;
  new.created_at := old.created_at;

  return new;
end;
$$;

create trigger notifications_prevent_tampering
before update on public.notifications
for each row execute function public.prevent_notification_tampering();

-- Deliberately NO insert policy for any client role (anon/authenticated)
-- — a user must never be able to write their own notification, which
-- would allow spoofing a fake "Booking confirmed" or similar. Every row
-- is created exclusively by the security-definer trigger functions
-- below, matching this codebase's existing pattern for guaranteed-fire,
-- cross-boundary side effects (update_venue_rating_stats(),
-- handle_new_user(), reconcile_reschedule_on_booking_cancel()).
--
-- Triggers, not app-layer calls at each relevant call site, deliberately:
-- booking confirmation alone is driven from three different code paths
-- (the Stripe webhook, the PayMongo webhook, and the confirmation page's
-- own fallback) — a trigger fires exactly once regardless of which path
-- mutated the row, with no risk of a forgotten call site. It also solves
-- a real RLS-visibility problem: a customer's own session cannot read a
-- venue's owner_id (intentionally excluded from the venue_marketplace
-- view — see 20260809000008_marketplace_view.sql), but a
-- security-definer function can look it up freely.

-- Fires on every bookings status transition. `pending -> confirmed`
-- notifies both sides ("Booking confirmed" / "New booking received");
-- any `-> cancelled` transition (from pending or confirmed) notifies
-- both sides ("Booking cancelled"). No-ops on any other update (e.g. a
-- plain field revert from prevent_booking_tampering() that doesn't
-- actually change status).
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
      insert into public.notifications (user_id, type, title, message)
      values (
        new.user_id,
        'booking_confirmed',
        'Booking confirmed',
        'Your booking (confirmation #' || new.confirmation_code || ') is confirmed.'
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

create trigger bookings_notify_on_change
after update on public.bookings
for each row execute function public.notify_on_booking_change();

-- Notifies the original booking's own customer once a reschedule
-- actually completes — mirrors complete_reschedule()'s own status
-- transition (see 20260810000015_booking_reschedules.sql), fired as a
-- separate AFTER UPDATE trigger rather than folded into that RPC, same
-- "trigger owns the side effect, RPC owns the transaction" separation
-- notify_on_booking_change() above already establishes for bookings.
create or replace function public.notify_on_reschedule_complete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_customer_id uuid;
begin
  if new.status = 'completed' and old.status is distinct from 'completed' then
    select user_id into v_customer_id
    from public.bookings
    where id = new.original_booking_id;

    if v_customer_id is not null then
      insert into public.notifications (user_id, type, title, message)
      values (
        v_customer_id,
        'reschedule_completed',
        'Reschedule completed',
        'Your booking has been rescheduled successfully.'
      );
    end if;
  end if;

  return new;
end;
$$;

create trigger booking_reschedules_notify_on_complete
after update on public.booking_reschedules
for each row execute function public.notify_on_reschedule_complete();

-- Notifies the venue owner the moment a customer leaves a review —
-- fires alongside (not instead of) reviews_update_venue_rating, which
-- already keeps venues.average_rating/review_count in sync.
create or replace function public.notify_on_review_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owner_id uuid;
begin
  select owner_id into v_owner_id from public.venues where id = new.venue_id;

  if v_owner_id is not null then
    insert into public.notifications (user_id, type, title, message)
    values (
      v_owner_id,
      'review_received',
      'New review received',
      'Your venue received a new ' || new.rating || '-star review.'
    );
  end if;

  return new;
end;
$$;

create trigger reviews_notify_on_insert
after insert on public.reviews
for each row execute function public.notify_on_review_insert();
