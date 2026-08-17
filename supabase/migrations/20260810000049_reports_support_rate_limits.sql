-- Trust & safety: user reports, support requests, and rate limits.
--
-- COURT/Side now accepts public posts, images, comments and player-created
-- clubs, and there has been no way for a user to report any of it, and no
-- way to contact anyone about a problem. This adds both, plus the limits
-- that stop a single account flooding the platform.

-- ---------------------------------------------------------------------------
-- reports
-- ---------------------------------------------------------------------------
--
-- target_id is deliberately a bare uuid with no foreign key: it points at
-- one of five different tables depending on target_type, and no single FK
-- can express that. The consequence is chosen, not overlooked — a report
-- SURVIVES the deletion of what it describes, which is what a moderation
-- record has to do. A report that vanished the moment an abusive post was
-- deleted would erase the evidence and the reporter's history together.
-- Resolution reads the target if it still exists and shows "no longer
-- available" when it does not.
create table public.reports (
  id uuid primary key default gen_random_uuid(),
  reporter_id uuid not null references public.profiles (id) on delete cascade,
  target_type text not null check (target_type in ('post', 'comment', 'club', 'event', 'user')),
  target_id uuid not null,
  reason text not null check (
    reason in ('spam', 'harassment', 'hate_speech', 'sexual_content', 'violence', 'misinformation', 'impersonation', 'other')
  ),
  details text check (details is null or char_length(details) between 1 and 1000),
  status text not null default 'open' check (status in ('open', 'reviewed', 'dismissed')),
  -- Who actioned it and what they concluded. Null until resolved.
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text check (resolution_note is null or char_length(resolution_note) <= 1000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- A resolved report must record who resolved it and when; an open one
  -- must not claim either. Written as an implication rather than a
  -- biconditional on a status list, which is the mistake that made
  -- cancelling an approved payout batch impossible in 20260810000042.
  constraint reports_resolution_complete check (
    (status = 'open' and resolved_by is null and resolved_at is null)
    or (status in ('reviewed', 'dismissed') and resolved_by is not null and resolved_at is not null)
  )
);

-- One open report per person per thing. Re-reporting the same post over
-- and over is itself a spam vector, and duplicates make the queue useless.
-- Partial, so a user CAN report again after a previous report was resolved
-- — the target may have got worse since.
create unique index reports_one_open_per_reporter_target
on public.reports (reporter_id, target_type, target_id)
where status = 'open';

create index reports_status_created_idx on public.reports (status, created_at desc);
create index reports_target_idx on public.reports (target_type, target_id);

create trigger reports_set_updated_at
before update on public.reports
for each row execute function public.set_updated_at();

alter table public.reports enable row level security;

-- Anyone signed in can file a report, as themselves and only as themselves.
create policy "Users can file their own reports"
on public.reports for insert
to authenticated
with check (reporter_id = auth.uid());

-- Reporters see their own; admins see everything.
create policy "Reporters see their own reports"
on public.reports for select
to authenticated
using (reporter_id = auth.uid() or public.is_admin());

-- Only admins resolve. Deliberately no UPDATE policy for reporters: a
-- reporter editing a filed report after the fact would let them change
-- what a moderator already acted on.
create policy "Admins resolve reports"
on public.reports for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- support_requests
-- ---------------------------------------------------------------------------
--
-- There is no email infrastructure, so this cannot promise a reply by
-- email. Replies reach the user as an in-app notification, and the /support
-- page says exactly that rather than implying an inbox response.
create table public.support_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  category text not null check (
    category in ('booking', 'payment', 'account', 'venue', 'safety', 'bug', 'other')
  ),
  subject text not null check (char_length(subject) between 1 and 200),
  message text not null check (char_length(message) between 1 and 4000),
  status text not null default 'open' check (status in ('open', 'in_progress', 'resolved', 'closed')),
  resolved_by uuid references public.profiles (id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint support_resolution_complete check (
    status not in ('resolved', 'closed') or (resolved_by is not null and resolved_at is not null)
  )
);

create index support_requests_status_created_idx on public.support_requests (status, created_at desc);
create index support_requests_user_idx on public.support_requests (user_id, created_at desc);

create trigger support_requests_set_updated_at
before update on public.support_requests
for each row execute function public.set_updated_at();

alter table public.support_requests enable row level security;

create policy "Users can raise their own support requests"
on public.support_requests for insert
to authenticated
with check (user_id = auth.uid());

create policy "Users see their own support requests"
on public.support_requests for select
to authenticated
using (user_id = auth.uid() or public.is_admin());

create policy "Admins update support requests"
on public.support_requests for update
to authenticated
using (public.is_admin())
with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Rate limits
-- ---------------------------------------------------------------------------
--
-- Enforced in the database, not the app. There is no Redis and no edge
-- middleware, and more importantly a limit in a server action is only a
-- limit for callers who go through that server action — PostgREST is
-- reachable directly with the anon key. A BEFORE INSERT trigger is the
-- only place a limit cannot be walked around.
--
-- Thresholds live in this one function so they are adjustable in a single
-- place rather than scattered across five triggers.
create or replace function public.rate_limit_threshold(p_kind text)
returns table (max_rows integer, window_interval interval)
language sql
immutable
as $$
  -- Explicit column list, not `select *`: the VALUES list carries the
  -- lookup key as a third column, which does not match this function's
  -- two-column signature.
  select t.max_rows, t.window_interval
  from (values
    ('post',    10, interval '1 hour'),
    ('comment', 30, interval '1 hour'),
    ('club',     3, interval '1 day'),
    ('report',  20, interval '1 day'),
    ('support',  5, interval '1 day')
  ) as t(kind, max_rows, window_interval)
  where t.kind = p_kind;
$$;

/**
 * Shared limiter. Counts the caller's own recent rows in the given table
 * and raises once they are at the threshold.
 *
 * SECURITY DEFINER because the count must see ALL of the user's rows: a
 * plain count under RLS would only see what the caller can select, and for
 * reports that is fine but for a table where the user cannot read their own
 * history it would silently count zero and never limit anything.
 *
 * Admins are exempt — moderation work legitimately involves bursts, and an
 * admin locked out of filing reports is a worse failure than an admin
 * posting quickly.
 */
create or replace function public.enforce_rate_limit()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kind text := tg_argv[0];
  v_user_column text := tg_argv[1];
  v_user_id uuid;
  v_max integer;
  v_window interval;
  v_count integer;
begin
  execute format('select ($1).%I', v_user_column) into v_user_id using new;

  -- No session (service-role writes, triggers, seed scripts) is not a
  -- user action and is never limited.
  if v_user_id is null or auth.uid() is null then
    return new;
  end if;

  if public.is_admin() then
    return new;
  end if;

  select t.max_rows, t.window_interval into v_max, v_window
  from public.rate_limit_threshold(v_kind) t;

  if v_max is null then
    return new;
  end if;

  execute format(
    'select count(*) from public.%I where %I = $1 and created_at > now() - $2',
    tg_table_name, v_user_column
  ) into v_count using v_user_id, v_window;

  if v_count >= v_max then
    raise exception 'rate limit reached: at most % per % for %', v_max, v_window, v_kind
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

create trigger posts_rate_limit
before insert on public.posts
for each row execute function public.enforce_rate_limit('post', 'user_id');

create trigger post_comments_rate_limit
before insert on public.post_comments
for each row execute function public.enforce_rate_limit('comment', 'user_id');

create trigger clubs_rate_limit
before insert on public.clubs
for each row execute function public.enforce_rate_limit('club', 'owner_id');

create trigger reports_rate_limit
before insert on public.reports
for each row execute function public.enforce_rate_limit('report', 'reporter_id');

create trigger support_requests_rate_limit
before insert on public.support_requests
for each row execute function public.enforce_rate_limit('support', 'user_id');

-- The limiter is SECURITY DEFINER, so per migrations 047/048 its own reach
-- is the boundary. It only ever counts and raises — it writes nothing — and
-- it is a trigger function, so PostgREST cannot call it as an RPC.
comment on function public.enforce_rate_limit() is
  'BEFORE INSERT rate limiter. Reads thresholds from rate_limit_threshold(). '
  'Counts only, never writes. Exempts admins and non-user (service-role) writes.';
