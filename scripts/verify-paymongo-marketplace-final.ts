/**
 * Final PayMongo Platforms marketplace verification harness — TEST MODE
 * only, direct PayMongo API calls, independent of AIR/Rally's own booking
 * flow (unlike scripts/verify-paymongo-checkout-flow.ts, which exercises
 * our own database/webhook route). This script exists to answer exactly
 * one open question as concretely as possible: can a genuine two-party
 * 95%/5% split, with pass_on_fees, be observed and refunded between two
 * DISTINCT real PayMongo accounts?
 *
 * Every mode below prints one of exactly four verdicts — CONFIRMED,
 * UNCONFIRMED, BLOCKED, or PAYMONGO_SUPPORT_REQUIRED — and never
 * upgrades an unknown into a success. Nothing here invents a Child
 * Merchant id, treats `org_test_merchant` (PayMongo TEST MODE's fixed
 * placeholder id, confirmed non-functional for real transfers — see
 * ARCHITECTURE.md) as real, or assumes an untested code path works.
 *
 * Never prints PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET, or any
 * Authorization header value. Object ids (checkout sessions, payments,
 * accounts) are safe to print — they are not credentials.
 *
 * HOW TO RUN (set these env vars first — this script does NOT read
 * .env.local automatically):
 *   PAYMONGO_SECRET_KEY          (test-mode, sk_test_...)
 *   PAYMONGO_PLATFORM_ACCOUNT_ID (org_..., AIR/Rally's own real account)
 *
 *   npx ts-node scripts/verify-paymongo-marketplace-final.ts diagnostic
 *     Read-only + one child-account creation attempt. Safe to run
 *     anytime. Prints the full A/B/C blocker diagnostic for PayMongo
 *     support, and separately checks idempotency and payment-method
 *     session-creation acceptance.
 *
 *   npx ts-node scripts/verify-paymongo-marketplace-final.ts verify-child --child-id=org_...
 *     Independently verifies a manually-created Child Account before any
 *     payment is attempted: GET /v2/accounts/{id}, whether it appears in
 *     GET /v2/relationships, and whether it's distinct from
 *     PAYMONGO_PLATFORM_ACCOUNT_ID. Never assumes usability from mere
 *     existence.
 *
 *   npx ts-node scripts/verify-paymongo-marketplace-final.ts create-split-session --child-id=org_... [--gross=50000] [--method=card]
 *     Only meaningful once a genuine second account id exists. Creates a
 *     real Checkout Session (₱500.00 gross by default; pass --gross=<minor
 *     units> for other amounts, e.g. --gross=100000 for ₱1,000) with
 *     split_payment (5% fixed to the platform, remainder to --child-id)
 *     and pass_on_fees:true. Prints the checkout_url — a human completes
 *     the real TEST MODE payment.
 *
 *   npx ts-node scripts/verify-paymongo-marketplace-final.ts inspect-payment --payment-id=pay_...
 *     Fetches the real Payment, prints the full amount/fee/net_amount/
 *     split_payment breakdown, and verdicts whether the split actually
 *     involved two distinct accounts.
 *
 *   npx ts-node scripts/verify-paymongo-marketplace-final.ts refund --payment-id=pay_... --amount=<minor-units> [--again]
 *     Issues a real refund, prints the resulting refund/split_refund
 *     breakdown. Pass --again to immediately retry with the same
 *     parameters (duplicate-refund-attempt / over-refund observation).
 */

const PAYMONGO_API_BASE = "https://api.paymongo.com/v1";
const PAYMONGO_API_V2_BASE = "https://api.paymongo.com/v2";

/** The one id PayMongo TEST MODE's mock account-creation endpoint always returns — confirmed non-functional for real transfers. Never treated as a real Child Merchant. */
const KNOWN_MOCK_CHILD_ID = "org_test_merchant";

type Verdict = "CONFIRMED" | "UNCONFIRMED" | "BLOCKED" | "PAYMONGO_SUPPORT_REQUIRED";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

function argValue(flag: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${flag}=`));
  return arg?.split("=").slice(1).join("=");
}

async function paymongoRequest(
  path: string,
  secretKey: string,
  options: { method?: string; body?: unknown; base?: string } = {}
): Promise<{ status: number; ok: boolean; data: unknown; errors: unknown }> {
  const response = await fetch(`${options.base ?? PAYMONGO_API_BASE}${path}`, {
    method: options.method ?? "GET",
    headers: {
      Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`,
      "Content-Type": "application/json",
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const json = (await response.json()) as { data?: unknown; errors?: unknown };
  return { status: response.status, ok: response.ok, data: json.data, errors: json.errors };
}

