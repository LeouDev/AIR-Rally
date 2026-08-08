create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  venue_id uuid not null references public.venues (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  -- No foreign key yet — `bookings` doesn't exist until the booking-engine
  -- phase. The column exists now so the relationship doesn't require a
  -- breaking migration later; add `references public.bookings (id)` then.
  booking_id uuid,
  rating integer not null check (rating between 1 and 5),
  title text,
  comment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index reviews_venue_id_idx on public.reviews (venue_id);
create index reviews_user_id_idx on public.reviews (user_id);

create trigger reviews_set_updated_at
before update on public.reviews
for each row execute function public.set_updated_at();

-- Keeps venues.average_rating / review_count in sync with the reviews
-- table so venue listings don't need to aggregate reviews on every read.
create or replace function public.update_venue_rating_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_venue_id uuid := coalesce(new.venue_id, old.venue_id);
begin
  update public.venues
  set average_rating = coalesce(
        (select round(avg(rating)::numeric, 2) from public.reviews where venue_id = target_venue_id),
        0
      ),
      review_count = (select count(*) from public.reviews where venue_id = target_venue_id)
  where id = target_venue_id;
  return coalesce(new, old);
end;
$$;

create trigger reviews_update_venue_rating
after insert or update or delete on public.reviews
for each row execute function public.update_venue_rating_stats();

alter table public.reviews enable row level security;

create policy "Reviews are publicly readable"
on public.reviews for select
using (true);

-- Structural policy for the relationship described in the brief. No UI
-- path calls this yet — review submission is deferred until reviews can be
-- tied to a completed booking — but the policy itself is correct today: a
-- user may only ever write a review as themselves, never on another
-- user's behalf.
create policy "Users can write reviews as themselves"
on public.reviews for insert
with check (auth.uid() = user_id);

create policy "Users can update their own reviews"
on public.reviews for update
using (auth.uid() = user_id or public.is_admin())
with check (auth.uid() = user_id or public.is_admin());

create policy "Users can delete their own reviews"
on public.reviews for delete
using (auth.uid() = user_id or public.is_admin());
