/**
 * ONE-OFF CAPABILITY PROBE — sends a small LIVE transfer to an account YOU
 * OWN, to find out whether PayMongo's transfer rail actually works.
 *
 * This is NOT a venue payout and must never be used as one. It exists
 * because PayMongo provisioned no test-mode wallet for this account, so the
 * sandbox suite in Phase 11 cannot run and the only remaining way to learn
 * whether `POST /v2/batch_transfers` works is to send one real transfer.
 *
 * ── WHY THIS IS A SCRIPT AND NOT PART OF THE APP ─────────────────────────
 *
 * lib/services/providers/paymongoTransfers.ts still refuses every call and
 * still reports `implemented: false`. AIR/Rally itself remains incapable of
 * moving money. Only this file, run deliberately from a terminal with two
 * explicit environment flags and a typed confirmation, can send anything.
 * Keeping the capability out of the application is the point.
 *
 * ── WHY IT DOES NOT WRITE TO payout_transfers ────────────────────────────
 *
 * A row in payout_transfers means "we paid a venue for a settlement". This
 * transfer pays nobody and settles nothing — recording it there would put a
 * lie in the financial ledger. It writes a local audit file instead.
 *
 * ── IRREVERSIBLE ─────────────────────────────────────────────────────────
 *
 * PayMongo documents no reversal or cancellation endpoint for transfers.
 * Once sent, it is sent. Send only to an account you control.
 *
 * Usage:
 *   # 1. Read-only. Shows your wallets and balances. Sends nothing.
 *   node -r ts-node/register scripts/paymongo-live-self-transfer.ts --check
 *
 *   # 2. Assembles the exact request and prints it. Sends nothing.
 *   node -r ts-node/register scripts/paymongo-live-self-transfer.ts --dry-run \
 *     --amount 80 --to 1234567890 --name "Your Name" --bank instapay
 *
 *   # 3. The real thing. Requires both flags and a typed confirmation.
 *   PAYMONGO_TRANSFERS_ENABLED=true PAYMONGO_TRANSFERS_ALLOW_LIVE=true \
 *     node -r ts-node/register scripts/paymongo-live-self-transfer.ts --send \
 *     --amount 80 --to 1234567890 --name "Your Name" --bank instapay \
 *     --i-understand-this-is-irreversible
 */
import { randomUUID } from "crypto";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { createInterface } from "readline";
import path from "path";

const API = "https://api.paymongo.com";
/** PayMongo's documented floor for a bank payout. Anything less is rejected. */
const MIN_CENTAVOS = 8000;
/** Our own ceiling for a probe. This is not a payout run. */
const MAX_CENTAVOS = 10000;

const AUDIT_DIR = path.join(process.cwd(), ".paymongo-audit");
const AUDIT_FILE = path.join(AUDIT_DIR, "live-self-transfers.json");

type AuditRecord = {
  referenceNumber: string;
  amountCentavos: number;
  destinationAccount: string;
  destinationName: string;
  provider: string;
  /** 'attempted' means we sent something and do not yet know the outcome. */
  status: "attempted" | "succeeded" | "failed";
  providerTransferId: string | null;
  requestBody: unknown;
  responseStatus: number | null;
  responseBody: unknown;
  sentAt: string;
};

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : undefined;
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

function requireSecretKey(): string {
  const key = process.env.PAYMONGO_SECRET_KEY;
  if (!key) {
    console.error("PAYMONGO_SECRET_KEY is not set.");
    process.exit(1);
  }
  return key;
}

function authHeader(key: string): string {
  // Basic auth is base64 of "key:" — passing the raw key does NOT
  // authenticate (verified: it returns 401 invalid authorization token).
  return `Basic ${Buffer.from(`${key}:`).toString("base64")}`;
}

function readAudit(): AuditRecord[] {
  if (!existsSync(AUDIT_FILE)) return [];
  try {
    return JSON.parse(readFileSync(AUDIT_FILE, "utf8")) as AuditRecord[];
  } catch {
    return [];
  }
}

function writeAudit(records: AuditRecord[]): void {
  if (!existsSync(AUDIT_DIR)) mkdirSync(AUDIT_DIR, { recursive: true });
  writeFileSync(AUDIT_FILE, JSON.stringify(records, null, 2));
}

function peso(centavos: number): string {
  return `₱${(centavos / 100).toFixed(2)}`;
}

