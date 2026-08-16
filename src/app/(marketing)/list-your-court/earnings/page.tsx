import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Earnings",
};

export default async function OwnerEarningsPage() {
  await requireSignedIn("/list-your-court/earnings");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Earnings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Payouts and settlement history for your venues.</p>
      </div>
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Earnings and payouts are coming with the PayMongo marketplace payments phase. In the meantime, see confirmed
        payments and refunds on each venue&apos;s own page.
      </p>
    </div>
  );
}
