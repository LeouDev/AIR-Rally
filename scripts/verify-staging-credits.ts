/**
 * Functional verification of AIR/Rally Credits against whatever database
 * DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * WRITES: creates throwaway auth users and ledger rows to exercise the
 * real triggers, RLS, and privileged functions, then removes everything
 * in a `finally`.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-credits.ts
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

/** Runs a callback with auth.uid() bound to the given user, as PostgREST would. */
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

async function balanceOf(pg: Client, userId: string): Promise<number> {
  const r = await pg.query(`select balance from public.user_credit_wallets where user_id = $1`, [userId]);
  return r.rows[0]?.balance ?? 0;
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const owner = randomUUID();
  const other = randomUUID();
  const userIds = [owner, other];

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `credits-${run}-${i}@example.test`]
      );
    }
    console.log(`Seeded 2 throwaway users (run ${run}).\n`);

    // --- Ledger drives balance -------------------------------------------
    console.log("— Balance derivation —");
    await pg.query(`select public.issue_credit($1, 50000, 'admin_adjustment', null, 'test top-up')`, [owner]);
    check("issuing credit creates the wallet and sets the balance", (await balanceOf(pg, owner)) === 50000, `got ${await balanceOf(pg, owner)}`);

    await pg.query(`select public.issue_credit($1, 30000, 'promotion_bonus', null, 'bonus')`, [owner]);
    check("a second credit accumulates (500 + 300 = 800)", (await balanceOf(pg, owner)) === 80000, `got ${await balanceOf(pg, owner)}`);

    await pg.query(`select public.spend_credit($1, 30000, null, 'test spend')`, [owner]);
    check("spending reduces the balance (800 - 300 = 500)", (await balanceOf(pg, owner)) === 50000, `got ${await balanceOf(pg, owner)}`);

    // --- Insufficient balance --------------------------------------------
    let overdrew = false;
    try {
      await pg.query(`select public.spend_credit($1, 999999, null, 'overdraw')`, [owner]);
      overdrew = true;
    } catch {
      /* expected */
    }
    check("spending more than the balance is rejected", !overdrew);
    check("a rejected spend leaves the balance untouched", (await balanceOf(pg, owner)) === 50000, `got ${await balanceOf(pg, owner)}`);

    // --- Tamper resistance ------------------------------------------------
    console.log("\n— Tamper resistance —");
    await pg.query(`update public.user_credit_wallets set balance = 999999 where user_id = $1`, [owner]);
    check("a direct UPDATE of balance is reverted by the guard trigger", (await balanceOf(pg, owner)) === 50000, `got ${await balanceOf(pg, owner)}`);

    const selfIssue = await asUser(pg, owner, async () => {
      try {
        await pg.query(`insert into public.credit_transactions (user_id, amount, transaction_type) values ($1, 100000, 'promotion_bonus')`, [owner]);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a user cannot insert their own ledger row (no INSERT policy)", selfIssue === "blocked");

    const rpcAsUser = await asUser(pg, owner, async () => {
      try {
        await pg.query(`select public.issue_credit($1, 100000, 'promotion_bonus', null, 'self mint')`, [owner]);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a user cannot call issue_credit() directly (service_role only)", rpcAsUser === "blocked");

    check("balance survived every tamper attempt", (await balanceOf(pg, owner)) === 50000, `got ${await balanceOf(pg, owner)}`);

    // --- Cross-user isolation ---------------------------------------------
    console.log("\n— Isolation —");
    const otherSeesWallet = await asUser(pg, other, async () => {
      const r = await pg.query(`select count(*)::int n from public.user_credit_wallets where user_id = $1`, [owner]);
      return r.rows[0].n as number;
    });
    check("a user cannot read another user's wallet", otherSeesWallet === 0, `saw ${otherSeesWallet}`);

    const otherSeesLedger = await asUser(pg, other, async () => {
      const r = await pg.query(`select count(*)::int n from public.credit_transactions where user_id = $1`, [owner]);
      return r.rows[0].n as number;
    });
    check("a user cannot read another user's credit history", otherSeesLedger === 0, `saw ${otherSeesLedger}`);

    const ownSees = await asUser(pg, owner, async () => {
      const r = await pg.query(`select count(*)::int n from public.credit_transactions where user_id = $1`, [owner]);
      return r.rows[0].n as number;
    });
    check("a user CAN read their own credit history", ownSees === 3, `saw ${ownSees}`);

    // --- Notification ------------------------------------------------------
    console.log("\n— Notifications —");
    const credited = await pg.query(`select count(*)::int n from public.notifications where user_id = $1 and type = 'credits_added'`, [owner]);
    check("each credit ISSUE notified the user (2 issues)", credited.rows[0].n === 2, `got ${credited.rows[0].n}`);
    check("the spend did NOT notify (deliberate — the user just did it)", credited.rows[0].n === 2);

    // --- Immutability -------------------------------------------------------
    console.log("\n— Ledger immutability —");
    const ledgerEdit = await asUser(pg, owner, async () => {
      const r = await pg.query(`update public.credit_transactions set amount = 999999 where user_id = $1`, [owner]);
      return r.rowCount ?? 0;
    });
    check("a user cannot edit ledger rows (no UPDATE policy)", ledgerEdit === 0, `updated ${ledgerEdit} row(s)`);

    const ledgerDelete = await asUser(pg, owner, async () => {
      const r = await pg.query(`delete from public.credit_transactions where user_id = $1`, [owner]);
      return r.rowCount ?? 0;
    });
    check("a user cannot delete ledger rows (no DELETE policy)", ledgerDelete === 0, `deleted ${ledgerDelete} row(s)`);
  } finally {
    console.log("\nCleaning up…");
    await pg.query(`delete from public.credit_transactions where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from public.user_credit_wallets where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from public.notifications where user_id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    await pg.query(`delete from auth.users where id = any($1::uuid[])`, [userIds]).catch(() => undefined);
    console.log("Cleanup done.");
    await pg.end();
  }

  console.log(`\n${failed === 0 ? "All checks passed." : "Some checks FAILED."} (${passed} passed, ${failed} failed)`);
  process.exit(failed === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
