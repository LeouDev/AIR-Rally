import Link from "next/link";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/shared/EmptyState";
import { BackLink } from "@/components/shared/BackLink";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { getUserCreditBalance, listCreditTransactions } from "@/lib/services/credits";
import {
  withRunningBalance,
  creditEntryLabel,
  formatCreditAmount,
  formatCreditBalance,
} from "@/lib/creditHistory";

export const metadata: Metadata = { title: "AIR/Rally Credits" };

// Per-viewer wallet state — never statically cached.
export const dynamic = "force-dynamic";

export default async function CreditsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/profile/credits");

  const supabase = await createClient();
  const [{ balance }, transactions] = await Promise.all([
    getUserCreditBalance(supabase, user.id),
    listCreditTransactions(supabase, user.id),
  ]);

  const entries = withRunningBalance(transactions, balance);

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6 px-4 py-8 sm:px-6 lg:px-8">
      <BackLink href="/profile" label="Profile" />

      {/* The balance is the wallet's own figure, never re-summed from the
          ledger below. Checkout spends against this number; a second
          calculation here would eventually disagree with it, and the
          customer would be the one to notice. */}
      <section className="flex flex-col items-center gap-1 rounded-xl bg-secondary px-6 py-8 text-center text-secondary-foreground">
        <p className="text-[0.6875rem]/[0.875rem] font-semibold tracking-[0.12em] text-muted-foreground uppercase">
          AIR/Rally Credits
        </p>
        <p className="font-mono text-4xl/[2.75rem] font-semibold tracking-[-0.02em]">
          {formatCreditBalance(balance)}
        </p>
        <Button asChild size="lg" className="mt-4 w-full sm:w-auto">
          <Link href="/explore">Book a court</Link>
        </Button>
      </section>

      {/* Both facts are true and both are reasons to hold credit rather than
          feel short-changed, so they sit next to the balance rather than in
          fine print at the bottom. */}
      <ul className="flex flex-col gap-2.5 rounded-xl bg-card p-4 shadow-card">
        <li className="flex gap-2.5 text-[0.9375rem]/[1.375rem] text-foreground">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
          <span>
            <strong className="font-semibold">Credits never expire.</strong> They stay on your account
            until you use them.
          </span>
        </li>
        <li className="flex gap-2.5 text-[0.9375rem]/[1.375rem] text-foreground">
          <span aria-hidden="true" className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
          <span>
            <strong className="font-semibold">No payment fee.</strong> Book with credits and the online
            payment fee doesn&apos;t apply.
          </span>
        </li>
      </ul>

      <section className="flex flex-col gap-3">
        <h2 className="text-xl/[1.625rem] font-semibold text-foreground">History</h2>

        {entries.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title="No credits yet"
            description="You'll see credits here if a booking is cancelled. They never expire, and they cover the online payment fee."
            action={
              <Button asChild>
                <Link href="/explore">Explore courts</Link>
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {entries.map((entry) => {
              const row = (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.9375rem]/[1.375rem] font-medium text-foreground">
                      {creditEntryLabel(entry)}
                    </span>
                    <span
                      className={
                        entry.amount < 0
                          ? "font-mono text-[0.9375rem]/[1.375rem] font-semibold text-foreground"
                          : "font-mono text-[0.9375rem]/[1.375rem] font-semibold text-success"
                      }
                    >
                      {formatCreditAmount(entry.amount)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
                      {new Intl.DateTimeFormat("en-US", { dateStyle: "medium" }).format(
                        new Date(entry.created_at)
                      )}
                    </span>
                    <span className="font-mono text-[0.8125rem]/[1.125rem] text-muted-foreground">
                      Balance {formatCreditBalance(entry.runningBalance)}
                    </span>
                  </div>
                </>
              );

              return (
                <li key={entry.id}>
                  {entry.reference_id ? (
                    <Link
                      href={`/bookings/${entry.reference_id}/confirmation`}
                      className="flex flex-col gap-1 rounded-lg bg-card p-3.5 shadow-card transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
                    >
                      {row}
                    </Link>
                  ) : (
                    <div className="flex flex-col gap-1 rounded-lg bg-card p-3.5 shadow-card">{row}</div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
