import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { cancelBooking, BookingError } from "@/lib/services/bookings";
import { cancelBookingSchema } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";

/**
 * Mobile twin of cancelBookingAction (lib/actions/booking.ts) — bearer
 * auth instead of cookies, same cancelBooking() service underneath, so
 * every policy it enforces (credit-funded confirmed bookings are final,
 * started bookings can't be cancelled, compensation is decided and issued
 * server-side) holds identically. The credit decision travels back so the
 * app can state what happened to the customer's money.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
} as const;

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createBearerClient(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401, headers: CORS_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const parsed = cancelBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ success: false, error: "Please try again." }, { status: 400, headers: CORS_HEADERS });
  }

  try {
    const { booking, credit } = await cancelBooking(supabase, user.id, parsed.data.bookingId);
    return NextResponse.json({ success: true, data: { booking, credit } }, { headers: CORS_HEADERS });
  } catch (error) {
    if (error instanceof BookingError) {
      logServerError(`booking.cancel.${error.reason}`, error);
      return NextResponse.json({ success: false, error: error.message }, { headers: CORS_HEADERS });
    }
    logServerError("booking.cancel", error);
    return NextResponse.json(
      { success: false, error: getFriendlyErrorMessage(error, "We couldn't cancel that booking.") },
      { headers: CORS_HEADERS }
    );
  }
}
