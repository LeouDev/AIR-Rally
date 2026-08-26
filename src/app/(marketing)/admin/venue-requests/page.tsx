import { notFound, redirect } from "next/navigation";
import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/services/admin";
import { listVenueDemand, listUnlinkedVenueRequests, listMergeTargetVenues } from "@/lib/services/adminVenueRequests";
import { getSiteUrl } from "@/lib/site";
import { VenueDemandRow } from "@/components/admin/VenueDemandRow";
import { UnlinkedVenueRequestRow } from "@/components/admin/UnlinkedVenueRequestRow";
import { BackLink } from "@/components/shared/BackLink";

// Live admin data — same convention as the other admin pages (see
// admin/venues/page.tsx).
export const dynamic = "force-dynamic";

export const metadata: Metadata = { title: "Venue Requests" };

export default async function AdminVenueRequestsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login?redirect=/admin/venue-requests");

  const supabase = await createClient();
  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) notFound();

  const [demand, unlinked, mergeTargets, siteUrl] = await Promise.all([
    listVenueDemand(supabase),
    listUnlinkedVenueRequests(supabase),
    listMergeTargetVenues(supabase),
    getSiteUrl(),
  ]);

  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <div className="mb-4">
        <BackLink href="/admin" label="Back to moderation dashboard" />
      </div>
      <h1 className="text-2xl font-semibold text-foreground">Venue Requests</h1>
      <p className="mt-1 text-muted-foreground">
        Courts players have asked for. A request is someone asking — not a booking, and not a
        promise they&apos;ll book once it lists.
      </p>

      {unlinked.length > 0 && (
        <div className="mt-8 rounded-2xl border border-warning/40 bg-warning/10 p-4">
          <h2 className="text-sm font-semibold text-foreground">Not linked to a real venue yet</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            These players get <strong>no notification</strong> when the venue lists, unless you
            link their request to it here.
          </p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted-foreground">
                  <th className="pb-2 font-medium">Place</th>
                  <th className="pb-2 pr-4 text-right font-medium">Asked</th>
                  <th className="pb-2 font-medium">Merge</th>
                </tr>
              </thead>
              <tbody>
                {unlinked.map((row) => (
                  <UnlinkedVenueRequestRow
                    key={`${row.placeName}-${row.placeCity}`}
                    row={row}
                    targets={mergeTargets}
                  />
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="mt-8 overflow-x-auto rounded-2xl border border-border bg-card p-4">
        {demand.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No venue requests yet.</p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th className="pb-2 pr-4 font-medium">Venue</th>
                <th className="pb-2 pr-4 text-right font-medium">Demand</th>
                <th className="pb-2 pr-4 font-medium">Status</th>
                <th className="pb-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {demand.map((row) => (
                <VenueDemandRow key={row.sampleRequestId} row={row} siteUrl={siteUrl} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
