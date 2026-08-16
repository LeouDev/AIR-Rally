import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

export type ReferralFunnelStats = {
  /** A referral link was shared but the invitee hasn't begun an application. */
  sent: number;
  /** The invitee actually began an owner application. */
  started: number;
  /** The application was submitted in full. */
  completed: number;
  /** An admin approved the resulting owner. */
  approved: number;
  total: number;
  /** approved ÷ total, 0 when there are no referrals at all. */
  conversionRate: number;
};

/**
 * Referral funnel counts for the admin dashboard, grouped by
 * `referrals.status`. Deliberately starts at the statuses the
 * `referrals` table already records — Phase 6 never logged anonymous
 * link visits, so there is no "clicks" stage to report and none is
 * invented here.
 *
 * Admin-only by RLS: `referrals` has no blanket public select, so a
 * non-admin caller simply sees their own rows. The calling page gates
 * on requireAdmin() before rendering.
 */
export async function getReferralFunnelStats(supabase: Client): Promise<ReferralFunnelStats> {
  const { data, error } = await supabase.from("referrals").select("status");
  if (error) throw error;

  const counts = { sent: 0, started: 0, completed: 0, approved: 0 };
  for (const row of data ?? []) {
    if (row.status in counts) counts[row.status as keyof typeof counts] += 1;
  }

  const total = (data ?? []).length;
  return { ...counts, total, conversionRate: total === 0 ? 0 : counts.approved / total };
}
