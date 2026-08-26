-- ============================================================================
-- "Request my venue" — capture demand for courts that are not on AIR/Rally
-- yet, so a player who cannot book becomes a sales lead instead of a churn.
--
-- WHY THIS SHAPE. The whole value is the sentence "14 players want to book at
-- Court X". That sentence is only TRUE if fourteen distinct people's entries
-- resolve to the same X. Free text gives "Court X", "court x", "CourtX
-- Pickleball", "courtx bgc" — five leads of three instead of one lead of
-- fourteen, which is worse than nothing because real demand then looks like
-- noise.
--
-- Three request targets, in descending order of reliability:
--   1. An existing venue row (draft/pending_review) — an FK, zero dedup risk,
--      and the strongest signal there is: already onboarding, people waiting.
--   2. A Google place_id — exact dedup, but needs a billed API dependency.
--      Deliberately NOT built yet; the column exists so adding it later does
--      not invalidate anything already collected.
--   3. Free text — always needed as a fallback, always needs an admin merge.
--
-- WHAT THIS DOES NOT MEASURE, and nobody should pitch otherwise: a request is
-- a claim, not a commitment. Fourteen requests are not fourteen bookings. And
-- it only ever counts people who already have the app, which today is nearly
-- nobody — it cannot see the demand it is being used to argue exists.
-- ============================================================================

create table if not exists public.venue_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,

  -- A request targets an existing venue, a named place, or (after an admin
  -- links a free-text request to a venue that later listed) BOTH. The
  -- constraint is "at least one", not "exactly one", precisely so linking is
  -- possible without destroying what the player originally typed.
  venue_id        uuid references public.venues(id) on delete cascade,
  place_name      text,
  place_city      text,
  place_address   text,
  google_place_id text,

  note   text,
  status text not null default 'open'
    check (status in ('open', 'listed', 'declined', 'duplicate')),
  merged_into_id uuid references public.venue_requests(id) on delete set null,

  listed_at  timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint venue_request_names_a_target
    check (venue_id is not null or nullif(btrim(place_name), '') is not null),
  constraint venue_request_note_length
    check (note is null or length(note) <= 500),
  constraint venue_request_place_name_length
    check (place_name is null or length(btrim(place_name)) between 2 and 160)
);

-- ---------------------------------------------------------------------------
-- THE ANTI-INFLATION GUARD. This is the credibility of the number.
--
-- Without it, "14 players want Court X" can be one player asking fourteen
-- times. The first time that figure is shown to a venue owner who checks, the
-- tool is dead — and so is the founder's credibility with that owner.
-- ---------------------------------------------------------------------------
create unique index if not exists venue_requests_one_per_user_per_venue
  on public.venue_requests (user_id, venue_id)
  where venue_id is not null;

create unique index if not exists venue_requests_one_per_user_per_place
  on public.venue_requests (user_id, lower(btrim(place_name)), lower(coalesce(btrim(place_city), '')))
  where venue_id is null and place_name is not null;

create index if not exists venue_requests_open_by_venue
  on public.venue_requests (venue_id) where status = 'open';

create or replace function public.set_venue_request_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end;
$$;

drop trigger if exists venue_requests_set_updated_at on public.venue_requests;
create trigger venue_requests_set_updated_at
  before update on public.venue_requests
  for each row execute function public.set_venue_request_updated_at();

-- === RLS ===================================================================
-- A player may create a request and see THEIR OWN. They may NOT see the
-- aggregate, for two reasons and the second is the one that matters:
--   * it is a commercial signal, and
--   * "nobody wants this venue" is a statement about a real third-party
--     business that we would be publishing on no evidence.
-- Status transitions are admin-only — no player UPDATE policy at all, same
-- posture as payout_batch_items.
alter table public.venue_requests enable row level security;

drop policy if exists venue_requests_insert_own on public.venue_requests;
create policy venue_requests_insert_own on public.venue_requests
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists venue_requests_select_own on public.venue_requests;
create policy venue_requests_select_own on public.venue_requests
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin());

drop policy if exists venue_requests_admin_all on public.venue_requests;
create policy venue_requests_admin_all on public.venue_requests
  for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Demand, counted honestly.
