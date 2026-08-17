/**
 * Proves how bookings.platform_fee_amount / venue_amount /
 * paymongo_venue_account_id actually behave under
 * prevent_booking_tampering(), against whatever database DATABASE_URL
 * points at — gated by assert-staging-env.ts.
 *
 * WHY THIS EXISTS
 *
 * 20260810000009 added those three columns and guarded all three.
 * 20260810000011 deliberately REMOVED the three guard clauses (its header
 * argues they're an owner-written audit snapshot). 20260810000038 then
 * re-declared the whole function claiming to reproduce "every clause from
 * 20260810000009 verbatim" — and did exactly that, copying the three
 * clauses 011 had removed back in. Nothing in 038 mentions them, so the
 * revert was silent.
 *
 * The consequence is the same class of bug 20260810000055 was written to
 * fix for processing_fee_amount: the guard reverts the value rather than
 * raising, so attachPaymongoCheckoutSession()'s UPDATE succeeds, returns
 * no error, and leaves the columns NULL. The trigger's only escape hatches
 * are is_admin() and the bypass GUC, and is_admin() resolves auth.uid(),
 * which is null for a service-role PostgREST call — so service_role is
 * guarded here exactly like a browser session.
 *
 * The "SILENT REVERT" section below is the empirical claim: the same
 * write, once as the booking's owner and once as service_role, read back
 * both times. The "WRITE PATH" section covers
 * set_booking_marketplace_split() and is skipped when that function does
 * not exist yet, so this script is runnable both before and after
 * 20260810000056.
 *
 * WRITES: creates throwaway users, a venue, a court and bookings to
 * exercise the real triggers, RLS and privileged functions, then removes
 * everything in a `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-marketplace-split-snapshot.ts
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

/**
 * Runs a callback the way a service-role PostgREST request arrives: the
 * service_role database role, and NO request.jwt.claims — which is
 * precisely why is_admin() (which reads auth.uid()) is false inside it.
 */
async function asServiceRole<T>(pg: Client, fn: () => Promise<T>): Promise<T> {
  await pg.query("begin");
  await pg.query("set local role service_role");
  await pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ role: "service_role" })]);
  try {
    const result = await fn();
    await pg.query("commit");
    return result;
  } catch (error) {
    await pg.query("rollback").catch(() => undefined);
    throw error;
  }
}

