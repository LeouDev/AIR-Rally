"use server";

import { revalidatePath } from "next/cache";
import { createReview, ReviewError } from "@/lib/services/reviews";
import { createReviewSchema, type CreateReviewValues } from "@/lib/validations/review";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Review } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function submitReviewAction(values: CreateReviewValues): Promise<ActionResult<Review>> {
  const parsed = createReviewSchema.safeParse(values);
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
    return { success: false, error: "Sign in to write a review." };
  }

  try {
    const review = await createReview(supabase, user.id, parsed.data);
    revalidatePath(`/courts/${parsed.data.venueId}`);
    return { success: true, data: review };
  } catch (error) {
    if (error instanceof ReviewError) {
      logServerError(`review.submit.${error.reason}`, error);
      return { success: false, error: error.message };
    }
    logServerError("review.submit", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't submit your review.") };
  }
}
