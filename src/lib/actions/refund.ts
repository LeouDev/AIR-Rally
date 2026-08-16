"use server";

import { revalidatePath } from "next/cache";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import { getBookingById } from "@/lib/services/bookings";
import { requestRefund, RefundError } from "@/lib/services/refunds";
import { requireAdmin } from "@/lib/services/admin";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { BookingRefund } from "@/lib/supabase/types";

/**
 * Admin-only, server-side only — never reachable by a customer or venue
 * owner directly. The RLS policies on booking_refunds already enforce
 * this at the database layer too (insert/update require is_admin()), but
 * checking here first means a non-admin gets a clean error instead of a
 * raw RLS-denial-shaped Postgres error, and means we never even attempt
 * a real Stripe/PayMongo API call for an unauthorized request.
 */
export async function refundBookingAction(bookingId: string, amount: number, reason?: string): Promise<ActionResult<BookingRefund>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) {
    return { success: false, error: adminCheck.error };
  }

  try {
    const booking = await getBookingById(supabase, bookingId);
    if (!booking) {
      return { success: false, error: "We couldn't find that booking." };
    }

    const refund = await requestRefund(supabase, { booking, amount, reason: reason ?? null, initiatedBy: adminCheck.userId });
    revalidatePath("/admin/payments");
    return { success: true, data: refund };
  } catch (error) {
    if (error instanceof RefundError) {
      logServerError(`refund.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("refund.requestFailed", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't process that refund.") };
  }
}
