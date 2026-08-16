import { Badge } from "@/components/ui/badge";
import type { RefundStatus } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type BookingRefundStatusProps = {
  status: RefundStatus;
  amount: number;
  currency: string;
};

/**
 * Customer-facing vocabulary only — deliberately coarser than the
 * internal RefundStatus. Never renders a raw PayMongo error code or
 * message (see lib/services/refunds.ts's failure_reason, which is
 * admin-only). "failed" and "provider_unavailable" both resolve to a
 * generic "contact support" instruction; the *reason* stays internal.
 */
const LABELS: Record<RefundStatus, string> = {
  pending: "Refund processing",
  provider_unavailable: "Refund unavailable — contact support",
  succeeded: "Refund completed",
  failed: "Refund unavailable — contact support",
};

const STYLES: Record<RefundStatus, string> = {
  pending: "bg-warning/15 text-warning",
  provider_unavailable: "bg-muted text-muted-foreground",
  succeeded: "bg-success/15 text-success",
  failed: "bg-muted text-muted-foreground",
};

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

export function BookingRefundStatus({ status, amount, currency }: BookingRefundStatusProps) {
  return (
    <div className="flex items-center gap-2 text-xs">
      <Badge className={cn("border-transparent", STYLES[status])}>{LABELS[status]}</Badge>
      {status === "succeeded" && <span className="text-muted-foreground">{formatMoney(amount, currency)}</span>}
    </div>
  );
}
