-- ---------------------------------------------------------------------------
-- Surfacing the ordering trap where it actually matters: the venue
-- approval screen, not a separate list an admin has to remember to check.
--
-- notify_on_venue_moderation_change() (migration 20260810000099) matches a
-- requester by venue_id, set only by admin_link_venue_requests() — and only
-- fires on the transition INTO 'active'. Link after that transition and
-- nothing sends, ever, retroactively or otherwise. This function exists so
-- an admin sees "these unlinked requests plausibly mean THIS venue" before
-- pressing Approve, not after.
--
-- FUZZY, DELIBERATELY LABELLED AS SUCH IN THE UI. This ranks candidates by
-- pg_trgm similarity between the venue's own name and each free-text
-- request's place_name; it never links anything itself. admin_link_venue_
-- requests() is the only function that writes venue_id, unchanged here.
--
-- ON THE INDEX QUESTION: pg_trgm is already enabled (20260809000008), and
-- venues.name/city already carry gin_trgm_ops indexes for the marketplace
-- search view. venue_requests.place_name/place_city carry NO trigram index.
-- Not added here — both sides of this join are small by construction (this
-- filters to venue_id is null, status = 'open', merged_into_id is null,
-- joined against exactly one venue), so there is nothing to scan that would
-- benefit from one at the scale this table exists at today. Revisit if
-- admin_unlinked_venue_requests() ever needs the same treatment against the
-- full table.
--
-- THIS REASONING HAS A SHELF LIFE. "Small by construction" holds only while
-- the unlinked backlog stays small — and the whole point of the requester
-- capture screen is to accumulate rows here, every one of which stays
-- unlinked until an admin acts on it. The backlog IS the success metric, so
-- growth is the expected outcome, not an edge case. Revisit this decision
-- once the unlinked backlog (venue_id is null, status = 'open') grows into
-- the thousands — not "if it ever becomes a problem," because a stale
-- justification with no expiry condition is exactly how a table scan
-- survives past the scale that made it fine.
create or replace function public.admin_venue_request_candidates(p_venue_id uuid)
returns table (
  place_name text,
  place_city text,
  requesters integer,
  oldest timestamptz,
  request_ids uuid[],
  similarity real
)
language sql
stable
security definer
set search_path = public
as $$
  select
    min(btrim(r.place_name)),
    min(btrim(coalesce(r.place_city, ''))),
    count(distinct r.user_id)::integer,
    min(r.created_at),
    array_agg(r.id),
    max(similarity(v.name, r.place_name))
  from public.venues v
  join public.venue_requests r on similarity(v.name, r.place_name) > 0.3
  where v.id = p_venue_id
    and r.venue_id is null
    and r.status = 'open'
    and r.merged_into_id is null
    and public.is_admin()
  group by lower(btrim(r.place_name)), lower(btrim(coalesce(r.place_city, '')))
  order by max(similarity(v.name, r.place_name)) desc;
$$;

revoke all on function public.admin_venue_request_candidates(uuid) from public, anon;
grant execute on function public.admin_venue_request_candidates(uuid) to authenticated;
