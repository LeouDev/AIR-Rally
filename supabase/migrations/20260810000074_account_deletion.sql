-- Account deletion — Apple Guideline 5.1.1(v) requires a self-service path;
-- see the mobile submission audit (2026-08-20). This is NOT a hard delete
-- of the auth.users/profiles row, and that's a schema constraint, not a
-- preference: `bookings.user_id references public.profiles (id)` has no
-- `on delete` clause (defaults to NO ACTION), so any user who has ever
-- made a booking would make `DELETE FROM auth.users` fail outright with a
-- foreign key violation. Even where it wouldn't fail, `credit_transactions`
-- is `on delete cascade` from profiles and is documented in
-- 20260810000036_air_rally_credits.sql as "an immutable ledger... history
-- stays auditable" — cascading it away on deletion would destroy exactly
-- the settlement/audit trail that ledger exists to preserve.
--
-- So this anonymizes in place instead: scrub PII off `profiles`, drop
-- device push tokens and club memberships (nothing else references a user
-- for identity purposes), and leave bookings/credit_transactions/posts
-- untouched — a post's author still resolves through the (now anonymized)
-- profile join, so it displays as "Deleted user" rather than disappearing
-- or breaking like_count/comment threads for other users.
--
-- Any remaining AIR/Rally Credits balance is forfeited, not carried
-- forward or refunded — the user's own explicit decision (2026-08-20,
-- confirmed directly, not taken from a relay). This follows the ledger's
-- own convention: never an UPDATE to the balance, always a new
-- compensating row, so the forfeiture itself stays auditable rather than
-- just quietly zeroing user_credit_wallets.balance.
--
-- The actual auth-level lockout (ban the auth.users row, scrub its email,
-- revoke sessions) needs the Supabase Admin API, which only a service-role
-- client can call — see lib/services/accountDeletion.ts. This function is
-- the RLS/data half only, restricted to service_role for the same reason
-- complete_reschedule()/issue_credit() are: authorization here comes from
-- WHICH CODE is calling (a server route that has already verified the
-- caller's own token), not any value a client could supply.

alter table public.profiles add column if not exists deleted_at timestamptz;

alter table public.credit_transactions drop constraint credit_transactions_transaction_type_check;
alter table public.credit_transactions
  add constraint credit_transactions_transaction_type_check
  check (transaction_type in (
    'cancellation_compensation', 'admin_adjustment', 'promotion_bonus', 'booking_payment',
    'account_deletion_forfeiture'
  ));

create or replace function public.anonymize_account(p_user_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  update public.profiles
  set
    display_name = 'Deleted user',
    first_name = null,
    last_name = null,
    phone = null,
    avatar_url = null,
    deleted_at = now()
  where id = p_user_id
    and deleted_at is null;

  -- Locks the wallet row for the rest of this transaction, same as
  -- spend_credit() does, so a concurrent credit issuance can't land after
  -- this reads the balance but before the forfeiting row is inserted.
  select balance into v_balance
  from public.user_credit_wallets
  where user_id = p_user_id
  for update;

  if v_balance is not null and v_balance > 0 then
    insert into public.credit_transactions (user_id, amount, transaction_type, description)
    values (p_user_id, -v_balance, 'account_deletion_forfeiture', 'Balance forfeited on account deletion.');
  end if;

  delete from public.device_push_tokens where user_id = p_user_id;
  delete from public.club_members where user_id = p_user_id;
end;
$$;

revoke all on function public.anonymize_account(uuid) from public, anon, authenticated;
grant execute on function public.anonymize_account(uuid) to service_role;
