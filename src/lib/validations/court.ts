import { z } from "zod";

export const courtStatusValues = ["active", "inactive", "maintenance"] as const;

export const createCourtSchema = z.object({
  name: z.string().trim().min(1, "Enter a court name").max(120),
  description: z.string().trim().max(1000).optional(),
  surfaceType: z.string().trim().max(100).optional(),
  indoorOutdoor: z.enum(["indoor", "outdoor"]),
  // Paired with `register("capacity", { setValueAs: ... })` in the form,
  // not `valueAsNumber: true` — an empty *optional* number input with
  // valueAsNumber gives NaN, not undefined, which z.number().optional()
  // would reject. `setValueAs` converts before RHF stores the value, so
  // the schema never has to special-case NaN. (z.preprocess would also
  // work but breaks zodResolver's TFieldValues inference — see the
  // z.coerce.number() note in validations/venue.ts for the same class of
  // issue.)
  capacity: z.number().int().min(1).max(20).optional(),
  hourlyPrice: z.number().min(0, "Price can't be negative").max(100000),
});
export type CreateCourtValues = z.infer<typeof createCourtSchema>;

export const updateCourtSchema = createCourtSchema.extend({
  status: z.enum(courtStatusValues),
});
export type UpdateCourtValues = z.infer<typeof updateCourtSchema>;
