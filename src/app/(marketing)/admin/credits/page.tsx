import { redirect } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { getTotalOutstandingCredit } from "@/lib/services/credits";
import { BackLink } from "@/components/shared/BackLink";
import { AdminCreditUserSearch } from "@/components/admin/AdminCreditUserSearch";

// Real liability and per-request wallet state — never statically cached.
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Credits" };

function peso(minorUnits: number): string {
  return `₱${(minorUnits / 100).toLocaleString("en-PH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export default async function AdminCreditsPage() {
  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) redirect("/");

  const outstanding = await getTotalOutstandingCredit(supabase);

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 lg:px-8">
      <BackLink href="/admin" label="Admin" />

      <div>
        <h1 className="text-xl font-semibold text-foreground">Credits</h1>
        <p className="text-sm text-muted-foreground">Grant or deduct AIR/Rally Credits, and see what is outstanding.</p>
      </div>

      {/*
        The liability figure. Credits never expire, so this only falls when
        someone spends them — it is a real obligation, not a running total
        of generosity, and it belongs somewhere a person sees rather than
        in a query someone has to remember to run.
      */}
      <div className="flex items-center justify-between rounded-xl border border-border bg-accent px-4 py-4">
        <div className="flex items-center gap-3">
          <Wallet className="size-5 text-accent-foreground" aria-hidden="true" />
          <div>
            <p className="text-sm font-medium text-accent-foreground">Outstanding credit</p>
            <p className="text-xs text-accent-foreground/80">Unspent across every wallet. Credits do not expire.</p>
          </div>
        </div>
        <p className="text-2xl font-semibold tabular-nums text-accent-foreground">{peso(outstanding)}</p>
      </div>

      <div className="flex flex-col gap-2">
        <h2 className="text-sm font-semibold text-foreground">Find a player</h2>
        <AdminCreditUserSearch />
      </div>

      <p className="text-xs text-muted-foreground">
        Every adjustment is permanent and attributed to you. The ledger is append-only — corrections are made with an offsetting entry, never by editing
        history. See <Link href="/admin/payments" className="underline">Payment Monitoring</Link> for booking-side movements.
      </p>
    </div>
  );
}
