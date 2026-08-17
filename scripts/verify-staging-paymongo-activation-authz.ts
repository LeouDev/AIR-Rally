/**
 * Proves — or disproves — that a venue owner can mark their OWN venue's
 * PayMongo account 'activated' without PayMongo ever approving it.
 *
 * THE SUSPECTED HOLE
 *
 * sync_venue_paymongo_activation(p_paymongo_account_id, p_activation_status,
 * p_declined_reason) is SECURITY DEFINER with EXECUTE granted to anon and
 * authenticated. Its body validates only that the status string is one of
 * three allowed values, then:
 *
 *   perform set_config('air_rally.bypass_venue_paymongo_sync', 'true', true);
 *   update public.venues set paymongo_activation_status = p_activation_status ...
 *    where paymongo_account_id = p_paymongo_account_id;
 *
 * It deliberately raises the bypass GUC that exists precisely to stop owners
 * writing these columns directly — so calling it defeats that guard rather
 * than tripping it. There is no auth.uid() check and no ownership check; the
 * only thing identifying the venue is paymongo_account_id, which the owner
 * supplies themselves during onboarding and can therefore read.
 *
 * Phase 10's stated rule was that venue owners "cannot modify PayMongo
 * account IDs, mark themselves verified, or change payout status". If this
 * RPC is callable from a browser session, that rule is enforced only by the
 * UI not offering a button.
 *
 * The legitimate caller is the PayMongo webhook, whose authority is the
 * verified webhook signature — something that cannot be expressed in SQL.
 * So the boundary has to be which code is calling: service_role only, the
 * same pattern as confirm_paymongo_booking_payment (migration 047) and the
 * credit RPCs.
 *
 * WRITES: a throwaway user and venue, removed in a `finally`. Cleanup
 * failures are REPORTED, not swallowed.
 *
 * Gated by assert-staging-env.ts: it refuses to run against production.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-paymongo-activation-authz.ts
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

async function activationOf(pg: Client, venueId: string): Promise<string | null> {
  const r = await pg.query(`select paymongo_activation_status from public.venues where id = $1`, [venueId]);
  return r.rows[0]?.paymongo_activation_status ?? null;
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const owner = randomUUID();
  const accountId = `acct_${run}`;
  let venueId = "";

  try {
    await pg.query(
      `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
      [owner, `pmactivation-${run}@example.test`]
    );
    await pg.query(`update public.profiles set role = 'venue_owner' where id = $1`, [owner]);

    const venue = await pg.query(
      `insert into public.venues (owner_id, name, status, timezone, paymongo_account_id, paymongo_activation_status)
       values ($1, $2, 'active', 'Asia/Manila', $3, 'under_review') returning id`,
      [owner, `PayMongo Activation Test ${run}`, accountId]
    );
    venueId = venue.rows[0].id;
    console.log(`Seeded 1 owner + 1 venue with paymongo_account_id=${accountId}, status=under_review (run ${run}).\n`);

    // --- 1. The owner can read their own account id ------------------------
    console.log("— Self-activation without PayMongo —");
    const visible = await asUser(pg, owner, async () => {
      const r = await pg.query(`select paymongo_account_id from public.venues where id = $1`, [venueId]);
      return r.rows[0]?.paymongo_account_id as string | undefined;
    });
    check(
      "an owner can read their own venue's paymongo_account_id",
      visible === accountId,
      visible ? "yes — the only value the RPC keys on is self-readable" : "not readable"
    );

    // --- 2. Direct column write must still be blocked ----------------------
    // This is the guard the RPC's bypass GUC turns off, so it must be
    // working for the RPC test below to mean anything.
    await asUser(pg, owner, async () => {
      await pg.query(`update public.venues set paymongo_activation_status = 'activated' where id = $1`, [venueId]);
    }).catch(() => undefined);
    check(
      "an owner cannot write paymongo_activation_status directly",
      (await activationOf(pg, venueId)) !== "activated",
      `column is now '${await activationOf(pg, venueId)}'`
    );

    // --- 3. The attack: same write, via the RPC ---------------------------
    let rpcError: string | null = null;
    try {
      await asUser(pg, owner, async () => {
        await pg.query(`select public.sync_venue_paymongo_activation($1, $2, $3)`, [accountId, "activated", null]);
      });
    } catch (error) {
      rpcError = (error as Error).message;
    }
    const after = await activationOf(pg, venueId);
    check(
      "an owner CANNOT self-activate via sync_venue_paymongo_activation()",
      after !== "activated",
      rpcError ? `rejected: ${rpcError}` : `NOT REJECTED — venue is now '${after}' with no PayMongo approval`
    );

    // --- 4. The legitimate webhook path must still work -------------------
    let serviceError: string | null = null;
    try {
      await pg.query("begin");
      await pg.query("set local role service_role");
      await pg.query(`select public.sync_venue_paymongo_activation($1, $2, $3)`, [accountId, "activated", null]);
      await pg.query("commit");
    } catch (error) {
      await pg.query("rollback").catch(() => undefined);
      serviceError = (error as Error).message;
    }
    check(
      "service_role CAN still apply a real webhook activation",
      (await activationOf(pg, venueId)) === "activated",
      serviceError ?? `status is '${await activationOf(pg, venueId)}'`
    );
  } finally {
    console.log("\nCleaning up…");
    const steps: [string, string, unknown[]][] = [
      ["venues", `delete from public.venues where id = $1`, [venueId]],
      ["auth.users", `delete from auth.users where id = $1`, [owner]],
    ];
    for (const [label, sql, params] of steps) {
      if (!params[0]) continue;
      try {
        const r = await pg.query(sql, params);
        console.log(`  ${label.padEnd(14)} removed ${r.rowCount}`);
      } catch (error) {
        console.error(`  ${label.padEnd(14)} CLEANUP FAILED — ${(error as Error).message}`);
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
