-- Notifies (and, via the existing notification-email webhook, emails) a
-- player the moment their email is actually confirmed — not at signup,
-- since signUp() (src/lib/actions/auth.ts) runs before any confirmation
-- link exists and has no way to know whether, or when, anyone clicks it.
--
-- auth.users.email_confirmed_at transitions from null to non-null exactly
-- once, precisely when Supabase's own confirmation flow verifies the
-- link, so that transition is the correct — and only reliable — signal
-- that a genuinely new email/password account just finished signing up.
--
-- Deliberately scoped to that ONE transition, not "user has a confirmed
-- email" in general:
--   * OAuth accounts (Google/Facebook) get email_confirmed_at set at row
--     creation, not via a later update — this trigger never fires for
--     them, which is correct: they already get the same welcome email
--     from completeOAuthSignup() the moment they record agreement
--     acceptance, since OAuth has no confirmation link to wait for.
--   * A password reset (updatePassword()) never touches
--     email_confirmed_at, so it can never re-trigger this for an
--     existing, already-confirmed user reusing the same /auth/callback
--     route.
--   * A second confirmation attempt can't refire this either — the WHEN
--     clause requires OLD to be null, and it's already non-null after
--     the first time.
--
-- Known gap: if this app ever lets a user change their account email,
-- confirming the new address may also touch email_confirmed_at — this
-- was not built against that case, since no such feature exists today.
-- Revisit this trigger's WHEN clause if one ships.
create or replace function public.notify_on_email_confirmed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, type, title, message)
  values (
    new.id,
    'email_confirmed',
    'Email confirmed',
    'Your AIR/Rally account is ready.'
  );
  return new;
end;
$$;

create trigger on_auth_user_email_confirmed
after update of email_confirmed_at on auth.users
for each row
when (old.email_confirmed_at is null and new.email_confirmed_at is not null)
execute function public.notify_on_email_confirmed();
