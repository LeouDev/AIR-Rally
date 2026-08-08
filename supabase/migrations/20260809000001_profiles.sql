-- Shared helpers used by every later migration.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- profiles ---------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  display_name text,
  avatar_url text,
  phone text,
  role text not null default 'player' check (role in ('player', 'venue_owner', 'admin')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

-- Role-check helper for RLS policies. SECURITY DEFINER so it can read
-- `profiles` without recursing back through this table's own RLS policies
-- (the classic "infinite recursion detected in policy" trap).
create or replace function public.is_admin()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- Users can never grant themselves a new role through a normal profile
-- update, no matter what the client sends — this is enforced here, not in
-- application code, so it holds even if a client bypasses the UI.
create or replace function public.prevent_role_self_escalation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if auth.uid() = new.id and new.role is distinct from old.role then
    new.role := old.role;
  end if;
  return new;
end;
$$;

create trigger profiles_prevent_role_change
before update on public.profiles
for each row execute function public.prevent_role_self_escalation();

-- Creates a profile row automatically whenever a new auth user is created.
-- Optional metadata (first_name/last_name/display_name) can be passed in
-- via `options.data` on `supabase.auth.signUp()`.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, first_name, last_name, display_name)
  values (
    new.id,
    new.raw_user_meta_data ->> 'first_name',
    new.raw_user_meta_data ->> 'last_name',
    coalesce(
      new.raw_user_meta_data ->> 'display_name',
      nullif(trim(concat(new.raw_user_meta_data ->> 'first_name', ' ', new.raw_user_meta_data ->> 'last_name')), '')
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- Row Level Security -------------------------------------------------------

alter table public.profiles enable row level security;

create policy "Users can view their own profile"
on public.profiles for select
using (auth.uid() = id or public.is_admin());

create policy "Users can update their own profile"
on public.profiles for update
using (auth.uid() = id or public.is_admin())
with check (auth.uid() = id or public.is_admin());

-- No insert policy: rows are created exclusively by the handle_new_user
-- trigger (SECURITY DEFINER, bypasses RLS), so no client — not even the
-- profile's own eventual owner — can insert a profiles row directly.
-- No delete policy: profiles are removed only via the `on delete cascade`
-- from auth.users when an account is deleted.

-- A narrow, public-safe view for displaying who wrote a review, who owns a
-- venue, etc. without exposing phone/email/role from the base table. Views
-- run with the privileges of their owner (the migration role) unless
-- `security_invoker` is set, so this intentionally sees through the
-- restrictive policies above for just these three columns.
create view public.public_profiles
with (security_invoker = false)
as
  select id, display_name, avatar_url from public.profiles;

grant select on public.public_profiles to anon, authenticated;
