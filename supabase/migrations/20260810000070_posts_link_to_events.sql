-- Lets a post embed a joinable match card — "share this game into
-- COURT/Side". Nullable: most posts aren't about a specific event, and
-- unrelated to a post's own visibility, so no RLS change is needed here
-- — the join button a client renders for it goes through the ordinary
-- (now approval-gated, see 20260810000069) event_attendees insert path.

alter table public.posts
  add column event_id uuid references public.events (id) on delete set null;

create index posts_event_id_idx on public.posts (event_id);