async function checkWallets(key: string): Promise<void> {
  console.log("Reading wallets (read-only — nothing is sent)…\n");
  const response = await fetch(`${API}/v2/wallets/`, { headers: { Authorization: authHeader(key) } });
  const body = await response.text();
  console.log(`HTTP ${response.status}`);
  console.log(body);

  if (response.ok) {
    console.log(
      "\nUse the wallet's account number as the SOURCE. If this list is empty, this key's mode has no wallet and nothing can be sent."
    );
  }
}

/**
 * Builds the exact request body. Kept separate from sending so --dry-run
 * and --send are provably assembling the same thing.
 */
function buildRequestBody(params: {
  sourceNumber: string;
  sourceName: string;
  destinationNumber: string;
  destinationName: string;
  amountCentavos: number;
  provider: string;
  referenceNumber: string;
}) {
  return {
    transfers: [
      {
        // bic "PAEYPHM2XXX" identifies PayMongo itself, per their reference.
        source_account: { number: params.sourceNumber, name: params.sourceName, bic: "PAEYPHM2XXX" },
        destination_account: { number: params.destinationNumber, name: params.destinationName, bic: "PAEYPHM2XXX" },
        amount: params.amountCentavos,
        currency: "PHP",
        provider: params.provider,
        // Generated ONCE and reused on any retry. PayMongo documents no
        // Idempotency-Key for transfers, so this is the only thing standing
        // between a retry and a double payment.
        reference_number: params.referenceNumber,
        purpose: "capability_test",
        description: "AIR/Rally transfer capability probe — self-transfer",
      },
    ],
  };
}

async function confirmInteractively(summary: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question(`${summary}\n\nType exactly SEND LIVE MONEY to proceed: `, resolve);
  });
  rl.close();
  return answer.trim() === "SEND LIVE MONEY";
}

