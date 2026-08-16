-- Closes the gap the original reviews migration flagged in its own
-- comment ("add references public.bookings (id) then") now that
-- bookings exists, and adds the actual "one review per booking"
-- guarantee — nothing enforced this at the DB layer before.
--
-- `on delete set null` rather than cascade: a booking row is never
-- physically deleted by this app (only cancelled), but if that were
-- ever to change, a customer's review content shouldn't vanish just
-- because its underlying booking row did.
--
-- A plain unique constraint (not a partial index) is correct here —
-- Postgres treats NULL as distinct from every other NULL for uniqueness
-- purposes, so pre-existing seed reviews with no booking_id are
-- unaffected; only a real duplicate (booking_id, booking_id) collision
-- is rejected.
alter table public.reviews
  add constraint reviews_booking_id_fkey
  foreign key (booking_id) references public.bookings (id) on delete set null;

alter table public.reviews
  add constraint reviews_booking_id_unique unique (booking_id);
