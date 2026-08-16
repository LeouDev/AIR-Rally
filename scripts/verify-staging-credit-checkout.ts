/**
 * Functional verification of the AIR/Rally Credits <-> checkout integration
 * against whatever database DATABASE_URL points at — gated by
 * assert-staging-env.ts.
 *
 * The centrepiece is the tampering check: `credit_amount_applied` feeds the
 * cancellation-restore trigger, so if a user can write that column on their
 * own booking they can mint unlimited credit. This script proves they
 * cannot.
 *
 * WRITES: creates throwaway users, a venue, a court and bookings to exercise
 * the real triggers, RLS and privileged functions, then removes everything in
 * a `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-credit-checkout.ts
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

async function balanceOf(pg: Client, userId: string): Promise<number> {
  const r = await pg.query(`select balance from public.user_credit_wallets where user_id = $1`, [userId]);
  return r.rows[0]?.balance ?? 0;
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
  const bookingIds: string[] = [];

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
    bookingIds.push(r.rows[0].id);
    return r.rows[0].id as string;
  }

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `creditco-${run}-${i}@example.test`]
      );
    }

    const venue = await pg.query(
      `insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'active', 'Asia/Manila') returning id`,
      [owner, `Credit Checkout Test ${run}`]
    );
    venueId = venue.rows[0].id;

    const court = await pg.query(
      `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 500, 'active') returning id`,
      [venueId]
    );
    courtId = court.rows[0].id;
    console.log(`Seeded 2 users, 1 venue, 1 court (run ${run}).\n`);

    // --- THE VULNERABILITY CHECK ------------------------------------------
    // credit_amount_applied is what the cancellation-restore trigger pays
    // out. If a user can write it on their own booking, cancelling that
    // booking mints credit from nothing.
    console.log("— Booking credit-column tampering —");
    const tamperBooking = await createPendingBooking(50000);

    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set credit_amount_applied = 9999999 where id = $1`, [tamperBooking]);
    });

    const afterTamper = await pg.query(`select credit_amount_applied from public.bookings where id = $1`, [tamperBooking]);
    check(
      "a user cannot inflate credit_amount_applied on their own booking",
      afterTamper.rows[0].credit_amount_applied === 0,
      `column is now ${afterTamper.rows[0].credit_amount_applied}`
    );

    const balanceBeforeCancel = await balanceOf(pg, player);
    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set status = 'cancelled' where id = $1`, [tamperBooking]);
    });
    check(
      "cancelling that booking mints no credit",
      (await balanceOf(pg, player)) === balanceBeforeCancel,
      `balance moved ${balanceBeforeCancel} -> ${await balanceOf(pg, player)}`
    );

    // --- apply_credit_to_booking ------------------------------------------
    console.log("\n— Applying credit at checkout —");
    await pg.query(`select public.issue_credit($1, 80000, 'admin_adjustment', null, 'test wallet')`, [player]);

    const partial = await createPendingBooking(50000);
    await pg.query(`select public.apply_credit_to_booking($1, $2, 30000)`, [partial, player]);

    const partialRow = await pg.query(`select credit_amount_applied, price_amount from public.bookings where id = $1`, [partial]);
    check("credit is recorded on the booking", partialRow.rows[0].credit_amount_applied === 30000, `got ${partialRow.rows[0].credit_amount_applied}`);
    check("the wallet was debited (800 - 300 = 500)", (await balanceOf(pg, player)) === 50000, `got ${await balanceOf(pg, player)}`);

    // Applying twice would double-charge the wallet for one booking.
    let reapplied = false;
    try {
      await pg.query(`select public.apply_credit_to_booking($1, $2, 10000)`, [partial, player]);
      reapplied = true;
    } catch {
      /* expected */
    }
    check("credit cannot be applied to the same booking twice", !reapplied);
    check("the wallet is untouched by the rejected re-application", (await balanceOf(pg, player)) === 50000, `got ${await balanceOf(pg, player)}`);

    let overApplied = false;
    try {
      const over = await createPendingBooking(20000);
      await pg.query(`select public.apply_credit_to_booking($1, $2, 50000)`, [over, player]);
      overApplied = true;
    } catch {
      /* expected */
    }
    check("credit exceeding the booking price is rejected", !overApplied);

    let wrongOwner = false;
    try {
      const someone = await createPendingBooking(20000);
      await pg.query(`select public.apply_credit_to_booking($1, $2, 10000)`, [someone, owner]);
      wrongOwner = true;
    } catch {
      /* expected */
    }
    check("credit cannot be applied to someone else's booking", !wrongOwner);

    const rpcAsUser = await asUser(pg, player, async () => {
      try {
        await pg.query(`select public.apply_credit_to_booking($1, $2, 10000)`, [partial, player]);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a user cannot call apply_credit_to_booking() directly (service_role only)", rpcAsUser === "blocked");

    // --- Webhook confirmation with credits applied -------------------------
    // The RPC's amount check must now expect price - credit, or every
    // partially-credited booking silently fails to confirm.
    console.log("\n— Webhook confirmation —");
    await pg.query(`update public.bookings set paymongo_checkout_session_id = 'cs_test_partial', payment_provider = 'paymongo' where id = $1`, [
      partial,
    ]);

    const confirmedWrong = await pg.query(
      `select public.confirm_paymongo_booking_payment($1, 'cs_test_partial', 'pi_test', 50000, 'PHP') as ok`,
      [partial]
    );
    check("the full price is REJECTED once credit has been applied", confirmedWrong.rows[0].ok === false);

    const confirmedRight = await pg.query(
      `select public.confirm_paymongo_booking_payment($1, 'cs_test_partial', 'pi_test', 20000, 'PHP') as ok`,
      [partial]
    );
    check("the credit-reduced amount (500 - 300 = 200) confirms the booking", confirmedRight.rows[0].ok === true);

    const confirmedAgain = await pg.query(
      `select public.confirm_paymongo_booking_payment($1, 'cs_test_partial', 'pi_test', 20000, 'PHP') as ok`,
      [partial]
    );
    check("a duplicate webhook delivery is a no-op (idempotent)", confirmedAgain.rows[0].ok === false);

    // A booking with no credit must behave exactly as it did before.
    const plain = await createPendingBooking(40000);
    await pg.query(`update public.bookings set paymongo_checkout_session_id = 'cs_test_plain', payment_provider = 'paymongo' where id = $1`, [plain]);
    const plainConfirm = await pg.query(
      `select public.confirm_paymongo_booking_payment($1, 'cs_test_plain', 'pi_plain', 40000, 'PHP') as ok`,
      [plain]
    );
    check("a booking with no credit still confirms at its full price", plainConfirm.rows[0].ok === true);

    // --- Credit-only bookings ----------------------------------------------
    console.log("\n— Fully credit-covered bookings —");
    const full = await createPendingBooking(30000);
    await pg.query(`select public.apply_credit_to_booking($1, $2, 30000)`, [full, player]);
    const fullOk = await pg.query(`select public.confirm_credit_only_booking($1, $2) as ok`, [full, player]);
    check("a fully covered booking confirms with no PayMongo session", fullOk.rows[0].ok === true);

    const fullRow = await pg.query(
      `select status, payment_provider, paid_at, paymongo_checkout_session_id from public.bookings where id = $1`,
      [full]
    );
    check("it is marked confirmed", fullRow.rows[0].status === "confirmed", `got ${fullRow.rows[0].status}`);
    check("its provider is air_rally_credit", fullRow.rows[0].payment_provider === "air_rally_credit", `got ${fullRow.rows[0].payment_provider}`);
    check("paid_at is set", fullRow.rows[0].paid_at !== null);
    check("no PayMongo session is attached", fullRow.rows[0].paymongo_checkout_session_id === null);

    const fullAgain = await pg.query(`select public.confirm_credit_only_booking($1, $2) as ok`, [full, player]);
    check("confirming a credit-only booking twice is a no-op", fullAgain.rows[0].ok === false);

    // A partially covered booking must never be confirmable for free.
    const sneaky = await createPendingBooking(50000);
    await pg.query(`select public.apply_credit_to_booking($1, $2, 10000)`, [sneaky, player]);
    const sneakyOk = await pg.query(`select public.confirm_credit_only_booking($1, $2) as ok`, [sneaky, player]);
    check("a partially covered booking CANNOT be confirmed without paying", sneakyOk.rows[0].ok === false);

    const creditOnlyAsUser = await asUser(pg, player, async () => {
      try {
        await pg.query(`select public.confirm_credit_only_booking($1, $2)`, [sneaky, player]);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a user cannot call confirm_credit_only_booking() directly", creditOnlyAsUser === "blocked");

    // --- Reschedule compatibility -------------------------------------------
    // Rescheduling prices a change as replacement.price_amount -
    // original.price_amount, and maybeCompleteReschedule() matches the
    // charged amount against that difference. Both break if applying credit
    // ever mutates price_amount.
    console.log("\n— Reschedule compatibility —");
    const priced = await pg.query(`select price_amount, credit_amount_applied from public.bookings where id = $1`, [partial]);
    check("applying credit leaves price_amount untouched", priced.rows[0].price_amount === 50000, `got ${priced.rows[0].price_amount}`);
    check("credit is tracked in its own column", priced.rows[0].credit_amount_applied === 30000, `got ${priced.rows[0].credit_amount_applied}`);

    // A reschedule replacement is confirmed before any difference is paid,
    // so credit must never be applicable to it after the fact.
    let creditOnConfirmed = false;
    try {
      await pg.query(`select public.apply_credit_to_booking($1, $2, 10000)`, [partial, player]);
      creditOnConfirmed = true;
    } catch {
      /* expected — booking is confirmed, not pending */
    }
    check("credit cannot be applied to an already-confirmed booking", !creditOnConfirmed);

    // --- Cancellation restore ----------------------------------------------
    console.log("\n— Cancellation restore —");
    // The checks above have spent most of the wallet down; top it back up
    // so this section tests restoration rather than sufficiency.
    await pg.query(`select public.issue_credit($1, 50000, 'admin_adjustment', null, 'top-up')`, [player]);
    const abandoned = await createPendingBooking(20000);
    await pg.query(`select public.apply_credit_to_booking($1, $2, 20000)`, [abandoned, player]);
    const beforeRestore = await balanceOf(pg, player);
    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set status = 'cancelled' where id = $1`, [abandoned]);
    });
    check(
      "cancelling a PENDING booking returns its applied credit",
      (await balanceOf(pg, player)) === beforeRestore + 20000,
      `${beforeRestore} -> ${await balanceOf(pg, player)}`
    );

    // The confirmed credit-only booking above must NOT auto-refund — the
    // 48-hour policy decides that, in application code.
    const beforeConfirmedCancel = await balanceOf(pg, player);
    await asUser(pg, player, async () => {
      await pg.query(`update public.bookings set status = 'cancelled' where id = $1`, [full]);
    });
    check(
      "cancelling a CONFIRMED booking does not auto-return credit",
      (await balanceOf(pg, player)) === beforeConfirmedCancel,
      `${beforeConfirmedCancel} -> ${await balanceOf(pg, player)}`
    );
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
