import Link from "next/link";
import type {
  OwnerSettlementSummary,
  SettlementRow,
} from "@/lib/services/settlements";
import type {
  PayoutBatchStatus,
  SettlementSource,
  SettlementStatus,
} from "@/lib/supabase/types";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import { cn } from "@/lib/utils";

const COUNT_LABELS: Record<string, string> = {
  "10": "10",
  "20": "20",
  "50": "50",
  all: "All",
};

const SOURCE_LABELS: Record<SettlementSource, string> = {
  paymongo: "PayMongo",
  credit: "AIR/Rally Credits",
  mixed: "Mixed",
};

const STATUS_LABELS: Record<SettlementStatus, string> = {
  pending: "Pending",
  payable: "Available",
  settled: "Paid",
  reversed: "Reversed",
  on_hold: "On hold",
};

const STATUS_STYLES: Record<SettlementStatus, string> = {
  pending: "bg-warning/15 text-warning",
  payable: "bg-success/15 text-success",
  settled: "bg-success/15 text-success",
  reversed: "bg-muted text-muted-foreground",
  on_hold: "bg-destructive/10 text-destructive",
};

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-PH", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

function SummaryCard({
  label,
  amount,
  currency,
  hint,
  muted,
}: {
  label: string;
  amount: number;
  currency: string;
  hint: string;
  muted?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card p-6">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={`mt-1 text-2xl font-semibold ${muted ? "text-muted-foreground" : "text-foreground"}`}
      >
        {formatSettlementMoney(amount, currency)}
      </dd>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SettlementPanel({
  summary,
  rows,
  totalCount,
  activeCount,
  countOptions,
  buildCountHref,
  batchBySettlement,
}: {
  summary: OwnerSettlementSummary;
  rows: SettlementRow[];
  /** How many settlements this owner has in total, independent of how many `rows` were fetched. */
  totalCount: number;
  /** Which row-count option is currently selected ("10" | "20" | "50" | "all"). */
  activeCount: string;
  countOptions: readonly string[];
  buildCountHref: (option: string) => string;
  /** Live payout batches covering this owner's settlements, keyed by settlement id. */
  batchBySettlement: Map<
    string,
    { reference: string; status: PayoutBatchStatus }
  >;
}) {
  const batchedCount = rows.filter((r) =>
    batchBySettlement.has(r.settlementId),
  ).length;
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Settlements</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What you have earned from confirmed bookings, whether the player paid
          with PayMongo or AIR/Rally Credits.
        </p>
      </div>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Pending"
          amount={summary.pending}
          currency={summary.currency}
          hint="Booked and paid for, court time still to come."
        />
        <SummaryCard
          label="Available"
          amount={summary.available}
          currency={summary.currency}
          hint="Court time delivered — earned and awaiting payout."
        />
        <SummaryCard
          label="Paid"
          amount={summary.paid}
          currency={summary.currency}
          hint="Payouts are not running yet, so this stays at zero."
          muted
        />
      </dl>

      {/* Payout status, stated plainly. Never says "paid" — that word is
          reserved for settlements that genuinely reached 'settled', which
          nothing can currently do. */}
      <div className="rounded-2xl border border-border bg-card p-5">
        <p className="text-sm font-medium text-foreground">Payout status</p>
        {summary.available > 0 ? (
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-semibold text-foreground">
              {formatSettlementMoney(summary.available, summary.currency)}
            </span>{" "}
            payable — awaiting payout processing.
            {batchedCount > 0 &&
              ` ${batchedCount} settlement(s) are already in a payout batch.`}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted-foreground">
            Nothing is payable yet. Earnings become payable once the booked
            court time has been played.
          </p>
        )}
        <p className="mt-2 text-xs text-muted-foreground">
          Automatic payouts are not live yet — transfers are arranged manually
          in the meantime.
        </p>
      </div>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No settlements yet. They appear here once a booking at your venue is
          confirmed.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              Showing {rows.length} of {totalCount} settlement
              {totalCount === 1 ? "" : "s"}
            </p>
            <div className="inline-flex w-fit rounded-lg border border-border bg-muted/40 p-1">
              {countOptions.map((option) => (
                <Link
                  key={option}
                  href={buildCountHref(option)}
                  className={cn(
                    "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                    activeCount === option
                      ? "bg-card text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  {COUNT_LABELS[option] ?? option}
                </Link>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto rounded-2xl border border-border bg-card">
            <table className="w-full min-w-[56rem] text-sm">
              <thead className="border-b border-border text-left text-xs text-muted-foreground">
                <tr>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Date
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Venue
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Court
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Booking date
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Gross
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    Platform fee
                  </th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">
                    You earn
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Paid with
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Status
                  </th>
                  <th scope="col" className="px-4 py-3 font-medium">
                    Payout
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((row) => (
                  <tr key={row.settlementId}>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(row.recordedAt)}
                    </td>
                    <td className="px-4 py-3 text-foreground">
                      {row.venueName}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {row.courtName ?? "—"}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {formatDate(row.bookingStartTime)}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      {formatSettlementMoney(
                        row.grossBookingAmount,
                        row.currency,
                      )}
                    </td>
                    <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                      −{formatSettlementMoney(row.platformFee, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                      {formatSettlementMoney(row.venueAmount, row.currency)}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">
                      {SOURCE_LABELS[row.settlementSource]}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.settlementStatus]}`}
                      >
                        {STATUS_LABELS[row.settlementStatus]}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {batchBySettlement.get(row.settlementId)?.reference ??
                        "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
