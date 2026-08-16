import { z } from "zod";

export const EVENT_TYPES = ["open_play", "club_meetup", "training", "tournament"] as const;
export const SKILL_LEVELS = ["beginner", "intermediate", "advanced", "mixed"] as const;

export const createEventSchema = z
  .object({
    title: z.string().trim().min(1, "Give your event a name.").max(120),
    description: z.string().trim().max(2000).optional(),
    startTime: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Pick a valid start date and time."),
    endTime: z.string().refine((v) => !Number.isNaN(Date.parse(v)), "Pick a valid end time.").optional(),
    eventType: z.enum(EVENT_TYPES).optional(),
    skillLevel: z.enum(SKILL_LEVELS).optional(),
    venueId: z.uuid().optional(),
    clubId: z.uuid().optional(),
    courtId: z.uuid().optional(),
    bookingId: z.uuid().optional(),
    maxPlayers: z.number().int().positive().max(500).optional(),
    /** Integer minor units. Display only — collected at the venue, never charged online in 7.8a. */
    priceAmount: z.number().int().min(0).optional(),
  })
  .refine((v) => !v.endTime || Date.parse(v.endTime) > Date.parse(v.startTime), {
    message: "The event must end after it starts.",
    path: ["endTime"],
  })
  // Mirrors the RLS policy: a court can only be held by a booking. Caught
  // here too so the user gets a readable message instead of a policy
  // rejection.
  .refine((v) => !v.courtId || Boolean(v.bookingId), {
    message: "Book the court first — an event can only hold a court you've reserved.",
    path: ["courtId"],
  });

export type CreateEventValues = z.infer<typeof createEventSchema>;
