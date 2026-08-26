-- Bank details on the owner application, and the carry-forward that makes
-- collecting them actually pay someone.
--
-- WHY HERE AND NOT LATER: venue_payment_accounts is per-VENUE and is created
-- by the mirror trigger below when a venue is inserted at 'draft' — long
-- after an owner application is approved. Collecting bank details at
-- application time and NOT carrying them forward would produce a filled-in
-- application beside an empty payout destination, which is the same failure
-- 20260810000089 just closed, wearing a different hat.
--
-- COLUMNS ARE NULLABLE ON PURPOSE. Both environments already hold owner
-- application rows (production: 1 approved, 1 pending — the founder's own
-- test accounts). Shipping `not null` would either fail outright or demand
-- placeholder data, and a fabricated account number sitting in a payout
-- table is exactly the thing that gets treated as real six months later.
-- The requirement is enforced in the submit and approve paths; a follow-up
-- migration tightens these to `not null` once the existing rows are filled
-- in through the form.

alter table public.owner_applications
  add column bank_name text
    check (bank_name is null or char_length(bank_name) between 2 and 120),
  add column bank_account_name text
    check (bank_account_name is null or char_length(bank_account_name) between 2 and 120),
  add column bank_account_number text
    check (bank_account_number is null or bank_account_number ~ '^[0-9]{6,20}$');

-- Same all-or-nothing rule venue_payment_accounts already carries
-- (20260810000053). A half-filled destination is worse than an empty one:
-- it looks configured and fails at upload. Because of this, a caller that
-- has confirmed bank_name is non-null has thereby confirmed all three —
-- which is why approveOwnerApplication() tests that one column rather than
-- reading the generated flag below.
alter table public.owner_applications
  add constraint owner_application_bank_details_all_or_nothing check (
    (bank_name is null and bank_account_name is null and bank_account_number is null)
    or (bank_name is not null and bank_account_name is not null and bank_account_number is not null)
  );

-- Lets the admin LIST answer "are the details present?" WITHOUT selecting
-- the account number. Generated in Postgres rather than mapped in
-- TypeScript for a specific reason: a boolean computed client-side would
-- require sending the values over the wire to derive it, so the page would
-- render a boolean while the network response still carried the account
-- number. That is a disguise, not a fix. Same posture ownerBookings.ts uses
-- to keep PayMongo ids from ever leaving Postgres — the data does not move,
-- rather than moving and being ignored.
-- Tests all three columns, not bank_name alone. The all-or-nothing CHECK
-- above already makes a partial row unrepresentable, so this is
-- belt-and-braces — but a column named "complete" that only inspects one
-- third of what completeness means is a claim resting entirely on a
-- constraint declared elsewhere. If that constraint were ever dropped or
-- widened, this would keep reporting "complete" for a half-filled row, the
-- admin list would show details on file, and the trigger below would seed a
-- partial payout destination — a failure surfacing three steps from its
-- cause. Naming the whole condition here means the column is true because
-- of what it tests, not because of what something else forbids.
alter table public.owner_applications
  add column bank_details_complete boolean
  generated always as (
    bank_name is not null and bank_account_name is not null and bank_account_number is not null
  ) stored;

comment on column public.owner_applications.bank_account_number is
  'Digits only. PII: readable by the applicant and admins only (see this table''s RLS). '
  'The admin LIST must select bank_details_complete instead — never these values in bulk.';

comment on column public.owner_applications.bank_details_complete is
  'Server-side presence flag so the admin list never has to receive the account number to know it exists.';

