import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import {
  createReschedule,
  getRescheduleEligibility,
  getRescheduleOptions,
  RescheduleError,
} from "@/lib/services/reschedules";
import { BookingError } from "@/lib/services/bookings";
import { RefundError } from "@/lib/services/refunds";
import { createRescheduleSchema } from "@/lib/validations/reschedule";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";

/**
 * Rescheduling for the mobile app. Bearer-authenticated like the sibling
 * checkout/cancel routes, and running the SAME service the web action
 * runs — the V1 rules (24h cutoff, same venue only, duration fixed, one
 * reschedule per booking) are deliberately not restated here, because a
 * second copy of them is a second thing to drift.
 *
 * GET  — eligibility plus the picker's options, so the app never has to
 *        re-derive who may reschedule what.
 * POST — performs it. The result is one of three shapes the app must
 *        handle: `completed` (nothing more owed), `checkout_required`
 *        (the new slot costs more; a PayMongo URL comes back for the
 *        difference), or `provider_unavailable`.
 *
 * The original booking is never cancelled until the financial step has
 * actually succeeded — that ordering lives in createReschedule() and is
 * the whole safety property of the feature.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
} as const;

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

async function authenticate(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) return null;

  const supabase = createBearerClient(token);
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser(token);
  if (error || !user) return null;
  return { supabase, user };
}

export async function GET(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: "Sign in to reschedule a booking." },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const bookingId = new URL(request.url).searchParams.get("bookingId") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(bookingId)) {
    return NextResponse.json(
      { success: false, error: "Please try again." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const eligibility = await getRescheduleEligibility(auth.supabase, auth.user.id, bookingId);
    if (!eligibility.eligible) {
      // Not an error: "you can't reschedule this, and here's the plain
      // reason" is a perfectly good answer for the UI to render.
      return NextResponse.json(
        { success: true, data: { eligible: false, message: eligibility.message, options: null } },
        { headers: CORS_HEADERS }
      );
    }

    const options = await getRescheduleOptions(auth.supabase, auth.user.id, bookingId);
    return NextResponse.json(
      { success: true, data: { eligible: true, message: null, options } },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    logServerError("mobile.reschedule.options", error);
    return NextResponse.json(
      { success: false, error: getFriendlyErrorMessage(error, "We couldn't load reschedule options.") },
      { headers: CORS_HEADERS }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  const auth = await authenticate(request);
  if (!auth) {
    return NextResponse.json(
      { success: false, error: "Sign in to reschedule a booking." },
      { status: 401, headers: CORS_HEADERS }
    );
  }

  const body = await request.json().catch(() => null);
  const parsed = createRescheduleSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Please fix the errors below and try again." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  try {
    const siteUrl = await getSiteUrl();
    const result = await createReschedule(auth.supabase, auth.user.id, {
      bookingId: parsed.data.bookingId,
      newCourtId: parsed.data.newCourtId,
      newStartTime: parsed.data.newStartTime,
      newEndTime: parsed.data.newEndTime,
      reason: parsed.data.reason ?? null,
      siteUrl,
      customerEmail: auth.user.email,
    });

    // Only the parts the app actually renders — the full service result
    // carries whole booking rows the client has no use for.
    return NextResponse.json(
      {
        success: true,
        data: {
          kind: result.kind,
          newBookingId: result.newBooking.id,
          checkoutUrl: result.kind === "checkout_required" ? result.checkoutUrl : null,
        },
      },
      { headers: CORS_HEADERS }
    );
  } catch (error) {
    if (error instanceof RescheduleError || error instanceof BookingError || error instanceof RefundError) {
      logServerError(`mobile.reschedule.${error.reason}`, error);
      return NextResponse.json({ success: false, error: error.message }, { headers: CORS_HEADERS });
    }
    logServerError("mobile.reschedule.create", error);
    return NextResponse.json(
      { success: false, error: getFriendlyErrorMessage(error, "We couldn't reschedule that booking.") },
      { headers: CORS_HEADERS }
    );
  }
}
