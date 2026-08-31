-- Open Match gets a scheduled time and a venue. Founder decision
-- 2026-08-31, referencing Reclub's own push ("4 players at 5pm on
-- Saturday at Nomads Pickleball") — both, not either. Two product
-- questions (does "now" still exist as its own mode; does the host
-- still approve requests or does first-come win) stay open and do NOT
-- touch this schema either way — see open-match-design.md.
--
-- ============================================================================
-- SCHEDULED_AT — required, no "now" special-casing at the schema level
-- ============================================================================
--
-- Whichever way the "now" question resolves, every open match ends up
-- with a concrete timestamp: either a real picked time, or (if "now"
-- survives as a mode) something like now() + a UI-chosen buffer computed
-- by whoever builds that flow. The column doesn't need to know which —
-- it is simply not-null, always.
--
-- ============================================================================
-- VENUE — display-only, on purpose, unlike the city
-- ============================================================================
--
-- The city drives who receives the broadcast, so it has to match
-- exactly — that's the whole reason cities is a 25-row lookup table.
-- The venue is text a human reads on an invite: "Nomads", "Nomads
-- Pickleball" and "nomads" are all fine, because nothing ever matches
-- on it. So: an optional FK for when the host picks one of ours, and a
-- free-text label for everywhere else (their own Reclub reference,
-- Nomads, isn't one of the three venues in this system, and restricting
-- to those three would make the feature useless). NOT normalized. NOT
-- a lookup table. If matching on venue is ever wanted, that's a new
-- decision with new columns, not something to pre-build here.
--
-- ============================================================================
-- EXPIRY CHANGES SHAPE
-- ============================================================================
--
-- The old rule (expire `open` past 1 hour from created_at) is wrong the
-- moment a match can be scheduled for the future: a Saturday game
-- posted Tuesday would die within the hour. Expiry moves to be relative
-- to scheduled_at, not created_at, with NO grace window after it: a
-- game at 5pm that never filled is dead at 5pm, full stop. If it DID
-- fill, it already left `open` status (converted) well before 5pm
-- arrived, so this can never kill a real result. A host whose game
-- didn't fill by kickoff can post a new one rather than the system
-- pretending the original time is still live. This also fixes the
-- Tuesday/Saturday case directly: nothing here looks at created_at at
-- all anymore, so a match stays `open` and browsable for however long
-- until its own scheduled_at, not a fixed hour.
--
-- Existing rows: none. Checked directly on both databases before
-- writing this (not assumed) — staging had 3 orphaned fixtures from an
-- unrelated crashed test run, deleted; production has zero. A clean
-- cutover, not a backfill.
begin;

alter table public.open_matches
  add column scheduled_at timestamptz,
  add column venue_id uuid references public.venues (id) on delete set null,
  add column venue_label text;

-- Two-step (nullable add, then NOT NULL) rather than one statement with
-- a default: there is no sensible default for a real user-facing
-- scheduled time, and the table is empty on every environment this
-- runs against, so there is nothing to backfill and nothing a default
-- would paper over.
alter table public.open_matches
  alter column scheduled_at set not null;

comment on column public.open_matches.scheduled_at is
  'When the match is meant to be played. Required. expire_stale_open_matches() '
  'sweeps relative to this, not to created_at.';

comment on column public.open_matches.venue_id is
  'Optional FK when the host picks one of our listed venues. Display only — '
  'never matched or filtered on. NULL is normal (most real-world venues, '
  'including the founder''s own Reclub reference, are not in this table).';

comment on column public.open_matches.venue_label is
  'Free-text venue name for anywhere not in venues. Deliberately NOT '
  'normalized or canonicalized, unlike target_city — nothing ever matches '
  'against this value, it is read by a human on an invite.';

