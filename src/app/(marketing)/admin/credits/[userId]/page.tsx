import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getUserCreditBalance, listCreditTransactionsAsAdmin } from "@/lib/services/credits";
import { BackLink } from "@/components/shared/BackLink";
import { CreditAdjustForm } from "@/components/admin/CreditAdjustForm";
import type { CreditTransactionType } from "@/lib/supabase/types";

// Live wallet state, read per request — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Player Credits" };

type PageProps = { params: Promise<{ userId: string }> };

function peso(minorUnits: number): string {
  const sign = minorUnits < 0 ? "−" : "";
  return `${sign}₱${(Math.abs(minorUnits) / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Plain-language labels — the raw enum values leak implementation into an operational screen. */
const TYPE_LABELS: Record<CreditTransactionType, string> = {
  cancellation_compensation: "Cancellation refund",
  admin_adjustment: "Manual adjustment",
  promotion_bonus: "Promotion",
  booking_payment: "Spent on a booking",
  account_deletion_forfeiture: "Forfeited on account deletion",
  // Not "refund" — no cash moved. QR Ph (the only payment method AIR/Rally
  // accepts) can't be refunded through PayMongo at all; this credit is the
  // actual compensation for a cheaper-slot reschedule, not a receipt for a
  // real refund. See the qrph-is-the-only-payment-method memory.
  reschedule_compensation: "Reschedule compensation",
};

export default async function AdminUserCreditsPage({ params }: PageProps) {
  const { userId } = await params;
  const supabase = await createClient();

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) redirect("/");

  // public_profiles, not profiles — profiles' RLS is read-your-own-row, so
  // a direct query returns nothing for anyone but the viewer and would
  // render as "player not found" for every real case.
  const { data: profile } = await supabase.from("public_profiles").select("*").eq("id", userId).maybeSingle();
  if (!profile) notFound();

  const [{ balance }, transactions] = await Promise.all([
    getUserCreditBalance(supabase, userId),
    listCreditTransactionsAsAdmin(supabase, userId, 100),
  ]);

  const displayName = profile.display_name || "Player";

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <BackLink href="/admin/credits" label="Credits" />

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-foreground">{displayName}</h1>
          <p className="text-xs text-muted-foreground">Current AIR/Rally Credits balance</p>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-foreground">{peso(balance)}</p>
      </div>

      <CreditAdjustForm userId={userId} displayName={displayName} />

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">History</h2>

        {transactions.length === 0 ? (
          <p className="rounded-xl border border-border px-4 py-6 text-center text-sm text-muted-foreground">
            No credit has ever moved for this player.
          </p>
        ) : (
          <ul className="flex flex-col divide-y divide-border rounded-xl border border-border">
            {transactions.map((t) => (
              <li key={t.id} className="flex items-start justify-between gap-4 px-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-foreground">{TYPE_LABELS[t.transaction_type] ?? t.transaction_type}</p>
                  {t.description && <p className="truncate text-xs text-muted-foreground">{t.description}</p>}
                  <p className="text-xs text-muted-foreground">
                    {new Intl.DateTimeFormat("en-PH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(t.created_at))}
                    {/* Attribution matters most on manual adjustments — the
                        others are system-generated and have no actor by
                        design, so an absent one there is not missing data. */}
                    {t.actor_id ? " · by an admin" : t.transaction_type === "admin_adjustment" ? " · actor not recorded" : ""}
                  </p>
                </div>
                <p className={`shrink-0 text-sm font-semibold tabular-nums ${t.amount < 0 ? "text-destructive" : "text-success"}`}>
                  {t.amount > 0 ? "+" : ""}
                  {peso(t.amount)}
                </p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
