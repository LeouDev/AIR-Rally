-- Closes a gap found while scoping the payout admin redesign: every gate
-- on the payout path checked venue_payment_accounts.status = 'verified'
-- (PayMongo merchant activation — can this venue ACCEPT a split payment)
-- and none of them checked bank_name/bank_account_name/bank_account_number
-- (whether AIR/Rally has anywhere to SEND the money). Those are different
-- questions; conflating them meant a fully PayMongo-verified venue with
-- zero bank details on file reported "ready" at every layer that mattered,
-- and could enter a real payout batch with nowhere for the money to go.
--
-- Verified against production (2026-08-26) before writing this: the one
-- live payable batch happens to have complete bank details, so the gap has
-- not yet cost anyone money — but it was reachable, not hypothetical.
--
-- venue_bank_details_all_or_nothing (20260810000053) means the three bank
-- columns are always either all null or all filled, so testing bank_name
-- alone is sufficient to know all three are present.
--
-- Three call sites, all fixed together so none of them can drift back out
-- of agreement with the others:
--
--   1. enforce_payout_batch_item()      — the load-bearing guard: batch
--                                          entry itself, holds even if a
--                                          settlement id is passed directly
--   2. available_settlements_for_payout — so the admin UI never offers a
--                                          settlement the trigger would
--                                          reject
--   3. venue_payout_readiness()         — so the Finance/Payment-accounts
--                                          "ready" counts agree with what
--                                          can actually enter a batch

create or replace function public.enforce_payout_batch_item()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_settlement public.booking_settlements%rowtype;
  v_existing_batch text;
  v_account_status text;
  v_bank_name text;
begin
  select * into v_settlement from public.booking_settlements where id = new.settlement_id;

  if v_settlement.id is null then
    raise exception 'Settlement not found.' using errcode = 'no_data_found';
  end if;

  if v_settlement.settlement_status <> 'payable' then
    raise exception 'Only payable settlements can enter a payout batch (this one is %).', v_settlement.settlement_status
      using errcode = 'check_violation';
  end if;

  select status, bank_name into v_account_status, v_bank_name
  from public.venue_payment_accounts
  where venue_id = v_settlement.venue_id and provider = 'paymongo';

  if v_account_status is distinct from 'verified' then
    raise exception 'Venue payment account unavailable (%).', coalesce(v_account_status, 'not_connected')
      using errcode = 'check_violation';
  end if;

  -- NEW: PayMongo activation says this venue can ACCEPT a payment; it says
  -- nothing about whether AIR/Rally knows where to SEND one.
  if v_bank_name is null then
    raise exception 'Venue has no bank details on file — nowhere to send this payout.'
      using errcode = 'check_violation';
  end if;

  select b.batch_reference into v_existing_batch
  from public.payout_batch_items i
  join public.payout_batches b on b.id = i.payout_batch_id
  where i.settlement_id = new.settlement_id
    and i.payout_batch_id is distinct from new.payout_batch_id
    and b.status not in ('cancelled', 'failed')
  limit 1;

  if v_existing_batch is not null then
    raise exception 'Settlement is already in payout batch %.', v_existing_batch using errcode = 'unique_violation';
  end if;

  new.venue_id := v_settlement.venue_id;
  new.amount := v_settlement.venue_amount;

  return new;
end;
$$;

-- Candidates now also exclude venues with an incomplete bank destination,
-- so the admin UI never offers a settlement the trigger above would reject.
create or replace function public.available_settlements_for_payout()
returns setof public.booking_settlements
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Payout preparation is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select s.*
  from public.booking_settlements s
  join public.venue_payment_accounts a
    on a.venue_id = s.venue_id and a.provider = 'paymongo' and a.status = 'verified' and a.bank_name is not null
  where s.settlement_status = 'payable'
    and not exists (
      select 1 from public.payout_batch_items i
      join public.payout_batches b on b.id = i.payout_batch_id
      where i.settlement_id = s.id and b.status not in ('cancelled', 'failed')
    )
  order by s.venue_id, s.created_at;
end;
$$;

-- "Ready" now means both things are true, not just PayMongo activation. A
-- venue that's verified but bank-detail-incomplete moves from "ready" into
-- "missing setup" — it genuinely isn't payable yet, which is exactly what
-- that bucket already means for a not-yet-connected venue.
create or replace function public.venue_payout_readiness()
returns table (
  venues_ready bigint,
  venues_missing_setup bigint,
  venues_restricted bigint,
  blocked_settlement_amount bigint,
  blocked_settlement_count bigint
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Payout readiness is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    (select count(*) from public.venue_payment_accounts where status = 'verified' and bank_name is not null)::bigint,
    (select count(*) from public.venue_payment_accounts
       where status in ('not_connected', 'pending_verification')
          or (status = 'verified' and bank_name is null))::bigint,
    (select count(*) from public.venue_payment_accounts where status in ('restricted', 'disabled'))::bigint,
    coalesce((
      select sum(s.venue_amount)
      from public.booking_settlements s
      left join public.venue_payment_accounts a on a.venue_id = s.venue_id and a.provider = 'paymongo'
      where s.settlement_status = 'payable'
        and (coalesce(a.status, 'not_connected') <> 'verified' or a.bank_name is null)
    ), 0)::bigint,
    coalesce((
      select count(*)
      from public.booking_settlements s
      left join public.venue_payment_accounts a on a.venue_id = s.venue_id and a.provider = 'paymongo'
      where s.settlement_status = 'payable'
        and (coalesce(a.status, 'not_connected') <> 'verified' or a.bank_name is null)
    ), 0)::bigint;
end;
$$;
