-- ============================================================================
-- Three additions to the venue-request pipeline (099): a status the admin
-- view can actually set, a narrow autocomplete for the capture form, and a
-- genuinely public per-request summary — the artifact a player shares with
-- their venue and the founder shares from the admin view.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- 1. 'contacted' as a real status.
--
-- The pipeline is open -> contacted -> declined -> listed. 'listed' is set
-- automatically by the moderation trigger; 'declined' already existed. But
-- the CHECK constraint never included 'contacted', so an admin marking "I
-- reached out to this venue" had nowhere to write that -- a four-state
-- pipeline with one state unreachable is not a pipeline.
-- ---------------------------------------------------------------------------
alter table public.venue_requests drop constraint venue_requests_status_check;
alter table public.venue_requests
  add constraint venue_requests_status_check
  check (status in ('open', 'contacted', 'listed', 'declined', 'duplicate'));

-- ---------------------------------------------------------------------------
-- 2. Autocomplete for the capture form — FREE-TEXT REQUESTS ONLY.
--
-- Deliberately does NOT search draft/pending_review venues. A venue mid-
-- onboarding is invisible to ordinary players under venues' own RLS
-- ("Public can view active venues"); building a function that reveals its
-- name to any signed-in user is a real exposure decision -- discoverable
-- before the venue has chosen to be public -- made in service of a nice-to-
-- have autocomplete. Excluding it removes the decision entirely rather than
-- making it implicitly.
--
-- What this costs: a player typing a venue that IS already onboarding
-- creates a free-text request instead of matching the real row. The admin
-- merges it later via admin_link_venue_requests() -- built for exactly this.
-- The signal isn't lost, it arrives one manual step later.
--
-- Returns name/city only. No requester, no counts -- selecting a suggestion
-- is what performs the dedup; the count is not the point of this call.
-- ---------------------------------------------------------------------------
create or replace function public.venue_request_place_suggestions(p_query text)
returns table (place_name text, place_city text)
language sql
stable
security definer
set search_path = public
as $$
  select distinct btrim(r.place_name), btrim(coalesce(r.place_city, ''))
  from public.venue_requests r
  where r.venue_id is null
    and r.status = 'open'
    and r.merged_into_id is null
    and nullif(btrim(p_query), '') is not null
    and r.place_name ilike '%' || btrim(p_query) || '%'
  order by 1
  limit 8;
$$;

revoke all on function public.venue_request_place_suggestions(text) from public, anon;
grant execute on function public.venue_request_place_suggestions(text) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. admin_venue_demand() gains a representative request id.
--
-- The admin view needs a link per row -- "share this with the venue" -- and
-- a link needs a request id to key the public page on. The function grouped
-- rows into clusters but never returned an id from inside the group.
--
-- An arbitrary-but-deterministic representative row: any request in the
-- cluster resolves to the same aggregate (see public_venue_request_summary
-- below), so which one is picked doesn't matter, only that it's stable.
-- min(r.id::text)::uuid rather than min(r.id) -- Postgres has no built-in
-- min() aggregate for uuid, only the btree ordering operators sort() uses.
--
-- Adding a column changes the return type, which create-or-replace cannot do
-- for a table-returning function -- drop first.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_venue_demand();

