import { z } from "zod";

/**
 * Deliberately thin — shape validation only. Eligibility (24h cutoff,
 * same-venue, single-reschedule limit, prior-refund exclusion,
 * in-flight-reschedule exclusion, slot availability) is all validated
 * server-side in lib/services/reschedules.ts against live database
 * state, matching the split lib/validations/booking.ts already
 * documents for createBookingSchema.
 */
export const createRescheduleSchema = z
  .object({
    bookingId: z.uuid(),
    newCourtId: z.uuid(),
    newStartTime: z.iso.datetime({ offset: true }),
    newEndTime: z.iso.datetime({ offset: true }),
    reason: z.string().max(500).optional(),
  })
  .refine((values) => new Date(values.newStartTime) < new Date(values.newEndTime), {
    message: "Start time must be before end time.",
    path: ["newEndTime"],
  });
export type CreateRescheduleValues = z.infer<typeof createRescheduleSchema>;

export const resumeRescheduleSchema = z.object({
  rescheduleId: z.uuid(),
});
export type ResumeRescheduleValues = z.infer<typeof resumeRescheduleSchema>;
