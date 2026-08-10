import { z } from "zod";

/**
 * Deliberately thin — shape validation only (are these well-formed
 * inputs), not business-rule validation. Operating hours, blocked
 * periods, overlap, lead time, and the booking window are all validated
 * server-side in lib/services/bookings.ts against live database state,
 * not against anything the client could assert here. A client could set
 * startTime/endTime to anything; that's fine, because nothing downstream
 * trusts them past this shape check.
 */
export const createBookingSchema = z
  .object({
    courtId: z.uuid(),
    startTime: z.iso.datetime({ offset: true }),
    endTime: z.iso.datetime({ offset: true }),
  })
  .refine((values) => new Date(values.startTime) < new Date(values.endTime), {
    message: "Start time must be before end time.",
    path: ["endTime"],
  });
export type CreateBookingValues = z.infer<typeof createBookingSchema>;

export const cancelBookingSchema = z.object({
  bookingId: z.uuid(),
});
export type CancelBookingValues = z.infer<typeof cancelBookingSchema>;

export const getAvailableSlotsSchema = z.object({
  courtId: z.uuid(),
  /** "YYYY-MM-DD", interpreted against the venue's own timezone server-side — never the browser's local date. */
  localDate: z.iso.date(),
  durationMinutes: z.number().int().positive(),
});
export type GetAvailableSlotsValues = z.infer<typeof getAvailableSlotsSchema>;
