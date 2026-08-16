/**
 * Live, real-Postgres verification of the four notification triggers
 * added in supabase/migrations/20260810000024_notifications.sql
 * (notify_on_booking_change, notify_on_reschedule_complete,
 * notify_on_review_insert) — a Jest mock can prove the service layer's
 * queries are shaped correctly, but only a live database can prove the
 * triggers actually fire on the right transition and write a row for
 * the right recipient.
 *
 * Reuses an existing active venue/court (owned by the seed demo owner)
 * and the established BOOKING_TEST_EMAIL customer account rather than
 * creating new ones — this script only needs to prove the trigger
 * fires for the right two user ids, not exercise the full booking flow.
 * Everything this script creates (bookings, a reschedule, a review, and
 * every notification produced along the way) is deleted at the end,
 * best-effort, in FK-safe order.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-notifications.ts
 */
import "./assert-staging-env";
import { Client as PgClient } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function hoursFromNow(hours: number): string {
  return new Date(Date.now() + hours * 60 * 60_000).toISOString();
}

async function main() {
  const pg = new PgClient({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  const customerId = "86f6cb7c-3051-4db5-89e0-3d5443945304"; // BOOKING_TEST_EMAIL account
  let ownerId: string | null = null;
  let courtId: string | null = null;
  let venueId: string | null = null;
  let rescheduleId: string | null = null;
  let reviewId: string | null = null;
  // Every booking id created below, tracked in one place so cleanup can't
  // silently drop one by a later step reassigning a single-booking variable.
  const bookingIds: string[] = [];
  const notificationIds: string[] = [];

  try {
    const court = await pg.query(
      `select c.id as court_id, c.venue_id, v.owner_id, c.hourly_price
       from public.courts c join public.venues v on v.id = c.venue_id
       where c.status = 'active' and v.status = 'active' limit 1`
    );
    if (court.rows.length === 0) throw new Error("No active court/venue found to test against.");
    courtId = court.rows[0].court_id;
    venueId = court.rows[0].venue_id;
    ownerId = court.rows[0].owner_id;
    console.log(`Using venue ${venueId} (owner ${ownerId}), court ${courtId}, customer ${customerId}`);

    // --- 1. booking pending -> confirmed: notifies customer + owner ---
    const booking = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, $3, $4, 'pending', 5000, 'PHP') returning id`,
      [courtId, customerId, hoursFromNow(48), hoursFromNow(49)]
    );
    const firstBookingId: string = booking.rows[0].id;
    bookingIds.push(firstBookingId);

    // Session-scoped (not `true`/local), since each pg.query() here is its
    // own implicit transaction — a `local` setting from one statement
    // would not survive into the next. prevent_booking_tampering() only
    // allows a non-admin session to move pending/confirmed -> cancelled;
    // this script also needs to drive pending -> confirmed directly, the
    // same bypass createBooking()/confirm_booking_payment() themselves use.
    await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', false)`);
    await pg.query(`update public.bookings set status = 'confirmed' where id = $1`, [firstBookingId]);

    const confirmedNotifs = await pg.query(
      `select id, user_id, type, title from public.notifications where user_id in ($1, $2) and created_at > now() - interval '1 minute' order by user_id`,
      [customerId, ownerId]
    );
    confirmedNotifs.rows.forEach((r) => notificationIds.push(r.id));
    record(
      "booking pending->confirmed notifies customer",
      confirmedNotifs.rows.some((r) => r.user_id === customerId && r.type === "booking_confirmed"),
      `found ${confirmedNotifs.rows.filter((r) => r.user_id === customerId).map((r) => r.type).join(",") || "none"}`
    );
    record(
      "booking pending->confirmed notifies owner",
      confirmedNotifs.rows.some((r) => r.user_id === ownerId && r.type === "booking_received"),
      `found ${confirmedNotifs.rows.filter((r) => r.user_id === ownerId).map((r) => r.type).join(",") || "none"}`
    );

    // --- 2. booking -> cancelled: notifies customer + owner ---
    await pg.query(`update public.bookings set status = 'cancelled', cancelled_at = now() where id = $1`, [firstBookingId]);

    const cancelledNotifs = await pg.query(
      `select id, user_id, type from public.notifications where user_id in ($1, $2) and type = 'booking_cancelled' and created_at > now() - interval '1 minute'`,
      [customerId, ownerId]
    );
    cancelledNotifs.rows.forEach((r) => notificationIds.push(r.id));
    record(
      "booking ->cancelled notifies customer",
      cancelledNotifs.rows.some((r) => r.user_id === customerId),
      `found ${cancelledNotifs.rows.length} booking_cancelled rows`
    );
    record(
      "booking ->cancelled notifies owner",
      cancelledNotifs.rows.some((r) => r.user_id === ownerId),
      `found ${cancelledNotifs.rows.length} booking_cancelled rows`
    );

    // --- 3. booking_reschedules -> completed: notifies the original booking's customer ---
    const original = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, $3, $4, 'confirmed', 5000, 'PHP') returning id`,
      [courtId, customerId, hoursFromNow(72), hoursFromNow(73)]
    );
    const originalBookingId: string = original.rows[0].id;
    bookingIds.push(originalBookingId);
    const replacement = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, $3, $4, 'pending', 5000, 'PHP') returning id`,
      [courtId, customerId, hoursFromNow(96), hoursFromNow(97)]
    );
    const replacementBookingId: string = replacement.rows[0].id;
    bookingIds.push(replacementBookingId);

    const reschedule = await pg.query(
      `insert into public.booking_reschedules (original_booking_id, new_booking_id, price_difference, status, initiated_by)
       values ($1, $2, 0, 'pending_payment', $3) returning id`,
      [originalBookingId, replacementBookingId, customerId]
    );
    rescheduleId = reschedule.rows[0].id;

    await pg.query(`select set_config('air_rally.bypass_reschedule_tampering', 'true', false)`);
    await pg.query(`update public.booking_reschedules set status = 'completed' where id = $1`, [rescheduleId]);

    const rescheduleNotifs = await pg.query(
      `select id, user_id, type from public.notifications where user_id = $1 and type = 'reschedule_completed' and created_at > now() - interval '1 minute'`,
      [customerId]
    );
    rescheduleNotifs.rows.forEach((r) => notificationIds.push(r.id));
    record(
      "reschedule ->completed notifies the original booking's customer",
      rescheduleNotifs.rows.length > 0,
      `found ${rescheduleNotifs.rows.length} reschedule_completed rows`
    );

    // --- 4. review insert: notifies the venue owner ---
    const review = await pg.query(
      `insert into public.reviews (venue_id, user_id, rating, comment) values ($1, $2, 5, '[STAGING-TEST] verification review') returning id`,
      [venueId, customerId]
    );
    reviewId = review.rows[0].id;

    const reviewNotifs = await pg.query(
      `select id, user_id, type from public.notifications where user_id = $1 and type = 'review_received' and created_at > now() - interval '1 minute'`,
      [ownerId]
    );
    reviewNotifs.rows.forEach((r) => notificationIds.push(r.id));
    record(
      "review insert notifies the venue owner",
      reviewNotifs.rows.length > 0,
      `found ${reviewNotifs.rows.length} review_received rows`
    );
  } finally {
    console.log("\nCleaning up...");
    if (notificationIds.length > 0) {
      await pg.query(`delete from public.notifications where id = any($1::uuid[])`, [notificationIds]).catch(() => {});
    }
    if (reviewId) await pg.query(`delete from public.reviews where id = $1`, [reviewId]).catch(() => {});
    if (rescheduleId) await pg.query(`delete from public.booking_reschedules where id = $1`, [rescheduleId]).catch(() => {});
    for (const id of bookingIds) {
      await pg.query(`delete from public.bookings where id = $1`, [id]).catch(() => {});
    }
    await pg.end();
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
  if (failed.length > 0) {
    console.error(`FAILED: ${failed.map((f) => f.check).join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