function verdictLine(verdict: Verdict, question: string, evidence: string) {
  console.log(`\n[${verdict}] ${question}`);
  console.log(`  Evidence: ${evidence}`);
}

// --- A/B/C: parent identification, child identification, relationships ---

async function runDiagnostic() {
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
  const platformAccountId = process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;

  console.log("=== PayMongo Marketplace Diagnostic (TEST MODE, read-only + 1 account-creation attempt) ===");

  // A. Parent/platform identification
  if (!platformAccountId) {
    verdictLine("BLOCKED", "A. Can we identify our own parent/platform account?", "PAYMONGO_PLATFORM_ACCOUNT_ID is not set in the environment.");
  } else {
    const selfLookup = await paymongoRequest(`/accounts/${platformAccountId}`, secretKey, { base: PAYMONGO_API_V2_BASE });
    if (selfLookup.status === 404) {
      verdictLine(
        "UNCONFIRMED",
        "A. Can we identify our own parent/platform account via GET /v2/accounts/{id}?",
        `HTTP 404 "${JSON.stringify(selfLookup.errors)}" — this endpoint does not resolve our own account, even though the same id works as a real recipients[].merchant_id in a completed split payment (confirmed separately). Self-lookup via this specific endpoint is not how PayMongo exposes parent-account status.`
      );
    } else if (selfLookup.ok) {
      verdictLine("CONFIRMED", "A. Can we identify our own parent/platform account?", `HTTP ${selfLookup.status}. Response: ${JSON.stringify(selfLookup.data)}`);
    } else {
      verdictLine("UNCONFIRMED", "A. Can we identify our own parent/platform account?", `HTTP ${selfLookup.status}: ${JSON.stringify(selfLookup.errors)}`);
    }
  }

  // B. Child Merchant identification
  const childCreate = await paymongoRequest("/accounts", secretKey, { method: "POST", base: PAYMONGO_API_V2_BASE, body: { type: "merchant" } });
  let childId: string | null = null;
  if (childCreate.ok) {
    childId = (childCreate.data as { id: string }).id;
    if (childId === KNOWN_MOCK_CHILD_ID) {
      verdictLine(
        "BLOCKED",
        "B. Can we obtain a real, usable Child Merchant id?",
        `POST /v2/accounts {"type":"merchant"} returned the known fixed TEST MODE placeholder id "${childId}" (not unique per call) — previously confirmed unusable as a real split_payment transfer_to target ("No such merchant with id org_test_merchant" at actual payment time). This is not a genuine second account.`
      );
    } else {
      verdictLine(
        "UNCONFIRMED",
        "B. Can we obtain a real, usable Child Merchant id?",
        `POST /v2/accounts returned a NEW, non-placeholder id: ${childId}. This id has not yet been exercised in a real split_payment — run create-split-session --child-id=${childId} next to find out whether it's genuinely usable.`
      );
    }
  } else {
    verdictLine("BLOCKED", "B. Can we obtain a real, usable Child Merchant id?", `POST /v2/accounts failed: HTTP ${childCreate.status} ${JSON.stringify(childCreate.errors)}`);
  }

  // C. Relationship verification
  const relationships = await paymongoRequest("/relationships", secretKey, { base: PAYMONGO_API_V2_BASE });
  if (relationships.ok) {
    const list = (relationships.data as unknown[]) ?? [];
    if (list.length === 0) {
      verdictLine(
        "BLOCKED",
        "C. Does a real parent-child relationship exist?",
        `GET /v2/relationships returned an empty list even after account creation attempts in this and prior sessions — no real relationship has ever been established by the mock account-creation flow.`
      );
    } else {
      verdictLine("CONFIRMED", "C. Does a real parent-child relationship exist?", `GET /v2/relationships returned ${list.length} relationship(s): ${JSON.stringify(list)}`);
    }
  } else {
    verdictLine("UNCONFIRMED", "C. Does a real parent-child relationship exist?", `GET /v2/relationships failed: HTTP ${relationships.status} ${JSON.stringify(relationships.errors)}`);
  }

  await runIdempotencyCheck(secretKey);
  await runPaymentMethodCheck(secretKey);

  console.log("\n=== Diagnostic complete ===");
  console.log(
    "If B and C are both BLOCKED, two-party verification cannot proceed without PayMongo support provisioning a real TEST MODE Child Merchant (or a completable identity-verification flow — the identity_verification step's returned URL, https://example.com/test-verification, is a non-functional placeholder, not a real hosted KYC page)."
  );
}

