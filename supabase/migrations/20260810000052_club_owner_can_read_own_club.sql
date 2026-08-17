-- Fixes club creation, which has been broken since 20260810000033.
--
-- THE BUG
--
-- 033 replaced the clubs SELECT policy so a club awaiting review no longer
-- appears in public discovery — correct, and still correct. But the new
-- policy has no clause for "this is my own club":
--
--   (status = 'active' and visibility <> 'private')
--   or club_role_of(id) is not null
--   or is_admin()
--
-- createClub() does `.insert(...).select().single()`, which PostgREST
-- issues as INSERT ... RETURNING. Postgres applies the SELECT policy to
-- the returned row, and a brand-new club is status='pending_review' with
-- no membership row yet — the owner-membership trigger is AFTER INSERT, so
-- it has not run when RETURNING is evaluated. All three clauses are false,
-- and the insert fails with "new row violates row-level security policy".
--
-- So a plain user pressing "Create club" got an error and no club. Found
-- by scripts/verify-staging-full-journey.ts, which walks the whole product
-- as a real user rather than as service_role — the earlier clubs script
-- passed because it never exercised this path the way the app does.
--
-- THE FIX
--
-- One more clause: an owner can always read their own club. That is
-- independently correct regardless of RETURNING — an owner needs to see
-- their own club while it is pending review, which the old policy also
-- denied unless the membership trigger happened to have run.
--
-- Discovery is unchanged: this adds visibility only for `owner_id =
-- auth.uid()`, so nobody sees anyone else's unapproved club.
drop policy "Clubs are readable when approved, or to their own members" on public.clubs;

create policy "Clubs are readable when approved, to members, or to their owner"
on public.clubs for select
using (
  (status = 'active' and visibility <> 'private')
  or owner_id = auth.uid()
  or public.club_role_of(id) is not null
  or public.is_admin()
);
