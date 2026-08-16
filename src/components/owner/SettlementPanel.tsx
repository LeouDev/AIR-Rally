import type { OwnerSettlementSummary, SettlementRow } from "@/lib/services/settlements";
import type { SettlementSource, SettlementStatus } from "@/lib/supabase/types";
import { formatSettlementMoney } from "@/lib/settlementFormat";

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
  return new Date(iso).toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" });
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
      <dd className={`mt-1 text-2xl font-semibold ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {formatSettlementMoney(amount, currency)}
      </dd>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

export function SettlementPanel({ summary, rows }: { summary: OwnerSettlementSummary; rows: SettlementRow[] }) {
  return (
    <div className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">Settlements</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          What you have earned from confirmed bookings, whether the player paid with PayMongo or AIR/Rally Credits.
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

      {/* Said plainly rather than left for an owner to wonder about: they
          can see what they have earned, and payouts are a later phase. */}
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
        Automatic payouts are not live yet. These figures show what AIR/Rally owes you; transfers are arranged manually in the
        meantime.
      </p>

      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
          No settlements yet. They appear here once a booking at your venue is confirmed.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[56rem] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">Date</th>
                <th scope="col" className="px-4 py-3 font-medium">Venue</th>
                <th scope="col" className="px-4 py-3 font-medium">Court</th>
                <th scope="col" className="px-4 py-3 font-medium">Booking date</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Gross</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">Platform fee</th>
                <th scope="col" className="px-4 py-3 text-right font-medium">You earn</th>
                <th scope="col" className="px-4 py-3 font-medium">Paid with</th>
                <th scope="col" className="px-4 py-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.settlementId}>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(row.recordedAt)}</td>
                  <td className="px-4 py-3 text-foreground">{row.venueName}</td>
                  <td className="px-4 py-3 text-muted-foreground">{row.courtName ?? "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{formatDate(row.bookingStartTime)}</td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    {formatSettlementMoney(row.grossBookingAmount, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-muted-foreground">
                    −{formatSettlementMoney(row.platformFee, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-right font-medium tabular-nums text-foreground">
                    {formatSettlementMoney(row.venueAmount, row.currency)}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{SOURCE_LABELS[row.settlementSource]}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLES[row.settlementStatus]}`}>
                      {STATUS_LABELS[row.settlementStatus]}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