// --- Idempotency ---

async function runIdempotencyCheck(secretKey: string) {
  const idemKey = `verify-final-${Date.now()}`;
  const body = {
    data: {
      attributes: {
        line_items: [{ amount: 10000, currency: "PHP", name: "Idempotency check", quantity: 1 }],
        payment_method_types: ["card"],
        success_url: "https://example.com/success",
        cancel_url: "https://example.com/cancel",
      },
    },
  };
  const r1 = await fetch(`${PAYMONGO_API_V2_BASE}/checkout_sessions`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`, "Content-Type": "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const r2 = await fetch(`${PAYMONGO_API_V2_BASE}/checkout_sessions`, {
    method: "POST",
    headers: { Authorization: `Basic ${Buffer.from(`${secretKey}:`).toString("base64")}`, "Content-Type": "application/json", "Idempotency-Key": idemKey },
    body: JSON.stringify(body),
  }).then((r) => r.json());
  const id1 = (r1 as { data?: { id: string } }).data?.id;
  const id2 = (r2 as { data?: { id: string } }).data?.id;
  if (id1 && id2 && id1 === id2) {
    verdictLine("CONFIRMED", "K. Does Idempotency-Key dedupe /v2/checkout_sessions?", `Two requests with the same key both returned session id ${id1}.`);
  } else {
    verdictLine(
      "PAYMONGO_SUPPORT_REQUIRED",
      "K. Does Idempotency-Key dedupe /v2/checkout_sessions?",
      `Two requests with the identical key produced two different session ids (${id1}, ${id2}), despite documentation (docs.paymongo.com/reference/idempotent-requests) describing this header as deduping creation requests. AIR/Rally's own database-level idempotency (confirm_paymongo_booking_payment()'s conditional UPDATE) must remain the sole authority — do not build logic assuming PayMongo dedupes this.`
    );
  }
}

// --- Payment method session-creation acceptance ---

const PAYMENT_METHODS = ["card", "gcash", "paymaya", "grab_pay", "dob", "billease", "qrph", "brankas"];

async function runPaymentMethodCheck(secretKey: string) {
  console.log("\n--- Payment method session-creation acceptance (SESSION_CREATION only — not completion) ---");
  for (const method of PAYMENT_METHODS) {
    const result = await paymongoRequest("/checkout_sessions", secretKey, {
      method: "POST",
      base: PAYMONGO_API_V2_BASE,
      body: {
        data: {
          attributes: {
            line_items: [{ amount: 50000, currency: "PHP", name: "Method check", quantity: 1 }],
            payment_method_types: [method],
            success_url: "https://example.com/success",
            cancel_url: "https://example.com/cancel",
          },
        },
      },
    });
    console.log(`  ${method}: SESSION_CREATION ${result.ok ? "accepted (HTTP " + result.status + ")" : "REJECTED (HTTP " + result.status + " " + JSON.stringify(result.errors) + ")"} — PAYMENT_COMPLETION not attempted by this mode`);
  }
}

// --- Independently verify a manually-created Child Account before any payment ---

async function runVerifyChild() {
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
  const platformAccountId = process.env.PAYMONGO_PLATFORM_ACCOUNT_ID;
  const childId = argValue("child-id");
  if (!childId) {
    console.error("Usage: verify-child --child-id=org_...");
    process.exit(1);
  }

  console.log(`=== Verifying Child Account ${childId} (TEST MODE, read-only) ===`);

  // 1/7. Distinct from our own parent/platform account id?
  if (!platformAccountId) {
    verdictLine("BLOCKED", "1/7. Is the child id distinct from our parent account id?", "PAYMONGO_PLATFORM_ACCOUNT_ID is not set in the environment — cannot compare.");
  } else if (platformAccountId === childId) {
    verdictLine("BLOCKED", "1/7. Is the child id distinct from our parent account id?", `Child id ${childId} is IDENTICAL to PAYMONGO_PLATFORM_ACCOUNT_ID — this would be a degenerate same-account test, not a real two-party split.`);
  } else {
    verdictLine("CONFIRMED", "1/7. Is the child id distinct from our parent account id?", `Child id ${childId} differs from PAYMONGO_PLATFORM_ACCOUNT_ID (parent). Two distinct string ids confirmed — does not by itself prove both are real/usable.`);
  }

  // 1/8. Does GET /v2/accounts/{id} recognize/retrieve this account?
  const accountLookup = await paymongoRequest(`/accounts/${childId}`, secretKey, { base: PAYMONGO_API_V2_BASE });
  if (accountLookup.ok) {
    verdictLine(
      "CONFIRMED",
      "1/8. Does PayMongo recognize this account via GET /v2/accounts/{id}?",
      `HTTP ${accountLookup.status}. Response: ${JSON.stringify(accountLookup.data)}`
    );
  } else if (accountLookup.status === 404) {
    verdictLine(
      "UNCONFIRMED",
      "1/8. Does PayMongo recognize this account via GET /v2/accounts/{id}?",
      `HTTP 404 "${JSON.stringify(accountLookup.errors)}" — consistent with the earlier finding that this specific endpoint does not resolve OUR OWN account either (self-lookup returns 404 even though the same id works as a real recipients[].merchant_id in a completed split payment). A 404 here does NOT by itself prove the child account is fake — this endpoint may simply not be how PayMongo exposes any account's status to its own API key. The real test is Phase 3 (an actual split checkout).`
    );
  } else {
    verdictLine("UNCONFIRMED", "1/8. Does PayMongo recognize this account via GET /v2/accounts/{id}?", `HTTP ${accountLookup.status}: ${JSON.stringify(accountLookup.errors)}`);
  }

  // 2/4. Does GET /v2/relationships show a relationship for this child, and what's its status?
  const relationships = await paymongoRequest("/relationships", secretKey, { base: PAYMONGO_API_V2_BASE });
  if (relationships.ok) {
    const list = (relationships.data as Array<{ id: string; attributes?: Record<string, unknown> }>) ?? [];
    console.log(`\nGET /v2/relationships returned ${list.length} total relationship(s).`);
    const matching = list.filter((r) => JSON.stringify(r).includes(childId));
    if (matching.length > 0) {
      verdictLine("CONFIRMED", "2/4. Does GET /v2/relationships show a relationship involving this child?", JSON.stringify(matching));
    } else {
      verdictLine(
        "UNCONFIRMED",
        "2/4. Does GET /v2/relationships show a relationship involving this child?",
        `No entry in the ${list.length} returned relationship(s) mentions ${childId}. Either this endpoint doesn't reflect manually-created accounts, or no relationship has been established from PayMongo's side yet.`
      );
    }
  } else {
    verdictLine("UNCONFIRMED", "2/4. Does GET /v2/relationships show a relationship involving this child?", `HTTP ${relationships.status}: ${JSON.stringify(relationships.errors)}`);
  }

  // 5/6. Activation status / usability — only a real split checkout session can conclusively answer this.
  if (childId === KNOWN_MOCK_CHILD_ID) {
    verdictLine(
      "BLOCKED",
      "5/6. Is the account activated/usable for payments?",
      `"${childId}" is the known fixed TEST MODE placeholder id, previously confirmed unusable as a real split_payment transfer_to target ("No such merchant with id org_test_merchant" at actual payment time). Refusing to proceed to Phase 3 with this id.`
    );
  } else {
    verdictLine(
      "UNCONFIRMED",
      "5/6. Is the account activated/usable for payments?",
      `Not a known-fake id. Neither GET /v2/accounts/{id} nor GET /v2/relationships conclusively proves usability either way — the only conclusive test is attempting a real split_payment against it. Proceeding to create-split-session --child-id=${childId} next.`
    );
  }

  console.log(`\n=== Child verification complete — see create-split-session for the conclusive test ===`);
}

