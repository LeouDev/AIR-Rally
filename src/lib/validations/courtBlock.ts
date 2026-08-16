import { z } from "zod";

export const createCourtBlockSchema = z
  .object({
    courtId: z.uuid(),
    startTime: z.iso.datetime({ offset: true }),
    endTime: z.iso.datetime({ offset: true }),
    reason: z.string().trim().max(200).optional(),
  })
  .refine((v) => new Date(v.endTime) > new Date(v.startTime), { message: "End time must be after start time", path: ["endTime"] });
export type CreateCourtBlockValues = z.infer<typeof createCourtBlockSchema>;

export const deleteCourtBlockSchema = z.object({
  blockId: z.uuid(),
});
export type DeleteCourtBlockValues = z.infer<typeof deleteCourtBlockSchema>;
