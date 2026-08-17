/**
 * Refunds a booking as AIR/Rally Credits — the only refund mechanism this
 * platform has, and the executable half of docs/payments/REFUNDS.md.
 *
 * WHY CREDIT AND NOT MONEY
 *
 * QR Ph payments cannot be refunded through PayMongo's API at all
 * (REFUND_UNSUPPORTED_SOURCE_TYPES in lib/services/refunds.ts, confirmed
 * against the live API). QR Ph is the only enabled payment method, so
 * there is no code path that returns money to a card or wallet. Refunds
 * are issued as credit, which the customer spends on a future booking.
 *
 * WHY A SCRIPT AND NOT SQL BY HAND
 *
 * Three things are easy to get wrong at 11pm with a customer waiting, and
 * all three are enforced here rather than remembered:
 *
 *   1. The amount. A refund covers the COURT PRICE ONLY — never the
 *      processing fee, which PayMongo consumed when the payment was
 *      processed and which AIR/Rally never held. Credit does not attract a
 *      fee when spent, so a full court price refunds to a full court's
 *      worth of booking. See calculateRefundCredit().
 *   2. Double-issuing. Credit is money-like and the ledger is immutable —
 *      there is no undo. This refuses if compensation already exists for
 *      the booking.
 *   3. Writing to booking_refunds. That table models PROVIDER refunds and
 *      requires a real provider_payment_id and a real PayMongo response;
 *      lib/services/refunds.ts is its only legitimate writer. A credit
 *      refund does not belong in it. The credit ledger is the audit trail.
 *
 * DRY RUN BY DEFAULT. Nothing is issued without --confirm.
 *
 * USAGE
 *
 *   set -a && source .env.production && set +a
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/issue-refund-credit.ts --code A6CCE76E --cause customer
 *
 *   Add --confirm to actually issue. --cause is one of:
 *     customer          the customer cancelled (48h cutoff applies)
 *     venue             the venue cancelled (always full)
 *     venue_unavailable the venue could not honour it (always full)
 *     system_error      a system or payment fault (always full)
 *     support_review    a deliberate support decision (always full)
 *
 *   --amount <centavos> overrides the computed amount for a partial
 *   refund. Use sparingly and say why in --note; the default is what the
 *   customer actually paid.
 */
import { Client } from "pg";
import { resolveCancellationCredit, addCredit, type CancellationCause } from "../src/lib/services/credits";
import { calculateRefundCredit, describeBookingAmounts } from "../src/lib/services/bookingFee";

type Row = {
  id: string;
  user_id: string;
  confirmation_code: string;
  status: string;
  price_amount: number;
  credit_amount_applied: number;
  processing_fee_amount: number;
  currency: string;
  start_time: string;
  paid_at: string | null;
  payment_provider: string;
};