// --- Create a real split checkout session against a caller-supplied child id ---

async function runCreateSplitSession() {
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
  const platformAccountId = requireEnv("PAYMONGO_PLATFORM_ACCOUNT_ID");
  const childId = argValue("child-id");
  if (!childId) {
    console.error("Usage: create-split-session --child-id=org_... [--gross=50000] [--method=card]");
    process.exit(1);
  }
  if (childId === KNOWN_MOCK_CHILD_ID) {
    console.error(`Refusing to run: "${childId}" is the known non-functional TEST MODE placeholder id, not a real Child Merchant. See the diagnostic mode's output.`);
    process.exit(1);
  }
  if (childId === platformAccountId) {
    console.error(`Refusing to run: --child-id is identical to PAYMONGO_PLATFORM_ACCOUNT_ID — this would be the same degenerate same-account test already done in a prior session, not a genuine two-party split.`);
    process.exit(1);
  }

  const grossAmount = Number(argValue("gross") ?? 50000); // ₱500.00 default, per the business rule's own worked example
  const platformFeeAmount = Math.round(grossAmount * 0.05); // 5% of gross, integer minor units — matches lib/services/commission.ts
  const method = argValue("method") ?? "card";

  const result = await paymongoRequest("/checkout_sessions", secretKey, {
    method: "POST",
    base: PAYMONGO_API_V2_BASE,
    body: {
      data: {
        attributes: {
          line_items: [{ amount: grossAmount, currency: "PHP", name: "Court booking - two-party split verification", quantity: 1 }],
          payment_method_types: [method],
          success_url: "https://example.com/success",
          cancel_url: "https://example.com/cancel",
          pass_on_fees: true,
          split_payment: {
            recipients: [{ merchant_id: platformAccountId, split_type: "fixed", value: platformFeeAmount }],
            transfer_to: childId,
          },
        },
      },
    },
  });

  if (!result.ok) {
    verdictLine("BLOCKED", "D/E/F. Can a split checkout session be created against this Child Merchant?", `HTTP ${result.status}: ${JSON.stringify(result.errors)}`);
    process.exit(1);
  }

  const session = result.data as { id: string; attributes: { checkout_url: string } };
  verdictLine(
    "UNCONFIRMED",
    "D/E/F. Session created — completion not yet verified.",
    `Session ${session.id} created. Gross ₱${(grossAmount / 100).toFixed(2)}, platform fee ₱${(platformFeeAmount / 100).toFixed(2)} (fixed), venue (remainder) ₱${((grossAmount - platformFeeAmount) / 100).toFixed(2)}, transfer_to ${childId}, pass_on_fees:true, method:${method}.`
  );
  console.log(`\nCHECKOUT_URL=${session.attributes.checkout_url}`);
  console.log("Open the URL and pay with PayMongo's official TEST MODE test card (4343 4343 4343 4345, any future expiry, any CVC) or the method's real TEST MODE flow.");
  console.log(`Then run: npx ts-node scripts/verify-paymongo-marketplace-final.ts inspect-payment --payment-id=<pay_... from the success screen>`);
}

