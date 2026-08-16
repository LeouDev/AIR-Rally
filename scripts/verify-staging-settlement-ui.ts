/**
 * Verifies the settlement dashboards' security boundary against whatever
 * database DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * The Jest suite covers aggregation with mocks; it cannot exercise RLS.
 * This script runs the exact queries the owner and admin pages issue, as
 * real authenticated roles, so "Owner A cannot see Owner B" is proven
 * rather than assumed.
 *
 * WRITES: throwaway users, two venues, courts, bookings — all removed in a
 * `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-settlement-ui.ts
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

  let hourOffset = 96;
  async function confirmedBooking(courtId: string, priceAmount: number, creditAmount: number): Promise<string> {
    hourOffset += 3;
    const r = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, now() + ($3 || ' hours')::interval, now() + (($3::int + 1) || ' hours')::interval,
               'pending', $4, 'PHP')
       returning id`,
      [courtId, player, String(hourOffset), priceAmount]
    );
    const bookingId = r.rows[0].id as string;

    if (creditAmount > 0) {
      await pg.query(`select public.apply_credit_to_booking($1, $2, $3)`, [bookingId, player, creditAmount]);
    }
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
    return bookingId;
  }

  /** The exact shape the owner dashboard's listOwnerSettlements() issues. */
  async function ownerSettlementCount(userId: string): Promise<number> {
    return asUser(pg, userId, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements`);
      return r.rows[0].n as number;
    });
  }

  /** The owner summary's own aggregation, as RLS sees it. */
  async function ownerEntitlement(userId: string): Promise<number> {
    return asUser(pg, userId, async () => {
      const r = await pg.query(
        `select coalesce(sum(venue_amount), 0)::int total from public.booking_settlements
         where settlement_status in ('pending', 'payable')`
      );
      return r.rows[0].total as number;
    });
  }

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `settleui-${run}-${i}@example.test`]
      );
    }
    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    for (const [i, owner] of [ownerA, ownerB].entries()) {
      const v = await pg.query(
        `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
        [owner, `Settlement UI ${run} #${i + 1}`]
      );
      venueIds.push(v.rows[0].id);
      const c = await pg.query(
        `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
        [v.rows[0].id]
      );
      courtIds.push(c.rows[0].id);
    }
    await pg.query(`select public.issue_credit($1, 200000, 'admin_adjustment', null, 'test wallet')`, [player]);
    console.log(`Seeded 2 owners, 1 admin, 1 player, 2 venues (run ${run}).\n`);

    // Owner A: one PayMongo-only (₱500) and one credit-only (₱400).
    // Owner B: one mixed (₱500 = ₱200 cash + ₱300 credit).
    console.log("— Seeding settlements —");
    await confirmedBooking(courtIds[0], 50000, 0);
    await confirmedBooking(courtIds[0], 40000, 40000);
    await confirmedBooking(courtIds[1], 50000, 30000);

    const seeded = await pg.query(
      `select count(*)::int n from public.booking_settlements where venue_id = any($1::uuid[])`,
      [venueIds]
    );
    check("three settlements were created by the triggers", seeded.rows[0].n === 3, `got ${seeded.rows[0].n}`);

    // --- Owner isolation ------------------------------------------------
    console.log("\n— Owner isolation —");
    const aCount = await ownerSettlementCount(ownerA);
    const bCount = await ownerSettlementCount(ownerB);
    check("Owner A sees exactly their own two settlements", aCount === 2, `saw ${aCount}`);
    check("Owner B sees exactly their own one settlement", bCount === 1, `saw ${bCount}`);

    const aSeesB = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements where venue_id = $1`, [venueIds[1]]);
      return r.rows[0].n as number;
    });
    check("Owner A cannot see Owner B's settlements", aSeesB === 0, `saw ${aSeesB}`);

    const bSeesA = await asUser(pg, ownerB, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements where venue_id = $1`, [venueIds[0]]);
      return r.rows[0].n as number;
    });
    check("Owner B cannot see Owner A's settlements", bSeesA === 0, `saw ${bSeesA}`);

    // --- Owner totals -----------------------------------------------------
    console.log("\n— Owner totals —");
    // Owner A: ₱500 → ₱475, plus ₱400 → ₱380. Total ₱855.
    const aTotal = await ownerEntitlement(ownerA);
    check("Owner A's entitlement totals ₱855", aTotal === 85500, `got ${aTotal}`);
    // Owner B: ₱500 → ₱475 regardless of the credit split.
    const bTotal = await ownerEntitlement(ownerB);
    check("Owner B's entitlement totals ₱475", bTotal === 47500, `got ${bTotal}`);

    const aExposure = await asUser(pg, ownerA, async () => {
      const r = await pg.query(
        `select coalesce(sum(-cash_position), 0)::int e from public.booking_settlements where cash_position < 0`
      );
      return r.rows[0].e as number;
    });
    check("Owner A's credit-only booking shows a ₱380 shortfall", aExposure === 38000, `got ${aExposure}`);

    // --- Customer ---------------------------------------------------------
    const playerSees = await ownerSettlementCount(player);
    check("the customer who paid sees no settlement rows at all", playerSees === 0, `saw ${playerSees}`);

    // --- Admin ------------------------------------------------------------
    console.log("\n— Admin —");
    const adminSees = await asUser(pg, admin, async () => {
      const r = await pg.query(`select count(*)::int n from public.booking_settlements where venue_id = any($1::uuid[])`, [venueIds]);
      return r.rows[0].n as number;
    });
    check("an admin sees settlements across every venue", adminSees === 3, `saw ${adminSees}`);

    const adminExposure = await asUser(pg, admin, async () => {
      const r = await pg.query(
        `select coalesce(sum(-cash_position), 0)::int e from public.booking_settlements
         where venue_id = any($1::uuid[]) and settlement_status in ('pending','payable') and cash_position < 0`,
        [venueIds]
      );
      return r.rows[0].e as number;
    });
    // ₱380 (credit-only) + ₱275 (mixed) = ₱655.
    check("platform credit-funded exposure totals ₱655", adminExposure === 65500, `got ${adminExposure}`);

    const adminWrote = await asUser(pg, admin, async () => {
      const r = await pg.query(`update public.booking_settlements set venue_amount = 1 where venue_id = any($1::uuid[])`, [venueIds]);
      return r.rowCount ?? 0;
    });
    // Deliberate: admins read the ledger, they do not author it.
    check("even an admin cannot rewrite a settlement", adminWrote === 0, `updated ${adminWrote} row(s)`);

    // --- Reconciliation ----------------------------------------------------
    console.log("\n— Reconciliation —");
    const issues = await asUser(pg, admin, async () => {
      const r = await pg.query(
        `select issue, count(*)::int n from public.reconcile_settlements()
         where booking_id in (select id from public.bookings where court_id = any($1::uuid[])) group by issue`,
        [courtIds]
      );
      return Object.fromEntries(r.rows.map((row) => [row.issue, row.n])) as Record<string, number>;
    });
    check("no missing settlements", !issues.missing_settlement, `${issues.missing_settlement} found`);
    check("no funding mismatches", !issues.funding_mismatch, `${issues.funding_mismatch} found`);
    check("no live settlements on cancelled bookings", !issues.live_settlement_on_cancelled_booking);
    check("credit exposure is reported for both funded bookings", issues.unfunded_entitlement === 2, `got ${issues.unfunded_entitlement ?? 0}`);

    const nonAdminBlocked = await asUser(pg, ownerA, async () => {
      try {
        await pg.query(`select * from public.reconcile_settlements()`);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    // reconcile_settlements() is SECURITY DEFINER, so it bypasses RLS by
    // design — it must, or "a confirmed booking with no settlement" could
    // never be detected. That makes its own is_admin() guard the boundary;
    // the page's requireAdmin() only stops someone loading the page.
    check("a non-admin cannot call reconcile_settlements()", nonAdminBlocked === "blocked");

    const sweepBlocked = await asUser(pg, ownerA, async () => {
      try {
        await pg.query(`select public.mark_settlements_payable()`);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a non-admin cannot run the payable sweep", sweepBlocked === "blocked");

  } finally {
    console.log("\nCleaning up…");
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
