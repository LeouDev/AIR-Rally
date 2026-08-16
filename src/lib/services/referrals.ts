import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Referral } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Records "who invited this person" the moment a referred visitor
 * requests owner access with a code attached. Resolves referrer_user_id
 * server-side from the CODE (never trusts a client-supplied id
 * directly, per Part 7's referral-security requirement) — an
 * unknown/garbage code, or someone using their own code, is a silent
 * no-op rather than an error, since a referral link should never block
 * the underlying action (requesting owner access) it's attached to.
 */
export async function recordReferralStart(supabase: Client, referralCode: string, referredUserId: string): Promise<void> {
  const { data: referrer, error: referrerError } = await supabase
    .from("profiles")
    .select("id")
    .eq("referral_code", referralCode)
    .maybeSingle();
  if (referrerError) throw referrerError;
  if (!referrer || referrer.id === referredUserId) return;

  const { error } = await supabase.from("referrals").insert({
    referral_code: referralCode,
    referrer_user_id: referrer.id,
    referred_user_id: referredUserId,
    status: "started",
  });
  if (error) throw error;
}

/** Called when the referred user submits their owner application. No-op if they were never referred. */
export async function markReferralCompleted(supabase: Client, referredUserId: string): Promise<void> {
  const { error } = await supabase
    .from("referrals")
    .update({ status: "completed" })
    .eq("referred_user_id", referredUserId)
    .eq("status", "started");
  if (error) throw error;
}

/**
 * Called from the owner-application approval flow (an admin session) —
 * resolves any in-flight referral for the newly-approved user to
 * 'approved' and records converted_owner_id. A safe no-op if the user
 * was never referred. Admin-only in practice (the RLS/trigger pair both
 * permit is_admin() to make this exact transition; a non-admin caller
 * would silently fail the WHERE match or have the trigger revert the
 * status change).
 */
export async function markReferralApproved(supabase: Client, referredUserId: string): Promise<void> {
  const { error } = await supabase
    .from("referrals")
    .update({ status: "approved", converted_owner_id: referredUserId })
    .eq("referred_user_id", referredUserId)
    .in("status", ["started", "completed"]);
  if (error) throw error;
}

export async function listReferralsForUser(supabase: Client, referrerUserId: string): Promise<Referral[]> {
  const { data, error } = await supabase
    .from("referrals")
    .select("*")
    .eq("referrer_user_id", referrerUserId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}
