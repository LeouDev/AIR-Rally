import { z } from "zod";

export const CLUB_SKILL_LEVELS = ["beginner", "intermediate", "advanced", "mixed"] as const;
export const CLUB_TYPES = ["social", "competitive", "training", "casual"] as const;
export const CLUB_VISIBILITIES = ["public", "approval_required", "private"] as const;

export const createClubSchema = z.object({
  name: z.string().trim().min(1, "Give your club a name.").max(80),
  description: z.string().trim().max(2000).optional(),
  location: z.string().trim().max(200).optional(),
  imageUrl: z.string().trim().max(500).optional(),
  skillLevel: z.enum(CLUB_SKILL_LEVELS),
  clubType: z.enum(CLUB_TYPES),
  visibility: z.enum(CLUB_VISIBILITIES),
});
export type CreateClubValues = z.infer<typeof createClubSchema>;

export const updateClubSchema = createClubSchema.partial();
export type UpdateClubValues = z.infer<typeof updateClubSchema>;
