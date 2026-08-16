-- User Agreement / Terms acceptance tracking — required before signup can
-- be considered complete. Purely additive: a new table only, no existing
-- table/column/function/policy touched.
--
-- Written only through record_agreement_acceptance() (SECURITY DEFINER),
-- never a direct client insert — for the same reason confirm_booking_
-- payment()/confirm_paymongo_booking_payment() are RPC-only: the record
-- must exist even in the "email confirmation pending" signup path, where
-- the new user has no active session yet (auth.uid() would be null), so
-- ordinary RLS-gated self-service insert can't work here. The function
-- is called immediately after supabase.auth.signUp() returns, using the
-- new user's id from that response — never a client-supplied boolean.
create table public.agreement_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  -- Free text, not an enum — new agreement versions should never require
  -- a migration. lib/legal.ts#CURRENT_AGREEMENT_VERSION is the single
  -- source of truth for what "current" means at signup time.
  agreement_version text not null,
  accepted_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

create index agreement_acceptances_user_id_idx on public.agreement_acceptances (user_id);

alter table public.agreement_acceptances enable row level security;

-- Users can see their own acceptance history (e.g. a future "you accepted
-- v2026-08-16 on Aug 16" account-settings display); admins can see all,
-- matching the same posture as every other table in this schema.
create policy "Users can view their own agreement acceptances"
on public.agreement_acceptances for select
using (auth.uid() = user_id or public.is_admin());

-- No insert/update/delete policy for any client role — see the header
-- comment. This table is genuinely append-only and RPC-only.

create or replace function public.record_agreement_acceptance(
  p_user_id uuid,
  p_agreement_version text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_agreement_version is null or length(trim(p_agreement_version)) = 0 then
    raise exception 'agreement_version is required';
  end if;

  -- Grantable to anon (see below) means this is a public, unauthenticated
  -- write endpoint by construction — this check is the one thing standing
  -- between that and "anyone can forge an acceptance record for any real
  -- user id." When a session exists, it must be that same user's; the
  -- remaining gap (a fully anonymous caller with no session at all,
  -- needed for the "email confirmation pending" signup path where
  -- auth.uid() is genuinely null) is accepted and documented, matching
  -- confirm_paymongo_booking_payment()'s own "necessarily anon-callable"
  -- posture — unlike that function, there's no unguessable secret
  -- (payment/session id) to verify against here, so this is the
  -- strongest check available without one.
  if auth.uid() is not null and auth.uid() != p_user_id then
    raise exception 'Cannot record an agreement acceptance for another user.';
  end if;

  insert into public.agreement_acceptances (user_id, agreement_version)
  values (p_user_id, p_agreement_version);
end;
$$;

-- Callable with the plain anon key: the "email confirmation pending"
-- signup path has no authenticated session yet when this must run, the
-- same reasoning every other webhook/signup-adjacent RPC in this schema
-- already relies on (e.g. confirm_paymongo_booking_payment, callable by
-- the unauthenticated webhook route).
grant execute on function public.record_agreement_acceptance(uuid, text) to anon, authenticated;
