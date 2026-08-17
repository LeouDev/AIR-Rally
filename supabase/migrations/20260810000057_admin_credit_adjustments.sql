-- Admin credit management: a write path, an actor, and a liability figure.
--
-- addCredit()/deductCredit() have existed and been tested since
-- 20260810000036, but nothing in the application can reach them. Correcting
-- a customer's balance today means hand-editing a financial table in
-- production. Since credits never expire, issuance discipline is the only
-- control on the liability, and it currently has no interface.
--
-- THREE THINGS THE EXISTING SCHEMA CANNOT DO
--
-- 1. It cannot say WHO adjusted a balance. credit_transactions records
--    user_id (whose wallet), amount, type, reference_id and description —
--    there is no actor column. "Admin X granted ₱500" is unanswerable, and
--    for a ledger that is the whole point of an audit trail.
--
-- 2. spend_credit() cannot express an admin deduction. It hardcodes
--    transaction_type = 'booking_payment' and requires a booking
--    reference_id (no default). Using it for a correction would file that
--    correction as a booking payment against a booking that does not
--    exist — corrupting the meaning of every row of that type, including
--    the ones reconciliation depends on.
--
-- 3. Neither issue_credit() nor spend_credit() can enforce "admin only".
--    Both are granted to service_role, and a service_role call carries no
--    auth.uid(), so is_admin() is false inside them by construction. The
--    authority for those functions is *which code calls them*, which is an
--    application-layer guarantee.
--
-- ON FOLLOWING 20260810000047's PATTERN: that migration's pattern is
-- service_role-only, and it is right for the webhook, where the authority
-- is a verified PayMongo signature that cannot be expressed in SQL. It is
-- the WRONG pattern here. An admin action has an authority that SQL can
-- express — is_admin() on the caller — and routing it through service_role
-- would move the check into application code, which is precisely what
-- "enforced at the database level" rules out. So this function is granted
-- to `authenticated` and checks is_admin() itself: a non-admin calling it
-- directly is refused by the database, with no application code involved.

-- === 1. Who did it =======================================================
--
-- Nullable, and deliberately so: every existing row predates this column
-- and no honest value can be invented for them. Null means "system or
-- pre-audit", not "unknown admin". System paths (cancellation
-- compensation, booking payments) legitimately have no actor.

alter table public.credit_transactions
  add column if not exists actor_id uuid references public.profiles (id) on delete set null;

comment on column public.credit_transactions.actor_id is
  'The admin who performed a manual adjustment, via admin_adjust_credit(). Null for system-generated rows (booking payments, cancellation compensation) and for every row predating this column. on delete set null: an admin leaving must never delete financial history.';

create index if not exists credit_transactions_actor_id_idx
  on public.credit_transactions (actor_id)
  where actor_id is not null;

-- === 2. The adjustment itself ===========================================
--
-- One function for both directions. A positive amount grants, a negative
-- amount deducts, and the sign is the only difference — which keeps the
-- authorisation, the reason requirement and the balance floor in exactly
-- one place rather than two that can drift.
--
-- Deliberately NOT a wrapper over issue_credit()/spend_credit(): those are
-- service_role-only, so calling them from a SECURITY DEFINER function
-- granted to `authenticated` would work but would file the row with the
-- wrong transaction_type and no actor. The insert is duplicated here
-- rather than the semantics being bent.
--
-- The `for update` lock on the wallet is reproduced from spend_credit()
-- and is load-bearing for the same reason: without serialising per wallet,
-- two concurrent deductions can both read the same sufficient balance and
-- both be admitted, overdrawing it.

create or replace function public.admin_adjust_credit(
  p_user_id uuid,
  p_amount integer,
  p_reason text
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
  v_actor uuid;
begin
  -- THE authorisation. Not in a server action, not in a route handler —
  -- here, where no caller can skip it. security definer means this
  -- function runs with elevated rights, so this check is the only thing
  -- standing between `authenticated` and arbitrary credit issuance.
  if not public.is_admin() then
    raise exception 'Only an administrator may adjust credit.' using errcode = 'insufficient_privilege';
  end if;

  v_actor := auth.uid();
  if v_actor is null then
    -- is_admin() resolves auth.uid(), so this is unreachable in practice.
    -- Kept because an unattributable financial adjustment is worse than a
    -- refused one, and a future change to is_admin() must not make it
    -- reachable silently.
    raise exception 'Credit adjustments must be attributable to an administrator.' using errcode = 'insufficient_privilege';
  end if;

  if p_amount = 0 then
    raise exception 'Adjustment amount must not be zero.' using errcode = 'check_violation';
  end if;

  -- A reason is not optional. This is the only free-text record of why a
  -- balance changed, and a blank one makes the audit trail unreadable
  -- exactly when someone needs to read it.
  if p_reason is null or btrim(p_reason) = '' then
    raise exception 'A reason is required for every credit adjustment.' using errcode = 'check_violation';
  end if;

  if p_user_id is null then
    raise exception 'A target user is required.' using errcode = 'check_violation';
  end if;

  select balance into v_balance
  from public.user_credit_wallets
  where user_id = p_user_id
  for update;

  -- A deduction may never take a wallet negative. A wallet row that does
  -- not exist yet is a zero balance, not an error — but it cannot be
  -- deducted from either.
  if p_amount < 0 and (v_balance is null or v_balance < abs(p_amount)) then
    raise exception 'Deduction would take the balance below zero.' using errcode = 'check_violation';
  end if;

  insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description, actor_id)
  values (p_user_id, p_amount, 'admin_adjustment', null, btrim(p_reason), v_actor);

  select balance into v_balance from public.user_credit_wallets where user_id = p_user_id;
  return v_balance;
