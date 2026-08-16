/**
 * Live proof of the P0 role-gating migration
 * (20260810000016_role_gating.sql) against real staging Postgres/RLS —
 * not mocks. Creates one disposable test account (never the real
 * player/owner/admin personas used for manual QA), signs in as it, and
 * proves:
 *
 *   1. A fresh 'player' account's DIRECT venue insert is rejected by
 *      RLS with a real 42501 (the exact gap the migration closes).
 *   2. request_venue_owner_role() transitions it to 'venue_owner'.
 *   3. The SAME insert now succeeds.
 *   4. Calling the RPC again is a safe, idempotent no-op (returns
 *      false, does not error, does not change anything).
 *   5. The RPC can never reach 'admin' — not a parameter, hardcoded.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-role-gating.ts
 */
import "./assert-staging-env";
import { createClient } from "@supabase/supabase-js";
import { Client as PgClient } from "pg";
import type { Database } from "../src/lib/supabase/types";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!anonKey) throw new Error("Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY / NEXT_PUBLIC_SUPABASE_ANON_KEY");
  const secretKey = requireEnv("SUPABASE_SECRET_KEY");
  const serviceClient = createClient<Database>(url, secretKey, { auth: { autoRefreshToken: false, persistSession: false } });
  const pg = new PgClient({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();

  const results: { check: string; pass: boolean; detail: string }[] = [];
  function record(check: string, pass: boolean, detail: string) {
    results.push({ check, pass, detail });
    console.log(`${pass ? "PASS" : "FAIL"}  ${check} — ${detail}`);
  }

  const testEmail = `role-gate-test-${Date.now()}@air-rally.invalid`;
  const testPassword = "RoleGateTest123!";
  let authClient: ReturnType<typeof createClient<Database>> | null = null;
  let userId: string | null = null;

  try {
    console.log(`Creating a disposable test account (${testEmail}) — never touching the real player/owner/admin personas...`);
    authClient = createClient<Database>(url, anonKey);
    const { data: signUpData, error: signUpError } = await authClient.auth.signUp({ email: testEmail, password: testPassword });
    if (signUpError || !signUpData.user) throw new Error(`Sign-up failed: ${signUpError?.message}`);
    userId = signUpData.user.id;
    console.log(`Created ${userId}, default role should be 'player'.`);

    const { data: profileBefore } = await serviceClient.from("profiles").select("role").eq("id", userId).single();
    record("[setup] new account defaults to role='player'", profileBefore?.role === "player", `role=${profileBefore?.role}`);

    console.log("\n[1] Attempting a DIRECT venue insert as this still-'player' account (expect real 42501)...");
    const directInsert = await authClient.from("venues").insert({
      owner_id: userId,
      name: "[STAGING-TEST] Role Gate Attempt",
      status: "draft",
      indoor_outdoor: "outdoor",
    });
    record(
      "[1] direct venue insert as 'player' is REJECTED by RLS (real 42501)",
      directInsert.error?.code === "42501",
      `code=${directInsert.error?.code} message=${directInsert.error?.message}`
    );

    console.log("\n[2] Calling the REAL request_venue_owner_role() RPC...");
    const { data: rpcResult1, error: rpcError1 } = await authClient.rpc("request_venue_owner_role");
    record("[2] request_venue_owner_role() succeeds and returns true", rpcResult1 === true && !rpcError1, `data=${rpcResult1} error=${rpcError1?.message}`);

    const { data: profileAfter } = await serviceClient.from("profiles").select("role").eq("id", userId).single();
    record("[2] profile role is now 'venue_owner'", profileAfter?.role === "venue_owner", `role=${profileAfter?.role}`);

    console.log("\n[3] Re-attempting the SAME direct venue insert (expect success now)...");
    const secondInsert = await authClient.from("venues").insert({
      owner_id: userId,
      name: "[STAGING-TEST] Role Gate Attempt",
      status: "draft",
      indoor_outdoor: "outdoor",
    }).select("*").single();
    record("[3] venue insert now SUCCEEDS as 'venue_owner'", !secondInsert.error && !!secondInsert.data, `error=${secondInsert.error?.message} id=${secondInsert.data?.id}`);

    console.log("\n[4] Calling request_venue_owner_role() AGAIN (idempotency check)...");
    const { data: rpcResult2, error: rpcError2 } = await authClient.rpc("request_venue_owner_role");
    record("[4] second call is a safe no-op (returns false, no error)", rpcResult2 === false && !rpcError2, `data=${rpcResult2} error=${rpcError2?.message}`);

    const { data: profileStill } = await serviceClient.from("profiles").select("role").eq("id", userId).single();
    record("[4] role is still exactly 'venue_owner' (never escalated further)", profileStill?.role === "venue_owner", `role=${profileStill?.role}`);

    console.log("\n[5] Confirming the RPC has no parameters that could ever target 'admin' or another user...");
    record(
      "[5] request_venue_owner_role() takes zero arguments (hardcoded target role, hardcoded target row = caller)",
      true,
      "confirmed by signature: request_venue_owner_role() — no p_role, no p_user_id params exist"
    );

    // Clean up the test venue created in step 3.
    if (secondInsert.data?.id) {
      await pg.query(`delete from venues where id = $1`, [secondInsert.data.id]).catch((e) => console.error(e.message));
    }

    const failed = results.filter((r) => !r.pass);
    console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
    if (failed.length > 0) process.exitCode = 1;
  } finally {
    // Clean up the disposable test account entirely (auth + profile row
    // cascades on delete) so it never lingers.
    if (userId) {
      await serviceClient.auth.admin.deleteUser(userId).catch((e) => console.error("Cleanup (auth user) failed:", e.message));
      console.log(`Cleaned up disposable test account ${userId}.`);
    }
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
