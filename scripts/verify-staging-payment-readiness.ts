/**
 * Verifies venue payment-account readiness against whatever database
 * DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * Proves the things a mock cannot: that the mirror trigger tracks PayMongo
 * state, that an unverified venue's earnings CANNOT enter a payout batch
 * however the request is made, that owners are isolated from each other,
 * and that the settlement ledger is untouched by any of it.
 *
 * WRITES: throwaway users, venues, courts, bookings, batches — all removed
 * in a `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-payment-readiness.ts
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

/** Writes venues.paymongo_* through the guarded path's own bypass GUC. */
async function setPaymongoStateOn(
  pg: Client,
  venueId: string,
  status: string,
  accountId: string | null
): Promise<void> {
  await pg.query("begin");
  await pg.query(`select set_config('air_rally.bypass_venue_paymongo_sync', 'true', true)`);
  await pg.query(
    `update public.venues
     set paymongo_activation_status = $2,
         paymongo_account_id = coalesce($3, paymongo_account_id),
         paymongo_activated_at = case when $2 = 'activated' then coalesce(paymongo_activated_at, now()) else paymongo_activated_at end
     where id = $1`,
    [venueId, status, accountId]
  );
  await pg.query("commit");
}

async function accountStatus(pg: Client, venueId: string): Promise<string | null> {
  const r = await pg.query(`select status from public.venue_payment_accounts where venue_id = $1`, [venueId]);
  return r.rows[0]?.status ?? null;
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

  const setPaymongoState = (venueId: string, status: string, accountId: string | null) =>
    setPaymongoStateOn(pg, venueId, status, accountId);

  let hourOffset = 200;
  let pastOffset = 2;
  async function payableSettlement(courtId: string): Promise<string> {
    hourOffset += 3;
    const r = await pg.query(
      `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
       values ($1, $2, now() + ($3 || ' hours')::interval, now() + (($3::int + 1) || ' hours')::interval,
               'pending', 50000, 'PHP')
       returning id`,
      [courtId, player, String(hourOffset)]
    );
    const bookingId = r.rows[0].id as string;
    const session = `cs_${run}_${bookingId.slice(0, 8)}`;
    await pg.query(`update public.bookings set paymongo_checkout_session_id = $2, payment_provider = 'paymongo' where id = $1`, [
      bookingId,
      session,
    ]);
    await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, 'pi_x', 50000, 'PHP')`, [bookingId, session]);

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
    await pg.query(`select public.mark_settlements_payable()`);

    const s = await pg.query(`select id from public.booking_settlements where booking_id = $1`, [bookingId]);
    return s.rows[0].id as string;
  }

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `payacct-${run}-${i}@example.test`]
      );
    }
    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    for (const [i, owner] of [ownerA, ownerB].entries()) {
      const v = await pg.query(
        `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
        [owner, `PayAcct ${run} #${i + 1}`]
      );
      venueIds.push(v.rows[0].id);
      const c = await pg.query(
        `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
        [v.rows[0].id]
      );
      courtIds.push(c.rows[0].id);
    }
    console.log(`Seeded 2 owners, 1 admin, 2 venues (run ${run}).\n`);

    // --- The mirror ---------------------------------------------------------
    console.log("— Mirroring PayMongo state —");
    check("a new venue gets a payment account automatically", (await accountStatus(pg, venueIds[0])) === "not_connected");

    // paymongo_* columns are guarded by prevent_venue_paymongo_tampering,
    // so a plain UPDATE is silently reverted. The trusted write path sets
    // this GUC — mirror that here rather than pretending the guard isn't there.
    await setPaymongoState(venueIds[0], "under_review", "acct_x");
    check("under_review maps to pending_verification", (await accountStatus(pg, venueIds[0])) === "pending_verification", `${await accountStatus(pg, venueIds[0])}`);

    await setPaymongoState(venueIds[0], "activated", "acct_x");
    check("activated maps to verified", (await accountStatus(pg, venueIds[0])) === "verified", `${await accountStatus(pg, venueIds[0])}`);

    const mirrored = await pg.query(`select paymongo_account_id, verified_at from public.venue_payment_accounts where venue_id = $1`, [
      venueIds[0],
    ]);
    check("the account id is mirrored, not retyped", mirrored.rows[0].paymongo_account_id === "acct_x");
    check("verification is timestamped", mirrored.rows[0].verified_at !== null);

    // --- Admin override sticks ----------------------------------------------
    console.log("\n— Admin override —");
    await asUser(pg, admin, async () => {
      await pg.query(`select public.set_venue_payment_account_status($1, 'restricted', 'under investigation')`, [venueIds[0]]);
    });
    check("an admin can restrict a verified account", (await accountStatus(pg, venueIds[0])) === "restricted");

    // The whole reason the mirror and the decision are separate.
    await setPaymongoState(venueIds[0], "activated", "acct_x2");
    check(
      "a later PayMongo update does NOT silently un-restrict the venue",
      (await accountStatus(pg, venueIds[0])) === "restricted",
      `${await accountStatus(pg, venueIds[0])}`
    );

    await asUser(pg, admin, async () => {
      await pg.query(`select public.set_venue_payment_account_status($1, 'verified', null)`, [venueIds[0]]);
    });
    check("an admin can restore it to verified", (await accountStatus(pg, venueIds[0])) === "verified");

    const badStatus = await attempt(pg, admin, `select public.set_venue_payment_account_status($1, 'pending_verification', null)`, [
      venueIds[0],
    ]);
    check("an admin cannot assert a PayMongo-owned status", badStatus === "blocked");

    // --- Owner cannot self-verify -------------------------------------------
    console.log("\n— Owner restrictions —");
    check(
      "a venue owner cannot call the status RPC",
      (await attempt(pg, ownerA, `select public.set_venue_payment_account_status($1, 'verified', null)`, [venueIds[1]])) === "blocked"
    );

    const ownerUpdate = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`update public.venue_payment_accounts set status = 'verified' where venue_id = $1`, [venueIds[0]]);
      return r.rowCount ?? 0;
    });
    check("a venue owner cannot update their own account row", ownerUpdate === 0, `updated ${ownerUpdate}`);

    const ownerAccountId = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`update public.venue_payment_accounts set paymongo_account_id = 'acct_fake' where venue_id = $1`, [
        venueIds[0],
      ]);
      return r.rowCount ?? 0;
    });
    check("a venue owner cannot change the PayMongo account id", ownerAccountId === 0, `updated ${ownerAccountId}`);

    // --- Owner isolation -----------------------------------------------------
    console.log("\n— Owner isolation —");
    const aSees = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`select count(*)::int n from public.venue_payment_accounts`);
      return r.rows[0].n as number;
    });
    check("Owner A sees exactly their own account", aSees === 1, `saw ${aSees}`);

    const aSeesB = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`select count(*)::int n from public.venue_payment_accounts where venue_id = $1`, [venueIds[1]]);
      return r.rows[0].n as number;
    });
    check("Owner A cannot see Owner B's payment account", aSeesB === 0, `saw ${aSeesB}`);

    const playerSees = await asUser(pg, player, async () => {
      const r = await pg.query(`select count(*)::int n from public.venue_payment_accounts`);
      return r.rows[0].n as number;
    });
    check("a customer sees no payment accounts", playerSees === 0, `saw ${playerSees}`);

    const adminSees = await asUser(pg, admin, async () => {
      const r = await pg.query(`select count(*)::int n from public.venue_payment_accounts where venue_id = any($1::uuid[])`, [venueIds]);
      return r.rows[0].n as number;
    });
    check("an admin sees all payment accounts", adminSees === 2, `saw ${adminSees}`);

    // --- Settlement eligibility ---------------------------------------------
    console.log("\n— Settlement eligibility —");
    // Venue A is verified; venue B is not connected.
    const settlementA = await payableSettlement(courtIds[0]);
    const settlementB = await payableSettlement(courtIds[1]);
    check("venue B is not connected", (await accountStatus(pg, venueIds[1])) === "not_connected");

    const candidates = await asUser(pg, admin, async () => {
      const r = await pg.query(`select id from public.available_settlements_for_payout()`);
      return r.rows.map((row) => row.id as string);
    });
    check("the verified venue's settlement IS a payout candidate", candidates.includes(settlementA));
    check("the unconnected venue's settlement is NOT a candidate", !candidates.includes(settlementB));

    // The rule must hold even when the id is passed in directly, bypassing
    // the candidate list entirely.
    const blockedDirect = await attempt(pg, admin, `select public.create_payout_batch(array[$1]::uuid[], null)`, [settlementB]);
    check("an unconnected venue's settlement cannot be forced into a batch", blockedDirect === "blocked");

    const batchId = await asUser(pg, admin, async () => {
      const r = await pg.query(`select public.create_payout_batch(array[$1]::uuid[], null) as id`, [settlementA]);
      return r.rows[0].id as string;
    });
    batchIds.push(batchId);
    check("a verified venue's settlement CAN be batched", !!batchId);

    // Restricting mid-flight must stop new batching.
    await asUser(pg, admin, async () => {
      await pg.query(`select public.set_venue_payment_account_status($1, 'restricted', 'test')`, [venueIds[0]]);
    });
    const settlementA2 = await payableSettlement(courtIds[0]);
    const blockedAfterRestrict = await attempt(pg, admin, `select public.create_payout_batch(array[$1]::uuid[], null)`, [settlementA2]);
    check("restricting a venue immediately blocks new batching", blockedAfterRestrict === "blocked");

    // --- Readiness reporting -------------------------------------------------
    console.log("\n— Readiness reporting —");
    const readiness = await asUser(pg, admin, async () => {
      const r = await pg.query(`select * from public.venue_payout_readiness()`);
      return r.rows[0] as Record<string, string>;
    });
    check("blocked settlement money is reported", Number(readiness.blocked_settlement_amount) > 0, JSON.stringify(readiness));
    check("venues missing setup are counted", Number(readiness.venues_missing_setup) > 0, JSON.stringify(readiness));
    check(
      "a venue owner cannot read platform readiness",
      (await attempt(pg, ownerA, `select * from public.venue_payout_readiness()`)) === "blocked"
    );

    // --- Ledger unchanged / no money moved -----------------------------------
    console.log("\n— No money moved —");
    const settled = await pg.query(`select count(*)::int n from public.booking_settlements where settlement_status = 'settled'`);
    check("no settlement anywhere is 'settled'", settled.rows[0].n === 0, `${settled.rows[0].n} found`);

    const states = await pg.query(
      `select settlement_status from public.booking_settlements where id = any($1::uuid[])`,
      [[settlementA, settlementB, settlementA2]]
    );
    check(
      "every settlement in this run is still payable",
      states.rows.every((r) => r.settlement_status === "payable"),
      JSON.stringify(states.rows)
    );

    const toCompleted = await attempt(pg, admin, `update public.payout_batches set status = 'completed' where id = $1`, [batchId]);
    check("a batch still cannot be marked completed", toCompleted === "blocked");
  } finally {
    console.log("\nCleaning up…");
    await pg.query(`delete from public.payout_batch_items where payout_batch_id = any($1::uuid[])`, [batchIds]).catch(() => undefined);
    await pg.query(`delete from public.payout_batches where created_by = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from public.booking_settlements where venue_id = any($1::uuid[])`, [venueIds]).catch(() => undefined);
    await pg.query(`delete from public.bookings where court_id = any($1::uuid[])`, [courtIds]).catch(() => undefined);
    await pg.query(`delete from public.courts where id = any($1::uuid[])`, [courtIds]).catch(() => undefined);
    await pg.query(`delete from public.venue_payment_accounts where venue_id = any($1::uuid[])`, [venueIds]).catch(() => undefined);
    await pg.query(`delete from public.venues where id = any($1::uuid[])`, [venueIds]).catch(() => undefined);
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
