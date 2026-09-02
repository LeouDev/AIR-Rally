/**
 * Proves migration 124: notify_on_owner_application_change() fires
 * exactly on pending -> approved (never emitted before this migration,
 * confirmed by querying every distinct notifications.type value that
 * has ever existed on staging), and does NOT fire on other transitions
 * (pending -> rejected, or a no-op update that leaves status
 * unchanged) — the guard is `old.status = 'pending' and new.status =
 * 'approved'` specifically, not just "status changed."
 *
 * Run with:
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-owner-application-approved-notification.ts
 * (after sourcing .env.staging).
 */
import "./assert-staging-env";
import { Client } from "pg";

let failures = 0;

function assertEqual(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? "OK  " : "FAIL"} ${label}: got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)}`);
  if (!ok) failures++;
}

const OWNER = "3e1c4aa5-2122-4343-a3e2-321c11961a74"; // MOBILE, reused test account

async function makeApplication(client: Client, userId: string): Promise<string> {
  const r = await client.query(
    `insert into public.owner_applications
       (user_id, business_name, business_phone, business_email, venue_name, venue_address, venue_city, court_count, status)
     values ($1, 'Test Biz', '09170000000', 'test@example.com', 'Test Venue', '123 Test St', 'taguig', 1, 'pending')
     returning id`,
    [userId]
  );
  return r.rows[0].id;
}

async function main() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  const applicationIds: string[] = [];
  await client.query(`delete from public.notifications where user_id = $1 and type = 'owner_application_approved'`, [OWNER]);

  try {
    console.log("\n=== pending -> approved fires the notification ===\n");
    const app1 = await makeApplication(client, OWNER);
    applicationIds.push(app1);
    await client.query(`update public.owner_applications set status = 'approved' where id = $1`, [app1]);

    const notif1 = await client.query(
      `select type, title, message from public.notifications where user_id = $1 and type = 'owner_application_approved' order by created_at desc limit 1`,
      [OWNER]
    );
    assertEqual("a notification was created", notif1.rows.length, 1);
    assertEqual("title is set", notif1.rows[0]?.title, "Your venue application was approved");

    console.log("\n=== pending -> rejected does NOT fire it ===\n");
    const app2 = await makeApplication(client, OWNER);
    applicationIds.push(app2);
    const before = await client.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'owner_application_approved'`,
      [OWNER]
    );
    await client.query(`update public.owner_applications set status = 'rejected' where id = $1`, [app2]);
    const after = await client.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'owner_application_approved'`,
      [OWNER]
    );
    assertEqual("rejection does not add a new owner_application_approved row", after.rows[0].n, before.rows[0].n);

    console.log("\n=== a no-op update (status unchanged) does NOT fire it ===\n");
    const app3 = await makeApplication(client, OWNER);
    applicationIds.push(app3);
    const before2 = await client.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'owner_application_approved'`,
      [OWNER]
    );
    await client.query(`update public.owner_applications set business_phone = '09171111111' where id = $1`, [app3]);
    const after2 = await client.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'owner_application_approved'`,
      [OWNER]
    );
    assertEqual("an unrelated field update does not fire the trigger", after2.rows[0].n, before2.rows[0].n);

    console.log("\n=== approving an ALREADY-approved row again does not double-fire ===\n");
    const before3 = await client.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'owner_application_approved'`,
      [OWNER]
    );
    await client.query(`update public.owner_applications set status = 'approved' where id = $1`, [app1]);
    const after3 = await client.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'owner_application_approved'`,
      [OWNER]
    );
    assertEqual("re-saving an already-approved row does not fire it again (old.status is already 'approved')", after3.rows[0].n, before3.rows[0].n);
  } finally {
    console.log("\n=== teardown ===\n");
    await client.query(`delete from public.notifications where user_id = $1 and type = 'owner_application_approved'`, [OWNER]);
    if (applicationIds.length) await client.query(`delete from public.owner_applications where id = any($1)`, [applicationIds]);
    console.log("fixtures cleaned up.");
  }

  console.log(`\n${failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`}\n`);
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
