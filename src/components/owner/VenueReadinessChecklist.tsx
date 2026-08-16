import Link from "next/link";
import { CheckCircle2, AlertCircle, Clock } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { VenueReadiness, ReadinessStatus } from "@/lib/services/venueReadiness";

type VenueReadinessChecklistProps = {
  readiness: VenueReadiness;
};

/**
 * Purely a display of the server-computed VenueReadiness result (see
 * lib/services/venueReadiness.ts) — this component never recomputes
 * readiness itself. "not_applicable" items are hidden entirely rather
 * than shown as a confusing extra row (e.g. PayMongo onboarding when
 * Stripe is the active provider).
 */
export function VenueReadinessChecklist({ readiness }: VenueReadinessChecklistProps) {
  const visibleItems = readiness.items.filter((item) => item.status !== "not_applicable");

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-base">Setup checklist</CardTitle>
          {readiness.isReady ? (
            <Badge variant="default">Ready for bookings</Badge>
          ) : (
            <Badge variant="secondary">Setup incomplete</Badge>
          )}
        </div>
        <CardDescription>
          {readiness.isReady
            ? "Everything required is in place."
            : "Complete every item below before this venue can accept real customer bookings."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="flex flex-col divide-y divide-border">
          {visibleItems.map((item) => (
            <li key={item.key} className="flex items-start gap-3 py-3 first:pt-0 last:pb-0">
              <StatusIcon status={item.status} />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{item.label}</p>
                  <StatusBadge status={item.status} />
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">{item.detail}</p>
              </div>
              {item.actionHref && item.status !== "complete" && (
                <Link href={item.actionHref} className="shrink-0 text-sm font-medium text-primary hover:underline">
                  Fix
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function StatusIcon({ status }: { status: ReadinessStatus }) {
  if (status === "complete") return <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-success" aria-hidden="true" />;
  if (status === "pending_verification") return <Clock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />;
  return <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />;
}

function StatusBadge({ status }: { status: ReadinessStatus }) {
  switch (status) {
    case "complete":
      return <Badge variant="default">Complete</Badge>;
    case "pending_verification":
      return <Badge variant="secondary">Pending verification</Badge>;
    case "action_required":
      return <Badge variant="destructive">Action required</Badge>;
    default:
      return null;
  }
}
