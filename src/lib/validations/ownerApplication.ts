import { z } from "zod";
import { phoneRegex } from "@/lib/validations/shared";

export const submitOwnerApplicationSchema = z.object({
  businessName: z.string().trim().min(2, "Enter your name or business name").max(120),
  businessPhone: z.string().trim().regex(phoneRegex, "Enter a valid phone number"),
  businessEmail: z.email("Enter a valid email address"),
  venueName: z.string().trim().min(2, "Enter your venue's name").max(120),
  venueAddress: z.string().trim().min(1, "Enter a street address").max(200),
  venueCity: z.string().trim().min(1, "Enter a city").max(100),
  venueDescription: z.string().trim().max(2000).optional(),
  // Paired with `register("courtCount", { valueAsNumber: true })` so
  // react-hook-form converts the input value before validation — same
  // reasoning createVenueDraftSchema's numberOfCourts field documents.
  courtCount: z.number().int().min(1, "Must have at least 1 court").max(100),
});
export type SubmitOwnerApplicationValues = z.infer<typeof submitOwnerApplicationSchema>;

/** Field groups per wizard step, for gating "Next" via react-hook-form's trigger(fields). */
export const OWNER_APPLICATION_STEP_FIELDS = [
  ["businessName", "businessPhone", "businessEmail"],
  ["venueName", "venueAddress", "venueCity", "venueDescription"],
  ["courtCount"],
] as const satisfies readonly (readonly (keyof SubmitOwnerApplicationValues)[])[];
