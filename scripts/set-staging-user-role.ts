/**
 * Grants or revokes a platform role for one account on whatever database
 * DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * This exists because `profiles_prevent_role_change`
 * (20260809000001_profiles.sql) deliberately stops a user from granting
 * themselves a role through the app, so admin access has to be conferred
 * from outside the request path. It changes a role only — it never
 * creates an account, sets a password, or touches auth credentials.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/set-staging-user-role.ts <email> <player|venue_owner|admin>
 */
import "./assert-staging-env";
import { Client } from "pg";

const ROLES = ["player", "venue_owner", "admin"] as const;
type Role = (typeof ROLES)[number];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

async function main() {
  const [email, role] = process.argv.slice(2);

  if (!email || !role || !(ROLES as readonly string[]).includes(role)) {
    console.error(`Usage: set-staging-user-role.ts <email> <${ROLES.join("|")}>`);
    process.exit(1);
  }

  const client = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await client.connect();

  try {
    const result = await client.query(
      `update public.profiles
       set role = $2
       where id = (select id from auth.users where email = $1)
       returning id`,
      [email, role as Role]
    );

    if (result.rowCount === 0) {
      console.error(`✗ No account found for ${email} on this database.`);
      process.exit(1);
    }

    console.log(`✓ ${email} is now '${role}'.`);

    const admins = await client.query(
      `select u.email from public.profiles p join auth.users u on u.id = p.id where p.role = 'admin' order by u.email`
    );
    console.log(`\nAdmins on this database (${admins.rows.length}):`);
    admins.rows.forEach((row) => console.log(`  - ${row.email}`));
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