--
-- count(distinct user_id) over rows NOT merged away. count(*) would
-- double-count a person whose duplicate was merged, which is the same
-- inflation the unique indexes exist to prevent — reintroduced at read time.
-- ---------------------------------------------------------------------------
create or replace function public.admin_venue_demand()
returns table (
  venue_id uuid,
  venue_name text,
  venue_status text,
  place_name text,
  place_city text,
  requesters integer,
  first_requested_at timestamptz,
  last_requested_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select
    r.venue_id,
    v.name,
    v.status,
    case when r.venue_id is null then min(btrim(r.place_name)) end,
    case when r.venue_id is null then min(btrim(coalesce(r.place_city, ''))) end,
    count(distinct r.user_id)::integer,
    min(r.created_at),
    max(r.created_at)
  from public.venue_requests r
  left join public.venues v on v.id = r.venue_id
  where r.status in ('open', 'listed')
    and r.merged_into_id is null
    and public.is_admin()
  group by r.venue_id, v.name, v.status,
           case when r.venue_id is null then lower(btrim(r.place_name)) end,
           case when r.venue_id is null then lower(btrim(coalesce(r.place_city, ''))) end
  order by count(distinct r.user_id) desc, min(r.created_at);
$$;

revoke all on function public.admin_venue_demand() from public, anon;
grant execute on function public.admin_venue_demand() to authenticated;

-- ---------------------------------------------------------------------------
-- Link free-text requests to a real venue.
--
-- Needed because a free-text request that is never linked gets NO
-- notification when the venue lists — the pipeline would silently drop
-- exactly the people who took the trouble to type a name.
--
-- A conflict (this user already has a request against that venue) marks the
-- row 'duplicate' rather than failing the whole call: one collision must not
-- block linking the other nineteen.
-- ---------------------------------------------------------------------------
create or replace function public.admin_link_venue_requests(p_request_ids uuid[], p_venue_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  r record;
  v_linked integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Linking venue requests is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  if not exists (select 1 from public.venues where id = p_venue_id) then
    raise exception 'No such venue.' using errcode = 'no_data_found';
  end if;

  for r in select * from public.venue_requests where id = any(p_request_ids) loop
    begin
      update public.venue_requests
      set venue_id = p_venue_id
      where id = r.id;
      v_linked := v_linked + 1;
    exception when unique_violation then
      update public.venue_requests
      set status = 'duplicate', merged_into_id = (
        select id from public.venue_requests
        where user_id = r.user_id and venue_id = p_venue_id limit 1
      )
      where id = r.id;
    end;
  end loop;

  return v_linked;
end;
$$;

revoke all on function public.admin_link_venue_requests(uuid[], uuid) from public, anon;
grant execute on function public.admin_link_venue_requests(uuid[], uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- CLOSING THE LOOP — the half that actually retains anyone.
--
-- Capture alone is a suggestion box. The value is telling the people who
-- asked, at the moment the thing they wanted became possible.
--
-- Extends the EXISTING moderation-notification trigger rather than adding a
-- second one on the same table and event, so there stays one place to read.
--
-- NOTE the broader condition: the owner notification only fires on
-- pending_review -> active, but a venue can reach 'active' from 'draft' (all
-- three production venues did). Requesters are notified on ANY transition
-- into 'active', because they care that it is bookable, not how it got there.
--
-- Duplicates are notified too — the person still asked, and being told is
-- what they were promised. They are deduplicated by user, not by row.
-- ---------------------------------------------------------------------------
create or replace function public.notify_on_venue_moderation_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_notified integer := 0;
begin
  if new.status is distinct from old.status and new.owner_id is not null then
    if old.status = 'pending_review' and new.status = 'active' then
      insert into public.notifications (user_id, type, title, message)
      values (
        new.owner_id,
        'venue_approved',
        'Venue approved',
        new.name || ' is now live on Air/Rally.'
      );
    elsif old.status = 'pending_review' and new.status = 'suspended' then
      insert into public.notifications (user_id, type, title, message)
      values (
        new.owner_id,
        'venue_rejected',
        'Venue not approved',
        new.name || ' was not approved. Check your listing details and submit again.'
      );
    end if;
  end if;

  if new.status is distinct from old.status and new.status = 'active' then
    with recipients as (
      select distinct user_id
      from public.venue_requests
      where venue_id = new.id
        and status in ('open', 'duplicate')
    )
    insert into public.notifications (user_id, type, title, message, link_url)
    select
      recipients.user_id,
      'venue_requested_listed',
      'The court you asked for is live',
      new.name || ' is now on AIR/Rally. You asked for it — book a court.',
      '/venues/' || new.id
    from recipients;

    get diagnostics v_notified = row_count;

    update public.venue_requests
    set status = 'listed', listed_at = now()
    where venue_id = new.id and status in ('open', 'duplicate');

    if v_notified > 0 then
      raise notice 'notify_on_venue_moderation_change: told % requester(s) that % listed.', v_notified, new.name;
    end if;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- What the REQUESTER is told back.
--
-- The tension: a bare confirmation makes the action feel like a suggestion
-- box, which is the retention half of this feature lost. But a queryable
-- aggregate is a demand-intelligence surface about third-party businesses.
--
-- Resolution: a function that answers for ONE request the caller owns, and
-- for nothing else. They get the feedback; nobody gets the dataset.
--
-- AND THE LOW END IS HANDLED DELIBERATELY. "You're the 1st player to ask"
-- reads as "nobody else wants this" — demoralising to the player and an
-- unevidenced claim about a real business's desirability. Below the
-- threshold this returns a null count and the UI must show the PROMISE
-- ("we'll tell you the moment it lists") rather than a number. The number
-- only appears once it is genuinely encouraging.
-- ---------------------------------------------------------------------------
create or replace function public.venue_request_demand_for_me(p_request_id uuid)
returns table (requesters integer, show_count boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_threshold constant integer := 5;
  v_req public.venue_requests%rowtype;
  v_count integer;
begin
  select * into v_req from public.venue_requests where id = p_request_id;

  -- Owned by the caller, or nothing. This is the whole reason the function
  -- exists rather than a view: it cannot be pointed at someone else's row.
  if v_req.id is null or v_req.user_id is distinct from auth.uid() then
    raise exception 'No such request.' using errcode = 'no_data_found';
  end if;

  if v_req.venue_id is not null then
    select count(distinct user_id) into v_count
    from public.venue_requests
    where venue_id = v_req.venue_id and status in ('open', 'listed');
  else
    select count(distinct user_id) into v_count
    from public.venue_requests
    where venue_id is null
      and lower(btrim(place_name)) = lower(btrim(v_req.place_name))
      and lower(coalesce(btrim(place_city), '')) = lower(coalesce(btrim(v_req.place_city), ''))
      and status in ('open', 'listed');
  end if;

  return query select v_count, (v_count >= v_threshold);
end;
$$;

revoke all on function public.venue_request_demand_for_me(uuid) from public, anon;
grant execute on function public.venue_request_demand_for_me(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- Free-text requests that were never linked to a venue.
--
-- These get NO notification when "their" venue lists, because nothing
-- connects them to it. That failure is INVISIBLE from the admin side — a
-- merged venue goes live, everyone linked is told, and the admin has no
-- reason to suspect anyone was missed. Surfacing the count is what stops it
-- hiding.
-- ---------------------------------------------------------------------------
create or replace function public.admin_unlinked_venue_requests()
returns table (place_name text, place_city text, requesters integer, oldest timestamptz)
language sql
stable
security definer
set search_path = public
as $$
  select min(btrim(r.place_name)), min(btrim(coalesce(r.place_city, ''))),
         count(distinct r.user_id)::integer, min(r.created_at)
  from public.venue_requests r
  where r.venue_id is null
    and r.status = 'open'
    and r.merged_into_id is null
    and public.is_admin()
  group by lower(btrim(r.place_name)), lower(btrim(coalesce(r.place_city, '')))
  order by count(distinct r.user_id) desc, min(r.created_at);
$$;

revoke all on function public.admin_unlinked_venue_requests() from public, anon;
grant execute on function public.admin_unlinked_venue_requests() to authenticated;
