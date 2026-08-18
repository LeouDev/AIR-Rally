-- The Venue Owner Agreement (src/lib/legalContent.ts#OWNER_AGREEMENT) had
-- no acknowledgement step anywhere — not at application submission, not
-- at approval, not at venue activation. This adds the record and enforces
-- it going forward, without touching the applications that already exist.
--
-- Nullable, not NOT NULL: rows submitted before this requirement existed
-- genuinely never saw this agreement, and there is no honest default
-- value to backfill them with. Enforcement instead lives in the INSERT
-- policy's WITH CHECK below, which only ever governs NEW rows — exactly
-- the same "additive, not retroactive" posture every other
-- previously-optional-then-required field in this schema uses.
alter table public.owner_applications
  add column agreement_accepted_at timestamptz,
  add column agreement_version text,
  add column has_liability_insurance boolean;

comment on column public.owner_applications.agreement_accepted_at is
  'When the applicant acknowledged the Venue Owner Agreement. Null for applications submitted before this requirement existed.';
comment on column public.owner_applications.agreement_version is
  'lib/legal.ts#CURRENT_OWNER_AGREEMENT_VERSION at the time of acceptance — free text, matching agreement_acceptances.agreement_version''s own reasoning: a new version should never require a migration.';
comment on column public.owner_applications.has_liability_insurance is
  'Self-reported at application time, per Venue Owner Agreement clause 5.3. Not verified by AIR/Rally.';

-- Replaces the WITH CHECK only — same USING clause, same policy name, same
-- role. A self-service submission missing any of the three new fields is
-- now rejected at the database layer, not just by client-side validation.
alter policy "Users can submit their own application"
on public.owner_applications
with check (
  user_id = auth.uid()
  and status = 'pending'
  and agreement_accepted_at is not null
  and agreement_version is not null
  and has_liability_insurance is not null
);
