"use server";

import { revalidatePath } from "next/cache";
import { createBooking, cancelBooking, BookingError } from "@/lib/services/bookings";
import { createBookingSchema, cancelBookingSchema, type CreateBookingValues, type CancelBookingValues } from "@/lib/validations/booking";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Booking } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function createBookingAction(values: CreateBookingValues): Promise<ActionResult<Booking>> {
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

  try {
    const booking = await createBooking(supabase, user.id, {
      courtId: parsed.data.courtId,
      startTime: parsed.data.startTime,
      endTime: parsed.data.endTime,
    });
    revalidatePath("/bookings");
    return { success: true, data: booking };
  } catch (error) {
    if (error instanceof BookingError) {
      logServerError(`booking.create.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("booking.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't create that booking.") };
  }
}

export async function cancelBookingAction(values: CancelBookingValues): Promise<ActionResult<Booking>> {
  const parsed = cancelBookingSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  try {
    const booking = await cancelBooking(supabase, user.id, parsed.data.bookingId);
    revalidatePath("/bookings");
    return { success: true, data: booking };
  } catch (error) {
    if (error instanceof BookingError) {
      logServerError(`booking.cancel.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("booking.cancel", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't cancel that booking.") };
  }
}
