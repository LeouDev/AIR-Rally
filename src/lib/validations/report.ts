import { z } from "zod";

/**
 * Kept in lockstep with the CHECK constraints in
 * supabase/migrations/20260810000049_reports_support_rate_limits.sql.
 * The database is the boundary; these exist so the form can say what is
 * wrong before a round trip, not instead of the constraint.
 */
export const REPORT_TARGET_TYPES = ["post", "comment", "club", "event", "user"] as const;

export const REPORT_REASONS = [
  "spam",
  "harassment",
  "hate_speech",
  "sexual_content",
  "violence",
  "misinformation",
  "impersonation",
  "other",
] as const;

/** Shown in the report dialog, in the order a reader scans them. */
export const REPORT_REASON_LABELS: Record<(typeof REPORT_REASONS)[number], string> = {
  spam: "Spam or scam",
  harassment: "Harassment or bullying",
  hate_speech: "Hate speech",
  sexual_content: "Sexual content",
  violence: "Violence or threats",
  misinformation: "False information",
  impersonation: "Pretending to be someone else",
  other: "Something else",
};

export const createReportSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.string().uuid("That doesn't look like something we can report."),
  reason: z.enum(REPORT_REASONS),
  details: z.string().trim().max(1000, "Please keep this under 1000 characters.").optional(),
});

export type CreateReportValues = z.infer<typeof createReportSchema>;

export const resolveReportSchema = z.object({
  reportId: z.string().uuid(),
  // 'open' is absent on purpose: this schema is for closing a report, and
  // re-opening one is not a flow the moderation queue offers.
  status: z.enum(["reviewed", "dismissed"]),
  note: z.string().trim().max(1000, "Please keep this under 1000 characters.").optional(),
});

export type ResolveReportValues = z.infer<typeof resolveReportSchema>;

/**
 * Unlike resolveReportSchema's optional note, this one is required for
 * 'resolved'/'closed' — support_resolution_complete
 * (20260810000088) enforces the same thing at the database layer; this
 * is the friendly, pre-round-trip version of that same requirement, not
 * a looser or stricter one. 'open'/'in_progress' need no note at all
 * (moving a request along isn't a reply), so this only requires one
 * conditionally rather than making it a blanket required field.
 */
export const setSupportStatusSchema = z
  .object({
    requestId: z.string().uuid(),
    status: z.enum(["open", "in_progress", "resolved", "closed"]),
    resolutionNote: z.string().trim().max(1000, "Please keep this under 1000 characters.").optional(),
  })
  .refine(
    (values) => {
      if (values.status !== "resolved" && values.status !== "closed") return true;
      return Boolean(values.resolutionNote && values.resolutionNote.length > 0);
    },
    { message: "Write a reply before resolving or closing this request.", path: ["resolutionNote"] }
  );

export type SetSupportStatusValues = z.infer<typeof setSupportStatusSchema>;

export const SUPPORT_CATEGORIES = ["booking", "payment", "account", "venue", "safety", "bug", "other"] as const;

export const SUPPORT_CATEGORY_LABELS: Record<(typeof SUPPORT_CATEGORIES)[number], string> = {
  booking: "A booking",
  payment: "A payment",
  account: "My account",
  venue: "My venue",
  safety: "Safety concern",
  bug: "Something is broken",
  other: "Something else",
};

export const createSupportRequestSchema = z.object({
  category: z.enum(SUPPORT_CATEGORIES),
  subject: z.string().trim().min(1, "Add a short subject.").max(200, "Please keep the subject under 200 characters."),
  message: z
    .string()
    .trim()
    .min(20, "Tell us a bit more — at least 20 characters.")
    .max(4000, "Please keep this under 4000 characters."),
});

export type CreateSupportRequestValues = z.infer<typeof createSupportRequestSchema>;
