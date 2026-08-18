import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { retrievePayMongoCheckoutSession } from "@/lib/services/paymongo";
import { PAYMONGO_EXPIRY_SWEEP_CHECK_AFTER_MINUTES } from "@/lib/booking-config";
import { logServerError } from "@/lib/errors";

/**
 * Called every 5 minutes by pg_cron (see supabase/migrations/
 * 20260810000065_paymongo_aware_expiry_sweep.sql). The counterpart to
 * expire_stale_pending_bookings(), which only ever touches bookings with
 * no PayMongo session attached — this is the half that does, and it must
 * never cancel one on elapsed time alone: it asks PayMongo directly.
 *
 * Fails toward NOT cancelling. If PayMongo is unreachable, or errors for
 * a specific booking, that booking is skipped and retried on the next
 * run — never cancelled on the strength of a failed check. The original
 * bug this route exists to fix was exactly the opposite instinct (cancel
 * first, find out later), and repeating that instinct here for
 * "PayMongo didn't answer" would be the same mistake in a new place.
 */
export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.EXPIRE_PAYMONGO_BOOKINGS_WEBHOOK_SECRET;
  if (!expectedSecret) {
    logServerError("expirePaymongoBookings", new Error("EXPIRE_PAYMONGO_BOOKINGS_WEBHOOK_SECRET isn't set"));
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-webhook-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createServiceRoleClient();
  const cutoff = new Date(Date.now() - PAYMONGO_EXPIRY_SWEEP_CHECK_AFTER_MINUTES * 60_000).toISOString();

  const { data: candidates, error } = await supabase
    .from("bookings")
    .select("id, paymongo_checkout_session_id")
    .eq("status", "pending")
    .not("paymongo_checkout_session_id", "is", null)
    .lt("created_at", cutoff);

  if (error) {
    logServerError("expirePaymongoBookings.query", error);
    return NextResponse.json({ error: "Query failed" }, { status: 500 });
  }

  let expired = 0;
  let keptInFlight = 0;
  let checkFailed = 0;

  for (const booking of candidates ?? []) {
    if (!booking.paymongo_checkout_session_id) continue; // narrows the type; the query already excludes null
    try {
      const session = await retrievePayMongoCheckoutSession(booking.paymongo_checkout_session_id);
      const payments = session.attributes.payment_intent?.attributes.payments ?? [];
      // Same definition reconcilePaymongoPendingBooking() uses: any
      // attempt that hasn't definitively failed counts as still possibly
      // live. "No payment_intent at all" (the customer never even
      // started paying) correctly falls through to an empty array here.
      const hasNonFailedAttempt = payments.some((p) => p.attributes.status !== "failed");

      if (hasNonFailedAttempt) {
        keptInFlight += 1;
        continue;
      }

      const { data: didExpire, error: rpcError } = await supabase.rpc("expire_specific_pending_booking", {
        p_booking_id: booking.id,
      });
      if (rpcError) {
        logServerError("expirePaymongoBookings.rpc", rpcError);
        continue;
      }
      if (didExpire) expired += 1;
    } catch (checkError) {
      checkFailed += 1;
      logServerError("expirePaymongoBookings.checkFailed", checkError);
    }
  }

  return NextResponse.json({ candidates: candidates?.length ?? 0, expired, keptInFlight, checkFailed });
}
