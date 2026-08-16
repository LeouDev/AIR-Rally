import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { listCourtsByVenue } from "@/lib/services/courts";
import { getVenueForOwner } from "@/lib/services/venues";

type Client = SupabaseClient<Database>;

export type ReadinessStatus = "complete" | "action_required" | "pending_verification" | "not_applicable";

export type ReadinessItem = {
  key: string;
  label: string;
  status: ReadinessStatus;
  /** Plain-language explanation of the status, and what to do about it if not complete. */
  detail: string;
  /** Where the owner should go to fix this item — always the single venue management page today. */
  actionHref: string | null;
};

export type VenueReadiness = {
  venueId: string;
  /** True only when every item is "complete" or "not_applicable" — never inferred from the frontend alone. */
  isReady: boolean;
  items: ReadinessItem[];
};

/**
 * Server-side, database-derived venue readiness — the only source of
 * truth for "can this venue actually accept a real booking," never a
 * frontend-computed boolean. Every check here reads real stored state
 * (venues/courts/venue_operating_hours rows, and — only when PayMongo is
 * the active provider — venues.paymongo_activation_status); nothing is
 * invented beyond what the application already requires elsewhere (see
 * lib/validations/venue.ts / court.ts for the same field requirements
 * enforced at creation time — this just re-verifies them against the
 * live row, since those columns remain nullable at the database level).
 *
 * Deliberately does NOT include a "cancellation policy" item — no such
 * field or table exists anywhere in this schema. Inventing one here
 * would fail a real venue against a requirement the application itself
 * has never actually modeled.
 */