type SplitRow = { platform_fee_amount: number | null; venue_amount: number | null; paymongo_venue_account_id: string | null };

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const player = randomUUID();
  const owner = randomUUID();
  const admin = randomUUID();
  const userIds = [player, owner, admin];
  let venueId = "";
  let courtId = "";

  async function splitOf(bookingId: string): Promise<SplitRow> {
    const r = await pg.query(
      `select platform_fee_amount, venue_amount, paymongo_venue_account_id from public.bookings where id = $1`,
      [bookingId]
    );
    return r.rows[0];
  }

  /** Books a fresh, non-overlapping hour so bookings_no_overlap never interferes. */
  let hourOffset = 48;
  async function createPendingBooking(priceAmount: number): Promise<string> {
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

  /** The exact write attachPaymongoCheckoutSession() issues. */
  const ATTACH_UPDATE = `update public.bookings
       set payment_provider = 'paymongo',
           paymongo_checkout_session_id = $2,
           platform_fee_amount = $3,
           venue_amount = $4,
           paymongo_venue_account_id = $5
     where id = $1`;

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `splitsnap-${run}-${i}@example.test`]
      );
    }
    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    const venue = await pg.query(
      `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
      [owner, `Split Snapshot Test ${run}`]
    );
    venueId = venue.rows[0].id;

    const court = await pg.query(
      `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
      [venueId]
    );
    courtId = court.rows[0].id;
    console.log(`Seeded 3 users, 1 venue, 1 court (run ${run}).\n`);

    // --- Which clauses are actually live -----------------------------------
    console.log("— Live trigger definition —");
    const def = await pg.query(
      `select pg_get_functiondef(p.oid) as def from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'prevent_booking_tampering'`
    );
    const body: string = def.rows[0]?.def ?? "";
    const guarded = ["platform_fee_amount", "venue_amount", "paymongo_venue_account_id"].filter((c) =>
      body.includes(`new.${c} is distinct from old.${c}`)
    );
    console.log(`  guarded split columns: ${guarded.length ? guarded.join(", ") : "(none)"}`);
    check(
      "all three split columns are guarded by the live trigger (the 038 revert of 011)",
      guarded.length === 3,
      `only ${guarded.join(", ") || "none"} guarded`
    );

    // --- THE SILENT REVERT --------------------------------------------------
    // attachPaymongoCheckoutSession() writes these three columns with the
    // CALLER'S client. Both of its callers pass a user-scoped client
    // (checkout.ts and reschedules.ts), but the interesting claim is that
    // even service_role would not help.
    console.log("\n— Silent revert: the write attachPaymongoCheckoutSession() issues —");

    const ownerWrite = await createPendingBooking(50000);
    let ownerUpdateError: string | null = null;
    await asUser(pg, player, async () => {
      try {
        await pg.query(ATTACH_UPDATE, [ownerWrite, "cs_owner", 2500, 47500, "acct_owner"]);
      } catch (e) {
        ownerUpdateError = (e as Error).message;
      }
    });
    const ownerRow = await splitOf(ownerWrite);
    check("as the booking's OWNER: the UPDATE raises no error", ownerUpdateError === null, ownerUpdateError ?? undefined);
    check(
      "as the booking's OWNER: all three columns are silently reverted to NULL",
      ownerRow.platform_fee_amount === null && ownerRow.venue_amount === null && ownerRow.paymongo_venue_account_id === null,
      JSON.stringify(ownerRow)
    );
    const ownerSession = await pg.query(`select paymongo_checkout_session_id from public.bookings where id = $1`, [ownerWrite]);
    check(
      "as the booking's OWNER: the unguarded part of the same UPDATE DID persist (so nothing looks wrong to the caller)",
      ownerSession.rows[0].paymongo_checkout_session_id === "cs_owner",
      `got ${ownerSession.rows[0].paymongo_checkout_session_id}`
    );

    const serviceWrite = await createPendingBooking(50000);
    let serviceUpdateError: string | null = null;
    await asServiceRole(pg, async () => {
      try {
        await pg.query(ATTACH_UPDATE, [serviceWrite, "cs_service", 2500, 47500, "acct_service"]);
      } catch (e) {
        serviceUpdateError = (e as Error).message;
      }
    });
    const serviceRow = await splitOf(serviceWrite);
    check("as SERVICE_ROLE: the UPDATE raises no error", serviceUpdateError === null, serviceUpdateError ?? undefined);
    check(
      "as SERVICE_ROLE: all three columns are silently reverted to NULL too (is_admin() is false without auth.uid())",
      serviceRow.platform_fee_amount === null && serviceRow.venue_amount === null && serviceRow.paymongo_venue_account_id === null,
      JSON.stringify(serviceRow)
    );

    // --- Controls: the columns ARE writable through the escape hatches ------
    // Without these, a NULL read-back above would be indistinguishable from
    // the columns being broken/nonexistent for some unrelated reason.
    console.log("\n— Controls: the two escape hatches —");

    const bypassWrite = await createPendingBooking(50000);
    await pg.query("begin");
    await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', true)`);
    await pg.query(ATTACH_UPDATE, [bypassWrite, "cs_bypass", 2500, 47500, "acct_bypass"]);
    await pg.query("commit");
    const bypassRow = await splitOf(bypassWrite);
    check(
      "the bypass GUC writes all three columns",
      bypassRow.platform_fee_amount === 2500 && bypassRow.venue_amount === 47500 && bypassRow.paymongo_venue_account_id === "acct_bypass",
      JSON.stringify(bypassRow)
    );

    const adminWrite = await createPendingBooking(50000);
    await asUser(pg, admin, async () => {
      await pg.query(ATTACH_UPDATE, [adminWrite, "cs_admin", 2500, 47500, "acct_admin"]);
    });
    const adminRow = await splitOf(adminWrite);
    check(
      "an admin session writes all three columns",
      adminRow.platform_fee_amount === 2500 && adminRow.venue_amount === 47500 && adminRow.paymongo_venue_account_id === "acct_admin",
      JSON.stringify(adminRow)
    );

    // --- Tampering must stay blocked ---------------------------------------
    // These columns feed settlement/payout accounting (20260810000039
    // onwards), so the guard itself must not be weakened to fix the write
    // path. Confirm an owner cannot rewrite an ALREADY-SET snapshot.
    console.log("\n— The guard's actual job —");
    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set venue_amount = 49999, platform_fee_amount = 1 where id = $1`, [bypassWrite]);
    });
    const afterTamper = await splitOf(bypassWrite);
    check(
      "an owner cannot rewrite a snapshot that is already set",
      afterTamper.venue_amount === 47500 && afterTamper.platform_fee_amount === 2500,
      JSON.stringify(afterTamper)
    );

    // --- THE WRITE PATH (20260810000056) -----------------------------------
    const rpcExists = await pg.query(
      `select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = 'set_booking_marketplace_split'`
    );

    if (rpcExists.rowCount === 0) {
      console.log("\n— Write path —");
      console.log("  set_booking_marketplace_split() does not exist yet; skipping (apply 20260810000056).");
    } else {
      console.log("\n— Write path: set_booking_marketplace_split() —");

      const viaRpc = await createPendingBooking(50000);
      const ok = await pg.query(`select public.set_booking_marketplace_split($1, 2500, 47500, 'acct_rpc') as ok`, [viaRpc]);
      check("the RPC reports success on a pending booking", ok.rows[0].ok === true);
      const rpcRow = await splitOf(viaRpc);
      check(
        "the RPC persists all three columns",
        rpcRow.platform_fee_amount === 2500 && rpcRow.venue_amount === 47500 && rpcRow.paymongo_venue_account_id === "acct_rpc",
        JSON.stringify(rpcRow)
      );

      // Re-attaching a new session is a real flow (resumeRescheduleCheckout),
      // so the RPC must be able to overwrite its own snapshot while pending.
      const reattach = await pg.query(`select public.set_booking_marketplace_split($1, 2400, 45600, 'acct_rpc2') as ok`, [viaRpc]);
      const reattachRow = await splitOf(viaRpc);
      check(
        "the RPC can re-write the snapshot on a still-pending booking (re-attach)",
        reattach.rows[0].ok === true && reattachRow.venue_amount === 45600 && reattachRow.paymongo_venue_account_id === "acct_rpc2",
        JSON.stringify(reattachRow)
      );

      // The bypass GUC must be transaction-local: if it leaked, the next
      // statement in the same transaction could tamper freely.
      const leak = await pg.query(`select coalesce(current_setting('air_rally.bypass_booking_tampering', true), 'unset') as flag`);
      check("the bypass GUC does not leak past the RPC", leak.rows[0].flag !== "true", `flag is ${leak.rows[0].flag}`);

      // Confirmed bookings are already reconciled; moving the split then
      // would retroactively change settlement inputs.
      const confirmedBooking = await createPendingBooking(50000);
      await pg.query(`select public.set_booking_marketplace_split($1, 2500, 47500, 'acct_before') as ok`, [confirmedBooking]);
      await pg.query("begin");
      await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', true)`);
      await pg.query(`update public.bookings set status = 'confirmed', paid_at = now() where id = $1`, [confirmedBooking]);
      await pg.query("commit");
      const onConfirmed = await pg.query(`select public.set_booking_marketplace_split($1, 1, 2, 'acct_after') as ok`, [confirmedBooking]);
      const confirmedRow = await splitOf(confirmedBooking);
      check(
        "the RPC refuses a confirmed booking and leaves the snapshot intact",
        onConfirmed.rows[0].ok === false && confirmedRow.paymongo_venue_account_id === "acct_before",
        `ok=${onConfirmed.rows[0].ok}, row=${JSON.stringify(confirmedRow)}`
      );

      // Sanity bound: a split can never promise out more than the booking's
      // gross price. Deliberately loose (the reschedule path splits only a
      // price difference), but it stops an arbitrary figure landing in
      // settlement.
      const overBooking = await createPendingBooking(20000);
      const over = await pg.query(`select public.set_booking_marketplace_split($1, 1000, 9999000, 'acct_over') as ok`, [overBooking]);
      const overRow = await splitOf(overBooking);
      check(
        "a split exceeding price_amount is refused",
        over.rows[0].ok === false && overRow.venue_amount === null,
        `ok=${over.rows[0].ok}, row=${JSON.stringify(overRow)}`
      );

      // A split of a price DIFFERENCE (the reschedule path) is under
      // price_amount and must still be accepted.
      const diffBooking = await createPendingBooking(50000);
      const diff = await pg.query(`select public.set_booking_marketplace_split($1, 500, 9500, 'acct_diff') as ok`, [diffBooking]);
      check("a split of a price difference (reschedule path) is accepted", diff.rows[0].ok === true);

      for (const [label, args] of [
        ["a negative platform fee", "-1, 100, 'acct_neg'"],
        ["a negative venue amount", "100, -1, 'acct_neg'"],
        ["a null account id", "100, 100, null"],
        ["an empty account id", "100, 100, ''"],
      ] as const) {
        const bad = await createPendingBooking(50000);
        let raised = false;
        try {
          await pg.query(`select public.set_booking_marketplace_split($1, ${args})`, [bad]);
        } catch {
          raised = true;
        }
        check(`${label} is rejected`, raised);
      }

      // --- Authorization -----------------------------------------------------
      console.log("\n— Authorization —");
      const target = await createPendingBooking(50000);

      const asPlayer = await asUser(pg, player, async () => {
        try {
          await pg.query(`select public.set_booking_marketplace_split($1, 2500, 47500, 'acct_evil')`, [target]);
          return "allowed";
        } catch {
          return "blocked";
        }
      }).catch(() => "blocked");
      check("the booking's own owner cannot call the RPC (service_role only)", asPlayer === "blocked");

      const asAnon = await (async () => {
        await pg.query("begin");
        try {
          await pg.query("set local role anon");
          await pg.query(`select public.set_booking_marketplace_split($1, 2500, 47500, 'acct_evil')`, [target]);
          await pg.query("commit");
          return "allowed";
        } catch {
          await pg.query("rollback").catch(() => undefined);
          return "blocked";
        }
      })();
      check("anon cannot call the RPC", asAnon === "blocked");

      const stillNull = await splitOf(target);
      check(
        "no unauthorized call left anything behind",
        stillNull.platform_fee_amount === null && stillNull.venue_amount === null,
        JSON.stringify(stillNull)
      );

      const asService = await asServiceRole(pg, async () => {
        const r = await pg.query(`select public.set_booking_marketplace_split($1, 2500, 47500, 'acct_svc') as ok`, [target]);
        return r.rows[0].ok;
      });
      check("service_role CAN call the RPC, and it persists", asService === true);
      const serviceRpcRow = await splitOf(target);
      check(
        "the service_role call's snapshot is on the row",
        serviceRpcRow.platform_fee_amount === 2500 && serviceRpcRow.venue_amount === 47500 && serviceRpcRow.paymongo_venue_account_id === "acct_svc",
        JSON.stringify(serviceRpcRow)
      );
    }
  } finally {
    console.log("\nCleaning up…");
    await pg.query(`reset role`).catch(() => undefined);
    await pg.query(`delete from public.bookings where court_id = $1`, [courtId]).catch(() => undefined);
    await pg.query(`delete from public.courts where id = $1`, [courtId]).catch(() => undefined);
    await pg.query(`delete from public.venues where id = $1`, [venueId]).catch(() => undefined);
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
