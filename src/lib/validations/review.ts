import { z } from "zod";

/**
 * Shape validation only — same split as lib/validations/booking.ts's own
 * doc comment: eligibility (has this user actually got a confirmed,
 * past booking at this venue?) is a live-data business rule, decided
 * server-side in lib/services/reviews.ts, not something a client input
 * shape could ever prove on its own.
 */
export const createReviewSchema = z.object({
  venueId: z.uuid(),
  bookingId: z.uuid(),
  rating: z.number().int().min(1).max(5),
  title: z.string().trim().max(120).optional(),
  comment: z.string().trim().max(2000).optional(),
});
export type CreateReviewValues = z.infer<typeof createReviewSchema>;
