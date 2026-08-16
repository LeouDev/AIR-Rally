"use server";

import { revalidatePath } from "next/cache";
import {
  createReschedule,
  resumeRescheduleCheckout,
  getRescheduleEligibility,
  getRescheduleOptions,
  RescheduleError,
  type RescheduleResult,
  type RescheduleOptions,
} from "@/lib/services/reschedules";
import { BookingError } from "@/lib/services/bookings";
import { PaymentError } from "@/lib/services/payments";
import { PayMongoError } from "@/lib/services/paymongo";
import { RefundError } from "@/lib/services/refunds";
import { createRescheduleSchema, resumeRescheduleSchema, type CreateRescheduleValues } from "@/lib/validations/reschedule";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getSiteUrl } from "@/lib/site";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

const DOMAIN_ERRORS = [RescheduleError, BookingError, PaymentError, PayMongoError, RefundError];

function isDomainError(error: unknown): error is InstanceType<(typeof DOMAIN_ERRORS)[number]> {
  return DOMAIN_ERRORS.some((ErrorClass) => error instanceof ErrorClass);
}

/**
 * Same "must a slot become active" ordering the service itself follows:
 * the replacement is created and, if the financial step succeeds,
 * atomically swapped in for the original — this action only ever
 * surfaces the *outcome* of that (already-atomic) transition, never
 * performs any of it itself.
 */
export async function createRescheduleAction(values: CreateRescheduleValues): Promise<ActionResult<RescheduleResult>> {
  const parsed = createRescheduleSchema.safeParse(values);
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
    return { success: false, error: "Sign in to reschedule a booking." };
  }

  try {
    const siteUrl = await getSiteUrl();
    const result = await createReschedule(supabase, user.id, {
      bookingId: parsed.data.bookingId,
      newCourtId: parsed.data.newCourtId,
      newStartTime: parsed.data.newStartTime,
      newEndTime: parsed.data.newEndTime,
      reason: parsed.data.reason ?? null,
      siteUrl,
      customerEmail: user.email,
    });
    revalidatePath("/bookings");
    return { success: true, data: result };
  } catch (error) {
    if (isDomainError(error)) {
      logServerError(`reschedule.create.${error instanceof RescheduleError || error instanceof BookingError || error instanceof RefundError ? error.reason : "provider_error"}`, error);
      return { success: false, error: error.message };
    }
    logServerError("reschedule.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't reschedule that booking.") };
  }
}

export async function resumeRescheduleCheckoutAction(rescheduleId: string): Promise<ActionResult<{ checkoutUrl: string }>> {
  const parsed = resumeRescheduleSchema.safeParse({ rescheduleId });
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
    return { success: false, error: "Sign in to continue this reschedule." };
  }

  try {
    const siteUrl = await getSiteUrl();
    const checkoutUrl = await resumeRescheduleCheckout(supabase, user.id, parsed.data.rescheduleId, {
      siteUrl,
      customerEmail: user.email,
    });
    return { success: true, data: { checkoutUrl } };
  } catch (error) {
    if (isDomainError(error)) {
      logServerError("reschedule.resume", error);
      return { success: false, error: error.message };
    }
    logServerError("reschedule.resume", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't continue that reschedule.") };
  }
}

export async function getRescheduleEligibilityAction(bookingId: string): Promise<ActionResult<{ eligible: boolean; reason?: string; message?: string }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to check reschedule eligibility." };
  }

  const eligibility = await getRescheduleEligibility(supabase, user.id, bookingId);
  if (eligibility.eligible) {
    return { success: true, data: { eligible: true } };
  }
  return { success: true, data: { eligible: false, reason: eligibility.reason, message: eligibility.message } };
}

/**
 * Combined "is this booking reschedulable, and if so what are the options"
 * call for the reschedule dialog — one round trip rather than two, since
 * the dialog needs both before it can render anything useful.
 */
export async function getRescheduleDialogDataAction(
  bookingId: string
): Promise<ActionResult<{ eligible: boolean; reason?: string; message?: string; options: RescheduleOptions | null }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Sign in to reschedule a booking." };
  }

  const eligibility = await getRescheduleEligibility(supabase, user.id, bookingId);
  if (!eligibility.eligible) {
    return { success: true, data: { eligible: false, reason: eligibility.reason, message: eligibility.message, options: null } };
  }

  const options = await getRescheduleOptions(supabase, user.id, bookingId);
  return { success: true, data: { eligible: true, options } };
}
