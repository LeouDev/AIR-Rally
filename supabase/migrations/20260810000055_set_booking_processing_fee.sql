-- The write path for bookings.processing_fee_amount.
--
-- 054 added the column and — necessarily — guarded it in
-- prevent_booking_tampering(), because confirm_paymongo_booking_payment()
-- now trusts it: a player who could set it could satisfy the amount check
-- with any payment at all. That guard has a consequence 054 did not
-- provide for. There was no longer ANY path that could write the column.
--
-- Verified against staging rather than assumed: a service-role UPDATE of
-- processing_fee_amount returns NO error and silently reverts to 0. The
-- trigger's escape hatch is is_admin() or the bypass GUC, and is_admin()
-- resolves auth.uid(), which is null for a service-role PostgREST call —
-- so service_role is guarded exactly like a browser session here.
--
-- Shipping without this would have been the original outage again, in a
-- quieter form: checkout would compute the fee, "write" it, get no error,
-- and leave 0 in the column while PayMongo charged the grossed-up total.
-- Every booking would then miss the amount check and sit on 'pending'.
--
-- Same shape and the same justification as apply_credit_to_booking() in
-- 20260810000038: a SECURITY DEFINER function that sets the bypass GUC,
-- granted to service_role only, because the authority is *which code is
-- calling* — a server action that already identified the user — not any
-- value in the request.

create or replace function public.set_booking_processing_fee(
  p_booking_id uuid,
  p_amount integer
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if p_amount is null or p_amount < 0 then
    raise exception 'Processing fee must be a non-negative amount.' using errcode = 'check_violation';
  end if;

  perform set_config('air_rally.bypass_booking_tampering', 'true', true);
  update public.bookings
  set processing_fee_amount = p_amount
  where id = p_booking_id
    -- Only before payment. After a booking is confirmed the fee is part
    -- of what was already charged and reconciled; moving it then would
    -- retroactively change what the amount check validated.
    and status = 'pending'
    -- A processing fee larger than the court price is not a fee, it is a
    -- bug or an attack. The real figure is ~1.5% of the amount collected;
    -- this bound is deliberately loose, and exists only so that no single
    -- wrong call can inflate the amount check to an arbitrary figure.
    and p_amount <= price_amount
  returning id into v_updated_id;
  return v_updated_id is not null;
end;
$$;

comment on function public.set_booking_processing_fee(uuid, integer) is
  'Sets bookings.processing_fee_amount on a pending booking. service_role ONLY — '
  'confirm_paymongo_booking_payment() trusts this column, so a caller able to set '
  'it freely could satisfy the amount-integrity check with any payment. Callable '
  'from a browser session this would re-open the free-booking exploit closed by '
  'migration 20260810000047. Returns false when the booking is not pending or the '
  'amount exceeds price_amount.';

revoke all on function public.set_booking_processing_fee(uuid, integer) from public, anon, authenticated;
grant execute on function public.set_booking_processing_fee(uuid, integer) to service_role;
