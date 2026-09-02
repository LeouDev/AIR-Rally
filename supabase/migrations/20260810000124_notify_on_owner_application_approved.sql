-- `owner_application_approved` has existed as a concept in a stash since
-- 2026-08-19 (a static welcome email template, plus wiring for the
-- email-render branch, the notification route map, and the
-- NotificationType TS union) — but nothing has ever actually EMITTED a
-- notification of this type, to anyone, ever. Confirmed directly:
-- queried every distinct `notifications.type` value that has ever
-- existed on staging (23 real types) and it isn't among them; the only
-- trigger on `owner_applications` is `owner_applications_set_updated_at`.
-- The stashed wiring is correct — it was just never going to fire,
-- because the notification it routes was never created in the first
-- place. This is that missing piece.
--
-- Modeled directly on notify_on_venue_moderation_change() (migration
-- 028) — same shape: a status-transition guard, one INSERT into
-- notifications with a fixed type/title/message, no link_url (the
-- stashed notificationRoutes.ts entry sends it to /list-your-court via
-- the type-based fallback route map, same as venue_approved does today).
--
-- Scoped to pending -> approved ONLY. A symmetric "your application was
-- rejected" notification is the same shape of gap, found by pattern-
-- match rather than by direct evidence — flagged separately, not built
-- here. Shipping it now would mean shipping something nobody has
-- actually asked for or verified matters, on the strength of an
-- inference rather than a finding.
begin;

create or replace function public.notify_on_owner_application_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and old.status = 'pending' and new.status = 'approved' then
    insert into public.notifications (user_id, type, title, message)
    values (
      new.user_id,
      'owner_application_approved',
      'Your venue application was approved',
      'Congratulations — your owner application has been approved. You can now list and manage your venue on AIR/Rally.'
    );
  end if;

  return new;
end;
$$;

create trigger owner_applications_notify_on_change
after update on public.owner_applications
for each row execute function public.notify_on_owner_application_change();

commit;
