import { PESONET_BANKS, isPesonetBank } from "./pesonetBanks";
import { payoutPeriodFor } from "@/lib/services/venueLocalPeriods";

/**
 * Build the bulk-transfer CSV that gets uploaded to PayMongo's Send Money
 * screen, from an approved payout batch.
 *
 * WHY A CSV AND NOT AN .XLSX. PayMongo's upload accepts ".xlsx, .xls, or
 * .csv" (their own wording, from the live screen). CSV is chosen because it
 * removes an entire class of corruption: a spreadsheet editor will happily
 * reformat a long bank account number into scientific notation, or strip a
 * leading zero, and the person uploading would never see it. A CSV written
 * here and uploaded unopened cannot be silently rewritten on the way.
 */

/**
 * THE COLUMN HEADER PAYMONGO EXPECTS.
 *
 * ⚠️ UNVERIFIED BY THIS CODEBASE. The template workbook (pesonet_template.xlsx)
 * is NOT in this repo — only the bank list generated from its Banks tab. These
 * five strings come from the founder reading the template's transfer sheet, not
 * from anything here that can be re-checked. If an upload is rejected for a
 * header reason, THIS IS THE FIRST THING TO DOUBT: re-read a fresh template and
 * correct it here.
 *
 * "Remarks" carries no parenthetical. An earlier draft had "Remarks (optional)"
 * and that is wrong — the header is matched literally.
 */
export const PESONET_CSV_HEADER = [
  "Bank Name",
  "Bank Account Name",
  "Bank Account Number",
  "Amount",
  "Remarks",
] as const;

/**
 * PayMongo's bulk upload takes at most 1,000 transfer rows in one file.
 * Exceeding it produces a file that cannot be uploaded at all, so this
 * refuses to generate rather than handing over something unusable.
 */
export const PESONET_MAX_ROWS = 1000;

/**
 * The minimum a single PESONet BANK transfer may be, in CENTAVOS. ₱80.00.
 *
 * NOT THE ₱1 WALLET MINIMUM. PayMongo's wallet documents a ₱1 floor, which
 * applies to wallet-to-wallet movement and does NOT apply here — these are
 * bank payouts over PESONet. Using ₱1 would let a below-floor row through and
 * the whole file would be rejected on upload.
 *
 * ⚠️ The ₱80 figure is from PayMongo's documentation and has NOT been
 * confirmed by a live below-floor transfer, unlike the ₱10 fee which was
 * verified empirically (see transferFee.ts). Treat it as the best available
 * number rather than a measured one.
 */
export const PESONET_MIN_TRANSFER_CENTAVOS = 8000;

/** Shown wherever the export is offered. The upload screen defaults to the OTHER rail. */
export const PESONET_RAIL_WARNING =
  "Upload this with PESONet selected. InstaPay uses different bank names and every row will fail.";

export type PesonetExportVenue = {
  venueId: string;
  venueName: string;
  amount: number;
  bankName: string | null;
  bankAccountName: string | null;
  bankAccountNumber: string | null;
};

export type PesonetExportInput = {
  batchReference: string;
  venues: PesonetExportVenue[];
  /** Local dates of the settled bookings, for the Sunday–Saturday period label. */
  localDates: readonly string[];
};

export type PesonetExportResult = {
  filename: string;
  csv: string;
  rowCount: number;
  totalCentavos: number;
};

export class PesonetExportError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`This file was not generated:\n${problems.map((p) => `• ${p}`).join("\n")}`);
    this.name = "PesonetExportError";
    this.problems = problems;
  }
}

/** RFC4180 quoting. Bank account names contain commas often enough to matter. */
function csvCell(value: string): string {
  const needsQuote = /[",\r\n]/.test(value);
  const escaped = value.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

/**
 * Centavos to the pesos-with-decimals string the Amount column takes.
 * Never toFixed() on a float derived by division alone at scale — but at
 * these magnitudes (well under 2^53 centavos) integer division plus a padded
 * remainder is exact and obvious.
 */
function centavosToPesos(centavos: number): string {
  const sign = centavos < 0 ? "-" : "";
  const abs = Math.abs(centavos);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

export function pesonetFilename(batchReference: string, period: { from: string; to: string } | null): string {
  const span = period ? `${period.from}_to_${period.to}` : "no-period";
  // PESONET is in the name because the file is rail-specific and the upload
  // screen is not. Someone with two files open needs to tell them apart.
  return `PESONET_${batchReference}_${span}.csv`;
}

export function buildPesonetCsv(input: PesonetExportInput): PesonetExportResult {
  const problems: string[] = [];

  if (input.venues.length === 0) {
    problems.push("This batch has no venues to pay.");
  }

  if (input.venues.length > PESONET_MAX_ROWS) {
    problems.push(
      `${input.venues.length} transfers exceeds PayMongo's ${PESONET_MAX_ROWS}-row limit for one upload. Split this batch.`
    );
  }

  for (const v of input.venues) {
    const where = v.venueName || v.venueId;

    if (!v.bankName || !v.bankAccountName || !v.bankAccountNumber) {
      problems.push(`${where}: no bank details on file — nowhere to send this payout.`);
      continue;
    }

    // Character-for-character against PayMongo's own list. A name that is
    // merely close is rejected on upload, and finding out then means the
    // whole file failed rather than one row.
    if (!isPesonetBank(v.bankName)) {
      problems.push(
        `${where}: "${v.bankName}" is not a PESONet bank name PayMongo accepts. It must match one of the ${PESONET_BANKS.length} names exactly.`
      );
    }

    if (v.amount < PESONET_MIN_TRANSFER_CENTAVOS) {
      problems.push(
        `${where}: ₱${centavosToPesos(v.amount)} is below the ₱${centavosToPesos(
          PESONET_MIN_TRANSFER_CENTAVOS
        )} minimum for a bank transfer.`
      );
    }

    if (!Number.isInteger(v.amount) || v.amount <= 0) {
      problems.push(`${where}: ₱${centavosToPesos(v.amount)} is not a valid amount.`);
    }
  }

  if (problems.length > 0) {
    throw new PesonetExportError(problems);
  }

  const period = payoutPeriodFor(input.localDates);
  const periodLabel = period ? `${period.from} to ${period.to}` : input.batchReference;

  const rows = input.venues.map((v) =>
    [
      csvCell(v.bankName as string),
      csvCell(v.bankAccountName as string),
      csvCell(v.bankAccountNumber as string),
      csvCell(centavosToPesos(v.amount)),
      csvCell(`${input.batchReference} ${v.venueName} ${periodLabel}`.trim()),
    ].join(",")
  );

  return {
    filename: pesonetFilename(input.batchReference, period),
    // CRLF: the safest line ending across the spreadsheet tools that may open
    // this before it reaches PayMongo.
    csv: [PESONET_CSV_HEADER.join(","), ...rows].join("\r\n") + "\r\n",
    rowCount: rows.length,
    totalCentavos: input.venues.reduce((sum, v) => sum + v.amount, 0),
  };
}