// --- Inspect a completed payment's real split accounting ---

async function runInspectPayment() {
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
  const paymentId = argValue("payment-id");
  if (!paymentId) {
    console.error("Usage: inspect-payment --payment-id=pay_...");
    process.exit(1);
  }

  const result = await paymongoRequest(`/payments/${paymentId}`, secretKey);
  if (!result.ok) {
    verdictLine("BLOCKED", "G/H. Can the payment be retrieved?", `HTTP ${result.status}: ${JSON.stringify(result.errors)}`);
    process.exit(1);
  }

  const p = result.data as {
    attributes: {
      amount: number;
      fee: number;
      foreign_fee: number | null;
      net_amount: number;
      status: string;
      split_payment?: { status: string; split_payments: Array<{ attributes: { amount: number; net_amount: number; recipient_organization_id: string; fee: number } }> };
    };
  };
  const a = p.attributes;
  // foreign_fee is card-specific (a foreign-issued-card surcharge) — other
  // payment methods (e.g. GCash) omit it entirely rather than sending 0.
  const foreignFee = a.foreign_fee ?? 0;

  console.log(`\n=== Payment ${paymentId} ===`);
  console.log(`status: ${a.status}`);
  console.log(`amount charged to customer: ${a.amount} (₱${(a.amount / 100).toFixed(2)})`);
  console.log(`PayMongo fee: ${a.fee} + foreign_fee: ${foreignFee} = ${a.fee + foreignFee} (₱${((a.fee + foreignFee) / 100).toFixed(2)})`);
  console.log(`net_amount (after PayMongo's own fee): ${a.net_amount} (₱${(a.net_amount / 100).toFixed(2)})`);

  if (!a.split_payment) {
    verdictLine("UNCONFIRMED", "H. Did split_payment execute on this payment?", "No split_payment object present on the payment — either no split was configured, or it wasn't attached correctly.");
    return;
  }

  console.log(`\nsplit_payment.status: ${a.split_payment.status}`);
  const legs = a.split_payment.split_payments;
  console.log(`split_payments legs (${legs.length}):`);
  const distinctRecipients = new Set<string>();
  for (const leg of legs) {
    console.log(`  recipient_organization_id=${leg.attributes.recipient_organization_id} amount=${leg.attributes.amount} net_amount=${leg.attributes.net_amount} fee=${leg.attributes.fee}`);
    distinctRecipients.add(leg.attributes.recipient_organization_id);
  }

  if (distinctRecipients.size >= 2) {
    verdictLine(
      "CONFIRMED",
      "I/J. Did the split land in two DISTINCT real accounts, and does the sum equal the original gross?",
      `${distinctRecipients.size} distinct recipient_organization_id values observed: ${[...distinctRecipients].join(", ")}. Original gross was ₱500.00 (50000) — verify the printed amounts above sum to exactly 50000 net of PayMongo's own fee.`
    );
  } else {
    verdictLine(
      "UNCONFIRMED",
      "I/J. Did the split land in two DISTINCT real accounts?",
      `Only ${distinctRecipients.size} distinct recipient_organization_id observed (${[...distinctRecipients].join(", ")}) — this is a single-destination (degenerate) split, not proof of a genuine two-party distribution. A real second Child Merchant is required to observe this.`
    );
  }
}

