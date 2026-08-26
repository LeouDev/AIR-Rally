import { z } from "zod";

/**
 * Mirrors the database's own constraints (migration 20260810000099) so a bad
 * value is rejected with a readable message before it reaches a CHECK
 * violation. venue_request_place_name_length: 2–160 chars, trimmed.
 */
export const createVenueRequestSchema = z.object({
  placeName: z
    .string()
    .trim()
    .min(2, "Tell us the venue's name.")
    .max(160, "That name is too long."),
  placeCity: z.string().trim().max(160).optional(),
  note: z.string().trim().max(500).optional(),
});

export type CreateVenueRequestValues = z.infer<typeof createVenueRequestSchema>;
