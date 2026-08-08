create table public.favorites (
  user_id uuid not null references public.profiles (id) on delete cascade,
  venue_id uuid not null references public.venues (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- The composite primary key both indexes the pair and is the uniqueness
  -- guarantee: it's not possible to insert the same (user, venue) twice.
  primary key (user_id, venue_id)
);

create index favorites_venue_id_idx on public.favorites (venue_id);

alter table public.favorites enable row level security;

create policy "Users can view their own favorites"
on public.favorites for select
using (auth.uid() = user_id or public.is_admin());

create policy "Users can favorite venues for themselves"
on public.favorites for insert
with check (auth.uid() = user_id);

create policy "Users can remove their own favorites"
on public.favorites for delete
using (auth.uid() = user_id);
