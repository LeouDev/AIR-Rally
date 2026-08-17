-- handle_new_user() only ever read the first_name/last_name/display_name
-- keys our own manual signup form writes into raw_user_meta_data. Google
-- (and Facebook, once enabled) never populate those keys — Supabase
-- normalizes their profile info under full_name/name/avatar_url instead —
-- so every brand-new OAuth signup got a nameless, photo-less profile that
-- only ever showed the user's raw email address in the UI. Confirmed
-- against production: the one real Google-linked account only looks
-- correct because that email already had a manual-signup profile before
-- Google was linked to it; a genuinely new OAuth signup has nothing to
-- fall back on.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  meta jsonb := new.raw_user_meta_data;
  v_first_name text := coalesce(meta ->> 'first_name', meta ->> 'given_name');
  v_last_name text := coalesce(meta ->> 'last_name', meta ->> 'family_name');
  v_full_name text := coalesce(meta ->> 'full_name', meta ->> 'name');
begin
  -- OAuth providers give a single full name, not first/last — split it as
  -- a best effort so profile-edit fields aren't blank, but display_name
  -- below never depends on this split succeeding cleanly.
  if v_first_name is null and v_last_name is null and v_full_name is not null then
    v_first_name := nullif(split_part(v_full_name, ' ', 1), '');
    v_last_name := nullif(trim(substring(v_full_name from length(coalesce(v_first_name, '')) + 1)), '');
  end if;

  insert into public.profiles (id, first_name, last_name, display_name, avatar_url)
  values (
    new.id,
    v_first_name,
    v_last_name,
    coalesce(
      meta ->> 'display_name',
      nullif(trim(concat(v_first_name, ' ', v_last_name)), ''),
      v_full_name
    ),
    coalesce(meta ->> 'avatar_url', meta ->> 'picture')
  );
  return new;
end;
$$;
