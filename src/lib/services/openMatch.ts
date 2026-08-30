import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type OpenMatchStatus = "open" | "converted" | "expired" | "cancelled";

const KNOWN_STATUSES: readonly OpenMatchStatus[] = ["open", "converted", "expired", "cancelled"];

/**
 * `open_matches.status` is a plain TEXT column with a CHECK constraint,
 * not a Postgres enum — but the client still has to treat it as a closed
 * set. A status this build has never seen (a future addition to the
 * CHECK, or simply a bug) must render as a safe unknown state, never
 * throw — see new-enum-value-breaks-old-clients: the exact failure mode
 * that cost a retrofit sweep across the whole mobile app was a switch
 * with no default branch. Writing the fallback here, in the first
 * commit, is that lesson applied rather than relearned.
 */
function normalizeStatus(status: string): OpenMatchStatus | "unknown" {
  return (KNOWN_STATUSES as readonly string[]).includes(status) ? (status as OpenMatchStatus) : "unknown";
}

export type PublicOpenMatch = {
  hostDisplayName: string | null;
  hostAvatarUrl: string | null;
  /** Resolved from cities.display_name, never the raw slug — falls back
   * to the slug only if the FK'd row is somehow unreadable, so the page
   * never has nothing to show. */
  cityDisplayName: string;
  status: OpenMatchStatus | "unknown";
  acceptedCount: number;
};

/**
 * No-session read of a single open match — get_open_match_public()
 * (migration 20260810000118) returns a row for EVERY status
 * (open/converted/expired/cancelled), not just 'open'; zero rows is the
 * only case meaning "no such match". Carries no requester identities and
 * nothing from open_match_join_requests — see the migration's own
 * comment for the full exposure boundary. `status` is returned verbatim
 * so this page owns the copy per status, not the database.
 *
 * `cities` is a second, separate read (not folded into the RPC) because
 * the RPC returns a slug, not a display name, and `cities` already has
 * an "Anyone can view" policy for anon+authenticated — no new exposure
 * surface is created by reading it directly.
 */
export async function getPublicOpenMatch(supabase: Client, openMatchId: string): Promise<PublicOpenMatch | null> {
  const { data, error } = await supabase.rpc("get_open_match_public", { p_open_match_id: openMatchId }).single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }

  const { data: city } = await supabase.from("cities").select("display_name").eq("slug", data.target_city).maybeSingle();

  return {
    hostDisplayName: data.host_display_name,
    hostAvatarUrl: data.host_avatar_url,
    cityDisplayName: city?.display_name ?? data.target_city,
    status: normalizeStatus(data.status),
    acceptedCount: data.accepted_count,
  };
}
