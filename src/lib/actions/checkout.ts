"use server";

import {
  createCheckoutSessionForUser,
  describeCheckoutError,
  type CheckoutSessionOutcome,
} from "@/lib/services/checkoutSession";
import { createBookingSchema, type CreateBookingValues } from "@/lib/validations/booking";
import { getSiteUrl } from "@/lib/site";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

/**
 * Creates a real, reserved (pending) booking and a real PayMongo Checkout
 * Session for it, then returns the URL to redirect the browser to.
 *
 * PayMongo is the only payment provider. Stripe was removed once PayMongo
 * became the platform's provider; `bookings.payment_provider` and the
 * dormant stripe_* columns remain so any historical row would still read
 * correctly, but nothing writes them.
 *
 * Ordering is deliberate and is the actual safety property of this whole
 * flow: the booking is created — and thus reserved via the
 * bookings_no_overlap exclusion constraint — *before* PayMongo is ever
 * contacted. If the database rejects the interval (already booked,
 * outside hours, whatever), no Checkout Session is created and nothing is
 * charged. If the booking succeeds but Checkout Session creation then
 * fails for any reason, the pending booking is cancelled immediately so
 * it doesn't sit there holding a slot nobody can actually pay for.
 *
 * Never create a session for a booking that wasn't successfully created
 * first — see ARCHITECTURE.md's Phase 4B section for why the reverse
 * ordering would risk charging for a slot the database refuses.
 *
 * AIR/Rally Credits sit between those two steps: the booking's price is
 * settled from the wallet first, and only the remainder — if any — is sent
 * to PayMongo. The whole split is recomputed server-side from the booking's
 * own price_amount and the wallet's own balance, so nothing about it can be
 * influenced by the client.
 *
 * The pipeline itself lives in lib/services/checkoutSession.ts, shared
 * with the mobile bearer-auth route (app/api/mobile/checkout) — this
 * action contributes cookie-session auth and the web's confirmation-page
 * redirects.
 */
export async function createCheckoutSessionAction(
  values: CreateBookingValues
): Promise<ActionResult<CheckoutSessionOutcome>> {
  const parsed = createBookingSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to book a court." };
  }

  const siteUrl = await getSiteUrl();

  try {
    const data = await createCheckoutSessionForUser(supabase, user.id, parsed.data, (bookingId) => {
      const confirmationUrl = `${siteUrl}/bookings/${bookingId}/confirmation`;
      return {
        successUrl: confirmationUrl,
        cancelUrl: `${confirmationUrl}?cancelled=true`,
        confirmationUrl,
      };
    });
    return { success: true, data };
  } catch (error) {
    return { success: false, error: describeCheckoutError(error) };
  }
}
