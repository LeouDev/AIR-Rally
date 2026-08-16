-- Narrows restore_credit_on_booking_cancel() to PENDING bookings only.
--
-- 20260810000036 returned applied credits on any cancellation. That is
-- wrong under the AIR/Rally cancellation policy, where a customer
-- cancelling inside 48 hours forfeits what they paid — credits included.
-- An unconditional trigger would have handed those credits straight back
-- and silently voided the policy.
--
-- The split:
--
--   * PENDING booking cancelled — payment never completed and no court
--     time was ever held against a paid reservation, so returning the
--     applied credits is unambiguous and needs no policy judgement. This
--     is also what stops credits being stranded by a checkout the user
--     abandoned, since any future expiry sweep cancels the pending row
--     and the credits come back automatically.
--
--   * CONFIRMED booking cancelled — the policy decides, and it depends on
--     facts a trigger cannot see (who cancelled, how far ahead, whether
--     the venue became unavailable, whether a system error occurred, or
--     whether support reviewed it). That decision lives in
--     resolveCancellationCredit() in lib/services/credits.ts and is
--     issued explicitly by a server action, never implicitly here.

create or replace function public.restore_credit_on_booking_cancel()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.status = 'cancelled'
     and old.status = 'pending'
     and new.credit_amount_applied > 0
     and not exists (
       select 1 from public.credit_transactions
       where reference_id = new.id and transaction_type = 'cancellation_compensation'
     ) then
    insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description)
    values (
      new.user_id,
      new.credit_amount_applied,
      'cancellation_compensation',
      new.id,
      'Credits returned for unpaid booking #' || new.confirmation_code
    );
  end if;

  return new;
end;
$$;
