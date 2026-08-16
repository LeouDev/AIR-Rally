import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type { Club, ClubMember, ClubMemberRole, Database, PublicProfile } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

const UNIQUE_VIOLATION = "23505";
const POSTGRES_INVALID_TEXT_REPRESENTATION = "22P02";

function isUniqueViolation(error: PostgrestError): boolean {
  return error.code === UNIQUE_VIOLATION;
}

export type ClubMemberWithProfile = ClubMember & { profile: PublicProfile | null };

export type ClubWithViewerState = Club & {
  /** The viewer's role in this club, or null if they aren't an active member. */
  viewerRole: ClubMemberRole | null;
  /** True when the viewer has a request awaiting approval. */
  viewerPending: boolean;
};

/**
 * Public/approval-required clubs, newest first. RLS already hides private
 * clubs the caller isn't a member of, so no visibility filter is applied
 * here — the database is the boundary, not this query.
 */
export async function listDiscoverableClubs(supabase: Client, limit = 24): Promise<Club[]> {
  const { data, error } = await supabase
    .from("clubs")
    .select("*")
    .eq("status", "active")
    .order("member_count", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * Name search for the COURT/Side search box and the `@` mention picker.
 *
 * Returns an empty array without querying for a blank term. Private
 * clubs the caller isn't a member of are filtered by RLS, not here — a
 * search must never become a way to discover the existence of a club you
 * can't see. The `%` and `_` LIKE wildcards are escaped so a user typing
 * them searches for the literal characters instead of matching everything.
 */
export async function searchClubs(supabase: Client, query: string, limit = 5): Promise<Club[]> {
  const term = query.trim();
  if (!term) return [];

  const escaped = term.replace(/([%_\\])/g, "\\$1");
  const { data, error } = await supabase
    .from("clubs")
    .select("*")
    .eq("status", "active")
    .ilike("name", `%${escaped}%`)
    .order("member_count", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

/**
 * The mention token for a club: the whole name with non-alphanumerics
 * stripped, so a multi-word name survives as ONE token. The feed's
 * highlighter matches `@` followed by alphanumerics only, so
 * "Cebu Weekend Picklers" has to become "@CebuWeekendPicklers" —
 * inserting it with its spaces intact would highlight only "@Cebu".
 */
export function clubMentionHandle(name: string): string {
  return name.replace(/[^a-zA-Z0-9_]/g, "");
}

/** A club mention resolved to something linkable. */
export type ClubMentionTarget = { id: string; name: string };

/**
 * Plain object rather than a Map: this crosses the server→client
 * component boundary, and a Map doesn't survive serialization.
 */
export type ClubMentionMap = Record<string, ClubMentionTarget>;

/** Every "@handle" token in a block of post text, deduped. */
export function extractMentionHandles(text: string): string[] {
  return Array.from(new Set(Array.from(text.matchAll(/@([a-zA-Z0-9_]+)/g), (m) => m[1])));
}

/**
 * Resolves mention tokens to clubs in one batched query, matching against
 * the `mention_handle` generated column (see
 * 20260810000031_club_mention_handle.sql).
 *
 * Unresolvable tokens are simply absent from the result — a person's
 * mention, a typo, or a private club the viewer can't see all fall
 * through to plain highlighted text rather than a broken link. RLS does
 * the visibility half; this function does not filter for it.
 *
 * Where two clubs collapse to the same handle, the one with more members
 * wins, since ordering ascending and overwriting leaves the largest last.
 */
export async function resolveClubMentions(supabase: Client, handles: string[]): Promise<ClubMentionMap> {
  if (handles.length === 0) return {};

  const { data, error } = await supabase
    .from("clubs")
    .select("id, name, mention_handle, member_count")
    .eq("status", "active")
    .in("mention_handle", handles)
    .order("member_count", { ascending: true });
  if (error) throw error;

  const map: ClubMentionMap = {};
  for (const club of data ?? []) {
    if (club.mention_handle) map[club.mention_handle] = { id: club.id, name: club.name };
  }
  return map;
}

/** Convenience: pull every mention out of a batch of posts and resolve them at once. */
export async function resolveClubMentionsForPosts(supabase: Client, contents: string[]): Promise<ClubMentionMap> {
  const handles = Array.from(new Set(contents.flatMap(extractMentionHandles)));
  return resolveClubMentions(supabase, handles);
}

export type ClubWithOwner = Club & { owner: PublicProfile | null };

/**
 * Every club in a given moderation state, for the admin dashboard.
 * Admins bypass the status/visibility half of the clubs SELECT policy via
 * is_admin(), so this sees pending and suspended clubs too — a non-admin
 * caller simply gets whatever RLS allows them, which is why the calling
 * page gates on requireAdmin() first.
 */
export async function listClubsForAdmin(supabase: Client, status?: Club["status"]): Promise<ClubWithOwner[]> {
  let query = supabase.from("clubs").select("*").order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);

  const { data: clubs, error } = await query;
  if (error) throw error;
  if (!clubs || clubs.length === 0) return [];

  const ownerIds = Array.from(new Set(clubs.map((c) => c.owner_id)));
  const { data: owners, error: ownersError } = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url")
    .in("id", ownerIds);
  if (ownersError) throw ownersError;

  const ownerById = new Map((owners ?? []).map((o) => [o.id, o]));
  return clubs.map((club) => ({ ...club, owner: ownerById.get(club.owner_id) ?? null }));
}

/** Counts per moderation state, for the dashboard's tab badges. */
export async function getClubModerationCounts(supabase: Client): Promise<Record<Club["status"], number>> {
  const { data, error } = await supabase.from("clubs").select("status");
  if (error) throw error;

  const counts: Record<Club["status"], number> = { pending_review: 0, active: 0, suspended: 0 };
  for (const row of data ?? []) {
    if (row.status in counts) counts[row.status] += 1;
  }
  return counts;
}

/**
 * Moves a club between moderation states. Admin-only: the
 * enforce_club_status_change() trigger silently reverts a status change
 * from anyone who isn't an admin, so this cannot be used to self-approve
 * even if the calling code forgot to check.
 */
export async function setClubStatus(supabase: Client, clubId: string, status: Club["status"]): Promise<void> {
  const { error } = await supabase.from("clubs").update({ status }).eq("id", clubId);
  if (error) throw error;
}

/** Every club the given user belongs to, whatever their role. */
export async function listClubsForUser(supabase: Client, userId: string): Promise<Club[]> {
  const { data: memberships, error: membershipsError } = await supabase
    .from("club_members")
    .select("club_id")
    .eq("user_id", userId)
    .eq("status", "active");
  if (membershipsError) throw membershipsError;

  const clubIds = (memberships ?? []).map((m) => m.club_id);
  if (clubIds.length === 0) return [];

  const { data, error } = await supabase.from("clubs").select("*").in("id", clubIds).order("name");
  if (error) throw error;
  return data ?? [];
}

/**
 * One club plus the viewer's own relationship to it. Returns null for a
 * club that doesn't exist, is private to the viewer, or whose id isn't a
 * valid UUID — all three look identical to the caller, same posture as
 * getVenueDetail().
 */
export async function getClubForViewer(supabase: Client, clubId: string, viewerId: string | null): Promise<ClubWithViewerState | null> {
  const { data: club, error } = await supabase.from("clubs").select("*").eq("id", clubId).maybeSingle();
  if (error) {
    if (error.code === POSTGRES_INVALID_TEXT_REPRESENTATION) return null;
    throw error;
  }
  if (!club) return null;

  if (!viewerId) return { ...club, viewerRole: null, viewerPending: false };

  const { data: membership, error: membershipError } = await supabase
    .from("club_members")
    .select("role, status")
    .eq("club_id", clubId)
    .eq("user_id", viewerId)
    .maybeSingle();
  if (membershipError) throw membershipError;

  return {
    ...club,
    viewerRole: membership?.status === "active" ? membership.role : null,
    viewerPending: membership?.status === "pending",
  };
}

/**
 * A club's roster joined to display names via public_profiles — profiles'
 * own RLS is own-row-only, so an embed through it would silently return
 * null for every other member.
 */
export async function listClubMembers(supabase: Client, clubId: string): Promise<ClubMemberWithProfile[]> {
  const { data: members, error } = await supabase
    .from("club_members")
    .select("*")
    .eq("club_id", clubId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  if (!members || members.length === 0) return [];

  const userIds = Array.from(new Set(members.map((m) => m.user_id)));
  const { data: profiles, error: profilesError } = await supabase
    .from("public_profiles")
    .select("id, display_name, avatar_url")
    .in("id", userIds);
  if (profilesError) throw profilesError;

  const profileById = new Map((profiles ?? []).map((p) => [p.id, p]));
  return members.map((member) => ({ ...member, profile: profileById.get(member.user_id) ?? null }));
}

export type CreateClubInput = {
  name: string;
  description?: string | null;
  location?: string | null;
  imageUrl?: string | null;
  skillLevel: Club["skill_level"];
  clubType: Club["club_type"];
  visibility: Club["visibility"];
};

/**
 * Creates a club owned by the caller. Requires no platform role beyond a
 * signed-in account — a `player` can own a club, and doing so grants no
 * venue, court, availability, or payout access anywhere.
 *
 * The owner's own `club_members` row is inserted by the
 * create_club_owner_membership() trigger, not here, so ownership can
 * never be half-written.
 */
export async function createClub(supabase: Client, ownerId: string, values: CreateClubInput): Promise<Club> {
  const { data, error } = await supabase
    .from("clubs")
    .insert({
      owner_id: ownerId,
      name: values.name,
      description: values.description ?? null,
      location: values.location ?? null,
      image_url: values.imageUrl ?? null,
      skill_level: values.skillLevel,
      club_type: values.clubType,
      visibility: values.visibility,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updateClub(supabase: Client, clubId: string, values: Partial<CreateClubInput>): Promise<void> {
  const { error } = await supabase
    .from("clubs")
    .update({
      ...(values.name !== undefined ? { name: values.name } : {}),
      ...(values.description !== undefined ? { description: values.description } : {}),
      ...(values.location !== undefined ? { location: values.location } : {}),
      ...(values.imageUrl !== undefined ? { image_url: values.imageUrl } : {}),
      ...(values.skillLevel !== undefined ? { skill_level: values.skillLevel } : {}),
      ...(values.clubType !== undefined ? { club_type: values.clubType } : {}),
      ...(values.visibility !== undefined ? { visibility: values.visibility } : {}),
    })
    .eq("id", clubId);
  if (error) throw error;
}

/**
 * Requests membership. The resulting role and status are decided by the
 * enforce_club_member_insert() trigger from the club's visibility — a
 * public club admits immediately, an approval_required club creates a
 * pending request, and a private club rejects outright. Nothing the
 * caller passes can influence that.
 *
 * Idempotent: re-requesting an existing membership is a no-op.
 */
export async function requestClubMembership(supabase: Client, clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("club_members").insert({ club_id: clubId, user_id: userId });
  if (error && !isUniqueViolation(error)) throw error;
}

export async function leaveClub(supabase: Client, clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("club_members").delete().eq("club_id", clubId).eq("user_id", userId);
  if (error) throw error;
}

/** Approve a pending request. RLS restricts this to the club's owner/admins. */
export async function approveClubMember(supabase: Client, clubId: string, userId: string): Promise<void> {
  const { error } = await supabase
    .from("club_members")
    .update({ status: "active" })
    .eq("club_id", clubId)
    .eq("user_id", userId);
  if (error) throw error;
}

export async function removeClubMember(supabase: Client, clubId: string, userId: string): Promise<void> {
  const { error } = await supabase.from("club_members").delete().eq("club_id", clubId).eq("user_id", userId);
  if (error) throw error;
}

/**
 * Promote/demote a member. Only the club's actual owner can grant
 * 'admin' — enforce_club_member_update() silently reverts the role
 * change otherwise, so a club admin cannot escalate themselves.
 */
export async function setClubMemberRole(supabase: Client, clubId: string, userId: string, role: ClubMemberRole): Promise<void> {
  const { error } = await supabase.from("club_members").update({ role }).eq("club_id", clubId).eq("user_id", userId);
  if (error) throw error;
}
