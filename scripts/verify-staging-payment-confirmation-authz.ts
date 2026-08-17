/**
 * Proves — or disproves — that an ordinary authenticated user can confirm
 * their OWN booking as paid without ever paying.
 *
 * THE SUSPECTED HOLE
 *
 * confirm_paymongo_booking_payment() is SECURITY DEFINER and EXECUTE is
 * granted to `authenticated` and `anon`. It bypasses RLS by design, and its
 * body contains no authorization check at all — it validates only that the
 * arguments it was handed match the booking row:
 *
 *   where id = p_booking_id
 *     and status = 'pending'
 *     and payment_provider = 'paymongo'
 *     and paymongo_checkout_session_id = p_paymongo_checkout_session_id
 *     and price_amount - credit_amount_applied = p_expected_amount
 *     and currency = p_expected_currency
 *
 * Every one of those values is readable by the booking's own owner: the
 * session id is written onto the pending booking at checkout-creation time
 * (attachPaymongoCheckoutSession), and price/credit/currency are columns the
 * owner selects to render their own booking. Nothing in the function asks
 * PayMongo whether money actually arrived.
 *
 * The app's own caller is safe — reconcilePaymongoPendingBooking() retrieves
 * the session from PayMongo and requires a payment with status 'paid' before
 * calling the RPC. But that check lives in TypeScript, and the RPC is
 * reachable from a browser session directly. This is the same shape as the
 * reconcile_settlements leak: a SECURITY DEFINER function whose only
 * protection was the app code that normally calls it.
 *
 * This script therefore drives the RPC exactly as a signed-in attacker would:
 * as `authenticated`, with auth.uid() bound to the booking's owner, passing
 * only values that owner can legitimately read off their own row.
 *
 * WRITES: a throwaway user, venue, court and bookings, removed in a
 * `finally`. Cleanup failures are REPORTED, not swallowed — the sibling
 * scripts' `.catch(() => undefined)` is what left orphaned rows in staging.
 *
 * Gated by assert-staging-env.ts: it refuses to run against production.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-payment-confirmation-authz.ts
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

/** Runs a callback with auth.uid() bound to the given user, as PostgREST would. */
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

