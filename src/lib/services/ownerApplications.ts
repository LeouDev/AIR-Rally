import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, OwnerApplication, OwnerApplicationStatus } from "@/lib/supabase/types";
import { CURRENT_OWNER_AGREEMENT_VERSION } from "@/lib/legal";

type Client = SupabaseClient<Database>;

/**
 * The one legitimate self-service owner_status transition
 * (none|rejected -> pending) — actually enforced by
 * prevent_owner_status_tampering() at the DB layer (see
 * supabase/migrations/20260810000025_owner_approval.sql); this is just
 * the app-layer entry point. A rejected applicant calling this again is
 * how they re-apply.
 */
export async function requestOwnerAccess(supabase: Client, userId: string): Promise<void> {
  const { error } = await supabase.from("profiles").update({ owner_status: "pending" }).eq("id", userId);
  if (error) throw error;
}

export type SubmitOwnerApplicationInput = {
  businessName: string;
  businessPhone: string;
  businessEmail: string;
  venueName: string;
  venueAddress: string;
  venueCity: string;
  venueDescription?: string;
  courtCount: number;
  hasLiabilityInsurance: boolean;
  /**
   * Payout destination, required at submission. The columns are nullable
   * in Postgres only because existing rows predate the requirement (see
   * migration 20260810000090); these three are non-optional here so a
   * caller cannot omit them, and the all-or-nothing CHECK rejects a
   * partial set even if one did.
   */
  bankName: string;
  bankAccountName: string;
  bankAccountNumber: string;
};

/**
 * Records Venue Owner Agreement acceptance inline with the application
 * row it belongs to, rather than in the general-signup
 * agreement_acceptances table — that table is written once per user
 * immediately after signUp() and has no way to represent a second,
 * distinct agreement (see lib/legal.ts#CURRENT_OWNER_AGREEMENT_VERSION).
 * The RLS insert policy (20260810000064) independently requires these
 * three columns to be non-null, so a client that skipped this schema
 * entirely — not just one that tampered with the boolean — still can't
 * submit.
 */
