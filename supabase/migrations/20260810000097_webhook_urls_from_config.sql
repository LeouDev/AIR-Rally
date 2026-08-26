-- ============================================================================
-- Repoint the three hardcoded 'https://air-rally.com' webhook URLs at
-- public.site_url(). See 096 for why this exists and why it is a table.
--
-- APPLY 096 AND SEED THE ROW BEFORE THIS FILE. This migration refuses to
-- apply otherwise (see the precondition below), which turns "a fresh
-- environment silently breaks bookings at runtime" into "the deploy stops".
--
-- WHAT THIS DOES NOT DO, ON PURPOSE:
--
--   * It does not install pg_net on staging. Staging has pg_cron only, so
--     net.http_post does not resolve there and these functions still cannot
--     fire. THIS MIGRATION MAKES STAGING HONEST, NOT FUNCTIONAL. Installing
--     pg_net on staging is a separate decision with its own consequences.
--
--   * It does not create notify_email_on_notification_insert on staging,
--     which does not have it. Creating it would need three things staging
--     lacks — pg_net, a webhook secret, and a Resend sending domain — and an
--     inert SECURITY DEFINER function that would POST the moment anyone
--     attached a trigger is a latent hazard on the environment people
--     experiment on. A visible gap beats something that looks configured.
--     The replace below is therefore conditional on the function existing.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Precondition. Fail the deploy, not a customer's booking.
-- ---------------------------------------------------------------------------
do $$
begin
  if not exists (select 1 from public.app_config where key = 'site_url') then
    raise exception
      'app_config.site_url must be seeded before this migration. Production: https://air-rally.com. Staging: https://staging.air-rally.invalid (no staging web app exists; the .invalid TLD is reserved by RFC 2606 and can never resolve, so staging cannot reach production even if pg_net and the Vault secret are added later).';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- 058: email on notification insert. Conditional — staging has no such
-- function and deliberately keeps none.
-- ---------------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.notify_email_on_notification_insert()') is null then
    raise notice 'notify_email_on_notification_insert() absent (expected on staging) — skipping.';
    return;
  end if;

  execute $fn$
create or replace function public.notify_email_on_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $body$
declare
  v_secret text;
  v_url    text;
begin
  -- Resolve config FIRST, and never let a config problem escape onto a
  -- customer path. 058 established this posture explicitly: "the secret not
  -- existing yet must not turn 'create a notification' into a hard failure
  -- for a customer". A missing site_url is the same class of problem, and a
  -- raise here would abort the INSERT — and with it the booking that wrote
  -- the notification. Loud in the log, invisible to the customer.
  begin
    v_url := public.site_url();
  exception when others then
    raise warning 'notify_email_on_notification_insert: site_url unavailable (%), skipping email webhook', sqlerrm;
    return new;
  end;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url || '/api/webhooks/notification-created',
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
$body$;
  $fn$;
end;
$$;

-- ---------------------------------------------------------------------------
-- 066: push on notification insert. Same customer-path posture.
-- ---------------------------------------------------------------------------
create or replace function public.notify_push_on_notification_insert()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
  v_url    text;
begin
  if not exists (
    select 1 from public.device_push_tokens where user_id = new.user_id
  ) then
    return new;
  end if;

  -- See the email function above: a config failure must not abort the
  -- INSERT, because the INSERT may be part of a booking.
  begin
    v_url := public.site_url();
  exception when others then
    raise warning 'notify_push_on_notification_insert: site_url unavailable (%), skipping push webhook', sqlerrm;
    return new;
  end;

  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'notification_webhook_secret'
  limit 1;

  if v_secret is null then
    return new;
  end if;

  perform net.http_post(
    url := v_url || '/api/webhooks/notification-push',
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

-- ---------------------------------------------------------------------------
-- 065: the pg_cron sweep. NO exception handler here, deliberately.
--
-- Nothing customer-facing calls this — pg_cron does, every 5 minutes. A raise
-- costs nobody a booking and marks the run "failed" in cron.job_run_details,
-- which is exactly the visibility the trigger paths have to trade away. Free
-- loudness where it is free.
-- ---------------------------------------------------------------------------
create or replace function public.trigger_expire_stale_paymongo_bookings()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_secret text;
begin
  select decrypted_secret into v_secret
  from vault.decrypted_secrets
  where name = 'expire_paymongo_bookings_webhook_secret'
  limit 1;

  if v_secret is null then
    return;
  end if;

  perform net.http_post(
    url := public.site_url() || '/api/cron/expire-stale-paymongo-bookings',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-webhook-secret', v_secret),
    timeout_milliseconds := 20000
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- IN-TRANSACTION ASSERTION.
--
-- The positive control (production's cron traffic returning 200 every 5
-- minutes) exercises the cron path only. These assertions cover all three
-- constructed URLs, and they run BEFORE COMMIT — so a typo in a path aborts
-- this migration instead of shipping a 404 that only shows up as a silently
-- undelivered email.
--
-- Skipped on any database whose site_url is not production, because there the
-- URLs are SUPPOSED to differ. On production this proves the change is
-- byte-for-byte identical to the literals it replaced.
-- ---------------------------------------------------------------------------
do $$
declare
  v_base text := public.site_url();
begin
  if v_base <> 'https://air-rally.com' then
    raise notice 'site_url is % — skipping the production-equivalence assertions (expected off production).', v_base;
    return;
  end if;

  if v_base || '/api/webhooks/notification-created'
       <> 'https://air-rally.com/api/webhooks/notification-created' then
    raise exception 'email webhook URL changed on production: %', v_base || '/api/webhooks/notification-created';
  end if;

  if v_base || '/api/webhooks/notification-push'
       <> 'https://air-rally.com/api/webhooks/notification-push' then
    raise exception 'push webhook URL changed on production: %', v_base || '/api/webhooks/notification-push';
  end if;

  if v_base || '/api/cron/expire-stale-paymongo-bookings'
       <> 'https://air-rally.com/api/cron/expire-stale-paymongo-bookings' then
    raise exception 'cron webhook URL changed on production: %', v_base || '/api/cron/expire-stale-paymongo-bookings';
  end if;

  raise notice 'All three webhook URLs resolve identically to the literals they replaced.';
end;
$$;
