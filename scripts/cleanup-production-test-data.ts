/**
 * Removes approved test data from PRODUCTION. Phase 7 of the migration brief.
 *
 * APPROVED SCOPE, and nothing beyond it:
 *   * all 7 bookings (every one carries a Stripe test-mode or PayMongo
 *     sandbox session — none is a real customer booking)
 *   * all 4 venues: the 3 named "[DEMO] …" plus "Banilad Pickle Club
 *     (Test Venue)", with their cascade
 *
 * That leaves production with no venues and no courts — a clean slate, so
 * real venues arrive through the normal owner-onboarding flow with real
 * owners, real approval and real payment accounts.
 *
 * PRESERVED: profiles, auth.users, and the 13 reference amenities.
 *
 * ORDERING MATTERS: bookings.court_id -> courts is ON DELETE NO ACTION, so
 * deleting a venue cascades to its courts and then FAILS on any booking
 * still referencing them. Bookings are therefore deleted first.
 *
 * Runs as ONE transaction: either the whole cleanup lands or none of it
 * does. A recovery point exists at .backups/production-*.sql.
 *
 * Usage:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/cleanup-production-test-data.ts --confirm
 */
import { Client } from "pg";

const PRODUCTION_REF = "hrpbjudsrqcgyrkkodop";

async function counts(client: Client, label: string): Promise<void> {
  const tables = ["venues", "courts", "bookings", "reviews", "favorites", "venue_operating_hours", "venue_amenities", "profiles"];
  console.log(`\n--- ${label} ---`);
  for (const t of tables) {
    const r = await client.query(`select count(*)::int n from public."${t}"`);
    console.log(`  ${t.padEnd(26)} ${r.rows[0].n}`);
  }
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString?.includes(PRODUCTION_REF)) {
    console.error(`Refusing: DATABASE_URL does not target ${PRODUCTION_REF}.`);
    process.exit(1);
  }
  if (!process.argv.includes("--confirm")) {
    console.error("Refusing: pass --confirm. This deletes production rows.");
    process.exit(1);
  }

  const client = new Client({ connectionString });
  await client.connect();
  console.log(`Connected to production (${PRODUCTION_REF}).`);

  await counts(client, "BEFORE");

  try {
    await client.query("begin");

    const bookings = await client.query(`delete from public.bookings returning id`);
    console.log(`\n  deleted bookings              ${bookings.rowCount}`);

    // Cascades to courts, venue_operating_hours, venue_amenities,
    // court_images, reviews and favorites belonging to these venues.
    const venues = await client.query(`delete from public.venues returning id, name`);
    console.log(`  deleted venues                ${venues.rowCount}`);
    venues.rows.forEach((r: { name: string }) => console.log(`    - ${r.name}`));

    await client.query("commit");
    console.log("\nCommitted.");
  } catch (error) {
    await client.query("rollback").catch(() => undefined);
    console.error("\nFAILED — rolled back, production unchanged.");
    console.error((error as Error).message);
    await client.end();
    process.exit(1);
  }

  await counts(client, "AFTER");
  await client.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
