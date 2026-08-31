/**
 * Proves migration 123 (reschedule_credit_compensation) against staging:
 * the mutual-exclusivity CHECK, the widened complete_reschedule /
 * mark_reschedule_failed, the new record_reschedule_credit_success, the
 * renamed pending_completion status, the sixth transaction_type value,
 * and that credit_transaction_id is guarded the same way refund_id is.
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-reschedule-credit-compensation.ts
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

async function assertThrows(label: string, expectedSubstring: string, fn: () => Promise<unknown>) {
  try {
    await fn();
    console.log(`FAIL ${label}: expected an error containing "${expectedSubstring}", but it succeeded`);
    failures++;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const ok = message.includes(expectedSubstring);
    console.log(`${ok ? "OK  " : "FAIL"} ${label}: got "${message}", want to include "${expectedSubstring}"`);
    if (!ok) failures++;
  }
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

const OWNER = "3e1c4aa5-2122-4343-a3e2-321c11961a74"; // MOBILE, role='player', not admin
const COURT = "00000000-0000-4000-8001-000000000001";

// bookings_generate_confirmation_code overwrites any confirmation_code
// supplied on insert, and bookings_force_pending_on_insert forces every
// new row to status='pending' regardless of what's specified — so
// fixtures are tracked by id (not confirmation_code) and any non-pending
// status is set via a separate privileged UPDATE after insert.
async function makeBooking(client: Client, price: number, status: string, hoursOut: number): Promise<string> {
  const r = await client.query(
    `insert into public.bookings
       (court_id, user_id, start_time, end_time, price_amount, confirmation_code,
        currency, credit_amount_applied, processing_fee_amount)
     values ($1, $2, now() + make_interval(hours => $4), now() + make_interval(hours => $4 + 1), $3, 'x',
        'PHP', 0, 0)
     returning id`,
    [COURT, OWNER, price, hoursOut]
  );
  const id = r.rows[0].id;
  if (status !== "pending") {
    // set_config(..., true) is transaction-local — it would reset before
    // a separate client.query() call ever saw it, since each runs as its
    // own implicit transaction outside an explicit BEGIN. false (session
    // scope) persists across statements on this connection instead.
    await client.query(`select set_config('air_rally.bypass_booking_tampering', 'true', false)`);
    await client.query(`update public.bookings set status = $1 where id = $2`, [status, id]);
    await client.query(`select set_config('air_rally.bypass_booking_tampering', 'false', false)`);
  }
  return id;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  const fixtureBookingIds: string[] = [];
  const fixtureRescheduleReason = "CREDITGUARDTEST";

  let fakeRefundId: string | null = null;
  let creditTransactionId2: string | null = null;
  let creditTransactionId: string | null = null;

  await client.query(`delete from public.booking_reschedules where reason = $1`, [fixtureRescheduleReason]);

  try {

  const originalBookingId = await makeBooking(client, 100000, "confirmed", 24);
  const newBookingId = await makeBooking(client, 80000, "pending", 48);
  fixtureBookingIds.push(originalBookingId, newBookingId);

  const reschedule = await client.query(
    `insert into public.booking_reschedules (original_booking_id, new_booking_id, price_difference, status, initiated_by, reason)
     values ($1, $2, -20000, 'pending_payment', $3, 'CREDITGUARDTEST')
     returning id`,
    [originalBookingId, newBookingId, OWNER]
  );
  const rescheduleId = reschedule.rows[0].id;

  console.log("\n=== transaction_type accepts the sixth value ===\n");
  const credit = await client.query(
    `insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description)
     values ($1, 20000, 'reschedule_compensation', $2, 'Credit for reschedule price difference') returning id`,
    [OWNER, originalBookingId]
  );
  creditTransactionId = credit.rows[0].id;
  console.log("OK   reschedule_compensation insert succeeded (would have thrown if the constraint rejected it)");

  console.log("\n=== record_reschedule_credit_success validates and transitions ===\n");
  await assertThrows(
    "a credit transaction for the WRONG booking is rejected",
    "is not a reschedule_compensation for booking",
    () => client.query(`select public.record_reschedule_credit_success($1, $2)`, [rescheduleId, "00000000-0000-0000-0000-000000000000"])
  );

  const recorded = await client.query(`select public.record_reschedule_credit_success($1, $2) as ok`, [rescheduleId, creditTransactionId]);
  assertEqual("record_reschedule_credit_success succeeded", recorded.rows[0].ok, true);

  const afterRecord = await client.query(`select status, credit_transaction_id, refund_id from public.booking_reschedules where id = $1`, [rescheduleId]);
  assertEqual("status is the renamed neutral value, not pending_refund", afterRecord.rows[0].status, "pending_completion");
  assertEqual("credit_transaction_id is set", afterRecord.rows[0].credit_transaction_id, creditTransactionId);
  assertEqual("refund_id stays null — only one mechanism is ever used", afterRecord.rows[0].refund_id, null);

  console.log("\n=== the customer cannot forge credit_transaction_id directly, same guard as refund_id ===\n");
  await asUser(client, OWNER, () =>
    client.query(`update public.booking_reschedules set credit_transaction_id = null where id = $1`, [rescheduleId])
  );
  const afterForgeAttempt = await client.query(`select credit_transaction_id from public.booking_reschedules where id = $1`, [rescheduleId]);
  assertEqual("the trigger reverts the customer's attempt to clear it", afterForgeAttempt.rows[0].credit_transaction_id, creditTransactionId);

  console.log("\n=== mutual exclusivity: a row can never carry both mechanisms ===\n");
  const fakeRefund = await client.query(
    `insert into public.booking_refunds
       (booking_id, payment_provider, provider_payment_id, amount, currency, status, initiated_by)
     values ($1, 'paymongo', 'pay_test', 20000, 'PHP', 'succeeded', $2) returning id`,
    [originalBookingId, OWNER]
  );
  fakeRefundId = fakeRefund.rows[0].id;
  // Bypass the tampering trigger for this attempt specifically — without
  // it, prevent_reschedule_tampering() silently reverts refund_id before
  // the CHECK ever sees a conflicting state, which would test the
  // trigger's guard instead of the CHECK this section is actually about.
  await client.query(`select set_config('air_rally.bypass_reschedule_tampering', 'true', false)`);
  await assertThrows(
    "setting refund_id on a row that already has credit_transaction_id violates the CHECK",
    "booking_reschedules_one_compensation_mechanism",
    () => client.query(`update public.booking_reschedules set refund_id = $1 where id = $2`, [fakeRefundId, rescheduleId])
  );
  await client.query(`select set_config('air_rally.bypass_reschedule_tampering', 'false', false)`);

  console.log("\n=== complete_reschedule accepts credit_transaction_id from pending_completion ===\n");
  const completed = await client.query(`select public.complete_reschedule($1, null, $2) as ok`, [rescheduleId, creditTransactionId]);
  assertEqual("complete_reschedule succeeded from pending_completion", completed.rows[0].ok, true);
  const afterComplete = await client.query(`select status from public.booking_reschedules where id = $1`, [rescheduleId]);
  assertEqual("reschedule is completed", afterComplete.rows[0].status, "completed");
  const newBookingAfter = await client.query(`select status from public.bookings where id = $1`, [newBookingId]);
  assertEqual("new booking confirmed", newBookingAfter.rows[0].status, "confirmed");
  const origBookingAfter = await client.query(`select status from public.bookings where id = $1`, [originalBookingId]);
  assertEqual("original booking cancelled", origBookingAfter.rows[0].status, "cancelled");

  console.log("\n=== mark_reschedule_failed accepts credit_transaction_id too ===\n");
  const reschedule2 = await client.query(
    `insert into public.booking_reschedules (original_booking_id, new_booking_id, price_difference, status, initiated_by, reason)
     values ($1, $2, -20000, 'pending_payment', $3, 'CREDITGUARDTEST') returning id`,
    [originalBookingId, newBookingId, OWNER]
  );
  const rescheduleId2 = reschedule2.rows[0].id;
  const credit2 = await client.query(
    `insert into public.credit_transactions (user_id, amount, transaction_type, reference_id, description)
     values ($1, 20000, 'reschedule_compensation', $2, 'test') returning id`,
    [OWNER, originalBookingId]
  );
  creditTransactionId2 = credit2.rows[0].id;
  const failed = await client.query(
    `select public.mark_reschedule_failed($1, 'failed', 'test failure', null, $2) as ok`,
    [rescheduleId2, creditTransactionId2]
  );
  assertEqual("mark_reschedule_failed succeeded with a credit reference", failed.rows[0].ok, true);
  const afterFail = await client.query(`select status, credit_transaction_id from public.booking_reschedules where id = $1`, [rescheduleId2]);
  assertEqual("status is failed", afterFail.rows[0].status, "failed");
  assertEqual("credit_transaction_id recorded even on failure", afterFail.rows[0].credit_transaction_id, creditTransactionId2);

  } finally {
    console.log("\n=== teardown ===\n");
    // credit_transactions is append-only by design (prevent_credit_ledger_mutation) —
    // the real ledger never deletes a row to correct a mistake, only
    // offsets it, so this suite's own test rows are left in place rather
    // than fighting that guard. Two small test-amount rows, harmless.
    await client.query(`delete from public.booking_reschedules where reason = $1`, [fixtureRescheduleReason]);
    if (fakeRefundId) await client.query(`delete from public.booking_refunds where id = $1`, [fakeRefundId]);
    if (fixtureBookingIds.length) await client.query(`delete from public.bookings where id = any($1)`, [fixtureBookingIds]);
    console.log("fixtures cleaned up (credit_transactions rows intentionally left — append-only ledger).");
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
