import { z } from "zod";

const timeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM");

const operatingHoursWindowSchema = z
  .object({
    dayOfWeek: z.number().int().min(0).max(6),
    startTime: timeSchema,
    endTime: timeSchema,
  })
  .refine((w) => w.endTime > w.startTime, { message: "End time must be after start time", path: ["endTime"] });

/**
 * One window per day of week, matching the editor UI (CourtsManager-style
 * "replace all rows" write) — the schema/RLS underneath supports multiple
 * windows per day (e.g. a lunch closure), but exposing that in the owner
 * UI is a real future enhancement, not something the readiness checklist
 * itself requires today. Overnight windows (end < start) are rejected —
 * see supabase/migrations/20260810000002_venue_operating_hours.sql's own
 * documented scope decision, mirrored here rather than re-litigated.
 */
export const setOperatingHoursSchema = z.object({
  windows: z.array(operatingHoursWindowSchema).max(7),
});
export type SetOperatingHoursValues = z.infer<typeof setOperatingHoursSchema>;