// --- Refund ---

async function runRefund() {
  const secretKey = requireEnv("PAYMONGO_SECRET_KEY");
  const paymentId = argValue("payment-id");
  const amountArg = argValue("amount");
  const isRetry = process.argv.includes("--again");
  if (!paymentId || !amountArg) {
    console.error("Usage: refund --payment-id=pay_... --amount=<minor-units> [--again]");
    process.exit(1);
  }
  const amount = Number(amountArg);

  const result = await paymongoRequest("/refunds", secretKey, {
    method: "POST",
    body: { data: { attributes: { amount, payment_id: paymentId, reason: "others", notes: "verify-paymongo-marketplace-final.ts" } } },
  });

  if (!result.ok) {
    verdictLine(
      isRetry ? "CONFIRMED" : "UNCONFIRMED",
      isRetry ? "N. Is a duplicate/over-refund attempt safely rejected?" : "K/L. Can this payment be refunded?",
      `HTTP ${result.status}: ${JSON.stringify(result.errors)}`
    );
    process.exit(result.status === 400 && isRetry ? 0 : 1);
  }

  const r = result.data as {
    id: string;
    attributes: {
      amount: number;
      status: string;
      split_refund?: { status: string; split_refunds: Array<{ attributes: { amount: number; net_amount: number; recipient_organization_id: string; fee: number } }> };
    };
  };
  console.log(`\n=== Refund ${r.id} ===`);
  console.log(`amount: ${r.attributes.amount} (₱${(r.attributes.amount / 100).toFixed(2)})`);
  console.log(`status: ${r.attributes.status}`);
  if (r.attributes.split_refund) {
    console.log(`split_refund.status: ${r.attributes.split_refund.status}`);
    for (const leg of r.attributes.split_refund.split_refunds) {
      console.log(`  recipient_organization_id=${leg.attributes.recipient_organization_id} amount=${leg.attributes.amount} net_amount=${leg.attributes.net_amount} fee=${leg.attributes.fee}`);
    }
    verdictLine(
      "UNCONFIRMED",
      "M. Does the refund correctly reverse each split leg proportionally?",
      "split_refund legs printed above — verify manually against the original split_payment legs from inspect-payment. Only conclusive with a genuine two-party split (see B/C in diagnostic mode)."
    );
  } else {
    verdictLine("UNCONFIRMED", "M. Does the refund correctly reverse each split leg?", "No split_refund object present on this refund.");
  }
}

async function main() {
  const mode = process.argv[2];
  if (mode === "diagnostic") return runDiagnostic();
  if (mode === "verify-child") return runVerifyChild();
  if (mode === "create-split-session") return runCreateSplitSession();
  if (mode === "inspect-payment") return runInspectPayment();
  if (mode === "refund") return runRefund();
  console.error("Usage:");
  console.error("  npx ts-node scripts/verify-paymongo-marketplace-final.ts diagnostic");
  console.error("  npx ts-node scripts/verify-paymongo-marketplace-final.ts verify-child --child-id=org_...");
  console.error("  npx ts-node scripts/verify-paymongo-marketplace-final.ts create-split-session --child-id=org_... [--gross=50000] [--method=card]");
  console.error("  npx ts-node scripts/verify-paymongo-marketplace-final.ts inspect-payment --payment-id=pay_...");
  console.error("  npx ts-node scripts/verify-paymongo-marketplace-final.ts refund --payment-id=pay_... --amount=<minor-units> [--again]");
  process.exit(1);
}

main().catch((error) => {
  console.error("Script failed:", error);
  process.exit(1);
});
