import { z } from "zod";
import { RANKED_DISPUTE_REASONS } from "@/lib/ranked";

export const createRankedMatchSchema = z
  .object({
    matchType: z.enum(["singles", "doubles"]),
    teamA: z.array(z.uuid()).min(1).max(2),
    teamB: z.array(z.uuid()).min(1).max(2),
    eventId: z.uuid().optional(),
    courtId: z.uuid().optional(),
  })
  .refine((v) => v.teamA.length === (v.matchType === "doubles" ? 2 : 1), {
    message: "Team A needs the right number of players for this match type.",
    path: ["teamA"],
  })
  .refine((v) => v.teamB.length === (v.matchType === "doubles" ? 2 : 1), {
    message: "Team B needs the right number of players for this match type.",
    path: ["teamB"],
  });

export type CreateRankedMatchValues = z.infer<typeof createRankedMatchSchema>;

/**
 * The four canned reasons plus free text under "Other" — mirrors the
 * design's dispute picker. `reason` is what's stored; when it's "Other"
 * the actual explanation rides in `detail` and the two are joined before
 * being sent to respond_ranked_result(), which only takes one string.
 */
export const rankedDisputeSchema = z
  .object({
    reason: z.enum(RANKED_DISPUTE_REASONS),
    detail: z.string().trim().max(300).optional(),
  })
  .refine((v) => v.reason !== "Other" || Boolean(v.detail?.length), {
    message: "Tell us what happened.",
    path: ["detail"],
  });

export type RankedDisputeValues = z.infer<typeof rankedDisputeSchema>;

export function formatDisputeReason(values: RankedDisputeValues): string {
  return values.reason === "Other" && values.detail ? `Other — ${values.detail}` : values.reason;
}