create or replace function public.create_open_match(
  p_city_slug text,
  p_scheduled_at timestamptz,
  p_venue_id uuid default null,
  p_venue_label text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_open_match_id uuid;
  v_host_name text;
begin
  if v_caller is null then
    raise exception 'Not authenticated' using errcode = 'AR001';
  end if;

  if not exists (select 1 from public.cities where slug = p_city_slug) then
    raise exception 'Pick a valid city.' using errcode = 'AR001';
  end if;

  if p_scheduled_at <= now() then
    raise exception 'Pick a time in the future.' using errcode = 'AR001';
  end if;

  perform public.ensure_player_rank(v_caller);

  -- The city picked here IS the player's registered city going forward —
  -- "ask inside the Find Match flow", not a per-match-only value. Per
  -- the design memory this is PERMANENT: a later device-location signal
  -- only pre-fills the ask, it never silently overwrites this column.
  update public.profiles set city_slug = p_city_slug where id = v_caller;

  insert into public.open_matches (host_id, target_city, scheduled_at, venue_id, venue_label)
  values (v_caller, p_city_slug, p_scheduled_at, p_venue_id, p_venue_label)
  returning id into v_open_match_id;

  select display_name into v_host_name from public.profiles where id = v_caller;

  -- One broadcast, sent once, to every other player registered in this
  -- city. "One notification per player" is satisfied by never
  -- re-sending, not by a dedupe check — expire_stale_open_matches()
  -- below does not repeat this.
  --
  -- THIS SCALES LINEARLY WITH CITY POPULATION, ON PURPOSE — that is the
  -- feature. It is currently safe only because the email webhook has no
  -- ranked-type eligible today (measured 2026-08-30: 95 calls, all
  -- `emailed:false`) and push no-ops per recipient with no device token
  -- (see notification-paths-have-asymmetric-guards memory). The day
  -- 'open_match_found' — or any ranked type — becomes email-eligible,
  -- every create_open_match() call becomes a mail-out to a whole city.
  -- That flag will be flipped somewhere else entirely (the webhook's own
  -- eligibility list), by someone who has no reason to read this RPC
  -- first. If you are that person: this is the trigger, not the victim.
  insert into public.notifications (user_id, type, title, message, link_url)
  select p.id, 'open_match_found', 'Open match near you',
         coalesce(v_host_name, 'Someone') || ' is looking for players — tap to join.',
         '/ranked/open/' || v_open_match_id
  from public.profiles p
  where p.city_slug = p_city_slug and p.id <> v_caller;

  return v_open_match_id;
end;
$$;

revoke execute on function public.create_open_match(text, timestamptz, uuid, text) from public, anon;
grant execute on function public.create_open_match(text, timestamptz, uuid, text) to authenticated;

-- The old create_open_match(text) signature is gone — no client has
-- ever called it (nothing beyond staging tests existed before this
-- migration), so there is no compatibility shim to keep.
drop function if exists public.create_open_match(text);

create or replace function public.expire_stale_open_matches()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with stale as (
    select id from public.open_matches
    where status = 'open' and scheduled_at <= now()
  )
  update public.open_matches m
  set status = 'expired'
  from stale s
  where m.id = s.id;

  get diagnostics v_count = row_count;

  update public.open_match_join_requests r
  set status = 'declined'
  where r.status = 'pending'
    and exists (
      select 1 from public.open_matches m
      where m.id = r.open_match_id and m.status = 'expired'
    );

  return v_count;
end;
$$;

revoke execute on function public.expire_stale_open_matches() from public, anon, authenticated;

-- The old expire_stale_open_matches(integer) signature took a
-- configurable minutes-from-created_at window, which no longer applies
-- now that expiry is relative to scheduled_at. Drop it and repoint the
-- cron job at the new zero-arg signature (cron.schedule upserts by job
-- name, so this updates the existing job rather than duplicating it).
drop function if exists public.expire_stale_open_matches(integer);

select cron.schedule(
  'expire-stale-open-matches',
  '*/15 * * * *',
  $$select public.expire_stale_open_matches()$$
);

-- Adds two columns to the return table, and CREATE OR REPLACE cannot
-- change an existing function's return type — drop first.
drop function if exists public.get_open_match_public(uuid);

create function public.get_open_match_public(p_open_match_id uuid)
returns table (
  host_display_name text,
  host_avatar_url text,
  target_city text,
  status text,
  accepted_count integer,
  scheduled_at timestamptz,
  venue_display text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    p.display_name,
    p.avatar_url,
    m.target_city,
    m.status,
    public.open_match_accepted_count(m.id),
    m.scheduled_at,
    coalesce(v.name, m.venue_label)
  from public.open_matches m
  join public.profiles p on p.id = m.host_id
  left join public.venues v on v.id = m.venue_id
  where m.id = p_open_match_id;
$$;

revoke all on function public.get_open_match_public(uuid) from public, anon, authenticated;
grant execute on function public.get_open_match_public(uuid) to anon, authenticated;

commit;
