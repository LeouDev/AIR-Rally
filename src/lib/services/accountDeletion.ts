import { createServiceRoleClient } from "@/lib/supabase/serviceRole";

/**
 * Self-service account deletion — Apple Guideline 5.1.1(v). SERVER ONLY,
 * for the same reason lib/services/credits.ts's writes are: this needs
 * the Supabase Admin API (banning a user, scrubbing their auth email,
 * revoking every session), which only a service-role client can call.
 * The caller's own token has already been verified before this runs — see
 * app/api/mobile/account/delete/route.ts, this module's only call site.
 *
 * This does NOT delete the auth.users/profiles row. `anonymize_account()`
 * (supabase/migrations/20260810000074_account_deletion.sql) explains why:
 * a real DELETE would fail outright for any user with a booking (no
 * `on delete cascade` on bookings.user_id), and would destroy
 * credit_transactions' documented-immutable ledger for anyone it didn't
 * fail for. Anonymizing in place is the only path that satisfies both the
 * schema and Apple's requirement.
 */

/** Reused across calls, same lazy pattern reschedules.ts/credits.ts use. */
let accountDeletionServiceRoleClient: ReturnType<typeof createServiceRoleClient> | null = null;
function getServiceRoleClient() {
  accountDeletionServiceRoleClient ??= createServiceRoleClient();
  return accountDeletionServiceRoleClient;
}

export type DeleteAccountResult = { success: true } | { success: false; error: string };

/**
 * Anonymizes profile PII, then locks the auth.users row out permanently:
 * bans it (so no future sign-in — password, magic link, or OAuth — can
 * succeed), scrubs its email so the original address is no longer
 * associated with the account, and revokes every existing session
 * globally so an already-signed-in device is logged out too.
 *
 * Order matters: the data-layer anonymization runs first. If it fails,
 * nothing has happened to auth yet and the caller can safely retry. If the
 * auth-layer lockout fails after data anonymization already succeeded,
 * the account is at least PII-scrubbed and worth logging loudly — that
 * partial state is why this returns a structured result instead of just
 * throwing, so the route can decide how to surface it.
 */
export async function deleteAccount(userId: string): Promise<DeleteAccountResult> {
  const client = getServiceRoleClient();

  const { error: anonymizeError } = await client.rpc("anonymize_account", { p_user_id: userId });
  if (anonymizeError) {
    return { success: false, error: "We couldn't delete your account. Please try again." };
  }

  const banResult = await client.auth.admin.updateUserById(userId, {
    email: `deleted+${userId}@deleted.air-rally.internal`,
    // Supabase's admin API takes ban_duration as a Postgres interval
    // string; there's no "forever", so this is the longest practical
    // stand-in — a century, which for a booking app is permanent.
    ban_duration: "876000h",
  });
  if (banResult.error) {
    return {
      success: false,
      error: "Your account data was deleted, but signing you out failed. Please contact support.",
    };
  }

  await client.auth.admin.signOut(userId, "global").catch(() => {
    // Not fatal: the account is already banned, so even an un-revoked
    // session's next request will be rejected by Supabase Auth itself.
  });

  return { success: true };
}