end;
$$;

comment on function public.admin_adjust_credit(uuid, integer, text) is
  'Manually grants (positive) or deducts (negative) AIR/Rally Credits. Admin-only, '
  'enforced by is_admin() INSIDE the function rather than by the grant, so a non-admin '
  'calling it directly is refused by the database. Records the acting admin in '
  'credit_transactions.actor_id and requires a non-empty reason. Deductions cannot take '
  'a balance below zero. The ledger is append-only: a mistake is corrected with an '
  'offsetting adjustment, never an edit.';

-- Granted to authenticated ON PURPOSE — see the header. The grant is not
-- the security boundary here; is_admin() inside the function is. anon is
-- excluded anyway since it can never satisfy is_admin().
revoke all on function public.admin_adjust_credit(uuid, integer, text) from public, anon;
grant execute on function public.admin_adjust_credit(uuid, integer, text) to authenticated;

-- === 3. The liability figure ============================================
--
-- Credits never expire, so outstanding credit is a real liability that
-- only grows. It needs a home and an owner. user_credit_wallets' RLS is
-- read-your-own-wallet, correctly, so an admin cannot simply sum the
-- table — hence a function rather than a policy widening, which would
-- expose every individual balance to satisfy a question about the total.

create or replace function public.admin_total_outstanding_credit()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare
  v_total bigint;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may read the credit liability.' using errcode = 'insufficient_privilege';
  end if;

  select coalesce(sum(balance), 0) into v_total from public.user_credit_wallets;
  return v_total;
end;
$$;

comment on function public.admin_total_outstanding_credit() is
  'Total unspent AIR/Rally Credits across all wallets, in integer minor units — the '
  'outstanding liability. Admin-only, checked inside the function. Returns bigint: the '
  'sum of many integer balances can exceed integer range even where no single one does.';

revoke all on function public.admin_total_outstanding_credit() from public, anon;
grant execute on function public.admin_total_outstanding_credit() to authenticated;

-- === 4. Reading one user's ledger as an admin ===========================
--
-- Same reasoning: credit_transactions' RLS is read-your-own-history. An
-- admin correcting a balance must see what they are correcting, and
-- guessing from a total is how a double-credit happens.

create or replace function public.admin_list_credit_transactions(
  p_user_id uuid,
  p_limit integer default 50
)
returns setof public.credit_transactions
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an administrator may read another user''s credit history.' using errcode = 'insufficient_privilege';
  end if;

  return query
    select * from public.credit_transactions
    where user_id = p_user_id
    order by created_at desc
    limit least(greatest(coalesce(p_limit, 50), 1), 200);
end;
$$;

comment on function public.admin_list_credit_transactions(uuid, integer) is
  'One user''s full credit ledger, newest first, for an admin correcting their balance. '
  'Admin-only, checked inside the function. Capped at 200 rows.';

revoke all on function public.admin_list_credit_transactions(uuid, integer) from public, anon;
grant execute on function public.admin_list_credit_transactions(uuid, integer) to authenticated;

-- === 5. Append-only, enforced rather than assumed =======================
--
-- credit_transactions has a SELECT policy and no INSERT/UPDATE/DELETE
-- policy, which already stops every client role from editing it. That is
-- an absence of permission, not a prohibition: service_role bypasses RLS
-- entirely, so any server-side code path — including a future one written
-- by someone who has not read this file — can silently rewrite financial
-- history.
--
-- A ledger whose immutability depends on nobody writing the wrong query is
-- not immutable. This makes it structural.

create or replace function public.prevent_credit_ledger_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception 'credit_transactions is append-only; correct a mistake with an offsetting adjustment, never an edit or delete.'
    using errcode = 'restrict_violation';
end;
$$;

drop trigger if exists credit_transactions_append_only on public.credit_transactions;
create trigger credit_transactions_append_only
  before update or delete on public.credit_transactions
  for each row execute function public.prevent_credit_ledger_mutation();
