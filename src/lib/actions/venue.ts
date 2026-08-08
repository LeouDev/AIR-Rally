"use server";

import { revalidatePath } from "next/cache";
import { createDraftVenue } from "@/lib/services/venues";
import { createVenueDraftSchema, type CreateVenueDraftValues } from "@/lib/validations/venue";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import type { Venue } from "@/lib/supabase/types";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";

export async function createVenueDraftAction(values: CreateVenueDraftValues): Promise<ActionResult<Venue>> {
  const parsed = createVenueDraftSchema.safeParse(values);
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
    return { success: false, error: "Sign in to list your court." };
  }

  try {
    const venue = await createDraftVenue(supabase, user.id, parsed.data);
    revalidatePath("/list-your-court");
    return { success: true, data: venue };
  } catch (error) {
    logServerError("venue.createDraft", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't save your venue.") };
  }
}
