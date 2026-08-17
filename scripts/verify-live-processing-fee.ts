/**
 * Checks what PayMongo ACTUALLY charged against what we predicted and
 * stored — the one measurement that decides whether the fee pass-through
 * survives going live.
 *
 * WHY THIS EXISTS
 *
 * PROCESSING_FEE_PERCENT is 0.015, and that number is a MEASUREMENT taken
 * in test mode, not PayMongo's published rate. Their documented QR Ph
 * pricing is 1.34% + 12% VAT = 1.5008%, which predicts ₱406.10 on a ₱400
 * court where the real charge was ₱406.09. We use the measured figure
 * because confirm_paymongo_booking_payment() compares for EXACT equality:
 *
 *     price_amount - credit_amount_applied + processing_fee_amount
 *
 * A one-centavo disagreement matches zero rows, so a genuinely paid
 * booking never confirms and sits on 'pending' forever. That outage has
 * already happened once on this project.
 *
 * The risk at activation is that live-mode billing follows the published
 * rate rather than the test-mode one. This script answers that in seconds,
 * against real payments, instead of by eye in the dashboard.
 *
 * READ-ONLY. It queries Postgres and PayMongo and writes nothing, to
 * either. Safe to run against production.
 *
 * USAGE
 *
 *   set -a && source .env.production && set +a
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-live-processing-fee.ts
 *
 *   Add --code ABCD1234 to check one specific booking, or --limit 20 to
 *   widen the sweep (default: the 10 most recent fee-bearing bookings).
 *
 * WHAT TO DO IF IT REPORTS DRIFT
 *
 * Do NOT loosen the amount check to tolerate the difference — that check
 * is what stops a free-booking exploit (see migration 20260810000047).
 * Set PAYMONGO_PASS_ON_FEES_ENABLED=false and redeploy, which restores
 * exact-price charging immediately with AIR/Rally absorbing the fee, then
 * recalibrate PROCESSING_FEE_PERCENT from the observed figures this script
 * prints and re-verify on staging before re-enabling.
 */
import { Client } from "pg";
import { PROCESSING_FEE_PERCENT } from "../src/lib/booking-config";

type Row = {
  confirmation_code: string;
  status: string;
  price_amount: number;
  credit_amount_applied: number;
  processing_fee_amount: number;
  paid_at: string | null;
  paymongo_checkout_session_id: string | null;
};

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function peso(minor: number): string {
  return `₱${(minor / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  const secretKey = process.env.PAYMONGO_SECRET_KEY;
  if (!connectionString) throw new Error("DATABASE_URL is not set — source .env.production or .env.staging first.");
  if (!secretKey) throw new Error("PAYMONGO_SECRET_KEY is not set.");

  // Which environment this is pointing at, stated up front — this script is
  // meant to be run against production, so it should never be ambiguous.
  const supabaseRef = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown";
  console.log(`Supabase project: ${supabaseRef}`);
  console.log(`PayMongo key mode: ${secretKey.startsWith("sk_live") ? "sk_live" : "sk_test"}`);
  console.log(`PROCESSING_FEE_PERCENT: ${PROCESSING_FEE_PERCENT} (${(PROCESSING_FEE_PERCENT * 100).toFixed(4)}%)\n`);

  const code = arg("code");
  const limit = Number(arg("limit") ?? 10);

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  const { rows } = await client.query<Row>(
    code
      ? `select confirmation_code, status, price_amount, credit_amount_applied, processing_fee_amount, paid_at, paymongo_checkout_session_id
           from bookings where confirmation_code = $1`
      : `select confirmation_code, status, price_amount, credit_amount_applied, processing_fee_amount, paid_at, paymongo_checkout_session_id
           from bookings where processing_fee_amount <> 0 order by created_at desc limit $1`,
    code ? [code] : [limit]
  );
  await client.end();

  if (rows.length === 0) {
    console.log(code ? `No booking with confirmation code ${code}.` : "No fee-bearing bookings found.");
    return;
  }

  const auth = `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`;
  let checked = 0;
  let drifted = 0;
  let unpaid = 0;
  let liveCount = 0;

  for (const b of rows) {
    const expected = b.price_amount - b.credit_amount_applied + b.processing_fee_amount;

    if (!b.paymongo_checkout_session_id) {
      console.log(`${b.confirmation_code}  no PayMongo session (credit-only booking) — skipped`);
      continue;
    }

    const res = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${b.paymongo_checkout_session_id}`, {
      headers: { Authorization: auth },
    });
    if (!res.ok) {
      // A 404 here usually means key/mode mismatch (a test key cannot see a
      // live session, or vice versa) rather than a missing session.
      console.log(`${b.confirmation_code}  PayMongo HTTP ${res.status} — session not visible to this key (mode mismatch?)`);
      continue;
    }

    const json = (await res.json()) as {
      data: { attributes: { livemode?: boolean; payment_intent?: { attributes?: { payments?: Array<{ attributes: { status: string; amount: number } }> } } } };
    };
    const attrs = json.data.attributes;
    if (attrs.livemode) liveCount += 1;

    const paid = (attrs.payment_intent?.attributes?.payments ?? []).filter((p) => p.attributes.status === "paid");
    if (paid.length === 0) {
      unpaid += 1;
      console.log(`${b.confirmation_code}  ${b.status.padEnd(9)} never paid (abandoned checkout) — nothing to compare`);
      continue;
    }

    checked += 1;
    for (const p of paid) {
      const actual = p.attributes.amount;
      const delta = actual - expected;
      const mode = attrs.livemode ? "LIVE" : "test";
      if (delta === 0) {
        console.log(`${b.confirmation_code}  ${mode}  court ${peso(b.price_amount)}  fee ${peso(b.processing_fee_amount)}  charged ${peso(actual)}  MATCH`);
      } else {
        drifted += 1;
        // The implied rate is what PROCESSING_FEE_PERCENT would have to be
        // for this charge to have been predicted exactly.
        const collected = b.price_amount - b.credit_amount_applied;
        const impliedRate = collected > 0 ? 1 - collected / actual : 0;
        console.log(
          `${b.confirmation_code}  ${mode}  court ${peso(b.price_amount)}  expected ${peso(expected)}  actual ${peso(actual)}  ` +
            `DRIFT ${delta > 0 ? "+" : ""}${peso(delta)}  implied rate ${(impliedRate * 100).toFixed(4)}%`
        );
      }
    }
  }

  console.log(`\nchecked ${checked} paid booking(s) · ${unpaid} unpaid/abandoned · ${liveCount} in LIVE mode`);

  if (drifted > 0) {
    console.log(
      `\nDRIFT DETECTED on ${drifted} payment(s). Bookings paid at a drifted amount CANNOT confirm — ` +
        `confirm_paymongo_booking_payment() compares for exact equality and will match zero rows.\n` +
        `Set PAYMONGO_PASS_ON_FEES_ENABLED=false and redeploy, then recalibrate PROCESSING_FEE_PERCENT ` +
        `from the implied rate above and re-verify on staging. Do NOT loosen the amount check.`
    );
    process.exitCode = 1;
    return;
  }

  if (checked === 0) {
    console.log("\nNothing was actually paid, so the fee arithmetic is UNVERIFIED. Put one real payment through and re-run.");
    return;
  }

  if (liveCount === 0) {
    console.log(
      "\nEvery payment matched, but all of them are test mode (livemode: false), so this does NOT yet prove live pricing.\n" +
        "Re-run after the first real payment once the PayMongo account is live-activated."
    );
    return;
  }

  console.log("\nEvery live payment matched the stored fee exactly. The pass-through is calibrated correctly for live pricing.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
