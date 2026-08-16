/**
 * Verifies the payout preparation layer against whatever database
 * DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * The point of this script is to prove two things a mock cannot:
 *   1. the eligibility and authorisation rules live in the DATABASE, so
 *      they hold even when the UI is bypassed entirely, and
 *   2. NO MONEY MOVES — no settlement is ever marked 'settled', and a batch
 *      cannot be pushed into an execution state.
 *
 * WRITES: throwaway users, venues, courts, bookings and batches — all
 * removed in a `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-payout-readiness.ts
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

/** Runs fn as the given user, reporting "blocked" if the database refuses. */
async function attempt(pg: Client, userId: string, sql: string, params: unknown[] = []): Promise<"allowed" | "blocked"> {
  return asUser(pg, userId, async () => {
    try {
      await pg.query(sql, params);
      return "allowed" as const;
    } catch {
      return "blocked" as const;
    }
  }).catch(() => "blocked" as const);
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const admin = randomUUID();
  const player = randomUUID();
  const userIds = [ownerA, ownerB, admin, player];
  const venueIds: string[] = [];
  const courtIds: string[] = [];
  const batchIds: string[] = [];

  let hourOffset = 120;
  // Delivered bookings each need their OWN past window, or the second one
  // on a court collides with the first under bookings_no_overlap.
  let pastOffset = 2;
  /** Creates a confirmed booking and returns its settlement id. */
  async function settledBooking(courtId: string, priceAmount: number, creditAmount: number, deliver: boolean): Promise<string> {
    hourOffset += 3;
    const r = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, now() + ($3 || ' hours')::interval, now() + (($3::int + 1) || ' hours')::interval,
               'pending', $4, 'PHP')
       returning id`,
      [courtId, player, String(hourOffset), priceAmount]
    );
    const bookingId = r.rows[0].id as string;

    if (creditAmount > 0) await pg.query(`select public.apply_credit_to_booking($1, $2, $3)`, [bookingId, player, creditAmount]);

    if (creditAmount >= priceAmount) {
      await pg.query(`select public.confirm_credit_only_booking($1, $2)`, [bookingId, player]);
    } else {
      const session = `cs_${run}_${bookingId.slice(0, 8)}`;
      await pg.query(`update public.bookings set paymongo_checkout_session_id = $2, payment_provider = 'paymongo' where id = $1`, [
        bookingId,
        session,
      ]);
      await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, 'pi_x', $3, 'PHP')`, [
        bookingId,
        session,
        priceAmount - creditAmount,
      ]);
    }

    if (deliver) {
      // Move the court time into the past so the sweep can earn it.
      // start_time/end_time are tamper-guarded, hence the bypass flag.
      pastOffset += 2;
      await pg.query("begin");
      await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', true)`);
      await pg.query(
        `update public.bookings
         set start_time = now() - (($2::int + 1) || ' hours')::interval,
             end_time = now() - ($2 || ' hours')::interval
         where id = $1`,
        [bookingId, String(pastOffset)]
      );
      await pg.query("commit");
    }

    const s = await pg.query(`select id from public.booking_settlements where booking_id = $1`, [bookingId]);
    return s.rows[0].id as string;
  }

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `payout-${run}-${i}@example.test`]
      );
    }
    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    for (const [i, owner] of [ownerA, ownerB].entries()) {
      const v = await pg.query(
        `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
        [owner, `Payout ${run} #${i + 1}`]
      );
      venueIds.push(v.rows[0].id);
      const c = await pg.query(
        `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
        [v.rows[0].id]
      );
      courtIds.push(c.rows[0].id);
    }
    await pg.query(`select public.issue_credit($1, 300000, 'admin_adjustment', null, 'test wallet')`, [player]);

    // Owner A: one delivered PayMongo booking, one delivered credit-only,
    // one still-future (pending). Owner B: one delivered mixed booking.
    const payableA1 = await settledBooking(courtIds[0], 50000, 0, true);
    const payableA2 = await settledBooking(courtIds[0], 40000, 40000, true);
    const pendingA = await settledBooking(courtIds[0], 50000, 0, false);
    const payableB = await settledBooking(courtIds[1], 50000, 30000, true);

    await pg.query(`select public.mark_settlements_payable()`);
    console.log(`Seeded 2 owners, 1 admin, 4 settlements (run ${run}).\n`);

    // --- Authorisation, at the database ------------------------------------
    console.log("— Authorisation —");
    check(
      "a venue owner cannot create a payout batch",
      (await attempt(pg, ownerA, `select public.create_payout_batch(array[$1]::uuid[], null)`, [payableA1])) === "blocked"
    );
    check(
      "a customer cannot create a payout batch",
      (await attempt(pg, player, `select public.create_payout_batch(array[$1]::uuid[], null)`, [payableA1])) === "blocked"
    );
    check(
      "a venue owner cannot read the platform cash position",
      (await attempt(pg, ownerA, `select * from public.payout_cash_position()`)) === "blocked"
    );
    check(
      "a venue owner cannot list payout candidates",
      (await attempt(pg, ownerA, `select * from public.available_settlements_for_payout()`)) === "blocked"
    );

    const ownerInsert = await attempt(
      pg,
      ownerA,
      `insert into public.payout_batches (batch_reference, created_by) values ('PB-HACK', $1)`,
      [ownerA]
    );
    check("a venue owner cannot insert a batch row directly", ownerInsert === "blocked");

    // --- Admin creates a batch ---------------------------------------------
    console.log("\n— Batch creation —");
    const batchId = await asUser(pg, admin, async () => {
      const r = await pg.query(`select public.create_payout_batch(array[$1, $2]::uuid[], 'test batch') as id`, [payableA1, payableA2]);
      return r.rows[0].id as string;
    });
    batchIds.push(batchId);
    check("an admin can create a batch from payable settlements", !!batchId);

    const batch = await pg.query(`select * from public.payout_batches where id = $1`, [batchId]);
    check("the batch starts as a draft", batch.rows[0].status === "draft", `got ${batch.rows[0].status}`);
    check("its reference is generated", /^PB-\d{6}$/.test(batch.rows[0].batch_reference), batch.rows[0].batch_reference);
    check("its settlement count is derived", batch.rows[0].settlement_count === 2, `got ${batch.rows[0].settlement_count}`);
    // ₱475 + ₱380 = ₱855, computed by trigger from the items themselves.
    check("its total is derived from the items (₱855)", batch.rows[0].total_amount === 85500, `got ${batch.rows[0].total_amount}`);

    // --- Eligibility --------------------------------------------------------
    console.log("\n— Eligibility —");
    const pendingRejected = await attempt(pg, admin, `select public.create_payout_batch(array[$1]::uuid[], null)`, [pendingA]);
    check("a PENDING settlement cannot enter a batch", pendingRejected === "blocked");

    const duplicate = await attempt(pg, admin, `select public.create_payout_batch(array[$1]::uuid[], null)`, [payableA1]);
    check("a settlement already in a live batch cannot be re-batched", duplicate === "blocked");

    // Reverse a settlement by cancelling its booking, then try to batch it.
    const reversibleId = await settledBooking(courtIds[1], 30000, 0, true);
    await pg.query(`select public.mark_settlements_payable()`);
    await pg.query("begin");
    await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', true)`);
    await pg.query(
      `update public.bookings set status = 'cancelled'
       where id = (select booking_id from public.booking_settlements where id = $1)`,
      [reversibleId]
    );
    await pg.query("commit");
    const reversedRejected = await attempt(pg, admin, `select public.create_payout_batch(array[$1]::uuid[], null)`, [reversibleId]);
    check("a REVERSED settlement cannot enter a batch", reversedRejected === "blocked");

    const emptyRejected = await attempt(pg, admin, `select public.create_payout_batch(array[]::uuid[], null)`);
    check("an empty batch is rejected", emptyRejected === "blocked");

    // A failed create must leave nothing behind.
    const orphans = await pg.query(
      `select count(*)::int n from public.payout_batches where settlement_count = 0 and created_by = $1`,
      [admin]
    );
    check("a rejected batch creation leaves no empty batch behind", orphans.rows[0].n === 0, `${orphans.rows[0].n} orphan(s)`);

    // --- Owner isolation ----------------------------------------------------
    console.log("\n— Owner isolation —");
    const aSeesItems = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`select count(*)::int n from public.payout_batch_items`);
      return r.rows[0].n as number;
    });
    check("Owner A sees their own two batch items", aSeesItems === 2, `saw ${aSeesItems}`);

    const bSeesItems = await asUser(pg, ownerB, async () => {
      const r = await pg.query(`select count(*)::int n from public.payout_batch_items`);
      return r.rows[0].n as number;
    });
    check("Owner B sees none of Owner A's payout data", bSeesItems === 0, `saw ${bSeesItems}`);

    const aSeesBatches = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`select count(*)::int n from public.payout_batches`);
      return r.rows[0].n as number;
    });
    check("no venue owner can read batch records themselves", aSeesBatches === 0, `saw ${aSeesBatches}`);

    const playerSees = await asUser(pg, player, async () => {
      const r = await pg.query(`select count(*)::int n from public.payout_batch_items`);
      return r.rows[0].n as number;
    });
    check("a customer sees no payout data at all", playerSees === 0, `saw ${playerSees}`);

    const adminSees = await asUser(pg, admin, async () => {
      const r = await pg.query(`select count(*)::int n from public.payout_batches where id = $1`, [batchId]);
      return r.rows[0].n as number;
    });
    check("an admin sees all batches", adminSees === 1, `saw ${adminSees}`);

    // --- Approval -----------------------------------------------------------
    console.log("\n— Approval —");
    const ownerApprove = await attempt(pg, ownerA, `select public.approve_payout_batch($1)`, [batchId]);
    check("a venue owner cannot approve a batch", ownerApprove === "blocked");

    const approved = await asUser(pg, admin, async () => {
      const r = await pg.query(`select public.approve_payout_batch($1) as ok`, [batchId]);
      return r.rows[0].ok as boolean;
    });
    check("an admin can approve a batch", approved === true);

    const approvedRow = await pg.query(`select status, approved_at, approved_by from public.payout_batches where id = $1`, [batchId]);
    check("the batch is approved", approvedRow.rows[0].status === "approved", `got ${approvedRow.rows[0].status}`);
    check("approval is timestamped", approvedRow.rows[0].approved_at !== null);
    check("approval records who approved it", approvedRow.rows[0].approved_by === admin);

    const reapprove = await asUser(pg, admin, async () => {
      const r = await pg.query(`select public.approve_payout_batch($1) as ok`, [batchId]);
      return r.rows[0].ok as boolean;
    });
    check("approving twice is a no-op", reapprove === false);

    const mutateApproved = await attempt(
      pg,
      admin,
      `insert into public.payout_batch_items (payout_batch_id, settlement_id, venue_id, amount) values ($1, $2, $3, 1)`,
      [batchId, payableB, venueIds[1]]
    );
    check("an approved batch cannot have settlements added to it", mutateApproved === "blocked");

    // --- NO MONEY MOVED (the whole point) -----------------------------------
    console.log("\n— No money moved —");
    const settlementStates = await pg.query(
      `select settlement_status, count(*)::int n from public.booking_settlements
       where id = any($1::uuid[]) group by settlement_status`,
      [[payableA1, payableA2]]
    );
    const states = Object.fromEntries(settlementStates.rows.map((r) => [r.settlement_status, r.n]));
    check("approving the batch left both settlements PAYABLE", states.payable === 2, JSON.stringify(states));
    check("no settlement was marked 'settled'", !states.settled);

    const anySettled = await pg.query(`select count(*)::int n from public.booking_settlements where settlement_status = 'settled'`);
    check("no settlement anywhere in the database is 'settled'", anySettled.rows[0].n === 0, `${anySettled.rows[0].n} found`);

    const toProcessing = await attempt(pg, admin, `update public.payout_batches set status = 'processing' where id = $1`, [batchId]);
    check("a batch cannot be moved to 'processing' — no executor exists", toProcessing === "blocked");

    const toCompleted = await attempt(pg, admin, `update public.payout_batches set status = 'completed' where id = $1`, [batchId]);
    check("a batch cannot be marked 'completed'", toCompleted === "blocked");

    // --- Cancellation releases ----------------------------------------------
    console.log("\n— Cancellation —");
    const cancelled = await asUser(pg, admin, async () => {
      const r = await pg.query(`select public.cancel_payout_batch($1, 'test cancel') as ok`, [batchId]);
      return r.rows[0].ok as boolean;
    });
    check("an admin can cancel an approved batch", cancelled === true);

    const released = await asUser(pg, admin, async () => {
      const r = await pg.query(
        `select count(*)::int n from public.available_settlements_for_payout() where id = any($1::uuid[])`,
        [[payableA1, payableA2]]
      );
      return r.rows[0].n as number;
    });
    check("cancelling releases its settlements back to the candidate pool", released === 2, `got ${released}`);

    // --- Readiness ----------------------------------------------------------
    console.log("\n— Readiness —");
    const cash = await asUser(pg, admin, async () => {
      const r = await pg.query(`select * from public.payout_cash_position()`);
      return r.rows[0] as Record<string, string>;
    });
    check("credit-funded exposure is reported and non-zero", Number(cash.credit_funded_exposure) > 0, JSON.stringify(cash));
    check(
      "cash position is negative, reflecting credit-funded entitlement",
      Number(cash.cash_position_total) < 0,
      `got ${cash.cash_position_total}`
    );
    check("batched amount returns to zero after cancellation", Number(cash.batched_amount) === 0, `got ${cash.batched_amount}`);
  } finally {
    console.log("\nCleaning up…");
    await pg.query(`delete from public.payout_batch_items where payout_batch_id = any($1::uuid[])`, [batchIds]).catch(() => undefined);
    await pg.query(`delete from public.payout_batches where created_by = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from public.booking_settlements where venue_id = any($1::uuid[])`, [venueIds]).catch(() => undefined);
    await pg.query(`delete from public.bookings where court_id = any($1::uuid[])`, [courtIds]).catch(() => undefined);
    await pg.query(`delete from public.courts where id = any($1::uuid[])`, [courtIds]).catch(() => undefined);
    await pg.query(`delete from public.venues where id = any($1::uuid[])`, [venueIds]).catch(() => undefined);
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
