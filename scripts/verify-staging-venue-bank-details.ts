/**
 * Proves the write boundary on venue bank details (migration
 * 20260810000053).
 *
 * Bank account numbers are the most sensitive thing this platform stores.
 * The rules that must hold:
 *
 *   * an owner can set and change their OWN venue's bank details
 *   * an owner cannot read or write ANOTHER venue's bank details
 *   * an owner cannot change status / verified_at / paymongo_account_id
 *     by piggybacking on a bank-details update — the column grant should
 *     reject it, and the guard trigger should revert it even if the grant
 *     were ever widened
 *   * a plain player sees nothing at all
 *   * the all-or-nothing constraint rejects a half-filled destination
 *   * the account number format is enforced by the database
 *
 * WRITES: throwaway users and venues, removed in a `finally`. Cleanup
 * failures are REPORTED, not swallowed.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-venue-bank-details.ts
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

async function attempt(pg: Client, userId: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await asUser(pg, userId, fn);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function accountOf(pg: Client, venueId: string) {
  const r = await pg.query(
    `select bank_name, bank_account_name, bank_account_number, status, paymongo_account_id
     from public.venue_payment_accounts where venue_id = $1`,
    [venueId]
  );
  return r.rows[0];
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const ownerA = randomUUID();
  const ownerB = randomUUID();
  const player = randomUUID();
  const userIds = [ownerA, ownerB, player];
  let venueA = "";
  let venueB = "";

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `bankdetails-${run}-${i}@example.test`]
      );
    }
    await pg.query(`update public.profiles set role = 'venue_owner' where id = any($1::uuid[])`, [[ownerA, ownerB]]);

    for (const [owner, label] of [
      [ownerA, "A"],
      [ownerB, "B"],
    ] as const) {
      const v = await pg.query(
        `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
        [owner, `Bank Details Venue ${label} ${run}`]
      );
      if (label === "A") venueA = v.rows[0].id;
      else venueB = v.rows[0].id;
    }

    // The mirroring trigger from 20260810000043 should have made a row.
    check("a payment account row exists for a new venue", Boolean(await accountOf(pg, venueA)));

    console.log("\n— An owner maintains their own details —");
    await asUser(pg, ownerA, async () => {
      await pg.query(
        `update public.venue_payment_accounts
         set bank_name = 'BANCO DE ORO UNIBANK, INC.', bank_account_name = 'Journey Courts',
             bank_account_number = '001234567890', bank_details_updated_at = now()
         where venue_id = $1`,
        [venueA]
      );
    });
    const a1 = await accountOf(pg, venueA);
    check("owner can set their own bank details", a1.bank_account_number === "001234567890", JSON.stringify(a1.bank_account_number));

    console.log("\n— Another venue's details are out of reach —");
    const crossRead = await asUser(pg, ownerA, async () => {
      const r = await pg.query(`select bank_account_number from public.venue_payment_accounts where venue_id = $1`, [venueB]);
      return r.rowCount;
    });
    check("an owner cannot READ another venue's account row", crossRead === 0, `saw ${crossRead} row(s)`);

    await attempt(pg, ownerA, async () => {
      await pg.query(`update public.venue_payment_accounts set bank_account_number = '999999999999' where venue_id = $1`, [venueB]);
    });
    const b1 = await accountOf(pg, venueB);
    check("an owner cannot WRITE another venue's bank details", b1.bank_account_number === null, String(b1.bank_account_number));

    console.log("\n— Protected columns stay protected —");
    const statusAttempt = await attempt(pg, ownerA, async () => {
      await pg.query(`update public.venue_payment_accounts set status = 'verified', verified_at = now() where venue_id = $1`, [
        venueA,
      ]);
    });
    const a2 = await accountOf(pg, venueA);
    check(
      "an owner cannot mark their own account verified",
      a2.status !== "verified",
      statusAttempt ?? `status is '${a2.status}'`
    );

    // The nastier version: change a bank detail AND status in one statement,
    // so the write is legitimate on one column and not the other.
    const piggyback = await attempt(pg, ownerA, async () => {
      await pg.query(
        `update public.venue_payment_accounts set bank_account_name = 'Renamed', status = 'verified' where venue_id = $1`,
        [venueA]
      );
    });
    const a3 = await accountOf(pg, venueA);
    check(
      "status cannot ride along with a legitimate bank-details update",
      a3.status !== "verified",
      piggyback ?? `status is '${a3.status}'`
    );

    const idAttempt = await attempt(pg, ownerA, async () => {
      await pg.query(`update public.venue_payment_accounts set paymongo_account_id = 'acct_forged' where venue_id = $1`, [venueA]);
    });
    const a4 = await accountOf(pg, venueA);
    check(
      "an owner cannot set a paymongo account id",
      a4.paymongo_account_id !== "acct_forged",
      idAttempt ?? String(a4.paymongo_account_id)
    );

    console.log("\n— A plain player sees nothing —");
    const playerRead = await asUser(pg, player, async () => {
      const r = await pg.query(`select id from public.venue_payment_accounts`);
      return r.rowCount;
    });
    check("a player reads no payment accounts at all", playerRead === 0, `saw ${playerRead} row(s)`);

    console.log("\n— The database rejects bad destinations —");
    const halfFilled = await attempt(pg, ownerA, async () => {
      await pg.query(
        `update public.venue_payment_accounts set bank_name = 'AL-AMANAH ISLAMIC BANK', bank_account_name = null,
         bank_account_number = null where venue_id = $1`,
        [venueA]
      );
    });
    check("a half-filled destination is rejected", halfFilled !== null, halfFilled ?? "NOT REJECTED");

    const badNumber = await attempt(pg, ownerA, async () => {
      await pg.query(`update public.venue_payment_accounts set bank_account_number = '12-34 ABC' where venue_id = $1`, [venueA]);
    });
    check("a non-numeric account number is rejected", badNumber !== null, badNumber ?? "NOT REJECTED");

    console.log("\n— Admins and the activation webhook still work —");
    await pg.query("begin");
    await pg.query("set local role service_role");
    await pg.query(`select set_config('air_rally.bypass_venue_paymongo_sync', 'true', true)`);
    await pg.query(`update public.venue_payment_accounts set status = 'verified', verified_at = now() where venue_id = $1`, [
      venueA,
    ]);
    await pg.query("commit");
    const a5 = await accountOf(pg, venueA);
    check("the bypass path can still set status", a5.status === "verified", a5.status);
  } finally {
    console.log("\nCleaning up…");
    const steps: [string, string, unknown[]][] = [
      ["venue_payment_accounts", `delete from public.venue_payment_accounts where venue_id = any($1::uuid[])`, [[venueA, venueB]]],
      ["venues", `delete from public.venues where id = any($1::uuid[])`, [[venueA, venueB]]],
      ["auth.users", `delete from auth.users where id = any($1::uuid[])`, [userIds]],
    ];
    for (const [label, sql, params] of steps) {
      try {
        const r = await pg.query(sql, params);
        console.log(`  ${label.padEnd(24)} removed ${r.rowCount}`);
      } catch (error) {
        console.error(`  ${label.padEnd(24)} CLEANUP FAILED — ${(error as Error).message}`);
        failed += 1;
      }
    }
    await pg.end();
  }

  console.log(`\n${failed === 0 ? "All checks passed." : "Some checks FAILED."} (${passed} passed, ${failed} failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
