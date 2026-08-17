/**
 * Verifies that resharing now surfaces a post in the feed (migration
 * 20260810000050's court_side_feed RPC).
 *
 * Before it, reshare was half-built: pressing it inserted a post_reshares
 * row, bumped reshare_count and notified the author, and nothing surfaced
 * the post anywhere. This proves the union actually reorders the feed.
 *
 * Also checks the property the RPC's own doc comment claims and which is
 * easy to get wrong: it must be SECURITY INVOKER, so RLS still applies.
 * Migrations 047 and 048 both closed holes created by definer functions
 * reachable from a browser session.
 *
 * WRITES: throwaway users and posts, removed in a `finally`. Cleanup
 * failures are REPORTED, not swallowed.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-reshare-feed.ts
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

type FeedRow = { id: string; user_id: string; effective_at: string; resharer_id: string | null };

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const author = randomUUID();
  const resharer = randomUUID();
  const userIds = [author, resharer];
  let oldPost = "";
  let newPost = "";

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `reshare-${run}-${i}@example.test`]
      );
    }

    // An OLD post and a NEWER one. Without a reshare the old one sorts
    // second; the whole point is that resharing it moves it back to first.
    const older = await pg.query(
      `insert into public.posts (user_id, content, created_at) values ($1, $2, now() - interval '3 days') returning id`,
      [author, `old post ${run}`]
    );
    oldPost = older.rows[0].id;
    const newer = await pg.query(
      `insert into public.posts (user_id, content, created_at) values ($1, $2, now() - interval '1 hour') returning id`,
      [author, `new post ${run}`]
    );
    newPost = newer.rows[0].id;
    console.log(`Seeded 2 users and 2 posts (run ${run}).\n`);

    async function feed(): Promise<FeedRow[]> {
      const r = await pg.query(`select id, user_id, effective_at, resharer_id from public.court_side_feed(50, null)`);
      return r.rows as FeedRow[];
    }

    console.log("— Before the reshare —");
    const before = await feed();
    const beforeOld = before.findIndex((r) => r.id === oldPost);
    const beforeNew = before.findIndex((r) => r.id === newPost);
    check(
      "the older post sorts below the newer one",
      beforeOld > beforeNew && beforeNew !== -1,
      `old at ${beforeOld}, new at ${beforeNew}`
    );
    check(
      "each post appears exactly once when nothing is reshared",
      before.filter((r) => r.id === oldPost).length === 1,
      `${before.filter((r) => r.id === oldPost).length} rows for the old post`
    );

    console.log("\n— After someone reshares the older post —");
    await pg.query(`insert into public.post_reshares (post_id, user_id) values ($1, $2)`, [oldPost, resharer]);

    const after = await feed();
    const reshareRow = after.find((r) => r.id === oldPost && r.resharer_id === resharer);
    check("a reshare row appears in the feed", Boolean(reshareRow));
    check(
      "it is attributed to the resharer, not the author",
      reshareRow?.resharer_id === resharer && reshareRow?.user_id === author,
      `resharer_id=${reshareRow?.resharer_id}, user_id=${reshareRow?.user_id}`
    );

    const afterReshareIndex = after.findIndex((r) => r.id === oldPost && r.resharer_id === resharer);
    const afterNewIndex = after.findIndex((r) => r.id === newPost);
    check(
      "the reshare lifts the old post ABOVE the newer one",
      afterReshareIndex !== -1 && afterReshareIndex < afterNewIndex,
      `reshare at ${afterReshareIndex}, newer post at ${afterNewIndex}`
    );
    check(
      "the original still appears in its own place too",
      after.some((r) => r.id === oldPost && r.resharer_id === null),
      "the original row disappeared, which would hide it from the author's followers"
    );

    console.log("\n— Resharing your own post —");
    await pg.query(`insert into public.post_reshares (post_id, user_id) values ($1, $2)`, [newPost, author]);
    const afterSelf = await feed();
    check(
      "a self-reshare adds no duplicate row",
      afterSelf.filter((r) => r.id === newPost).length === 1,
      `${afterSelf.filter((r) => r.id === newPost).length} rows for a post the author reshared themselves`
    );

    console.log("\n— The function does not bypass RLS —");
    const definer = await pg.query(
      `select p.prosecdef from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname = 'court_side_feed'`
    );
    check(
      "court_side_feed() is SECURITY INVOKER, so RLS still applies",
      definer.rows[0]?.prosecdef === false,
      definer.rows[0]?.prosecdef ? "it is SECURITY DEFINER — it would bypass RLS" : "not found"
    );

    console.log("\n— Pagination —");
    const firstPage = await pg.query(`select id, effective_at from public.court_side_feed(1, null)`);
    const cursor = firstPage.rows[0]?.effective_at;
    const secondPage = await pg.query(`select id, effective_at from public.court_side_feed(1, $1)`, [cursor]);
    check(
      "the cursor advances rather than repeating the first row",
      secondPage.rows.length === 0 || secondPage.rows[0].id !== firstPage.rows[0].id,
      `first=${firstPage.rows[0]?.id}, second=${secondPage.rows[0]?.id}`
    );
  } finally {
    console.log("\nCleaning up…");
    const steps: [string, string, unknown[]][] = [
      ["post_reshares", `delete from public.post_reshares where user_id = any($1::uuid[])`, [userIds]],
      ["posts", `delete from public.posts where user_id = any($1::uuid[])`, [userIds]],
      ["notifications", `delete from public.notifications where user_id = any($1::uuid[])`, [userIds]],
      ["auth.users", `delete from auth.users where id = any($1::uuid[])`, [userIds]],
    ];
    for (const [label, sql, params] of steps) {
      try {
        const r = await pg.query(sql, params);
        console.log(`  ${label.padEnd(16)} removed ${r.rowCount}`);
      } catch (error) {
        console.error(`  ${label.padEnd(16)} CLEANUP FAILED — ${(error as Error).message}`);
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