async function main(): Promise<void> {
  const key = requireSecretKey();
  const isLiveKey = key.startsWith("sk_live");

  if (flag("check")) {
    await checkWallets(key);
    return;
  }

  const amountPesos = Number(arg("amount") ?? "0");
  const amountCentavos = Math.round(amountPesos * 100);
  const destinationNumber = arg("to");
  const destinationName = arg("name");
  const provider = arg("bank") ?? "instapay";
  const sourceNumber = arg("from");
  const sourceName = arg("from-name") ?? destinationName;

  if (!destinationNumber || !destinationName) {
    console.error("--to and --name are required. Run with --check first to see your wallet.");
    process.exit(1);
  }
  if (amountCentavos < MIN_CENTAVOS || amountCentavos > MAX_CENTAVOS) {
    console.error(
      `--amount must be between ${peso(MIN_CENTAVOS)} and ${peso(MAX_CENTAVOS)}. PayMongo's documented minimum bank payout is ${peso(MIN_CENTAVOS)}; the ceiling is ours, because this is a probe and not a payout.`
    );
    process.exit(1);
  }

  const existing = readAudit();
  const unresolved = existing.find((r) => r.status === "attempted");
  if (unresolved) {
    // The double-payment guard. An attempt whose outcome we never learned
    // must be looked up at PayMongo before anything else is sent.
    console.error(
      `Refusing: a previous attempt (reference ${unresolved.referenceNumber}, ${peso(unresolved.amountCentavos)}) has an unknown outcome.\n` +
        `Look it up at PayMongo before sending anything else — retrying blindly could send twice.\n` +
        `Audit file: ${AUDIT_FILE}`
    );
    process.exit(1);
  }

  const referenceNumber = `airrally-probe-${randomUUID().slice(0, 12)}`;
  const body = buildRequestBody({
    sourceNumber: sourceNumber ?? "<SOURCE — pass --from with your wallet account number>",
    sourceName: sourceName ?? destinationName,
    destinationNumber,
    destinationName,
    amountCentavos,
    provider,
    referenceNumber,
  });

  if (flag("dry-run") || !flag("send")) {
    console.log("DRY RUN — nothing will be sent.\n");
    console.log(`POST ${API}/v2/batch_transfers`);
    console.log(`Authorization: Basic <base64 of ${key.slice(0, 8)}…:>`);
    console.log("Content-Type: application/json\n");
    console.log(JSON.stringify(body, null, 2));
    console.log(`\nMode: ${isLiveKey ? "LIVE KEY — this would move real money" : "test key"}`);
    if (!sourceNumber) {
      console.log("\nNo --from given. Run --check to find your wallet's account number, then pass it as --from.");
    }
    console.log("\nReview every field, especially destination_account.number. Then re-run with --send.");
    return;
  }

  // --- The real send. Every guard below must pass. ---
  if (process.env.PAYMONGO_TRANSFERS_ENABLED !== "true") {
    console.error("Refusing: PAYMONGO_TRANSFERS_ENABLED is not 'true'.");
    process.exit(1);
  }
  if (isLiveKey && process.env.PAYMONGO_TRANSFERS_ALLOW_LIVE !== "true") {
    console.error(
      "Refusing: this is a LIVE key and PAYMONGO_TRANSFERS_ALLOW_LIVE is not 'true'.\n" +
        "This second flag exists so enabling live money movement is always a separate, deliberate act."
    );
    process.exit(1);
  }
  if (!flag("i-understand-this-is-irreversible")) {
    console.error("Refusing: pass --i-understand-this-is-irreversible. PayMongo documents no way to reverse a transfer.");
    process.exit(1);
  }
  if (!sourceNumber) {
    console.error("Refusing: --from is required for a real send. Run --check to find your wallet's account number.");
    process.exit(1);
  }

  const confirmed = await confirmInteractively(
    [
      "",
      "──────────────────────────────────────────────",
      `  Sending   ${peso(amountCentavos)}`,
      `  From      ${sourceNumber}`,
      `  To        ${destinationNumber} (${destinationName})`,
      `  Rail      ${provider}`,
      `  Reference ${referenceNumber}`,
      `  Key       ${isLiveKey ? "LIVE — REAL MONEY" : "test"}`,
      "──────────────────────────────────────────────",
      "",
      "This cannot be reversed. Confirm the destination is an account YOU own.",
    ].join("\n")
  );

  if (!confirmed) {
    console.log("Aborted. Nothing was sent.");
    return;
  }

  // Record BEFORE sending. If this process dies mid-request, the reference
  // survives on disk and the outcome can be looked up rather than guessed.
  const record: AuditRecord = {
    referenceNumber,
    amountCentavos,
    destinationAccount: destinationNumber,
    destinationName,
    provider,
    status: "attempted",
    providerTransferId: null,
    requestBody: body,
    responseStatus: null,
    responseBody: null,
    sentAt: new Date().toISOString(),
  };
  writeAudit([...existing, record]);
  console.log(`\nRecorded attempt ${referenceNumber} before sending. Audit: ${AUDIT_FILE}\n`);

  let responseStatus: number | null = null;
  let responseBody: unknown = null;
  try {
    const response = await fetch(`${API}/v2/batch_transfers`, {
      method: "POST",
      headers: { Authorization: authHeader(key), "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    responseStatus = response.status;
    const text = await response.text();
    try {
      responseBody = JSON.parse(text);
    } catch {
      responseBody = text;
    }

    console.log(`HTTP ${responseStatus}`);
    console.log(JSON.stringify(responseBody, null, 2));
  } catch (error) {
    // A network failure is the worst case: the request may or may not have
    // arrived. The record stays 'attempted' precisely so nobody retries.
    console.error("\nRequest failed at the network level. The transfer may or may not have reached PayMongo.");
    console.error("DO NOT retry. Look the reference up in the PayMongo dashboard first.");
    console.error(error);
    process.exit(1);
  }

  const providerTransferId =
    typeof responseBody === "object" && responseBody !== null && "data" in responseBody
      ? ((responseBody as { data?: { id?: string } }).data?.id ?? null)
      : null;

  const resolved: AuditRecord = {
    ...record,
    // 2xx means PayMongo accepted it; the transfer itself still starts as
    // 'pending' and its true outcome arrives later by webhook.
    status: responseStatus !== null && responseStatus >= 200 && responseStatus < 300 ? "succeeded" : "failed",
    providerTransferId,
    responseStatus,
    responseBody,
  };
  writeAudit([...existing, resolved]);

  console.log(`\nAudit updated: ${AUDIT_FILE}`);
  console.log(
    resolved.status === "succeeded"
      ? "\nAccepted. Note the transfer itself starts as 'pending' — acceptance is not proof it landed. Watch the dashboard or a payout.deposited webhook."
      : "\nRejected. Nothing moved. The response above says why."
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
