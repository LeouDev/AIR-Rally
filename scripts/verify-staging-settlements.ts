/**
 * Functional verification of the settlement ledger against whatever
 * database DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * Covers the three funding shapes (PayMongo-only, credit-only, mixed),
 * the arithmetic identities, reversal on cancellation, the reschedule
 * shape, RLS, and the reconciliation function.
 *
 * WRITES: throwaway users, venue, courts and bookings, all removed in a
 * `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-settlements.ts
 */
import "./assert-staging-env";
import { Client } from "pg";
import { randomUUID } from "crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed += 1;
  } else {
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

async function asUser<T>(pg: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await pg.query("begin");
  await pg.query("set local role authenticated");
  await pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
  try {
    const result = await fn();
    await pg.query("commit");
    return result;
  } catch (error) {
    await pg.query("rollback").catch(() => undefined);
    throw error;
  }
}

type Settlement = {
  gross_booking_amount: number;
  paymongo_amount: number;
  credit_amount: number;
  platform_fee: number;
  venue_amount: number;
  settlement_source: string;
  settlement_status: string;
  cash_position: number;
};

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const player = randomUUID();
  const owner = randomUUID();
  const stranger = randomUUID();
  const admin = randomUUID();
  const userIds = [player, owner, stranger, admin];
  let venueId = "";
  let courtId = "";

  let hourOffset = 72;
  async function createBooking(priceAmount: number): Promise<string> {
    hourOffset += 3;
    const r = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, now() + ($3 || ' hours')::interval, now() + (($3::int + 1) || ' hours')::interval,
               'pending', $4, 'PHP')
       returning id`,
      [courtId, player, String(hourOffset), priceAmount]
    );
    return r.rows[0].id as string;
  }

  /** Confirms a booking the way the PayMongo webhook would. */
  async function confirmViaPaymongo(bookingId: string, chargedAmount: number, session: string) {
    await pg.query(
      `update public.bookings set paymongo_checkout_session_id = $2, payment_provider = 'paymongo' where id = $1`,
      [bookingId, session]
    );
    await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, 'pi_x', $3, 'PHP')`, [bookingId, session, chargedAmount]);
  }

  async function settlementOf(bookingId: string): Promise<Settlement | null> {
    const r = await pg.query(`select * from public.booking_settlements where booking_id = $1`, [bookingId]);
    return (r.rows[0] as Settlement) ?? null;
  }

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `settle-${run}-${i}@example.test`]
      );
    }

    const venue = await pg.query(
      `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
      [owner, `Settlement Test ${run}`]
    );
    venueId = venue.rows[0].id;
    const court = await pg.query(
      `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
      [venueId]
    );
    courtId = court.rows[0].id;
    await pg.query(`select public.issue_credit($1, 200000, 'admin_adjustment', null, 'test wallet')`, [player]);
    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);
    console.log(`Seeded users, venue, court, ₱2000 wallet (run ${run}).\n`);

    // --- 1. PayMongo-only ---------------------------------------------------
    console.log("— PayMongo-only booking —");
    const b1 = await createBooking(50000);
    await confirmViaPaymongo(b1, 50000, `cs_${run}_1`);
    const s1 = await settlementOf(b1);

    check("a settlement row is created on confirmation", s1 !== null);
    check("source is 'paymongo'", s1?.settlement_source === "paymongo", `got ${s1?.settlement_source}`);
    check("gross is the full price", s1?.gross_booking_amount === 50000, `got ${s1?.gross_booking_amount}`);
    check("all of it is PayMongo cash", s1?.paymongo_amount === 50000, `got ${s1?.paymongo_amount}`);
    check("no credit involved", s1?.credit_amount === 0, `got ${s1?.credit_amount}`);
    check("platform fee is 5% (₱25)", s1?.platform_fee === 2500, `got ${s1?.platform_fee}`);
    check("venue is owed 95% (₱475)", s1?.venue_amount === 47500, `got ${s1?.venue_amount}`);
    check("cash position is positive (₱25 held)", s1?.cash_position === 2500, `got ${s1?.cash_position}`);
    check("status starts as pending", s1?.settlement_status === "pending", `got ${s1?.settlement_status}`);

    // --- 2. Credit-only -----------------------------------------------------
    console.log("\n— Credit-only booking —");
    const b2 = await createBooking(40000);
    await pg.query(`select public.apply_credit_to_booking($1, $2, 40000)`, [b2, player]);
    await pg.query(`select public.confirm_credit_only_booking($1, $2)`, [b2, player]);
    const s2 = await settlementOf(b2);

    check("a settlement row is created for a credit-only booking", s2 !== null);
    check("source is 'credit'", s2?.settlement_source === "credit", `got ${s2?.settlement_source}`);
    check("no PayMongo cash was collected", s2?.paymongo_amount === 0, `got ${s2?.paymongo_amount}`);
    check("the whole price came from credit", s2?.credit_amount === 40000, `got ${s2?.credit_amount}`);
    check("the venue is STILL owed 95% (₱380)", s2?.venue_amount === 38000, `got ${s2?.venue_amount}`);
    // The point of the whole ledger: entitlement with no cash behind it.
    check("cash position is negative — entitlement with no cash behind it", s2?.cash_position === -38000, `got ${s2?.cash_position}`);

    // --- 3. Mixed -----------------------------------------------------------
    console.log("\n— Mixed booking —");
    const b3 = await createBooking(50000);
    await pg.query(`select public.apply_credit_to_booking($1, $2, 30000)`, [b3, player]);
    await confirmViaPaymongo(b3, 20000, `cs_${run}_3`);
    const s3 = await settlementOf(b3);

    check("a settlement row is created for a mixed booking", s3 !== null);
    check("source is 'mixed'", s3?.settlement_source === "mixed", `got ${s3?.settlement_source}`);
    check("PayMongo cash is the remainder (₱200)", s3?.paymongo_amount === 20000, `got ${s3?.paymongo_amount}`);
    check("credit is the rest (₱300)", s3?.credit_amount === 30000, `got ${s3?.credit_amount}`);
    check("gross is unchanged at ₱500", s3?.gross_booking_amount === 50000, `got ${s3?.gross_booking_amount}`);
    check("venue is owed 95% of GROSS, not of the cash (₱475)", s3?.venue_amount === 47500, `got ${s3?.venue_amount}`);
    check("cash position is short by ₱275", s3?.cash_position === -27500, `got ${s3?.cash_position}`);

    // --- Arithmetic identities ----------------------------------------------
    console.log("\n— Arithmetic identities —");
    const bad = await pg.query(
      `select count(*)::int n from public.booking_settlements
       where paymongo_amount + credit_amount <> gross_booking_amount
          or platform_fee + venue_amount <> gross_booking_amount`
    );
    check("every row balances on both identities", bad.rows[0].n === 0, `${bad.rows[0].n} row(s) unbalanced`);

    let forced = false;
    try {
      await pg.query(
        `insert into public.booking_settlements
           (booking_id, venue_id, gross_booking_amount, paymongo_amount, credit_amount,
            platform_fee, venue_amount, fee_percent_applied, settlement_source)
         values ($1, $2, 50000, 10000, 10000, 2500, 47500, 0.05, 'mixed')`,
        [await createBooking(50000), venueId]
      );
      forced = true;
    } catch {
      /* expected — funding identity violated */
    }
    check("a row whose funding doesn't sum to gross is rejected", !forced);

    let mislabelled = false;
    try {
      await pg.query(
        `insert into public.booking_settlements
           (booking_id, venue_id, gross_booking_amount, paymongo_amount, credit_amount,
            platform_fee, venue_amount, fee_percent_applied, settlement_source)
         values ($1, $2, 50000, 50000, 0, 2500, 47500, 0.05, 'credit')`,
        [await createBooking(50000), venueId]
      );
      mislabelled = true;
    } catch {
      /* expected — source contradicts the amounts */
    }
    check("a row whose source contradicts its amounts is rejected", !mislabelled);

    // --- Payable sweep -------------------------------------------------------
    console.log("\n— Payable sweep —");
    const beforeSweep = await settlementOf(b1);
    check("a future booking is not yet payable", beforeSweep?.settlement_status === "pending");

    // Move b1 into the past so the sweep can see it as delivered.
    // start_time/end_time are guarded by prevent_booking_tampering(), so
    // this needs the same transaction-local bypass the privileged RPCs
    // use — without it the update is silently reverted and the booking
    // never moves.
    await pg.query("begin");
    await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', true)`);
    await pg.query(
      `update public.bookings set start_time = now() - interval '3 hours', end_time = now() - interval '2 hours' where id = $1`,
      [b1]
    );
    await pg.query("commit");
    await pg.query(`select public.mark_settlements_payable()`);
    const afterSweep = await settlementOf(b1);
    check("a delivered booking becomes payable", afterSweep?.settlement_status === "payable", `got ${afterSweep?.settlement_status}`);

    const sweptAgain = await pg.query(`select public.mark_settlements_payable() as n`);
    check("the sweep is idempotent", sweptAgain.rows[0].n === 0, `moved ${sweptAgain.rows[0].n} more`);

    // --- Cancellation --------------------------------------------------------
    console.log("\n— Cancellation —");
    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set status = 'cancelled' where id = $1`, [b3]);
    });
    const s3after = await settlementOf(b3);
    check("cancelling reverses the settlement", s3after?.settlement_status === "reversed", `got ${s3after?.settlement_status}`);
    const reversedRow = await pg.query(`select reversed_at, reversal_reason from public.booking_settlements where booking_id = $1`, [b3]);
    check("the reversal is timestamped", reversedRow.rows[0].reversed_at !== null);
    check("the reversal records a reason", reversedRow.rows[0].reversal_reason !== null);
    check("the row is kept, not deleted", s3after !== null);

    // --- Reschedule shape ----------------------------------------------------
    // A reschedule cancels the original and confirms a replacement. Each
    // gets its own independent settlement — matching how venueEarnings.ts
    // already treats a replacement as its own snapshot.
    console.log("\n— Reschedule shape —");
    const original = await createBooking(50000);
    await confirmViaPaymongo(original, 50000, `cs_${run}_o`);
    const replacement = await createBooking(60000);
    await confirmViaPaymongo(replacement, 60000, `cs_${run}_r`);
    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set status = 'cancelled' where id = $1`, [original]);
    });

    const sOrig = await settlementOf(original);
    const sRepl = await settlementOf(replacement);
    check("the original's entitlement is reversed", sOrig?.settlement_status === "reversed", `got ${sOrig?.settlement_status}`);
    check("the replacement carries its own live entitlement", sRepl?.settlement_status === "pending", `got ${sRepl?.settlement_status}`);
    check("the replacement is priced independently (₱600 → ₱570)", sRepl?.venue_amount === 57000, `got ${sRepl?.venue_amount}`);
    check("no double entitlement survives the move", (sOrig?.settlement_status === "reversed") && (sRepl?.settlement_status === "pending"));

    // --- Reconciliation ------------------------------------------------------
    console.log("\n— Reconciliation —");
    // reconcile_settlements() is admin-only since migration 040, so this
    // must run under a real admin identity rather than the raw connection.
    const byIssue = await asUser(pg, admin, async () => {
      const issues = await pg.query(
        `select issue, count(*)::int n from public.reconcile_settlements()
         where booking_id in (select id from public.bookings where court_id = $1) group by issue`,
        [courtId]
      );
      return Object.fromEntries(issues.rows.map((r) => [r.issue, r.n])) as Record<string, number>;
    });
    check("no missing settlements", !byIssue.missing_settlement, `${byIssue.missing_settlement} found`);
    check("no funding mismatches", !byIssue.funding_mismatch, `${byIssue.funding_mismatch} found`);
    check("no live entitlement on cancelled bookings", !byIssue.live_settlement_on_cancelled_booking, `${byIssue.live_settlement_on_cancelled_booking} found`);
    // Expected, not an error: the credit-only booking is real exposure.
    check("credit-funded exposure IS reported", byIssue.unfunded_entitlement >= 1, `got ${byIssue.unfunded_entitlement ?? 0}`);

    // --- RLS ------------------------------------------------------------------
    console.log("\n— RLS —");
    const ownerSees = await asUser(pg, owner, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements where venue_id = $1`, [venueId]);
      return r.rows[0].n as number;
    });
    check("a venue owner reads their own settlements", ownerSees > 0, `saw ${ownerSees}`);

    const strangerSees = await asUser(pg, stranger, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements where venue_id = $1`, [venueId]);
      return r.rows[0].n as number;
    });
    check("an unrelated user sees nothing", strangerSees === 0, `saw ${strangerSees}`);

    const playerSees = await asUser(pg, player, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements where venue_id = $1`, [venueId]);
      return r.rows[0].n as number;
    });
    check("the customer cannot read venue entitlement", playerSees === 0, `saw ${playerSees}`);

    const ownerWrote = await asUser(pg, owner, async () => {
      const r = await pg.query(`update public.booking_settlements set venue_amount = 999999 where venue_id = $1`, [venueId]);
      return r.rowCount ?? 0;
    });
    check("a venue owner cannot revalue their own entitlement", ownerWrote === 0, `updated ${ownerWrote} row(s)`);

    const ownerDeleted = await asUser(pg, owner, async () => {
      const r = await pg.query(`delete from public.booking_settlements where venue_id = $1`, [venueId]);
      return r.rowCount ?? 0;
    });
    check("a venue owner cannot delete a settlement", ownerDeleted === 0, `deleted ${ownerDeleted} row(s)`);
  } finally {
    console.log("\nCleaning up…");
    await pg.query(`delete from public.bookings where court_id = $1`, [courtId]).catch(() => undefined);
    await pg.query(`delete from public.courts where id = $1`, [courtId]).catch(() => undefined);
    await pg.query(`delete from public.venues where id = $1`, [venueId]).catch(() => undefined);
    await pg.query(`delete from public.credit_transactions where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from public.user_credit_wallets where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from public.notifications where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from auth.users where id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    console.log("Cleanup done.");
    await pg.end();
  }

  console.log(`\n${failed === 0 ? "All checks passed." : "Some checks FAILED."} (${passed} passed, ${failed} failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
