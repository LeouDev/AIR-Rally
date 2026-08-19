import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { createCheckoutSessionForUser, describeCheckoutError } from "@/lib/services/checkoutSession";
import { createBookingSchema } from "@/lib/validations/booking";
import { getSiteUrl } from "@/lib/site";

/**
 * The mobile app's one required call into this Next.js server (see the
 * mobile repo's src/lib/checkout.ts): everything else the app does goes
 * straight to Supabase under RLS, but a PayMongo Checkout Session needs
 * the secret key, so it must be created here.
 *
 * Auth is a Supabase access token as a bearer header — no cookies. The
 * token is verified with auth.getUser() before anything runs, and the
 * same pipeline as the web checkout action executes under the user's own
 * RLS (lib/services/checkoutSession.ts).
 *
 * Redirects differ from the web's: PayMongo sends the customer's in-app
 * browser to /payment-return, a public page that immediately deep-links
 * back into the app (airrally://payment-return), where the app polls the
 * booking row itself. The booking id rides along; the outcome flag only
 * picks the message shown if the deep link fails.
 *
 * The response envelope mirrors ActionResult: { success, data | error },
 * HTTP 200 for business-rule failures (slot taken, venue closed), with
 * non-200 reserved for malformed requests (400) and failed auth (401).
 */
/**
 * Bearer-only auth means no cookies ride on these requests, so a
 * wildcard origin exposes nothing — it exists for the Expo app's web
 * target (localhost:8081 in dev), which preflights the cross-origin
 * Authorization header. Native fetch never sends a preflight at all.
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
    return NextResponse.json({ success: false, error: "Sign in to book a court." }, { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createBearerClient(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ success: false, error: "Sign in to book a court." }, { status: 401, headers: CORS_HEADERS });
  }

  const body = await request.json().catch(() => null);
  const parsed = createBookingSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { success: false, error: "Please fix the errors below and try again." },
      { status: 400, headers: CORS_HEADERS }
    );
  }

  // NOT getSiteUrl() alone: that helper prefers the request's `Origin`
  // header, which is correct for a same-origin server action but wrong
  // here. This return URL must point at the deployment that actually
  // serves /payment-return, and the caller does not get to decide that.
  // The Expo web target is a real browser and sends its own origin
  // (localhost:8081), which serves no such route; native fetch sends no
  // Origin at all, so production only works today by accident.
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? (await getSiteUrl());

  try {
    const data = await createCheckoutSessionForUser(supabase, user.id, parsed.data, (bookingId) => {
      const returnUrl = (outcome: "success" | "cancelled") =>
        `${siteUrl}/payment-return?bookingId=${bookingId}&outcome=${outcome}`;
      return {
        successUrl: returnUrl("success"),
        cancelUrl: returnUrl("cancelled"),
        confirmationUrl: returnUrl("success"),
      };
    });
    return NextResponse.json({ success: true, data }, { headers: CORS_HEADERS });
  } catch (error) {
    return NextResponse.json({ success: false, error: describeCheckoutError(error) }, { headers: CORS_HEADERS });
  }
}
