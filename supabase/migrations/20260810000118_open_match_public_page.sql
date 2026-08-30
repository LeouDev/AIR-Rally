-- Backs the public, sign-in-free open-match invite page (founder-approved
-- 2026-08-31 — see open-match-api-contract.md). Someone a link is
-- forwarded to should see the game and a way to install the app, not a
-- login wall — same reasoning, same shape, as
-- public_ranked_match_summary() (20260810000107) for ranked results.
--
-- FUNCTION, NOT A POLICY — deliberate. A row-level SELECT policy exposes
-- the ROW: every column added to open_matches from here on would be
-- public by default unless someone remembers to lock it down. An
-- explicit-column function exposes only what it names; a new column on
-- the table changes nothing here until someone deliberately adds it to
-- the return type. Same asymmetry as a new enum value crashing old
-- clients while a new column stays invisible to them — the default
-- direction of drift should be toward less exposure, not more.
--
-- RETURNS FOR EVERY STATUS, NOT JUST 'open' — converted/expired/cancelled
-- all return a row too. A 404 here reads as "the app is broken"; a page
-- that says "this game already filled up" is the actual growth moment —
-- someone arriving late still learns what AIR/Rally is. `status` is
-- returned VERBATIM; the page owns the copy per status, not this
-- function. An id that matches no row returns zero rows regardless of
-- status — that is the ONLY case meaning "no such match."
--
-- EXPOSURE, held constant across every status: host display_name and
-- avatar_url (nothing else from profiles — no email, phone, or
-- city_slug beyond the match's own target_city), target_city, status,
-- and the live accepted count via open_match_accepted_count(), never a
-- stored column. NOTHING from open_match_join_requests, in any form —
-- that table is host-or-self only and this must never become a way
-- around that. No requester identities, no counts-by-person, nothing
-- joinable back to a specific requester.
--
-- Enumeration is not a concern: open_matches.id is gen_random_uuid()
-- (122 bits) — this is lookup-if-you-have-the-link, not walk-the-space.
-- Nobody can discover a match through this function who wasn't already
-- given its id.
--
-- No time/venue field: open question with the founder as of this
-- writing (an open match broadcasts now and expires in an hour; the
-- founder's own Reclub reference had both a scheduled time and a
-- venue). Not shaped around one, not foreclosing one either.
begin;

create or replace function public.get_open_match_public(p_open_match_id uuid)
returns table (
  host_display_name text,
  host_avatar_url text,
  target_city text,
  status text,
  accepted_count integer
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
    public.open_match_accepted_count(m.id)
  from public.open_matches m
  join public.profiles p on p.id = m.host_id
  where m.id = p_open_match_id;
$$;

revoke all on function public.get_open_match_public(uuid) from public, anon, authenticated;
grant execute on function public.get_open_match_public(uuid) to anon, authenticated;

commit;
