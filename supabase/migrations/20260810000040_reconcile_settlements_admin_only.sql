-- Restricts reconcile_settlements() to admins.
--
-- THE LEAK (found by scripts/verify-staging-settlement-ui.ts, which called
-- the function as an ordinary venue owner and got platform-wide rows back):
--
-- 20260810000039 defined reconcile_settlements() as SECURITY DEFINER so it
-- could see across every venue, and granted execute to PUBLIC by default —
-- which is what Postgres does for a new function unless told otherwise.
-- Being SECURITY DEFINER, it also bypasses row-level security. Any signed-in
-- user could therefore call it and read booking ids and settlement amounts
-- for the entire platform, including venues they have nothing to do with.
--
-- The admin gate at /admin/settlements/reconciliation was never the
-- boundary — it only stopped someone loading the page, not calling the
-- function underneath it. The boundary belongs here.
--
-- SECURITY DEFINER is still correct and deliberate: reconciliation must see
-- rows RLS would hide from any individual caller, or "a confirmed booking
-- with no settlement" could never be detected. What changes is that the
-- function now checks WHO is asking before it does that.

create or replace function public.reconcile_settlements()
returns table (issue text, booking_id uuid, detail text)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  -- The same is_admin() every other admin surface uses. Raising rather
  -- than returning zero rows is deliberate: an empty result is exactly
  -- what a healthy ledger looks like, so silently returning nothing to a
  -- non-admin would read as "all clear" instead of "not allowed".
  if not public.is_admin() then
    raise exception 'Settlement reconciliation is admin-only.' using errcode = 'insufficient_privilege';
  end if;

  return query
  -- 1. Every confirmed, priced booking must have a settlement row.
  select 'missing_settlement'::text, b.id, 'confirmed booking has no settlement row'::text
  from public.bookings b
  left join public.booking_settlements s on s.booking_id = b.id
  where b.status = 'confirmed' and b.price_amount > 0 and s.id is null

  union all

  -- 2. A settlement's funding must still match its booking.
  select 'funding_mismatch', b.id,
         'booking says paymongo=' || (b.price_amount - b.credit_amount_applied)::text ||
         ' credit=' || b.credit_amount_applied::text ||
         ', settlement says paymongo=' || s.paymongo_amount::text ||
         ' credit=' || s.credit_amount::text
  from public.booking_settlements s
  join public.bookings b on b.id = s.booking_id
  where s.paymongo_amount <> b.price_amount - b.credit_amount_applied
     or s.credit_amount <> b.credit_amount_applied
     or s.gross_booking_amount <> b.price_amount

  union all

  -- 3. A cancelled booking must not carry live entitlement.
  select 'live_settlement_on_cancelled_booking', b.id,
         'booking cancelled but settlement is ' || s.settlement_status
  from public.booking_settlements s
  join public.bookings b on b.id = s.booking_id
  where b.status = 'cancelled' and s.settlement_status in ('pending', 'payable')

  union all

  -- 4. Credit-funded entitlement with no cash behind it. Not an error —
  --    it is the expected shape of a credit booking — but it must be
  --    visible, because it is the platform's own cash exposure.
  select 'unfunded_entitlement', b.id,
         'venue owed ' || s.venue_amount::text || ' but only ' || s.paymongo_amount::text || ' collected'
  from public.booking_settlements s
  join public.bookings b on b.id = s.booking_id
  where s.settlement_status in ('pending', 'payable') and s.cash_position < 0;
end;
$$;

-- Belt and braces: revoke the implicit PUBLIC execute grant as well, so the
-- function is unreachable rather than merely unhelpful to a non-admin.
-- `authenticated` keeps execute because an ADMIN's session is an
-- authenticated session — the is_admin() check above is what separates them.
revoke all on function public.reconcile_settlements() from public, anon;
grant execute on function public.reconcile_settlements() to authenticated, service_role;

-- The payable sweep has the same shape of exposure: SECURITY DEFINER, and
-- it WRITES. It is meant to be called by a scheduled job, never by a user.
revoke all on function public.mark_settlements_payable() from public, anon, authenticated;
grant execute on function public.mark_settlements_payable() to service_role;