async function statusOf(pg: Client, bookingId: string): Promise<string> {
  const r = await pg.query(`select status from public.bookings where id = $1`, [bookingId]);
  return r.rows[0]?.status ?? "(gone)";
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const player = randomUUID();
  const owner = randomUUID();
  const userIds = [player, owner];
  let venueId = "";
  let courtId = "";

  /** Books a fresh, non-overlapping hour so bookings_no_overlap never interferes. */
  let hourOffset = 72;
  async function createPendingBooking(priceAmount: number, sessionId: string): Promise<string> {
    hourOffset += 3;
    const r = await pg.query(
      `insert into public.bookings
         (court_id, user_id, start_time, end_time, status, price_amount, currency,
          payment_provider, paymongo_checkout_session_id)
       values ($1, $2, now() + ($3 || ' hours')::interval, now() + (($3::int + 1) || ' hours')::interval,
               'pending', $4, 'PHP', 'paymongo', $5)
       returning id`,
      [courtId, player, String(hourOffset), priceAmount, sessionId]
    );
    return r.rows[0].id as string;
  }

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `payauthz-${run}-${i}@example.test`]
      );
    }

    const venue = await pg.query(
      `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
      [owner, `Payment Authz Test ${run}`]
    );
    venueId = venue.rows[0].id;

    const court = await pg.query(
      `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
      [venueId]
    );
    courtId = court.rows[0].id;
    console.log(`Seeded 2 users, 1 venue, 1 court (run ${run}).\n`);

    // --- 1. The attack, using only self-readable values -------------------
    console.log("— Self-confirmation without payment —");
    const sessionId = `cs_test_${run}`;
    const target = await createPendingBooking(50000, sessionId);

    // An attacker reads their own pending booking first. If RLS lets them
    // see these columns, they have every argument the RPC checks.
    const selfRead = await asUser(pg, player, async () => {
      const r = await pg.query(
        `select price_amount, credit_amount_applied, currency, paymongo_checkout_session_id
         from public.bookings where id = $1`,
        [target]
      );
      return r.rows[0];
    });
    check(
      "an owner can read every value the RPC validates off their own booking",
      Boolean(selfRead?.paymongo_checkout_session_id) && selfRead?.price_amount != null,
      selfRead ? "yes — session id, price, credit and currency are all visible" : "no row returned"
    );

    let rpcError: string | null = null;
    let rpcResult: boolean | null = null;
    try {
      rpcResult = await asUser(pg, player, async () => {
        const r = await pg.query(
          `select public.confirm_paymongo_booking_payment($1, $2, $3, $4, $5) as ok`,
          [
            target,
            selfRead.paymongo_checkout_session_id,
            `pi_forged_${run}`, // any string — nothing verifies this against PayMongo
            selfRead.price_amount - selfRead.credit_amount_applied,
            selfRead.currency,
          ]
        );
        return r.rows[0].ok as boolean;
      });
    } catch (error) {
      rpcError = (error as Error).message;
    }

    const statusAfter = await statusOf(pg, target);
    check(
      "an authenticated user CANNOT confirm their own unpaid booking via the RPC",
      statusAfter !== "confirmed",
      rpcError
        ? `rejected: ${rpcError}`
        : `NOT REJECTED — RPC returned ${rpcResult}, booking is now '${statusAfter}' with no payment`
    );

    // --- 2. Same attack against someone else's booking --------------------
    // Bypassing RLS means the function does not care whose booking it is.
    console.log("\n— Confirming a booking that isn't yours —");
    const victimSession = `cs_test_victim_${run}`;
    const victim = await createPendingBooking(75000, victimSession);
    let otherError: string | null = null;
    try {
      await asUser(pg, owner, async () => {
        await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, $3, $4, $5)`, [
          victim,
          victimSession,
          `pi_forged_other_${run}`,
          75000,
          "PHP",
        ]);
      });
    } catch (error) {
      otherError = (error as Error).message;
    }
    const victimStatus = await statusOf(pg, victim);
    check(
      "a different user cannot confirm someone else's booking",
      victimStatus !== "confirmed",
      otherError ? `rejected: ${otherError}` : `NOT REJECTED — booking is now '${victimStatus}'`
    );

    // --- 3. The legitimate path must still work ---------------------------
    // Whatever fix lands, the webhook and the confirmation page call this
    // same RPC through the service-role key. If that breaks, every real
    // payment stops confirming — a worse outcome than the hole itself.
    console.log("\n— The service-role path still confirms —");
    const legitSession = `cs_test_legit_${run}`;
    const legit = await createPendingBooking(60000, legitSession);
    let serviceError: string | null = null;
    let serviceOk = false;
    try {
      await pg.query("begin");
      await pg.query("set local role service_role");
      const r = await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, $3, $4, $5) as ok`, [
        legit,
        legitSession,
        `pi_legit_${run}`,
        60000,
        "PHP",
      ]);
      serviceOk = r.rows[0].ok;
      await pg.query("commit");
    } catch (error) {
      await pg.query("rollback").catch(() => undefined);
      serviceError = (error as Error).message;
    }
    check(
      "service_role CAN still confirm a paid booking",
      serviceOk && (await statusOf(pg, legit)) === "confirmed",
      serviceError ?? `rpc returned ${serviceOk}, status is '${await statusOf(pg, legit)}'`
    );

    // --- 4. The Stripe twin has the same shape ----------------------------
    console.log("\n— The Stripe-era twin —");
    const stripeGrant = await pg.query(
      `select has_function_privilege('authenticated', p.oid, 'EXECUTE') auth_exec
       from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'confirm_booking_payment'`
    );
    check(
      "confirm_booking_payment() is not executable by a browser session either",
      stripeGrant.rows.length === 0 || stripeGrant.rows[0].auth_exec === false,
      stripeGrant.rows[0]?.auth_exec ? "still granted to authenticated" : "not granted"
    );
  } finally {
    console.log("\nCleaning up…");
    const cleanup: [string, string, unknown[]][] = [
      ["bookings", `delete from public.bookings where court_id = $1`, [courtId]],
      ["courts", `delete from public.courts where id = $1`, [courtId]],
      ["venues", `delete from public.venues where id = $1`, [venueId]],
      ["booking_settlements", `delete from public.booking_settlements where venue_id = $1`, [venueId]],
      ["notifications", `delete from public.notifications where user_id = any($1::uuid[])`, [userIds]],
      ["auth.users", `delete from auth.users where id = any($1::uuid[])`, [userIds]],
    ];
    // Settlements are created by a trigger on confirmation, so they must go
    // before the venue they reference. Ordered deliberately; reported loudly.
    const ordered = [cleanup[0], cleanup[3], cleanup[1], cleanup[2], cleanup[4], cleanup[5]];
    for (const [label, sql, params] of ordered) {
      if (!params[0]) continue;
      try {
        const r = await pg.query(sql, params);
        console.log(`  ${label.padEnd(22)} removed ${r.rowCount}`);
      } catch (error) {
        // Never swallowed: a silent failure here is how orphaned rows got
        // left behind in staging by the earlier verification scripts.
        console.error(`  ${label.padEnd(22)} CLEANUP FAILED — ${(error as Error).message}`);
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
