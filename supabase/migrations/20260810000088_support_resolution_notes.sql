-- support_requests gets a reply, closing a real gap: /support tells a
-- user "we reply in your AIR/Rally notifications, not by email", but
-- nothing in this table or its admin UI has ever let an admin say
-- anything back — SupportStatusButtons.tsx only ever moves status.
-- Someone reports a problem, an admin marks it resolved, and the
-- notification the product promised never arrives, because there was
-- never a message to send.
--
-- Founder's decision: "single reply for now" — one resolution_note per
-- request, not a threaded back-and-forth. Deliberate first step, not a
-- belief that a thread would be wrong: if usage shows people needing to
-- go back and forth, that's a signal to build the fuller thing, not
-- something this migration is guessing wrong today.
--
-- NAMING MATCHES reports.resolution_note EXACTLY (same migration,
-- 20260810000049, adjacent table) rather than inventing new vocabulary
-- — someone reading both tables side by side should see one pattern.
--
-- ONE DELIBERATE DIFFERENCE FROM reports: reports_resolution_complete
-- never requires resolution_note to be non-null — an admin can dismiss a
-- report with no note, which is fine there (a report isn't a promise of
-- a reply to the reporter). support_requests' whole problem IS the
-- broken promise of a reply, so its own resolution-complete constraint
-- is tightened further: resolved/closed now also requires a note, not
-- just a resolver and a timestamp. Checked before writing this that this
-- doesn't break on apply: production holds exactly one support_requests
-- row today, status='in_progress' — zero rows in 'resolved' or 'closed',
-- so there is nothing existing for the tightened constraint to conflict
-- with. If that count has changed by the time this actually applies,
-- re-check before running it — same standard as every migration
-- tonight.
--
-- Reopening (resolved/closed -> open) clears resolution_note back to
-- null, the same way it already clears resolved_by/resolved_at — a
-- reopened request must not keep displaying a stale note as if it were
-- still the live, final answer.
--
-- NOTIFICATION: a trigger, not application code, matching this
-- codebase's own established pattern for exactly this shape
-- (notify_on_venue_moderation_change/notify_on_club_moderation_change,
-- both admin-driven status-change notifications on a table the
-- affected user doesn't write to themselves) — so the notification
-- fires no matter what code path performs the update, not only the one
-- Server Action that exists today.

alter table public.support_requests
  add column resolution_note text
    check (resolution_note is null or char_length(resolution_note) <= 1000);

comment on column public.support_requests.resolution_note is
  'The single reply an admin sends back, matching reports.resolution_note''s shape. Required when status moves to resolved or closed (see support_resolution_complete) — this is exactly the reply /support promises and support_requests previously had no way to deliver. Cleared on reopen, same as resolved_by/resolved_at.';

alter table public.support_requests
  drop constraint support_resolution_complete;

alter table public.support_requests
  add constraint support_resolution_complete check (
    status not in ('resolved', 'closed')
    or (resolved_by is not null and resolved_at is not null and resolution_note is not null)
  );

create or replace function public.notify_on_support_resolution()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status is distinct from old.status
     and old.status not in ('resolved', 'closed')
     and new.status in ('resolved', 'closed')
     and new.resolution_note is not null then
    insert into public.notifications (user_id, type, title, message, link_url)
    values (
      new.user_id,
      'support_request_resolved',
      case when new.status = 'resolved' then 'Your support request was resolved' else 'Your support request was closed' end,
      new.subject || ': ' || new.resolution_note,
      '/support'
    );
  end if;
  return new;
end;
$$;

create trigger support_requests_notify_on_resolution
after update on public.support_requests
for each row execute function public.notify_on_support_resolution();
