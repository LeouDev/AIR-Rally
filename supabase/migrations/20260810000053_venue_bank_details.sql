-- Venue bank details — the missing half of the payout system.
--
-- venue_payment_accounts has tracked WHETHER a venue may be paid since
-- 20260810000043, but never WHERE to send the money. The payout tables
-- compute amounts correctly and then have nowhere to send them, which is
-- why no venue has ever been paid.
--
-- PayMongo's own reply settled the shape: their dashboard accepts a bulk
-- transfer file whose Details tab is exactly Bank Name, Bank Account Name,
-- Bank Account Number, Amount, Remarks. These three columns are the first
-- three of that file.
--
-- Bank name is stored as PayMongo's PESONet spelling verbatim
-- (src/lib/payouts/pesonetBanks.ts) because PayMongo validates it
-- character for character on upload. The owner picks from a list rather
-- than typing, so the stored value is already the value we write out.

alter table public.venue_payment_accounts
  add column bank_name text
    check (bank_name is null or char_length(bank_name) between 2 and 120),
  add column bank_account_name text
    check (bank_account_name is null or char_length(bank_account_name) between 2 and 120),
  add column bank_account_number text
    check (bank_account_number is null or bank_account_number ~ '^[0-9]{6,20}$'),
  add column bank_details_updated_at timestamptz;

-- All three together or none. A half-filled destination is worse than an
-- empty one: it looks configured in the UI and fails at upload.
alter table public.venue_payment_accounts
  add constraint venue_bank_details_all_or_nothing check (
    (bank_name is null and bank_account_name is null and bank_account_number is null)
    or (bank_name is not null and bank_account_name is not null and bank_account_number is not null)
  );

comment on column public.venue_payment_accounts.bank_name is
  'Verbatim PESONet bank name from PayMongo''s template. Must match their Banks list exactly or the transfer row is rejected.';
comment on column public.venue_payment_accounts.bank_account_number is
  'Digits only. Sensitive: readable by the owning venue and admins only, never exposed to other users.';

-- === Who may write these ==================================================
--
-- Until now this table had ONE policy — a SELECT for the owner and admins —
-- and no write policy at all, so every write came from service_role. Owners
-- now need to maintain their own bank details, but must not be able to
-- touch anything that decides whether they get paid.
--
-- Two mechanisms, deliberately layered:
--
--   1. Column-level GRANTs. Postgres RLS is row-level and cannot restrict
--      WHICH columns an UPDATE touches, so the grant does that job: only
--      the four bank columns are updatable by `authenticated`.
--   2. A guard trigger that reverts any change to the protected columns.
--      Belt and braces, matching prevent_owner_status_tampering — if a
--      future migration widens the grant by accident, this still holds.
--
-- No INSERT policy: rows are created automatically for every venue by the
-- mirroring trigger from 20260810000043, so an owner never needs to insert
-- one and granting that would only add a way to create rows for venues
-- they do not own.
create policy "Owners maintain their own bank details"
on public.venue_payment_accounts for update
to authenticated
using (
  exists (
    select 1 from public.venues v
    where v.id = venue_payment_accounts.venue_id and v.owner_id = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.venues v
    where v.id = venue_payment_accounts.venue_id and v.owner_id = auth.uid()
  )
);

revoke update on public.venue_payment_accounts from authenticated;
grant update (bank_name, bank_account_name, bank_account_number, bank_details_updated_at)
  on public.venue_payment_accounts to authenticated;

/**
 * Reverts owner edits to anything that is not a bank detail.
 *
 * `not is_admin()` alone is the right test: the UPDATE policy above
 * already guarantees any non-admin reaching this trigger owns the venue.
 * Silently reverting rather than raising matches this codebase's existing
 * tampering guards — the write succeeds, the protected values do not move.
 */
create or replace function public.prevent_payment_account_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin()
     and current_setting('air_rally.bypass_venue_paymongo_sync', true) is distinct from 'true' then
    new.status := old.status;
    new.status_reason := old.status_reason;
    new.verified_at := old.verified_at;
    new.paymongo_account_id := old.paymongo_account_id;
    new.provider := old.provider;
    new.venue_id := old.venue_id;
  end if;
  return new;
end;
$$;

create trigger venue_payment_accounts_prevent_tampering
before update on public.venue_payment_accounts
for each row execute function public.prevent_payment_account_tampering();

comment on function public.prevent_payment_account_tampering() is
  'Owners may edit bank details and nothing else. Honours the existing '
  'bypass_venue_paymongo_sync GUC so the activation webhook can still write status.';
