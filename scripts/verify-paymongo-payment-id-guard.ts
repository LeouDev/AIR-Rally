/**
 * Proves the fix for the gap `95` found: paymongo_payment_id (121) was
 * never added to prevent_booking_tampering()'s guarded-column
 * allowlist, so a booking's own owner could write ANY value into it via
 * the ordinary "Users can update their own bookings" RLS policy — a
 * real refund-target-forgery path once requestRefund() starts reading
 * it. This proves the trigger now reverts a non-privileged write, and
 * that confirm_paymongo_booking_payment() can still set the real value
 * through the same privileged path paymongo_payment_intent_id already
 * uses.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-paymongo-payment-id-guard.ts
 * (after sourcing .env.staging).
 */
import "./assert-staging-env";
import { Client } from "pg";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

async function asUser(client: Client, userId: string, fn: () => Promise<unknown>) {
  await client.query("begin");
  try {
    await client.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await client.query(`select set_config('role', 'authenticated', true)`);
    const result = await fn();
    await client.query("commit");
    return result;
  } catch (e) {
    await client.query("rollback");
    throw e;
  }
}

// A plain player, deliberately NOT the LEOU admin account used
// elsewhere in this suite of scripts — is_admin() makes the trigger's
// guard a no-op for an admin by design, so testing "can an ordinary
// customer forge this" with an admin account would prove nothing.
const OWNER = "3e1c4aa5-2122-4343-a3e2-321c11961a74"; // MOBILE, role='player'
const COURT = "00000000-0000-4000-8001-000000000001";

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  await client.query(`delete from public.bookings where confirmation_code = 'GUARDTEST'`);

  const booking = await client.query(
    `insert into public.bookings
       (court_id, user_id, start_time, end_time, price_amount, confirmation_code, status, payment_provider,
        paymongo_checkout_session_id, currency, credit_amount_applied, processing_fee_amount)
     values ($1, $2, now() + interval '1 day', now() + interval '1 day 1 hour', 100000, 'GUARDTEST', 'pending', 'paymongo',
        'cs_guardtest', 'PHP', 0, 0)
     returning id`,
    [COURT, OWNER]
  );
  const bookingId = booking.rows[0].id;

  console.log("\n=== the booking owner cannot write paymongo_payment_id via the ordinary client path ===\n");
  await asUser(client, OWNER, () =>
    client.query(`update public.bookings set paymongo_payment_id = 'pay_forged_by_owner' where id = $1`, [bookingId])
  );
  const afterForgeAttempt = await client.query(`select paymongo_payment_id from public.bookings where id = $1`, [bookingId]);
  assertEqual(
    "the trigger reverts the customer-supplied value — still null, not the forged one",
    afterForgeAttempt.rows[0].paymongo_payment_id,
    null
  );

  console.log("\n=== the same guard still protects its sibling column, unchanged ===\n");
  await asUser(client, OWNER, () =>
    client.query(`update public.bookings set paymongo_payment_intent_id = 'pi_forged_by_owner' where id = $1`, [bookingId])
  );
  const afterIntentForge = await client.query(`select paymongo_payment_intent_id from public.bookings where id = $1`, [bookingId]);
  assertEqual("paymongo_payment_intent_id is still guarded too", afterIntentForge.rows[0].paymongo_payment_intent_id, null);

  console.log("\n=== the privileged RPC path can still set the real value ===\n");
  const confirmed = await client.query(
    `select public.confirm_paymongo_booking_payment($1, $2, $3, $4, $5, $6) as ok`,
    [bookingId, "cs_guardtest", "pi_real_intent", 100000, "PHP", "pay_real_payment_id"]
  );
  assertEqual("confirm_paymongo_booking_payment succeeded", confirmed.rows[0].ok, true);
  const afterConfirm = await client.query(
    `select status, paymongo_payment_intent_id, paymongo_payment_id from public.bookings where id = $1`,
    [bookingId]
  );
  assertEqual("status moved to confirmed", afterConfirm.rows[0].status, "confirmed");
  assertEqual("paymongo_payment_intent_id set via the privileged path", afterConfirm.rows[0].paymongo_payment_intent_id, "pi_real_intent");
  assertEqual("paymongo_payment_id set via the SAME privileged path", afterConfirm.rows[0].paymongo_payment_id, "pay_real_payment_id");

  console.log("\n=== once confirmed, the owner still can't overwrite it post-hoc ===\n");
  await asUser(client, OWNER, () =>
    client.query(`update public.bookings set paymongo_payment_id = 'pay_forged_after_confirm' where id = $1`, [bookingId])
  );
  const afterSecondForgeAttempt = await client.query(`select paymongo_payment_id from public.bookings where id = $1`, [bookingId]);
  assertEqual(
    "still the real value set via confirm_paymongo_booking_payment, not the forgery",
    afterSecondForgeAttempt.rows[0].paymongo_payment_id,
    "pay_real_payment_id"
  );

  console.log("\n=== teardown ===\n");
  await client.query(`delete from public.bookings where id = $1`, [bookingId]);
  console.log("fixture cleaned up.");

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
