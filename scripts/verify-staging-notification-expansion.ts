/**
 * Read-only inspection of the Phase 7.5 notification-expansion triggers
 * against whatever database DATABASE_URL points at — gated by
 * assert-staging-env.ts. Issues no writes at all; safe to run any number
 * of times.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-notification-expansion.ts
 */
import "./assert-staging-env";
import { Client } from "pg";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

const FUNCTIONS = ["notify_on_booking_created", "notify_on_venue_moderation_change"];
const TRIGGERS: { name: string; table: string }[] = [
  { name: "bookings_notify_on_created", table: "bookings" },
  { name: "venues_notify_on_moderation_change", table: "venues" },
];

async function main() {
  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();
  console.log("Connected.\n");

  let allOk = true;

  for (const fn of FUNCTIONS) {
    const result = await client.query(
      `select prosecdef from pg_proc where proname = $1 and pronamespace = 'public'::regnamespace`,
      [fn]
    );
    if (result.rows.length === 0) {
      console.log(`✗ Function "${fn}" does not exist`);
      allOk = false;
      continue;
    }
    const isSecurityDefiner = result.rows[0].prosecdef;
    console.log(`${isSecurityDefiner ? "✓" : "✗"} Function "${fn}" exists, ${isSecurityDefiner ? "SECURITY DEFINER" : "NOT security definer"}`);
    if (!isSecurityDefiner) allOk = false;
  }

  console.log();
  for (const { name, table } of TRIGGERS) {
    const result = await client.query(
      `select tgenabled from pg_trigger where tgname = $1 and tgrelid = $2::regclass and not tgisinternal`,
      [name, `public.${table}`]
    );
    if (result.rows.length === 0) {
      console.log(`✗ Trigger "${name}" on ${table} does not exist`);
      allOk = false;
      continue;
    }
    const enabled = result.rows[0].tgenabled !== "D";
    console.log(`${enabled ? "✓" : "✗"} Trigger "${name}" on ${table} exists, ${enabled ? "enabled" : "DISABLED"}`);
    if (!enabled) allOk = false;
  }

  // The notifications table must still have no client INSERT policy —
  // every row comes from a SECURITY DEFINER trigger, and 7.5 must not
  // have weakened that.
  console.log();
  const insertPolicies = await client.query(
    `select polname from pg_policy where polrelid = 'public.notifications'::regclass and polcmd = 'a'`
  );
  if (insertPolicies.rows.length === 0) {
    console.log("✓ notifications still has no client INSERT policy (trigger-only writes)");
  } else {
    console.log(`✗ notifications gained an INSERT policy: ${insertPolicies.rows.map((r) => r.polname).join(", ")}`);
    allOk = false;
  }

  await client.end();
  console.log(`\n${allOk ? "All checks passed." : "Some checks FAILED."}`);
  process.exit(allOk ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
