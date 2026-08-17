-- Emails every notification, via pg_net calling this app's own webhook
-- route (src/app/api/webhooks/notification-created/route.ts) rather than a
-- Supabase-dashboard-configured "Database Webhook" — the dashboard's
-- convenience wrapper depends on a `supabase_functions` schema that isn't
-- provisioned on this project (confirmed: ERROR 3F000, schema does not
-- exist, when attempting to create one). pg_net itself needs no such
-- schema, so this bypasses that gap entirely rather than waiting on it.
--
-- Every notification is already created by a SECURITY DEFINER trigger
-- before this one runs (notify_on_credit_issued() and friends) — there is
-- no single application code path to hook "also send an email" into
-- instead, because there's no application code path at all. This is the
-- one place every notification, regardless of which trigger wrote it,
-- actually passes through.
create extension if not exists pg_net;

-- Where the webhook's shared secret lives. NOT set here — a value in a
-- committed migration file is a value in git history forever. It was
-- created out-of-band via vault.create_secret(), named
-- 'notification_webhook_secret', and is read by name below rather than by
-- id so this migration carries no reference to a specific row.
create extension if not exists supabase_vault cascade;

create or replace function public.notify_email_on_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  -- The secret not existing yet must not turn "create a notification" into
  -- a hard failure for a customer — same posture as sendEmail() itself,
  -- which never throws. Missing config here just means no email this time.
  if v_secret is null then
    return new;
  end if;

  -- Fire-and-forget by construction: net.http_post() queues the request
  -- and returns immediately, so a slow or unreachable webhook adds no
  -- latency to whatever inserted this notification. Failures are visible
  -- in net._http_response for debugging, never as an error here.
  perform net.http_post(
    url := 'https://air-rally.com/api/webhooks/notification-created',
    body := jsonb_build_object(
      'type', 'INSERT',
      'table', 'notifications',
      'schema', 'public',
      'record', to_jsonb(new),
      'old_record', null
    ),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-webhook-secret', v_secret
    ),
    timeout_milliseconds := 5000
  );

  return new;
end;
$$;

create trigger notifications_email_webhook
after insert on public.notifications
for each row execute function public.notify_email_on_notification_insert();
