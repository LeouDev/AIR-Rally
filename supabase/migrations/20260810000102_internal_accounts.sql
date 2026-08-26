-- ============================================================================
-- Mark internal (test) accounts and venues so money REPORTING can exclude
-- them, without changing anything about how they behave.
--
-- ⚠️ THE RULE THAT MATTERS MOST, AND THE ONE MOST LIKELY TO ERODE:
--
--     THIS FLAG EXCLUDES FROM REPORTING. IT CHANGES NO BEHAVIOUR.
--
-- A flagged account books, pays, gets ranked, receives payslips and hits
-- every gate exactly as a real one does. The moment an internal account takes
-- a different code path, testing on it stops proving anything about the
-- product that ships — you would be exercising a second implementation real
-- users never touch, which is a worse problem than the one this solves.
--
-- If you are about to write "and if is_internal then ..." anywhere outside a
-- reporting query, that is the line.
--
-- WHY ACCOUNTS AND VENUES RATHER THAN ROWS. Every test booking, settlement and
-- match descends from a handful of accounts. A boolean on the two roots covers
-- everything derived from them without labelling individual records, and
-- without a backfill that would have to guess.
--
-- WHAT THIS DOES NOT SOLVE, stated plainly because a flag believed to be
-- complete is worse than one known to be partial:
--
--   * It answers "is this row internal?" only for rows created AFTER someone
--     sets it. It distinguishes nothing retroactively.
--   * It is only as good as the discipline of flagging each new test account.
--     Nothing detects an unflagged one.
--   * It does not clean anything up. Production's existing test data stays
--     exactly where it is; this only stops it being counted.
--
-- RELATIONSHIP TO anonymize_account(). That function (migration 074) scrubs
-- PII and sets profiles.deleted_at, and is the ONLY viable path for removing
-- a user — hard deletion is blocked by bookings.user_id being ON DELETE NO
-- ACTION. But it hides nothing from reporting: nothing anywhere reads
-- deleted_at. So the two are complementary rather than redundant — one
-- removes the person, this one removes them from the totals.
-- ============================================================================

alter table public.profiles
  add column if not exists is_internal boolean not null default false;

alter table public.venues
  add column if not exists is_internal boolean not null default false;

comment on column public.profiles.is_internal is
  'Internal/test account. EXCLUDED FROM MONEY REPORTING ONLY — never from '
  'behaviour, and never from operational lists like bookings or the payout '
  'routine, which must show what is actually there.';

comment on column public.venues.is_internal is
  'Internal/test venue. Same rule as profiles.is_internal: reporting only.';

-- ---------------------------------------------------------------------------
-- Admin-set only.
--
-- A user must not be able to mark themselves internal and vanish from
-- reporting. Same posture and same mechanism as owner_status: a non-admin
-- change is silently reverted to the old value rather than raised, so an
-- ordinary profile update that happens to carry the column still succeeds.
-- ---------------------------------------------------------------------------
create or replace function public.prevent_is_internal_tampering()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() and new.is_internal is distinct from old.is_internal then
    new.is_internal := old.is_internal;
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_prevent_is_internal_tampering on public.profiles;
create trigger profiles_prevent_is_internal_tampering
  before update on public.profiles
  for each row execute function public.prevent_is_internal_tampering();

drop trigger if exists venues_prevent_is_internal_tampering on public.venues;
create trigger venues_prevent_is_internal_tampering
  before update on public.venues
  for each row execute function public.prevent_is_internal_tampering();

-- ---------------------------------------------------------------------------
-- One predicate for reporting queries, so "what counts as internal" lives in
-- one place rather than being re-expressed at each of the surfaces below.
--
-- A settlement is internal if EITHER end of it is: the venue receiving the
-- money, or the player who paid. Counting a real player's booking at a test
-- venue would inflate venue revenue; counting a test player's booking at a
-- real venue would inflate platform revenue. Both are wrong, so either side
-- taints the row.
-- ---------------------------------------------------------------------------
create or replace function public.settlement_is_internal(p_settlement_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.booking_settlements s
    join public.venues v on v.id = s.venue_id
    left join public.bookings b on b.id = s.booking_id
    left join public.profiles p on p.id = b.user_id
    where s.id = p_settlement_id
      and (v.is_internal or coalesce(p.is_internal, false))
  );
$$;

-- ---------------------------------------------------------------------------
-- WHERE THIS APPLIES — and, as importantly, where it must NOT.
--
-- APPLIES (money reporting; exclude by default, with a visible toggle to
-- include, because the founder must be able to confirm their own tests
-- worked or they will conclude the product is broken):
--
--   src/app/(marketing)/admin/finance          platform revenue
--   src/lib/services/adminPayments.ts          payment totals
--   src/lib/services/ownerAnalytics.ts         owner analytics + its CSV export
--   src/lib/services/venueEarnings.ts          venue earnings
--   src/lib/services/settlements.ts            settlement aggregates
--   src/app/(marketing)/list-your-court/earnings and its export/route.ts
--
-- MUST NOT APPLY (operational surfaces — these must show what is actually
-- there, or someone acts on a picture that is missing rows):
--
--   admin/payouts, admin/transfers      the payout routine itself
--   admin/settlements (row list)        individual settlements
--   bookings lists anywhere             a real court is really occupied
--   available_settlements_for_payout()  a flagged venue is still owed money
--
-- The distinction is reporting versus operations: this hides rows from
-- TOTALS, never from the work.
-- ---------------------------------------------------------------------------