create function public.admin_venue_demand()
returns table (
  venue_id uuid,
  venue_name text,
  venue_status text,
  place_name text,
  place_city text,
  requesters integer,
  first_requested_at timestamptz,
  last_requested_at timestamptz,
  sample_request_id uuid,
  -- True once every row in the cluster is 'contacted' or 'listed' -- no
  -- 'open' row remains. A UI signal only ("you've followed up on everyone
  -- who's asked so far"); it does NOT remove the cluster from this list,
  -- because a fully-contacted cluster that simply vanished would look like
  -- the lead was never real rather than like it was handled. 'contacted' is
  -- now included in the WHERE below for the same reason: marking a cluster
  -- contacted must not make it disappear from view.
  fully_contacted boolean
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
    max(r.created_at),
    min(r.id::text)::uuid,
    bool_and(r.status <> 'open')
  from public.venue_requests r
  left join public.venues v on v.id = r.venue_id
  where r.status in ('open', 'contacted', 'listed')
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
-- 4. The public per-request summary — genuinely anonymous.
--
-- Neither existing count function can serve this page:
--   venue_request_demand_for_me() answers ONLY for the caller's own request,
--     and is authenticated-only.
--   admin_venue_demand() is admin-only.
--
-- This has to work for a venue manager with no account and no app, which is
-- the entire point of the page -- so it is granted to anon as well as
-- authenticated, and does NOT check who is asking.
--
-- Keyed on the request's own id rather than venue_id or a place slug,
-- because most requests are free text with no venue_id, and an id exists
-- from the moment a player submits -- which is what makes the player-share
-- half of this feature possible at all. The id is a UUID, so the aggregate
-- is not enumerable by guessing.
--
-- Follows merged_into_id so a link shared before an admin merge still
-- resolves to the current, correct cluster rather than a dead end. Bounded
-- to guard against a cycle, though admin_link_venue_requests() only ever
-- creates single-level chains.
--
-- THE THRESHOLD IS THE SAME RULE AS venue_request_demand_for_me(), FOR THE
-- SAME REASON, APPLIED TO A DIFFERENT READER. Below 5, "you're the 1st"
-- reads as nobody wants this to the player who submitted; on THIS page the
-- reader is the venue, so the failure mode is different but the fix is the
-- same: omit the number rather than publish a discouraging one. There is
-- deliberately NO version of this page's copy that says "we'll tell you
-- when it lists" -- that sentence is addressed to the submitting player and
-- is meaningless, or actively confusing, to the venue manager who is the
-- actual reader of a shared link.
-- ---------------------------------------------------------------------------
create or replace function public.public_venue_request_summary(p_request_id uuid)
returns table (display_name text, city text, requesters integer, show_count boolean)
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_id uuid := p_request_id;
  v_venue_id uuid;
  v_place_name text;
  v_place_city text;
  v_merged_into uuid;
  v_hops integer := 0;
  v_display_name text;
  v_city text;
  v_count integer;
begin
  loop
    select venue_id, place_name, place_city, merged_into_id
      into v_venue_id, v_place_name, v_place_city, v_merged_into
      from public.venue_requests where id = v_id;

    if not found then
      raise exception 'No such request.' using errcode = 'no_data_found';
    end if;

    exit when v_merged_into is null or v_hops >= 5;
    v_id := v_merged_into;
    v_hops := v_hops + 1;
  end loop;

  if v_venue_id is not null then
    select v.name, v.city into v_display_name, v_city
      from public.venues v where v.id = v_venue_id;

    select count(distinct user_id) into v_count
      from public.venue_requests
      where venue_id = v_venue_id
        and status in ('open', 'contacted', 'listed');
  else
    v_display_name := btrim(v_place_name);
    v_city := btrim(coalesce(v_place_city, ''));

    select count(distinct user_id) into v_count
      from public.venue_requests
      where venue_id is null
        and lower(btrim(place_name)) = lower(btrim(v_place_name))
        and lower(coalesce(btrim(place_city), '')) = lower(coalesce(btrim(v_place_city), ''))
        and status in ('open', 'contacted', 'listed');
  end if;

  return query select v_display_name, v_city, v_count, (v_count >= 5);
end;
$$;

revoke all on function public.public_venue_request_summary(uuid) from public, anon, authenticated;
grant execute on function public.public_venue_request_summary(uuid) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 5. Setting 'contacted'/'declined' operates on the CLUSTER, not one row.
--
-- Status lives on each individual venue_requests row, but "I contacted this
-- venue" is a fact about the PLACE, not about any one of the (possibly
-- fourteen) players who separately asked for it. A plain single-row UPDATE
-- would flip one arbitrary request to 'contacted' while the other thirteen
-- stayed 'open' -- and admin_venue_demand() filters to status in
-- ('open','listed'), so the cluster would keep showing as open regardless of
-- what the admin just did. Bulk-updating every live row in the cluster is
-- what makes the admin's action match what admin_venue_demand() displays.
--
-- Restricted to 'contacted' and 'declined' -- the two states an admin sets by
-- hand. 'listed' is set only by the moderation trigger and 'duplicate' only
-- by the merge function; this must not become a second way to set either.
-- ---------------------------------------------------------------------------
create or replace function public.admin_set_venue_request_cluster_status(p_request_id uuid, p_status text)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_venue_id uuid;
  v_place_name text;
  v_place_city text;
  v_updated integer;
begin
  if not public.is_admin() then
    raise exception 'Setting a venue request''s status is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  if p_status not in ('contacted', 'declined') then
    raise exception 'Only contacted or declined can be set here.' using errcode = 'check_violation';
  end if;

  select venue_id, place_name, place_city into v_venue_id, v_place_name, v_place_city
    from public.venue_requests where id = p_request_id;

  if not found then
    raise exception 'No such request.' using errcode = 'no_data_found';
  end if;

  if v_venue_id is not null then
    update public.venue_requests
    set status = p_status
    where venue_id = v_venue_id and status in ('open', 'contacted');
  else
    update public.venue_requests
    set status = p_status
    where venue_id is null
      and lower(btrim(place_name)) = lower(btrim(v_place_name))
      and lower(coalesce(btrim(place_city), '')) = lower(coalesce(btrim(v_place_city), ''))
      and status in ('open', 'contacted');
  end if;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.admin_set_venue_request_cluster_status(uuid, text) from public, anon;
grant execute on function public.admin_set_venue_request_cluster_status(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. admin_unlinked_venue_requests() gains the request ids in each cluster.
--
-- The merge action (admin_link_venue_requests) takes an ARRAY OF REQUEST
-- IDS. The unlinked-requests list only ever returned the aggregate --
-- there was no way to get from "this place has 6 unlinked requests" to the
-- ids needed to actually merge them. Adding request_ids closes that.
-- ---------------------------------------------------------------------------
drop function if exists public.admin_unlinked_venue_requests();

create function public.admin_unlinked_venue_requests()
returns table (place_name text, place_city text, requesters integer, oldest timestamptz, request_ids uuid[])
language sql
stable
security definer
set search_path = public
as $$
  select min(btrim(r.place_name)), min(btrim(coalesce(r.place_city, ''))),
         count(distinct r.user_id)::integer, min(r.created_at),
         array_agg(r.id)
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