export async function getVenueReadiness(supabase: Client, venueId: string): Promise<VenueReadiness> {
  const venue = await getVenueForOwner(supabase, venueId);
  if (!venue) {
    return {
      venueId,
      isReady: false,
      items: [
        { key: "venue_exists", label: "Venue", status: "action_required", detail: "This venue could not be found.", actionHref: null },
      ],
    };
  }

  const courts = await listCourtsByVenue(supabase, venueId);
  const activeCourts = courts.filter((c) => c.status === "active");

  const { count: operatingHoursCount, error: hoursError } = await supabase
    .from("venue_operating_hours")
    .select("id", { count: "exact", head: true })
    .eq("venue_id", venueId);
  if (hoursError) throw hoursError;

  const actionHref = `/list-your-court/${venueId}`;
  const items: ReadinessItem[] = [];

  // 1. Business information — required at draft-creation time by
  // createVenueDraftSchema, but the columns are nullable at the database
  // level, so this re-checks the live row rather than assuming the form
  // was the only way the row was ever written.
  const hasBusinessInfo = Boolean(venue.name?.trim() && venue.description?.trim() && venue.phone?.trim() && venue.email?.trim());
  items.push({
    key: "business_info",
    label: "Venue business information",
    status: hasBusinessInfo ? "complete" : "action_required",
    detail: hasBusinessInfo
      ? "Name, description, phone, and email are all on file."
      : "Add your venue's name, description, phone number, and email.",
    actionHref: hasBusinessInfo ? null : actionHref,
  });

  // 2. Address/location
  const hasLocation = Boolean(venue.address?.trim() && venue.city?.trim() && venue.country?.trim());
  items.push({
    key: "location",
    label: "Venue address",
    status: hasLocation ? "complete" : "action_required",
    detail: hasLocation ? "Address, city, and country are all on file." : "Add your venue's street address, city, and country.",
    actionHref: hasLocation ? null : actionHref,
  });

  // 3. At least one active court
  const hasActiveCourt = activeCourts.length > 0;
  items.push({
    key: "courts",
    label: "Active courts",
    status: hasActiveCourt ? "complete" : "action_required",
    detail: hasActiveCourt
      ? `${activeCourts.length} active court${activeCourts.length === 1 ? "" : "s"}.`
      : courts.length > 0
        ? "You have courts, but none are marked active — activate at least one court."
        : "Add at least one court.",
    actionHref: hasActiveCourt ? null : actionHref,
  });

  // 4. Court pricing — the create/update court form allows hourlyPrice as
  // low as 0 (a shape-validation minimum, not a business one); a $0
  // court can never generate a real charge, so it can't be "ready."
  const unpricedActiveCourts = activeCourts.filter((c) => !(Number(c.hourly_price) > 0));
  const hasPricing = activeCourts.length > 0 && unpricedActiveCourts.length === 0;
  items.push({
    key: "court_pricing",
    label: "Court pricing",
    status: activeCourts.length === 0 ? "action_required" : hasPricing ? "complete" : "action_required",
    detail:
      activeCourts.length === 0
        ? "Add an active court first."
        : hasPricing
          ? "All active courts have a price set."
          : `${unpricedActiveCourts.length} active court${unpricedActiveCourts.length === 1 ? "" : "s"} still ${unpricedActiveCourts.length === 1 ? "has" : "have"} no price (or ₱0) set.`,
    actionHref: hasPricing ? null : actionHref,
  });

  // 5. Operating hours — zero rows means every day shows as closed (see
  // ARCHITECTURE.md's Phase 4A availability model), i.e. the venue can
  // never actually be booked regardless of anything else being complete.
  const hasOperatingHours = (operatingHoursCount ?? 0) > 0;
  items.push({
    key: "operating_hours",
    label: "Operating hours",
    status: hasOperatingHours ? "complete" : "action_required",
    detail: hasOperatingHours ? "At least one open window is configured." : "Set at least one open day/time window — with none set, every day shows as closed and no booking can ever be made.",
    actionHref: hasOperatingHours ? null : actionHref,
  });

  // 6. Platform approval — the existing draft/pending_review/active/
  // suspended gate (see venues_prevent_status_escalation), not something
  // new invented for this checklist.
  items.push({
    key: "platform_approval",
    label: "Platform approval",
    status: venue.status === "active" ? "complete" : venue.status === "pending_review" ? "pending_verification" : "action_required",
    detail:
      venue.status === "active"
        ? "Your venue is live on the marketplace."
        : venue.status === "pending_review"
          ? "Submitted for review — AIR/Rally will approve or follow up soon."
          : "Your venue is still in draft. Submit it for review when the rest of this checklist is complete.",
    actionHref: venue.status === "active" ? null : actionHref,
  });

  // 7. PayMongo onboarding — only enforced when PayMongo is actually the
  // active payment provider (see ARCHITECTURE.md's PayMongo Platforms
  // section). A venue that only ever takes Stripe payments must never be
  // blocked on a PayMongo-specific requirement.
  const paymongoIsActiveProvider = process.env.ACTIVE_PAYMENT_PROVIDER === "paymongo";
  if (paymongoIsActiveProvider) {
    const status = venue.paymongo_activation_status;
    items.push({
      key: "paymongo_onboarding",
      label: "PayMongo payouts",
      status: status === "activated" ? "complete" : status === "pending" || status === "under_review" ? "pending_verification" : "action_required",
      detail:
        status === "activated"
          ? "PayMongo is connected — this venue can receive its share of split payments automatically."
          : status === "pending" || status === "under_review"
            ? "PayMongo verification is in progress."
            : status === "declined"
              ? (venue.paymongo_declined_reason ?? "PayMongo declined this account during review.")
              : "Connect PayMongo so this venue can receive payouts.",
      actionHref: status === "activated" ? null : actionHref,
    });
  } else {
    items.push({
      key: "paymongo_onboarding",
      label: "PayMongo payouts",
      status: "not_applicable",
      detail: "Stripe is the active payment provider — PayMongo onboarding isn't required.",
      actionHref: null,
    });
  }

  const isReady = items.every((item) => item.status === "complete" || item.status === "not_applicable");

  return { venueId, isReady, items };
}
