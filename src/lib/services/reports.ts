import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type {
  Database,
  PublicProfile,
  Report,
  ReportStatus,
  ReportTargetType,
  SupportRequest,
  SupportStatus,
} from "@/lib/supabase/types";
import type { CreateReportValues, CreateSupportRequestValues } from "@/lib/validations/report";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";

/**
 * Thrown for the two rejections a user can actually act on, so the action
 * layer can show something better than "we couldn't save that".
 */
export class ReportError extends Error {
  constructor(
    public reason: "already_reported" | "rate_limited",
    message: string
  ) {
    super(message);
    this.name = "ReportError";
  }
}

function isRateLimit(error: PostgrestError): boolean {
  return /rate limit reached/i.test(error.message ?? "");
}

/**
 * Files a report as `reporterId`.
 *
 * RLS enforces that the reporter is the caller — this function does not
 * re-check, deliberately, following the same convention as the rest of the
 * service layer (the database is the boundary). What it does do is turn the
 * two constraint rejections into typed errors: the partial unique index on
 * open reports, and the rate-limit trigger.
 */
export async function createReport(supabase: Client, reporterId: string, values: CreateReportValues): Promise<Report> {
  const { data, error } = await supabase
    .from("reports")
    .insert({
      reporter_id: reporterId,
      target_type: values.targetType,
      target_id: values.targetId,
      reason: values.reason,
      details: values.details ?? null,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === UNIQUE_VIOLATION) {
      throw new ReportError("already_reported", "You've already reported this, and we're still looking at it.");
    }
    if (isRateLimit(error)) {
      throw new ReportError("rate_limited", "You've filed a lot of reports today. Please try again tomorrow.");
    }
    throw error;
  }
  return data as Report;
}

export type ReportWithReporter = Report & { reporter: PublicProfile | null };

/**
 * Looks up profiles in a second query rather than a PostgREST embed.
 * `public_profiles` is a view, so it cannot be embedded through a foreign
 * key — the same reason posts.ts#attachAuthors exists.
 */
async function profilesById(supabase: Client, ids: string[]): Promise<Map<string, PublicProfile>> {
  if (ids.length === 0) return new Map();
  const { data, error } = await supabase
    .from("public_profiles")
    .select("*")
    .in("id", Array.from(new Set(ids)));
  if (error) throw error;
  return new Map((data ?? []).map((p) => [p.id, p]));
}

/**
 * The moderation queue. RLS already restricts this to admins, so there is
 * no is_admin() check here — a non-admin caller simply gets nothing back.
 */
export async function listReports(supabase: Client, status: ReportStatus | "all" = "open", limit = 100): Promise<ReportWithReporter[]> {
  let query = supabase.from("reports").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as Report[];
  const byId = await profilesById(supabase, rows.map((r) => r.reporter_id));
  return rows.map((row) => ({ ...row, reporter: byId.get(row.reporter_id) ?? null }));
}

/** Counts per status, for the admin hub's badge. */
export async function countOpenReports(supabase: Client): Promise<number> {
  const { count, error } = await supabase
    .from("reports")
    .select("id", { count: "exact", head: true })
    .eq("status", "open");
  if (error) throw error;
  return count ?? 0;
}

/**
 * Resolves a report. `resolvedBy` and `resolved_at` are written together
 * because the reports_resolution_complete CHECK requires both — a
 * resolution that records no resolver is rejected by the database.
 */
