import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getOwnerSettlementsForExport } from "@/lib/services/settlements";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Minor units (centavos) -> a plain decimal number, never a formatted currency string a spreadsheet can't sum. */
function toMajorUnits(minorUnits: number): number {
  return Math.round(minorUnits) / 100;
}

// Same shape a <input type="date"> ever submits, matching the earnings
// page's own validation — a malformed or partial pair is treated as no
// range at all rather than guessed at.
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/**
 * CSV export for "further analytics" (the founder's own phrase) — real
 * row-level data, not the aggregate cards the earnings page already
 * shows. Calls getOwnerSettlementsForExport(), not listOwnerSettlements()
 * — that function's default limit exists for the on-page table's small
 * display sizes, and silently capped this export at 100 rows before an
 * owner with more history than that ever noticed. RLS is what scopes this
 * to the signed-in owner's own venues either way.
 *
 * A route handler, not a Server Action returning a string for the client
 * to blob-and-download — this is a plain GET a <a href> can point at
 * directly, so the browser handles the download natively rather than
 * needing client-side JS to construct one.
 *
 * NOT requireSignedIn(): that calls next/navigation's redirect(), which
 * is built for a Server Component/Action render tree that catches its
 * thrown NEXT_REDIRECT signal — a plain Route Handler is outside that
 * tree. The one existing route handler in this codebase that redirects
 * (src/app/auth/callback/route.ts) uses NextResponse.redirect(), a real
 * Response object, not that function — matched here rather than assumed
 * to also work.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getCurrentUser();
  if (!user) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("redirect", "/list-your-court/earnings");
    return NextResponse.redirect(loginUrl);
  }

  const url = new URL(request.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  const hasRange = Boolean(
    from && to && DATE_ONLY.test(from) && DATE_ONLY.test(to) && from <= to,
  );

  const supabase = await createClient();
  const {
    rows: settlements,
    totalMatching,
    truncated,
  } = await getOwnerSettlementsForExport(
    supabase,
    user.id,
    hasRange ? { dateRange: { from: from!, to: to! } } : {},
  );

  const csv = toCsv(
    [
      "confirmation_code",
      "venue",
      "court",
      "booking_start_time",
      "recorded_at",
      "currency",
      "gross_amount",
      "platform_fee",
      "venue_amount",
      "status",
    ],
    settlements.map((s) => [
      s.confirmationCode,
      s.venueName,
      s.courtName,
      s.bookingStartTime,
      s.recordedAt,
      s.currency,
      toMajorUnits(s.grossBookingAmount),
      toMajorUnits(s.platformFee),
      toMajorUnits(s.venueAmount),
      s.settlementStatus,
    ]),
  );

  // A truncated file must say so in the one place a plain download link
  // can: its own name. Silence here is exactly the bug this replaces —
  // an export that stops early with nothing on screen to contradict it.
  const rangeSuffix = hasRange ? `-${from}-to-${to}` : "";
  const truncationSuffix = truncated
    ? `-first-${settlements.length}-of-${totalMatching}`
    : "";
  const filename = `air-rally-earnings-${new Date().toISOString().slice(0, 10)}${rangeSuffix}${truncationSuffix}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