export async function submitOwnerApplication(
  supabase: Client,
  userId: string,
  input: SubmitOwnerApplicationInput
): Promise<OwnerApplication> {
  const { data, error } = await supabase
    .from("owner_applications")
    .insert({
      user_id: userId,
      business_name: input.businessName,
      business_phone: input.businessPhone,
      business_email: input.businessEmail,
      venue_name: input.venueName,
      venue_address: input.venueAddress,
      venue_city: input.venueCity,
      venue_description: input.venueDescription || null,
      court_count: input.courtCount,
      has_liability_insurance: input.hasLiabilityInsurance,
      agreement_accepted_at: new Date().toISOString(),
      agreement_version: CURRENT_OWNER_AGREEMENT_VERSION,
      bank_name: input.bankName,
      bank_account_name: input.bankAccountName,
      bank_account_number: input.bankAccountNumber,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

/** Most recent application for this user — a rejected applicant may re-apply, producing more than one row over time. */
export async function getOwnerApplicationForUser(supabase: Client, userId: string): Promise<OwnerApplication | null> {
  const { data, error } = await supabase
    .from("owner_applications")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * The admin review queue. Deliberately an explicit column allowlist that
 * OMITS bank_name/bank_account_name/bank_account_number, carrying the
 * server-generated `bank_details_complete` boolean instead.
 *
 * The distinction is the whole point: selecting the values and mapping
 * them to a boolean in TypeScript would render a boolean while the network
 * response still carried every applicant's account number — a disguise
 * rather than a fix, and worse than the honest version because it looks
 * solved. `bank_details_complete` is generated in Postgres (migration
 * 20260810000090), so the values never leave the database. Same posture
 * ownerBookings.ts uses to keep PayMongo ids from ever leaving Postgres.
 *
 * A reviewer who genuinely needs to see the values opens one application —
 * getOwnerApplicationForAdmin() below is the only place they are readable,
 * and the approve gate needs presence, not the number itself.
 */
const ADMIN_LIST_COLUMNS =
  "id, user_id, business_name, business_phone, business_email, venue_name, venue_address, venue_city, " +
  "venue_description, court_count, status, reviewed_at, reviewed_by, created_at, updated_at, " +
  "agreement_accepted_at, agreement_version, has_liability_insurance, bank_details_complete";

export type OwnerApplicationListItem = Omit<
  OwnerApplication,
  "bank_name" | "bank_account_name" | "bank_account_number"
>;

export async function listOwnerApplicationsForAdmin(
  supabase: Client,
  status?: OwnerApplicationStatus
): Promise<OwnerApplicationListItem[]> {
  let query = supabase.from("owner_applications").select(ADMIN_LIST_COLUMNS).order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data ?? []) as unknown as OwnerApplicationListItem[];
}

export async function getOwnerApplicationForAdmin(supabase: Client, applicationId: string): Promise<OwnerApplication | null> {
  const { data, error } = await supabase.from("owner_applications").select("*").eq("id", applicationId).maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Grants venue_owner + owner_status='approved' in one admin-session
 * update to the applicant's OWN row — untouched by
 * profiles_prevent_role_change/prevent_owner_status_tampering, both of
 * which only guard SELF-updates (`auth.uid() = new.id`); an admin
 * acting on a different user's row is unaffected by either trigger, the
 * same mechanism setVenueStatusAsAdmin() already relies on for venues.
 * Referral resolution (if any) is the caller's responsibility — see
 * lib/actions/ownerApplications.ts, which orchestrates this alongside
 * lib/services/referrals.ts rather than coupling the two services.
 */
export class OwnerApplicationError extends Error {
  constructor(
    public reason: "not_found" | "missing_bank_details",
    message: string
  ) {
    super(message);
    this.name = "OwnerApplicationError";
  }
}

export async function approveOwnerApplication(
  supabase: Client,
  applicationId: string,
  adminUserId: string
): Promise<OwnerApplication> {
  const application = await getOwnerApplicationForAdmin(supabase, applicationId);
  if (!application) throw new OwnerApplicationError("not_found", "Application not found.");

  // An owner approved without a payout destination is an owner the platform
  // has no way to pay — and because venue_payment_accounts is seeded from
  // this row when they create a venue (migration 20260810000090), approving
  // one now produces an unpayable venue later, far from where the mistake
  // was made. Checked on bank_name alone: the all-or-nothing CHECK means one
  // non-null implies all three.
  if (!application.bank_name) {
    throw new OwnerApplicationError(
      "missing_bank_details",
      "This application has no bank details. The applicant must supply a payout destination before they can be approved."
    );
  }

  const { data, error } = await supabase
    .from("owner_applications")
    .update({ status: "approved", reviewed_at: new Date().toISOString(), reviewed_by: adminUserId })
    .eq("id", applicationId)
    .select("*")
    .single();
  if (error) throw error;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ role: "venue_owner", owner_status: "approved" })
    .eq("id", application.user_id);
  if (profileError) throw profileError;

  return data;
}

export async function rejectOwnerApplication(
  supabase: Client,
  applicationId: string,
  adminUserId: string
): Promise<OwnerApplication> {
  const application = await getOwnerApplicationForAdmin(supabase, applicationId);
  if (!application) throw new Error("Application not found.");

  const { data, error } = await supabase
    .from("owner_applications")
    .update({ status: "rejected", reviewed_at: new Date().toISOString(), reviewed_by: adminUserId })
    .eq("id", applicationId)
    .select("*")
    .single();
  if (error) throw error;

  const { error: profileError } = await supabase
    .from("profiles")
    .update({ owner_status: "rejected" })
    .eq("id", application.user_id);
  if (profileError) throw profileError;

  return data;
}
