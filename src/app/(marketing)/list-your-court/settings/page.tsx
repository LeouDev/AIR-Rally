import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Clock, AlertTriangle, Link2Off } from "lucide-react";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listOwnerPaymentAccounts, describePaymentAccountStatus } from "@/lib/services/venuePaymentAccounts";
import type { VenuePaymentAccountStatus } from "@/lib/supabase/types";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner Settings",
};

const STATUS_ICONS: Record<VenuePaymentAccountStatus, typeof CheckCircle2> = {
  verified: CheckCircle2,
  pending_verification: Clock,
  restricted: AlertTriangle,
  disabled: AlertTriangle,
  not_connected: Link2Off,
};

const STATUS_TONES: Record<VenuePaymentAccountStatus, string> = {
  verified: "border-success/40 bg-success/5 text-success",
  pending_verification: "border-warning/40 bg-warning/5 text-warning",
  restricted: "border-destructive/40 bg-destructive/5 text-destructive",
  disabled: "border-destructive/40 bg-destructive/5 text-destructive",
  not_connected: "border-border bg-muted/40 text-muted-foreground",
};

export default async function OwnerSettingsPage() {
  await requireSignedIn("/list-your-court/settings");
  const supabase = await createClient();
  // RLS scopes these to venues this caller owns.
  const accounts = await listOwnerPaymentAccounts(supabase);

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-8 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Account-wide preferences for your venue business.</p>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-base font-semibold text-foreground">Payment setup</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Where AIR/Rally will send what you earn. One payment account per venue.
          </p>
        </div>

        {accounts.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
            Add a venue first — its payment account appears here once it exists.
          </p>
        ) : (
          <ul className="flex flex-col gap-4">
            {accounts.map((account) => {
              const copy = describePaymentAccountStatus(account.status);
              const Icon = STATUS_ICONS[account.status];
              return (
                <li key={account.id} className="rounded-2xl border border-border bg-card p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{account.venueName}</p>
                      <span
                        className={`mt-2 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium ${STATUS_TONES[account.status]}`}
                      >
                        <Icon className="size-3.5" aria-hidden />
                        {copy.title}
                      </span>
                      <p className="mt-2 max-w-xl text-sm text-muted-foreground">{copy.detail}</p>
                      {/* An admin-set reason is the one thing an owner can act
                          on, so it is shown rather than hidden behind support. */}
                      {account.status_reason && (
                        <p className="mt-2 max-w-xl text-sm text-muted-foreground">
                          <span className="font-medium text-foreground">Reason:</span> {account.status_reason}
                        </p>
                      )}
                      {account.status === "verified" && account.paymongo_account_id && (
                        <p className="mt-2 text-xs text-muted-foreground">PayMongo account: connected</p>
                      )}
                    </div>

                    {/* Links to the REAL onboarding flow that already exists on
                        the venue page, rather than a second placeholder button
                        that would do less than what is already built. */}
                    {(account.status === "not_connected" || account.status === "restricted") && (
                      <Link
                        href={`/list-your-court/${account.venue_id}`}
                        className="shrink-0 rounded-full bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
                      >
                        {account.status === "restricted" ? "Review setup" : "Set up payment account"}
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}

        <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-3 text-xs text-muted-foreground">
          Automatic payouts are not live yet. A verified account means you are ready for them; until then, transfers are arranged
          manually.
        </p>
      </section>
    </div>
  );
}
