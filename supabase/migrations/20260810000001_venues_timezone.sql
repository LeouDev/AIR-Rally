-- Phase 4A: booking-engine foundation. Additive only — no existing table,
-- column, row, or RLS policy is altered or dropped.
--
-- Canonical timezone for a venue, as an IANA identifier (e.g. 'Asia/Manila',
-- not 'GMT+8' or 'PST' — see ARCHITECTURE.md's Phase 4A timezone strategy
-- for why an offset/abbreviation is wrong here: it can't express DST). This
-- single ADD COLUMN ... DEFAULT backfills every existing row in the same
-- statement, no separate UPDATE needed. Courts inherit this from their
-- parent venue rather than having their own timezone column — there is no
-- current product need for a court's hours to run on a different clock
-- than the rest of its venue.
--
-- 'Asia/Manila' is a correct backfill, not a guess: every venue currently
-- in this database (the 3 [DEMO] venues plus the one real test venue) has
-- a Philippines address.
alter table public.venues
  add column timezone text not null default 'Asia/Manila';
