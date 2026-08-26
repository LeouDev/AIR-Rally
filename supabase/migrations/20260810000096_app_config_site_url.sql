-- ============================================================================
-- Per-environment site URL, so database webhooks stop calling production
-- from wherever they happen to run.
--
-- THE BUG THIS EXISTS TO FIX. Three functions POST to a URL hardcoded as
-- 'https://air-rally.com':
--
--   notify_email_on_notification_insert   (058)  trigger on notifications
--   notify_push_on_notification_insert    (066)  trigger on notifications
--   trigger_expire_stale_paymongo_bookings(065)  pg_cron, every 5 minutes
--
-- All three exist on staging too (except the email one, see below), pointing
-- at production. Staging has never actually called production, but NOT by
-- design — by two accidents:
--
--   1. Each function returns early when its Vault secret is missing, and
--      staging has neither secret. Verified by name only, never decrypted.
--   2. pg_net is not installed on staging at all, so net.http_post does not
--      even resolve there.
--
-- Evidence for (1): staging's cron job has run 2,307 times, every one logged
-- "succeeded", inside a function with NO exception handler that calls a
-- net.http_post which does not exist on that database. That is only possible
-- if the line is never reached.
--
-- WHY IT IS URGENT ANYWAY. The only thing between staging and production's
-- API is an absent Vault secret. Adding that secret to test notifications is
-- a completely ordinary thing to do, and the day someone does it, staging
-- starts POSTing production with staging's payloads. This lands first.
--
-- WHY A TABLE AND NOT current_setting()/ALTER DATABASE SET. A GUC set with
-- ALTER DATABASE applies at SESSION START. Supabase fronts these databases
-- with a connection pooler holding long-lived server connections, so after
-- setting it there is a window — potentially hours, ending at pooler recycle
-- — in which some sessions resolve the URL and others get NULL,
-- non-deterministically, on the notification path. A table read has no such
-- window: it is correct the instant the row is committed.
-- ============================================================================

create table if not exists public.app_config (
  key         text primary key,
  value       text not null,
  updated_at  timestamptz not null default now(),
  -- Empty-or-blank is rejected at WRITE time rather than discovered at read
  -- time, so the failure lands on whoever misconfigures it instead of on a
  -- customer mid-booking.
  constraint app_config_value_not_blank check (btrim(value) <> '')
);

comment on table public.app_config is
  'Per-environment configuration read by SECURITY DEFINER functions. Not '
  'secrets — secrets live in Vault. A site URL is public information; this '
  'table exists so it differs per database rather than being compiled in.';

alter table public.app_config enable row level security;

-- No policies, deliberately: unreachable to anon and authenticated. Reads go
-- through public.site_url(), which is SECURITY DEFINER.
--
-- HONEST CAVEAT, same shape as payout_batch_items: "unreachable" means
-- unreachable to non-service roles. service_role bypasses RLS entirely, as
-- does the table owner. That is acceptable here precisely because this is not
-- a secret — but "nobody can read it" and "no ordinary client can read it"
-- are different claims and only the second one is true.

-- ---------------------------------------------------------------------------
-- The site_url row must not be removable.
--
-- WHY. public.site_url() raises when the row is absent. If that raise happens
-- inside the notifications trigger it aborts the INSERT, which aborts the
-- transaction that wrote the notification — INCLUDING A BOOKING. So deleting
-- one row would stop people booking courts. The trigger functions defend
-- against this themselves (see 097), but defence in depth is cheap here:
-- remove the path entirely rather than rely on every future caller being
-- careful.
-- ---------------------------------------------------------------------------
create or replace function public.protect_app_config_site_url()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' and old.key = 'site_url' then
    raise exception
      'app_config.site_url cannot be deleted: database webhooks resolve their target URL from it, and removing it would make notification inserts fail, which would block bookings. Update the value instead.'
      using errcode = 'restrict_violation';
  end if;

  if tg_op = 'UPDATE' and old.key = 'site_url' and new.key <> 'site_url' then
    raise exception
      'app_config.site_url cannot be renamed: database webhooks look it up by that exact key.'
      using errcode = 'restrict_violation';
  end if;

  return coalesce(new, old);
end;
$$;

drop trigger if exists app_config_protect_site_url on public.app_config;
create trigger app_config_protect_site_url
  before delete or update on public.app_config
  for each row
  execute function public.protect_app_config_site_url();

-- ---------------------------------------------------------------------------
-- The accessor.
--
-- RAISES rather than falling back to 'https://air-rally.com'. A fallback is
-- the current bug re-encoded: a misconfigured environment would silently
-- resume calling production, which is the exact failure this migration
-- exists to remove. Loud beats silent here.
--
-- Callers on a customer path must NOT let that raise escape — see 097, where
-- the notification triggers catch it and warn. This function is deliberately
-- strict; the decision about whether a missing URL should break a booking
-- belongs to the caller, not to the accessor.
-- ---------------------------------------------------------------------------
create or replace function public.site_url()
returns text
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_url text;
begin
  select value into v_url from public.app_config where key = 'site_url';

  if v_url is null or btrim(v_url) = '' then
    raise exception
      'app_config.site_url is not configured on this database.'
      using
        errcode = 'config_file_error',
        -- The hint deliberately does NOT name production's origin. A hint
        -- read on staging that names the live site is an instruction to
        -- recreate the exact bug this migration removes. Seed each database
        -- with ITS OWN origin. (Keeping the literal out of this function's
        -- source also lets a drift check assert that NO function body
        -- mentions the production host — a check that a well-meaning comment
        -- would otherwise defeat.)
        hint = 'insert into public.app_config (key, value) values (''site_url'', ''<this environment''''s own origin>'');';
  end if;

  -- Trailing slash stripped here rather than at every call site: callers
  -- append '/api/...', and 'https://host/' || '/api/x' yields a double slash
  -- that some routers 404 on. Normalising once removes a whole class of
  -- "works on one environment" bug.
  return rtrim(btrim(v_url), '/');
end;
$$;

revoke all on function public.site_url() from public, anon, authenticated;

comment on function public.site_url() is
  'The origin this database should call for its own environment. Raises when '
  'unconfigured rather than defaulting to production.';
