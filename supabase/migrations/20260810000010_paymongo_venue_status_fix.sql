-- Fixes a real design bug in sync_venue_paymongo_status() from
-- 20260810000009_paymongo_marketplace.sql, caught before any application
-- code called it: that function required p_venue_id, but PayMongo's
-- merchant.activated/merchant.declined webhooks only carry merchant_id
-- (the org_... account id) — confirmed against the real webhook payload
-- shape in onboarding-aas docs, which has no venue-side metadata
-- pass-through on the Accounts resource. The webhook could never have
-- called the Phase 1 function as written.
--
-- Splits it into two single-purpose functions instead of one function
-- branching on two different callers' shapes:
--   - sync_venue_paymongo_status(): owner-initiated, once, right after
--     creating the PayMongo account for their venue. Requires venue_id +
--     owner match, same as before.
--   - sync_venue_paymongo_activation(): webhook-initiated only. Looked
--     up purely by paymongo_account_id (already unique, already set by
--     the call above) — no venue_id needed, no owner check, same
--     "knowing the real, unguessable id is itself sufficient
--     authorization" reasoning already used by confirm_booking_payment
--     and confirm_paymongo_booking_payment elsewhere in this schema. A
--     stray/unmatched event is a safe no-op (returns false, zero rows
--     touched), same idempotent-safe posture as every other webhook
--     handler in this codebase.
--
-- Purely additive/corrective: drops and recreates one function that has
-- never been called by any application code yet (Phase 2 hasn't shipped
-- until this migration), touches no other table, column, or row.

drop function if exists public.sync_venue_paymongo_status(uuid, text, text, text);

create or replace function public.sync_venue_paymongo_status(
  p_venue_id uuid,
  p_paymongo_account_id text,
  p_activation_status text default 'pending'
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if p_activation_status not in ('unlinked', 'pending', 'under_review', 'activated', 'declined') then
    raise exception 'invalid paymongo activation status: %', p_activation_status;
  end if;

  perform set_config('air_rally.bypass_venue_paymongo_sync', 'true', true);

  update public.venues
  set paymongo_account_id = p_paymongo_account_id,
      paymongo_activation_status = p_activation_status,
      paymongo_onboarding_started_at = coalesce(paymongo_onboarding_started_at, now())
  where id = p_venue_id
    and owner_id = auth.uid()
    and paymongo_account_id is null
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

grant execute on function public.sync_venue_paymongo_status(uuid, text, text) to authenticated;

-- Webhook-only entry point: looks up the venue by the already-linked,
-- unique paymongo_account_id — the venue_id is neither known nor needed
-- by the caller. SECURITY DEFINER + unconditional bypass, matching
-- confirm_paymongo_booking_payment's own reasoning (this function is
-- itself the trusted boundary; there is no "admin" caller to special-case
-- since a human never calls this directly).
create or replace function public.sync_venue_paymongo_activation(
  p_paymongo_account_id text,
  p_activation_status text,
  p_declined_reason text default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_updated_id uuid;
begin
  if p_activation_status not in ('under_review', 'activated', 'declined') then
    raise exception 'invalid paymongo activation status for a webhook-driven update: %', p_activation_status;
  end if;

  perform set_config('air_rally.bypass_venue_paymongo_sync', 'true', true);

  update public.venues
  set paymongo_activation_status = p_activation_status,
      paymongo_activated_at = case
        when p_activation_status = 'activated' then coalesce(paymongo_activated_at, now())
        else paymongo_activated_at
      end,
      paymongo_declined_reason = case when p_activation_status = 'declined' then p_declined_reason else null end
  where paymongo_account_id = p_paymongo_account_id
  returning id into v_updated_id;

  return v_updated_id is not null;
end;
$$;

grant execute on function public.sync_venue_paymongo_activation(text, text, text) to anon, authenticated;
