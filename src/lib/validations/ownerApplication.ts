import { z } from "zod";
import { phoneRegex } from "@/lib/validations/shared";

export const submitOwnerApplicationSchema = z
  .object({
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
    // Left undefined (not defaulted) until the applicant actually answers
    // — `false` is itself a valid, meaningful answer under Owner Agreement
    // clause 5.3, so it must never be indistinguishable from "unanswered."
    // The custom `error` message replaces Zod's default "expected boolean,
    // received undefined" — verified empirically, since a `.refine()`
    // here would never run: the base invalid_type check rejects undefined
    // before any refine gets a chance to.
    hasLiabilityInsurance: z.boolean({ error: "Let us know whether your venue carries public liability insurance." }),
    // Same shape as signUpSchema's agreedToTerms — a plain boolean here,
    // checked with the rest of the object below so record_agreement-
    // shaped server-side logic never has to trust this value as proof of
    // anything by itself, only as what gated the submit button.
    agreedToOwnerAgreement: z.boolean(),
  })
  .refine((data) => data.agreedToOwnerAgreement === true, {
    message: "You must accept the Venue Owner Agreement to continue.",
    path: ["agreedToOwnerAgreement"],
  });
export type SubmitOwnerApplicationValues = z.infer<typeof submitOwnerApplicationSchema>;

/** Field groups per wizard step, for gating "Next" via react-hook-form's trigger(fields). */
export const OWNER_APPLICATION_STEP_FIELDS = [
  ["businessName", "businessPhone", "businessEmail"],
  ["venueName", "venueAddress", "venueCity", "venueDescription"],
  ["courtCount"],
  [],
  [],
  [],
  ["hasLiabilityInsurance", "agreedToOwnerAgreement"],
] as const satisfies readonly (readonly (keyof SubmitOwnerApplicationValues)[])[];
