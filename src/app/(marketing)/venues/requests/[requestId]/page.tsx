import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MapPin } from "lucide-react";
import { getPublicVenueRequestSummaryAction } from "@/lib/actions/venueRequests";
import { Button } from "@/components/ui/button";
import Link from "next/link";

/**
 * The artifact both readers of this feature get: a player shares this right
 * after submitting a request ("I asked my venue to join"), and the founder
 * shares the same link from the admin demand view. One page, two senders,
 * because it's the same claim regardless of who sends it.
 *
 * NO SESSION REQUIRED, DELIBERATELY. The actual reader is a venue manager who
 * has never heard of AIR/Rally and has no account — that's the entire point,
 * per the founder's own framing. Every call here goes through
 * getPublicVenueRequestSummaryAction(), which reaches
 * public_venue_request_summary() (migration 20260810000106), the one
 * function in this feature granted to `anon`.
 *
 * Keyed on the request's own id (a UUID, not enumerable) rather than a venue
 * id or a slug — most requests are free text with no venue row yet, and an
 * id exists from the moment a player submits, which is what makes the
 * player-share half of this feature possible at all.
 */
export const dynamic = "force-dynamic";

// Never indexed. Same reasoning as the ranked match pages this pattern will
// follow: a page describing a business that hasn't signed up shouldn't be
// searchable, independent of the (separate) privacy reasoning that keeps
// requester identities off it entirely. See migration 20260810000106's
// header for the full framing.
export const metadata: Metadata = {
  title: "A court requested on AIR/Rally",
  robots: { index: false, follow: false },
};

export default async function VenueRequestSummaryPage({
  params,
}: {
  params: Promise<{ requestId: string }>;
}) {
  const { requestId } = await params;
  const result = await getPublicVenueRequestSummaryAction(requestId);

  if (!result.success || !result.data) notFound();
  const { displayName, city, requesters, showCount } = result.data;

  // "Asked for you", never "will book" — a request is a claim, not a
  // commitment, and this is the artifact most likely to be read as a
  // promise. Below the threshold of 5, there is deliberately no number and
  // no player-facing "we'll tell you when it lists" line — that sentence is
  // addressed to the submitter, not the venue manager who is the actual
  // reader of a shared link.
  const headline = showCount
    ? `${requesters} player${requesters === 1 ? "" : "s"}${city ? ` in ${city}` : ""} ${
        requesters === 1 ? "has" : "have"
      } asked to book your courts on AIR/Rally.`
    : `Players${city ? ` in ${city}` : ""} are asking for your courts on AIR/Rally.`;

  return (
    <div className="mx-auto flex max-w-lg flex-col gap-6 px-4 py-16 text-center sm:px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <MapPin className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">{displayName}</h1>
        {city && <p className="text-sm text-muted-foreground">{city}</p>}
      </div>

      <p className="text-lg text-foreground">{headline}</p>

      <p className="text-sm text-muted-foreground">
        AIR/Rally is a pickleball booking app. Listing your courts is free — players
        already looking for you can find and book you directly.
      </p>

      <Button asChild size="lg">
        <Link href="/list-your-court">List your courts on AIR/Rally</Link>
      </Button>
    </div>
  );
}
