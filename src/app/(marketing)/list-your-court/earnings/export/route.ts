import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listOwnerSettlements } from "@/lib/services/settlements";
import { toCsv } from "@/lib/csv";

export const dynamic = "force-dynamic";

/** Minor units (centavos) -> a plain decimal number, never a formatted currency string a spreadsheet can't sum. */
function toMajorUnits(minorUnits: number): number {
  return Math.round(minorUnits) / 100;
}

/**
 * CSV export for "further analytics" (the founder's own phrase) — real
 * row-level data, not the aggregate cards the earnings page already
 * shows. Reuses listOwnerSettlements() as-is; RLS is what scopes this to
 * the signed-in owner's own venues, same trust boundary that function's
 * own doc comment already establishes for the page that renders it.
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

  const supabase = await createClient();
  const settlements = await listOwnerSettlements(supabase);

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
    ])
  );

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="air-rally-earnings-${new Date().toISOString().slice(0, 10)}.csv"`,
    },
  });
}