-- === Carry-forward ========================================================
--
-- Seeds a new venue's payout destination from its owner's approved
-- application. Per-owner default: one application yields one set of
-- details, every venue that owner later creates is seeded from it, and each
-- venue's row is independently editable afterwards (owners already hold an
-- UPDATE grant on exactly these columns, per 20260810000053). An owner with
-- three venues banking to one account gets that for free; one who wants a
-- different account for venue C edits venue C without disturbing A or B.
--
-- SEEDING HAPPENS ON INSERT ONLY, NEVER IN THE `on conflict do update`
-- BRANCH. That branch runs every time the PayMongo mirror fires on a venue
-- update; re-seeding there would silently revert bank details an owner had
-- deliberately changed.
--
-- THIS FUNCTION MUST STAY `security definer` AND POSTGRES-OWNED. The seed
-- reads public.owner_applications, whose RLS is
-- `user_id = auth.uid() or is_admin()`. It reads through that policy only
-- because a definer function owned by the table owner bypasses RLS. Changed
-- to `security invoker`, the subquery would return ZERO ROWS RATHER THAN
-- ERRORING for any caller the policy excludes — the venue would be created
-- with a null payout destination, silently, with nothing failing anywhere.
-- That is precisely the class of bug this migration exists to prevent, so
-- it would be reintroduced by the fix itself. Verified empirically before
-- shipping: as the `authenticated` role, a direct read of another user's
-- application returns 0 rows (proving the policy genuinely bites) while
-- this definer path still reads it.
--
-- owner_applications IS A HISTORICAL RECORD OF WHAT WAS SUBMITTED, NOT THE
-- LIVE SOURCE OF TRUTH. Once seeded, an owner may change a venue's bank
-- details; the application row keeps the originally-submitted values, which
-- is correct for an audit trail and wrong for a payout. Never read this
-- table to answer "where do we pay this venue" —
-- venue_payment_accounts is the only answer to that question.
create or replace function public.sync_venue_payment_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_mapped text;
  v_existing text;
  v_bank_name text;
  v_bank_account_name text;
  v_bank_account_number text;
begin
  v_mapped := case new.paymongo_activation_status
    when 'activated' then 'verified'
    when 'pending' then 'pending_verification'
    when 'under_review' then 'pending_verification'
    when 'declined' then 'restricted'
    else 'not_connected'
  end;

  select status into v_existing
  from public.venue_payment_accounts
  where venue_id = new.id and provider = 'paymongo';

  if v_existing in ('restricted', 'disabled') and v_mapped <> 'restricted' then
    -- An admin decision outranks the mirror. Keep the account id fresh but
    -- leave the status alone.
    update public.venue_payment_accounts
    set paymongo_account_id = new.paymongo_account_id, updated_at = now()
    where venue_id = new.id and provider = 'paymongo';
    return new;
  end if;

  -- `nulls last` is deliberate: reviewed_at is nullable, and Postgres
  -- `desc` defaults to NULLS FIRST, so an approved row with no reviewed_at
  -- would outrank a properly-reviewed one and seed from the wrong
  -- application. approveOwnerApplication() does always stamp it today
  -- (verified: 0 approved rows carry a null), so this is not currently
  -- reachable — it is fixed here because it costs nothing now and would be
  -- invisible when it started biting. created_at is non-null by definition,
  -- so the ordering stays total even if a future path forgets the stamp.
  select a.bank_name, a.bank_account_name, a.bank_account_number
    into v_bank_name, v_bank_account_name, v_bank_account_number
  from public.owner_applications a
  where a.user_id = new.owner_id
    and a.status = 'approved'
    and a.bank_name is not null
  order by a.reviewed_at desc nulls last, a.created_at desc
  limit 1;

  insert into public.venue_payment_accounts (
    venue_id, provider, paymongo_account_id, status, verified_at,
    bank_name, bank_account_name, bank_account_number, bank_details_updated_at
  )
  values (
    new.id, 'paymongo', new.paymongo_account_id, v_mapped,
    case when v_mapped = 'verified' then coalesce(new.paymongo_activated_at, now()) else null end,
    v_bank_name, v_bank_account_name, v_bank_account_number,
    case when v_bank_name is not null then now() else null end
  )
  on conflict (venue_id, provider) do update
  set paymongo_account_id = excluded.paymongo_account_id,
      status = excluded.status,
      -- Keep the original verification moment if it was already verified.
      verified_at = case
        when excluded.status = 'verified'
          then coalesce(public.venue_payment_accounts.verified_at, excluded.verified_at)
        else null
      end,
      updated_at = now();
      -- Deliberately no bank_* here. See the INSERT-ONLY note above.

  return new;
end;
$$;