const CAUSES: CancellationCause[] = ["customer", "venue", "venue_unavailable", "system_error", "support_review"];

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}
function peso(minor: number): string {
  return `₱${(minor / 100).toFixed(2)}`;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set — source .env.production first.");

  const code = arg("code");
  const cause = (arg("cause") ?? "customer") as CancellationCause;
  const override = arg("amount");
  const note = arg("note");
  const confirm = process.argv.includes("--confirm");

  if (!code) throw new Error("Pass --code <confirmation code>.");
  if (!CAUSES.includes(cause)) throw new Error(`--cause must be one of: ${CAUSES.join(", ")}`);

  const ref = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").match(/https:\/\/([a-z0-9]+)\./)?.[1] ?? "unknown";
  console.log(`Supabase project: ${ref}${confirm ? "  [LIVE — will issue credit]" : "  [dry run]"}\n`);

  const client = new Client({ connectionString, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    const { rows } = await client.query<Row>(
      `select id, user_id, confirmation_code, status, price_amount, credit_amount_applied,
              processing_fee_amount, currency, start_time, paid_at, payment_provider
         from bookings where confirmation_code = $1`,
      [code]
    );
    if (rows.length === 0) throw new Error(`No booking with confirmation code ${code}.`);
    const b = rows[0];

    // The refundable base is the COURT PRICE ONLY. The processing fee was
    // consumed by PayMongo when the payment was processed — AIR/Rally never
    // held it and cannot return it. Credit does not attract a fee when it is
    // spent, so a full court price refunds to a full court's worth of credit.
    // See calculateRefundCredit() for the whole argument.
    const amounts = describeBookingAmounts(b);
    const amountPaid = calculateRefundCredit(b);

    console.log(`Booking ${b.confirmation_code}  (${b.status}, ${b.payment_provider})`);
    console.log(`  starts        ${b.start_time}`);
    console.log(`  court price       ${peso(amounts.courtPrice)}   <- refundable base`);
    console.log(`  credit used       ${peso(amounts.creditApplied)}`);
    console.log(`  processing fee    ${peso(amounts.processingFee)}   <- NOT refunded (consumed by PayMongo)`);
    console.log(`  total paid        ${peso(amounts.totalPaid)}   (PayMongo collected ${peso(amounts.payableToProvider)})`);
    console.log(`  REFUNDABLE CREDIT ${peso(amounts.refundableAsCredit)}`);
    console.log(`  paid_at       ${b.paid_at ?? "NEVER PAID"}\n`);

    if (!b.paid_at) {
      // An abandoned checkout. Most pending bookings are these, and they
      // are the single most likely thing to be refunded by mistake.
      throw new Error("This booking was never paid (paid_at is null) — there is nothing to refund. Abandoned checkouts need no action.");
    }

    // Idempotency. The ledger is immutable and credit is money-like, so a
    // second issue cannot be undone — only offset by a negative adjustment,
    // which is a worse audit trail than never double-issuing.
    const { rows: existing } = await client.query<{ id: string; amount: number; created_at: string }>(
      `select id, amount, created_at from credit_transactions
        where reference_id = $1 and transaction_type = 'cancellation_compensation'`,
      [b.id]
    );
    if (existing.length > 0) {
      console.log("ALREADY REFUNDED — compensation exists for this booking:");
      existing.forEach((t) => console.log(`  ${peso(t.amount)} on ${t.created_at}`));
      throw new Error("Refusing to issue a second refund. If this one is genuinely wrong, make a deliberate admin_adjustment instead.");
    }

    const decision = resolveCancellationCredit({
      cause,
      amountPaid,
      startTime: b.start_time,
      now: Date.now(),
    });

    const amount = override ? Number(override) : decision.amount;
    if (override && (!Number.isInteger(amount) || amount <= 0 || amount > amountPaid)) {
      throw new Error(`--amount must be a positive whole number of centavos not exceeding the refundable base ${amountPaid}.`);
    }

    console.log(`Policy (cause: ${cause}): ${decision.reason}`);
    console.log(`  eligible      ${decision.eligible}`);
    console.log(`  policy amount ${peso(decision.amount)}`);
    if (override) console.log(`  OVERRIDE      ${peso(amount)}${note ? `  — ${note}` : "  (no --note given)"}`);

    if (amount <= 0) {
      console.log("\nNothing to issue under this policy. If you intend to compensate anyway, pass --cause support_review (a deliberate decision) rather than overriding silently.");
      return;
    }

    if (!confirm) {
      console.log(`\nDRY RUN. Would issue ${peso(amount)} of credit to user ${b.user_id}.`);
      console.log("Re-run with --confirm to actually issue it.");
      return;
    }

    const balance = await addCredit({
      userId: b.user_id,
      amount,
      transactionType: "cancellation_compensation",
      referenceId: b.id,
      description: note ? `Refund for booking #${b.confirmation_code} — ${note}` : `Refund for booking #${b.confirmation_code}`,
    });

    console.log(`\nISSUED ${peso(amount)} to user ${b.user_id}. New balance: ${peso(balance)}`);
    console.log("The customer is notified automatically (credit issues notify; see the credits migration).");
    console.log("\nReminder: this does NOT cancel the booking. If it still needs cancelling, do that separately.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(`\n${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
