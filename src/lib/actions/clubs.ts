"use server";

import { revalidatePath } from "next/cache";
import {
  createClub,
  updateClub,
  requestClubMembership,
  leaveClub,
  approveClubMember,
  removeClubMember,
  setClubMemberRole,
  setClubStatus,
} from "@/lib/services/clubs";
import { createClubSchema, updateClubSchema, type CreateClubValues, type UpdateClubValues } from "@/lib/validations/club";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import { requireAdmin } from "@/lib/services/admin";
import type { Club, ClubMemberRole } from "@/lib/supabase/types";

/**
 * Any signed-in account can create a club — there is deliberately no
 * role gate here. Club ownership is not venue ownership: it grants no
 * court, availability, or payout access, and does not change the
 * creator's `profiles.role`.
 */
export async function createClubAction(values: CreateClubValues): Promise<ActionResult<Club>> {
  const parsed = createClubSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to create a club." };

  try {
    const club = await createClub(supabase, user.id, parsed.data);
    revalidatePath("/clubs");
    return { success: true, data: club };
  } catch (error) {
    logServerError("clubs.create", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't create that club.") };
  }
}

export async function updateClubAction(clubId: string, values: UpdateClubValues): Promise<ActionResult<null>> {
  const parsed = updateClubSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };

  try {
    // RLS restricts this to the club's owner/admins — no separate check here.
    await updateClub(clientResult.client, clubId, parsed.data);
    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("clubs.update", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that club.") };
  }
}

/**
 * Requests membership. The database decides the outcome from the club's
 * visibility (join outright / await approval / rejected as invite-only),
 * so this reports back what actually happened rather than assuming.
 */
export async function joinClubAction(clubId: string): Promise<ActionResult<{ pending: boolean }>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to join a club." };

  try {
    await requestClubMembership(supabase, clubId, user.id);

    const { data: membership } = await supabase
      .from("club_members")
      .select("status")
      .eq("club_id", clubId)
      .eq("user_id", user.id)
      .maybeSingle();

    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: { pending: membership?.status === "pending" } };
  } catch (error) {
    logServerError("clubs.join", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't join that club.") };
  }
}

export async function leaveClubAction(clubId: string): Promise<ActionResult<null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to manage your clubs." };

  try {
    await leaveClub(supabase, clubId, user.id);
    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("clubs.leave", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't leave that club.") };
  }
}

export async function approveClubMemberAction(clubId: string, userId: string): Promise<ActionResult<null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };

  try {
    // RLS restricts membership updates to the club's owner/admins.
    await approveClubMember(clientResult.client, clubId, userId);
    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("clubs.approveMember", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't approve that member.") };
  }
}

export async function removeClubMemberAction(clubId: string, userId: string): Promise<ActionResult<null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };

  try {
    await removeClubMember(clientResult.client, clubId, userId);
    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("clubs.removeMember", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't remove that member.") };
  }
}

/**
 * Only the club's actual owner can grant 'admin' — enforced in the
 * database by enforce_club_member_update(), which silently reverts an
 * unauthorized role change rather than trusting this layer.
 */
export async function setClubMemberRoleAction(
  clubId: string,
  userId: string,
  role: ClubMemberRole
): Promise<ActionResult<null>> {
  if (role === "owner") {
    return { success: false, error: "Club ownership can't be reassigned here." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };

  try {
    await setClubMemberRole(clientResult.client, clubId, userId, role);
    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("clubs.setMemberRole", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that member.") };
  }
}

/**
 * Admin moderation of a club listing. Gated three ways: requireAdmin()
 * here, the clubs UPDATE policy, and the enforce_club_status_change()
 * trigger, which reverts a status change from any non-admin regardless of
 * how the write arrived.
 */
export async function setClubStatusAdminAction(clubId: string, status: Club["status"]): Promise<ActionResult<null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const adminCheck = await requireAdmin(supabase);
  if (!adminCheck.ok) return { success: false, error: adminCheck.error };

  try {
    await setClubStatus(supabase, clubId, status);
    revalidatePath("/admin/community");
    revalidatePath("/clubs");
    revalidatePath(`/clubs/${clubId}`);
    return { success: true, data: null };
  } catch (error) {
    logServerError("clubs.setStatusAdmin", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't update that club.") };
  }
}
