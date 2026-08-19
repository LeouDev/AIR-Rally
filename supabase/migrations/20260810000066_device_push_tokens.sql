-- Phase 0 of the mobile app: device push-token storage plus a trigger that
-- fans every notification INSERT out to the push webhook — the exact
-- pattern 20260810000058_notification_email_webhook.sql established for
-- email, reusing the same vault secret ('notification_webhook_secret')
-- and the same fail-open posture, just aimed at a second route
-- (/api/webhooks/notification-push) that speaks Expo Push instead of
-- Resend.

create table public.device_push_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- An Expo push token ("ExponentPushToken[...]"). Unique across ALL
  -- users, not per-user: a physical device holds exactly one Expo token,
  -- and if a second account signs in on the same device the token must
  -- move to that account — otherwise the previous account's
  -- notifications keep landing on a device its owner no longer uses.
  token text not null unique,
  platform text not null check (platform in ('ios', 'android')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The push webhook's one read: "all tokens for this notification's user".
create index device_push_tokens_user_id_idx on public.device_push_tokens (user_id);

alter table public.device_push_tokens enable row level security;

create policy "Users can view their own push tokens"
on public.device_push_tokens for select
using (auth.uid() = user_id or public.is_admin());

create policy "Users can delete their own push tokens"
on public.device_push_tokens for delete
using (auth.uid() = user_id or public.is_admin());

-- Deliberately NO insert/update policy — registration goes through the
-- SECURITY DEFINER function below, because the interesting case (same
-- device, new account) requires deleting ANOTHER user's row for that
-- token, which row-scoped RLS can never allow a client to do directly.
-- Same "no client writes, function owns the writes" posture as
-- notifications itself (20260810000024).

create or replace function public.register_push_token(
  p_token text,
  p_platform text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  if p_platform not in ('ios', 'android') then
    raise exception 'Invalid platform';
  end if;

  -- Expo tokens look like "ExponentPushToken[22 base64-ish chars]".
  -- Bounding length (not format — Expo doesn't document it as stable)
  -- keeps a hostile client from storing arbitrary large payloads under a
  -- column the push route will happily echo into outbound HTTP requests.
  if p_token is null or length(p_token) < 10 or length(p_token) > 200 then
    raise exception 'Invalid token';
  end if;

  -- The device changed hands: whoever is signed in on it NOW is who its
  -- pushes belong to. Delete-then-insert rather than upsert so the row's
  -- created_at honestly restarts with the new registration.
  delete from public.device_push_tokens
  where token = p_token
    and user_id <> auth.uid();

  insert into public.device_push_tokens (user_id, token, platform)
  values (auth.uid(), p_token, p_platform)
  on conflict (token) do update
    set platform = excluded.platform,
        updated_at = now();
end;
$$;

-- authenticated only — an anonymous session has no user to register for.
revoke execute on function public.register_push_token(text, text) from public, anon;
grant execute on function public.register_push_token(text, text) to authenticated;

-- Sign-out cleanup: scoped to the caller's own rows (same guarantee the
-- delete RLS policy gives), provided as a function anyway so the mobile
-- client's sign-out path is one RPC regardless of session quirks.
create or replace function public.unregister_push_token(p_token text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Not authenticated';
  end if;

  delete from public.device_push_tokens
  where token = p_token
    and user_id = auth.uid();
end;
$$;

revoke execute on function public.unregister_push_token(text) from public, anon;
grant execute on function public.unregister_push_token(text) to authenticated;

-- The push mirror of notify_email_on_notification_insert(). Differences
-- are deliberate and small: it skips users with no registered device (the
-- overwhelming majority until the mobile app ships — no point queueing an
-- HTTP call that can only no-op), and it posts to the push route. Secret
-- lookup, fail-open-on-missing-config, and fire-and-forget semantics are
-- identical to the email trigger.
create or replace function public.notify_push_on_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  if not exists (
    select 1 from public.device_push_tokens where user_id = new.user_id
  ) then
    return new;
  end if;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := 'https://air-rally.com/api/webhooks/notification-push',
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

create trigger notifications_push_webhook
after insert on public.notifications
for each row execute function public.notify_push_on_notification_insert();
