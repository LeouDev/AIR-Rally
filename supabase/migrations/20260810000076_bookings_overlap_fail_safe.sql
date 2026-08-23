-- Makes the no-double-booking guarantee fail-safe instead of fail-open.
--
-- bookings_no_overlap has protected exactly ('pending','confirmed') since
-- 20260810000004. That set is currently complete — bookings_status_check
-- permits only ('pending','confirmed','cancelled') and status is NOT NULL,
-- so the only unprotected status is 'cancelled', which correctly must not
-- hold a slot. Nothing is broken today.
--
-- What is fragile is the coupling. The two constraints have to be changed
-- together, and nothing says so. Adding a status to bookings_status_check
-- without also adding it here yields a status that is insertable and has
-- NO overlap protection — silently, because the exclusion constraint simply
-- stops applying rather than raising anything. That is a double-booking on
-- a real court, discovered by a customer.
--
-- Inverting the predicate removes the coupling rather than documenting it:
-- every status is protected unless deliberately excluded. The default flips
-- from "unprotected unless someone remembers" to "protected unless someone
-- decides otherwise", which is the direction a booking system should fail.
--
-- This is behaviour-preserving TODAY, provably: given the CHECK above and
-- NOT NULL, (status <> 'cancelled') selects exactly the same rows as
-- (status in ('pending','confirmed')). Same index contents, same rejections,
-- no data change, no backfill.
--
-- Deliberately chosen over an application-level guard in createBooking():
-- that would protect TypeScript callers only, and this codebase already
-- writes through SECURITY DEFINER RPCs that would bypass it entirely. The
-- database is the boundary, so the rule belongs here.
--
-- LOCKING: DROP and ADD in a single ALTER TABLE so it is one atomic
-- statement holding one ACCESS EXCLUSIVE lock — overlap protection is never
-- absent partway through, and concurrent bookings block rather than slip
-- past. ADD re-validates every existing row and rebuilds the GiST index;
-- trivial at current table size, but prefer a quiet window.

alter table public.bookings
  drop constraint bookings_no_overlap,
  add constraint bookings_no_overlap
    exclude using gist (
      court_id with =,
      tstzrange(start_time, end_time, '[)') with &&
    ) where (status <> 'cancelled');

comment on constraint bookings_no_overlap on public.bookings is
  'No two non-cancelled bookings may overlap on the same court. Stated as '
  '"not cancelled" rather than an allow-list so any status added to '
  'bookings_status_check is protected by default. Keep it that way.';
