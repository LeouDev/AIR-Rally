import { z } from "zod";
import { phoneRegex } from "@/lib/validations/shared";

const websiteSchema = z
  .string()
  .trim()
  .max(2048)
  .refine((value) => value === "" || z.url().safeParse(value).success, "Enter a valid website URL");

export const createVenueDraftSchema = z.object({
  name: z.string().trim().min(2, "Enter your venue's name").max(120),
  description: z.string().trim().min(20, "Tell players a bit more about your venue").max(2000),
  address: z.string().trim().min(1, "Enter a street address").max(200),
  city: z.string().trim().min(1, "Enter a city").max(100),
  stateProvince: z.string().trim().max(100).optional(),
  country: z.string().trim().min(1, "Enter a country").max(100),
  phone: z.string().trim().regex(phoneRegex, "Enter a valid phone number"),
  email: z.email("Enter a valid email address"),
  website: websiteSchema,
  indoorOutdoor: z.enum(["indoor", "outdoor", "both"]),
  // Paired with `register("numberOfCourts", { valueAsNumber: true })` in the
  // form so react-hook-form converts the input value before validation —
  // `z.coerce.number()` would otherwise give the resolver an `unknown`
  // input type that doesn't match useForm's generic.
  numberOfCourts: z.number().int().min(1, "Must have at least 1 court").max(100),
});
export type CreateVenueDraftValues = z.infer<typeof createVenueDraftSchema>;

// Editing a venue collects exactly the same fields it was created with —
// `status` is deliberately never part of this shape. Self-service status
// changes are blocked at the database layer regardless (see
// venues_prevent_status_escalation in supabase/migrations), but keeping it
// out of the form/schema entirely means there's nothing to strip in the
// first place.
export const updateVenueSchema = createVenueDraftSchema;
export type UpdateVenueValues = CreateVenueDraftValues;

export const setVenueAmenitiesSchema = z.object({
  amenityIds: z.array(z.string()).max(50),
});
export type SetVenueAmenitiesValues = z.infer<typeof setVenueAmenitiesSchema>;

export const deleteVenueSchema = z.uuid();
