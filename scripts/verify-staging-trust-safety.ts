/**
 * Behavioural verification of the trust & safety layer (migration
 * 20260810000049): reports, support requests, and the database-enforced
 * rate limits.
 *
 * These are the rules the UI cannot be trusted to enforce:
 *   * a reporter files only as themselves, and cannot read anyone else's
 *     reports or resolve their own
 *   * an admin sees the whole queue and is the only one who can resolve
 *   * a report OUTLIVES the thing it describes, so deleting an abusive
 *     post does not erase the moderation record
 *   * the same person cannot file two open reports on the same target,
 *     but CAN report again once the first is resolved
 *   * the rate limiter counts and rejects, exempts admins, and does not
 *     interfere with service-role writes
 *
 * WRITES: throwaway users, a club, posts and reports, removed in a
 * `finally`. Cleanup failures are REPORTED, not swallowed.
 *
 * Gated by assert-staging-env.ts: it refuses to run against production.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-trust-safety.ts
 */
import "./assert-staging-env";
import { Client } from "pg";
import { randomUUID } from "crypto";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

let passed = 0;
let failed = 0;

function check(label: string, condition: boolean, detail?: string) {
  if (condition) {
    console.log(`✓ ${label}`);
    passed += 1;
  } else {
    console.log(`✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

async function asUser<T>(pg: Client, userId: string, fn: () => Promise<T>): Promise<T> {
  await pg.query("begin");
  await pg.query("set local role authenticated");
  await pg.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: userId, role: "authenticated" })]);
  try {
    const result = await fn();
    await pg.query("commit");
    return result;
  } catch (error) {
    await pg.query("rollback").catch(() => undefined);
    throw error;
  }
}

/** Runs fn as the user and reports whether it was rejected, without throwing. */
async function attempt(pg: Client, userId: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await asUser(pg, userId, fn);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const reporter = randomUUID();
  const author = randomUUID();
  const admin = randomUUID();
  const userIds = [reporter, author, admin];
  let postId = "";

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `trustsafety-${run}-${i}@example.test`]
      );
    }
    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    const post = await pg.query(`insert into public.posts (user_id, content) values ($1, $2) returning id`, [
      author,
      `Trust and safety test post ${run}`,
    ]);
    postId = post.rows[0].id;
    console.log(`Seeded 3 users (reporter, author, admin) and 1 post (run ${run}).\n`);

    // --- Filing -----------------------------------------------------------
    console.log("— Filing a report —");
    let reportId = "";
    await asUser(pg, reporter, async () => {
      const r = await pg.query(
        `insert into public.reports (reporter_id, target_type, target_id, reason, details)
         values ($1, 'post', $2, 'harassment', 'test report') returning id`,
        [reporter, postId]
      );
      reportId = r.rows[0].id;
    });
    check("a signed-in user can file a report", Boolean(reportId));

    const forged = await attempt(pg, reporter, async () => {
      await pg.query(
        `insert into public.reports (reporter_id, target_type, target_id, reason)
         values ($1, 'post', $2, 'spam')`,
        [author, postId]
      );
    });
    check("a user cannot file a report as someone else", forged !== null, forged ?? "NOT REJECTED");

    const duplicate = await attempt(pg, reporter, async () => {
      await pg.query(
        `insert into public.reports (reporter_id, target_type, target_id, reason)
         values ($1, 'post', $2, 'spam')`,
        [reporter, postId]
      );
    });
    check("the same user cannot file two OPEN reports on one target", duplicate !== null, duplicate ?? "NOT REJECTED");

    // --- Visibility -------------------------------------------------------
    console.log("\n— Who can see the queue —");
    const authorSees = await asUser(pg, author, async () => {
      const r = await pg.query(`select id from public.reports where id = $1`, [reportId]);
      return r.rowCount;
    });
    check("the reported user cannot see the report against them", authorSees === 0, `saw ${authorSees} row(s)`);

    const reporterSees = await asUser(pg, reporter, async () => {
      const r = await pg.query(`select id from public.reports where id = $1`, [reportId]);
      return r.rowCount;
    });
    check("the reporter can see their own report", reporterSees === 1, `saw ${reporterSees} row(s)`);

    const adminSees = await asUser(pg, admin, async () => {
      const r = await pg.query(`select id from public.reports where id = $1`, [reportId]);
      return r.rowCount;
    });
    check("an admin can see the report", adminSees === 1, `saw ${adminSees} row(s)`);

    // --- Resolution -------------------------------------------------------
    console.log("\n— Resolving —");
    await asUser(pg, reporter, async () => {
      await pg.query(`update public.reports set status = 'dismissed', resolved_by = $1, resolved_at = now() where id = $2`, [
        reporter,
        reportId,
      ]);
    }).catch(() => undefined);
    const afterReporter = await pg.query(`select status from public.reports where id = $1`, [reportId]);
    check(
      "a reporter cannot resolve their own report",
      afterReporter.rows[0].status === "open",
      `status is '${afterReporter.rows[0].status}'`
    );

    await asUser(pg, admin, async () => {
      await pg.query(`update public.reports set status = 'reviewed', resolved_by = $1, resolved_at = now() where id = $2`, [
        admin,
        reportId,
      ]);
    });
    const afterAdmin = await pg.query(`select status, resolved_by from public.reports where id = $1`, [reportId]);
    check("an admin can resolve a report", afterAdmin.rows[0].status === "reviewed" && afterAdmin.rows[0].resolved_by === admin);

    // The CHECK must reject a resolution that records no resolver.
    const incomplete = await pg
      .query(`update public.reports set status = 'dismissed', resolved_by = null, resolved_at = null where id = $1`, [reportId])
      .then(() => null)
      .catch((e: Error) => e.message);
    check("a resolved report cannot be left without a resolver", incomplete !== null, incomplete ?? "NOT REJECTED");

    // Once resolved, the same target can be reported again — it may have
    // got worse. This is why the unique index is partial.
    let secondReport = "";
    const reReport = await attempt(pg, reporter, async () => {
      const r = await pg.query(
        `insert into public.reports (reporter_id, target_type, target_id, reason)
         values ($1, 'post', $2, 'spam') returning id`,
        [reporter, postId]
      );
      secondReport = r.rows[0].id;
    });
    check("the same target CAN be reported again once resolved", reReport === null && Boolean(secondReport), reReport ?? "");

    // --- The report outlives its target -----------------------------------
    console.log("\n— A report survives its target —");
    await pg.query(`delete from public.posts where id = $1`, [postId]);
    const survived = await pg.query(`select count(*)::int n from public.reports where target_id = $1`, [postId]);
    check(
      "deleting the reported post does not delete the reports",
      survived.rows[0].n === 2,
      `${survived.rows[0].n} report(s) remain, expected 2`
    );
    postId = "";

    // --- Rate limits ------------------------------------------------------
    console.log("\n— Rate limits —");
    // Threshold is 10 posts/hour. Post 10, expect the 11th to be rejected.
    let postsCreated = 0;
    let limitMessage: string | null = null;
    for (let i = 0; i < 12; i += 1) {
      const err = await attempt(pg, author, async () => {
        await pg.query(`insert into public.posts (user_id, content) values ($1, $2)`, [author, `rate limit probe ${run} #${i}`]);
      });
      if (err) {
        limitMessage = err;
        break;
      }
      postsCreated += 1;
    }
    check(
      "posting is limited to 10 per hour",
      postsCreated === 10 && limitMessage !== null,
      limitMessage ? `stopped after ${postsCreated}` : `created ${postsCreated} with no limit hit`
    );
    check(
      "the limit error is a check_violation the app can map to a friendly message",
      (limitMessage ?? "").includes("rate limit reached"),
      limitMessage ?? "no error"
    );

    // Admins are exempt: moderation involves legitimate bursts.
    let adminPosts = 0;
    for (let i = 0; i < 12; i += 1) {
      const err = await attempt(pg, admin, async () => {
        await pg.query(`insert into public.posts (user_id, content) values ($1, $2)`, [admin, `admin probe ${run} #${i}`]);
      });
      if (err) break;
      adminPosts += 1;
    }
    check("admins are exempt from the post limit", adminPosts === 12, `created ${adminPosts} of 12`);

    // Service-role writes are not user actions and must not be limited —
    // otherwise a backfill or a trigger-driven insert could start failing.
    let serviceWrites = 0;
    for (let i = 0; i < 12; i += 1) {
      try {
        await pg.query(`insert into public.posts (user_id, content) values ($1, $2)`, [reporter, `service probe ${run} #${i}`]);
        serviceWrites += 1;
      } catch {
        break;
      }
    }
    check("service-role writes are not rate limited", serviceWrites === 12, `wrote ${serviceWrites} of 12`);

    // --- Support requests -------------------------------------------------
    console.log("\n— Support requests —");
    let supportId = "";
    await asUser(pg, reporter, async () => {
      const r = await pg.query(
        `insert into public.support_requests (user_id, category, subject, message)
         values ($1, 'booking', 'Test subject', 'Test message') returning id`,
        [reporter]
      );
      supportId = r.rows[0].id;
    });
    check("a user can raise a support request", Boolean(supportId));

    const otherSees = await asUser(pg, author, async () => {
      const r = await pg.query(`select id from public.support_requests where id = $1`, [supportId]);
      return r.rowCount;
    });
    check("another user cannot read someone else's support request", otherSees === 0, `saw ${otherSees} row(s)`);

    const adminSeesSupport = await asUser(pg, admin, async () => {
      const r = await pg.query(`select id from public.support_requests where id = $1`, [supportId]);
      return r.rowCount;
    });
    check("an admin can read it", adminSeesSupport === 1, `saw ${adminSeesSupport} row(s)`);
  } finally {
    console.log("\nCleaning up…");
    const steps: [string, string, unknown[]][] = [
      ["reports", `delete from public.reports where reporter_id = any($1::uuid[])`, [userIds]],
      ["support_requests", `delete from public.support_requests where user_id = any($1::uuid[])`, [userIds]],
      ["posts", `delete from public.posts where user_id = any($1::uuid[])`, [userIds]],
      ["notifications", `delete from public.notifications where user_id = any($1::uuid[])`, [userIds]],
      ["auth.users", `delete from auth.users where id = any($1::uuid[])`, [userIds]],
    ];
    for (const [label, sql, params] of steps) {
      try {
        const r = await pg.query(sql, params);
        console.log(`  ${label.padEnd(18)} removed ${r.rowCount}`);
      } catch (error) {
        console.error(`  ${label.padEnd(18)} CLEANUP FAILED — ${(error as Error).message}`);
        failed += 1;
      }
    }
    await pg.end();
  }

  console.log(`\n${failed === 0 ? "All checks passed." : "Some checks FAILED."} (${passed} passed, ${failed} failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
