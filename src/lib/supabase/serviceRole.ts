import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";
import { getSupabaseEnv } from "@/lib/supabase/env";

/**
 * The one place `SUPABASE_SECRET_KEY` is ever read — narrowly scoped to
 * exactly the operations that genuinely cannot be safely gated any other
 * way: completing/failing a booking_reschedules row (see
 * lib/services/reschedules.ts) and moving AIR/Rally Credits (see
 * lib/services/credits.ts). Every other write in this app (booking
 * creation/cancellation, payment confirmation, refunds, venue/court
 * management) goes through the ordinary per-request, RLS-scoped client
 * from lib/supabase/server.ts — this file is deliberately NOT a general
 * "admin client," and must never be imported outside those two modules'
 * own trusted RPC calls.
 *
 * Why this is necessary here specifically, and wasn't needed anywhere
 * else in this codebase: `confirm_booking_payment()` and similar
 * SECURITY DEFINER RPCs are safe to leave callable by `anon`/
 * `authenticated` because their own WHERE clause requires the caller to
 * supply a provider-generated value (a Stripe/PayMongo checkout session
 * id) that only comes from actually starting a real checkout — a
 * meaningful, if imperfect, proof. `complete_reschedule()` has no
 * equivalent: the only thing distinguishing "the webhook, after
 * independently verifying a real payment/refund" from "the booking's own
 * customer, calling the RPC directly with their own already-known
 * reschedule id" is which CODE is making the call, not any value in the
 * request — and Postgres RLS/GRANTs can't express "only my own server
 * code," only "which authenticated role." Restricting these two RPCs to
 * `service_role` (see supabase/migrations/20260810000015_booking_
 * reschedules.sql) and calling them exclusively through this client is
 * what actually closes that gap — see the production-readiness audit's
 * finding B1.
 *
 * issue_credit()/spend_credit() (20260810000036_air_rally_credits.sql)
 * are restricted for the same reason: a wallet movement is authorised by
 * WHICH CODE is calling — a server action that already checked the caller
 * — not by any value in the request, so leaving them callable by
 * `authenticated` would let any session mint itself credit.
 *
 * Never imported by anything outside lib/services/reschedules.ts and
 * lib/services/credits.ts — grep for `createServiceRoleClient` before
 * adding a new call site, and never import this module from a
 * "use client" component or any code path reachable with only a
 * customer's own session.
 */
export function createServiceRoleClient() {
  const { url } = getSupabaseEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY;
  if (!secretKey) {
    throw new Error(
      "SUPABASE_SECRET_KEY isn't set — required to complete a reschedule (see .env.example). " +
        "Add it from your Supabase project's Settings -> API -> Service role / secret key."
    );
  }
  return createSupabaseClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