export async function resolveReport(
  supabase: Client,
  reportId: string,
  adminId: string,
  status: Exclude<ReportStatus, "open">,
  note?: string
): Promise<Report> {
  const { data, error } = await supabase
    .from("reports")
    .update({
      status,
      resolved_by: adminId,
      resolved_at: new Date().toISOString(),
      resolution_note: note ?? null,
    })
    .eq("id", reportId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Report;
}

/**
 * Reads the reported thing so the queue can show what it is about.
 *
 * Returns null when the target is gone, which is expected rather than
 * exceptional: reports deliberately outlive their targets (see the
 * migration's note on why target_id carries no foreign key), so the queue
 * has to render "no longer available" as a normal state.
 */
export async function describeReportTarget(
  supabase: Client,
  targetType: ReportTargetType,
  targetId: string
): Promise<{ label: string; href: string | null } | null> {
  switch (targetType) {
    case "post": {
      const { data } = await supabase.from("posts").select("id, content, user_id").eq("id", targetId).maybeSingle();
      if (!data) return null;
      return { label: data.content.slice(0, 140), href: `/court-side/${data.user_id}` };
    }
    case "comment": {
      const { data } = await supabase.from("post_comments").select("id, content, post_id").eq("id", targetId).maybeSingle();
      if (!data) return null;
      return { label: data.content.slice(0, 140), href: null };
    }
    case "club": {
      const { data } = await supabase.from("clubs").select("id, name").eq("id", targetId).maybeSingle();
      if (!data) return null;
      return { label: data.name, href: `/clubs/${data.id}` };
    }
    case "event": {
      const { data } = await supabase.from("events").select("id, title").eq("id", targetId).maybeSingle();
      if (!data) return null;
      return { label: data.title, href: `/events/${data.id}` };
    }
    case "user": {
      const { data } = await supabase.from("public_profiles").select("id, display_name").eq("id", targetId).maybeSingle();
      if (!data) return null;
      return { label: data.display_name ?? "A player", href: `/court-side/${data.id}` };
    }
    default:
      return null;
  }
}

// --- Support requests ------------------------------------------------------

export async function createSupportRequest(
  supabase: Client,
  userId: string,
  values: CreateSupportRequestValues
): Promise<SupportRequest> {
  const { data, error } = await supabase
    .from("support_requests")
    .insert({
      user_id: userId,
      category: values.category,
      subject: values.subject,
      message: values.message,
    })
    .select("*")
    .single();

  if (error) {
    if (isRateLimit(error)) {
      throw new ReportError("rate_limited", "You've sent us several messages today. We'll reply to those first.");
    }
    throw error;
  }
  return data as SupportRequest;
}

export type SupportRequestWithUser = SupportRequest & { user: PublicProfile | null };

export async function listSupportRequests(
  supabase: Client,
  status: SupportStatus | "all" = "open",
  limit = 100
): Promise<SupportRequestWithUser[]> {
  let query = supabase.from("support_requests").select("*").order("created_at", { ascending: false }).limit(limit);
  if (status !== "all") query = query.eq("status", status);

  const { data, error } = await query;
  if (error) throw error;
  const rows = (data ?? []) as SupportRequest[];
  const byId = await profilesById(supabase, rows.map((r) => r.user_id));
  return rows.map((row) => ({ ...row, user: byId.get(row.user_id) ?? null }));
}

/** A user's own history, for the /support page. RLS scopes this to them. */
export async function listMySupportRequests(supabase: Client, userId: string): Promise<SupportRequest[]> {
  const { data, error } = await supabase
    .from("support_requests")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as SupportRequest[];
}

export async function setSupportRequestStatus(
  supabase: Client,
  requestId: string,
  adminId: string,
  status: SupportStatus,
  resolutionNote?: string
): Promise<SupportRequest> {
  const closing = status === "resolved" || status === "closed";
  const { data, error } = await supabase
    .from("support_requests")
    .update({
      status,
      // The CHECK requires all three when closing, and reopening must
      // clear them or the row would claim a resolver — and a reply — it
      // no longer has. support_resolution_complete (20260810000088)
      // enforces resolution_note the same way it already enforced
      // resolved_by/resolved_at; the friendly validation for a missing
      // note lives in setSupportRequestStatusAction, one layer up.
      resolved_by: closing ? adminId : null,
      resolved_at: closing ? new Date().toISOString() : null,
      resolution_note: closing ? resolutionNote : null,
    })
    .eq("id", requestId)
    .select("*")
    .single();
  if (error) throw error;
  return data as SupportRequest;
}
