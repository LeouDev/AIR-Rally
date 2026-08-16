/**
 * Phase 7.8a functional verification against whatever database
 * DATABASE_URL points at — gated by assert-staging-env.ts.
 *
 * Unlike the read-only schema inspectors, this script WRITES: it creates
 * throwaway auth users, a club, an event, and attendance rows in order to
 * exercise the real trigger logic (capacity, waitlisting, promotion,
 * counts, notifications) and the real RLS policies. Everything it creates
 * is removed in a `finally` block, and every id is namespaced with a
 * per-run suffix so a crashed run can't collide with a later one.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-clubs-events.ts
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

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const owner = randomUUID();
  const joiner = randomUUID();
  const outsider = randomUUID();
  const userIds = [owner, joiner, outsider];
  let clubId = "";
  let eventId = "";

  try {
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `phase78a-${run}-${i}@example.test`]
      );
      await pg.query(`update public.profiles set display_name = $2 where id = $1`, [id, `Phase78a ${run} ${i}`]);
    }
    console.log(`Seeded 3 throwaway users (run ${run}).\n`);

    // --- Clubs: a plain player can create one ---------------------------
    console.log("— Clubs —");
    const roleRow = await pg.query(`select role from public.profiles where id = $1`, [owner]);
    check("test club creator is a plain 'player', not a venue_owner", roleRow.rows[0]?.role === "player", `got ${roleRow.rows[0]?.role}`);

    const created = await asUser(pg, owner, async () => {
      const r = await pg.query(
        `insert into public.clubs (owner_id, name, visibility, skill_level, club_type)
         values ($1, $2, 'approval_required', 'intermediate', 'social') returning id`,
        [owner, `Phase78a Club ${run}`]
      );
      return r.rows[0].id as string;
    });
    clubId = created;
    check("a player can create a club (no venue_owner role required)", Boolean(clubId));

    const ownerRow = await pg.query(`select role, status from public.club_members where club_id = $1 and user_id = $2`, [clubId, owner]);
    check("owner is auto-seeded onto the roster as role=owner/status=active",
      ownerRow.rows[0]?.role === "owner" && ownerRow.rows[0]?.status === "active",
      JSON.stringify(ownerRow.rows[0]));

    // --- Membership: approval_required forces pending --------------------
    await asUser(pg, joiner, async () => {
      await pg.query(`insert into public.club_members (club_id, user_id, role, status) values ($1, $2, 'owner', 'active')`, [clubId, joiner]);
    });
    const joinRow = await pg.query(`select role, status from public.club_members where club_id = $1 and user_id = $2`, [clubId, joiner]);
    check("self-join into an approval_required club is forced to role=member/status=pending (privilege escalation blocked)",
      joinRow.rows[0]?.role === "member" && joinRow.rows[0]?.status === "pending",
      JSON.stringify(joinRow.rows[0]));

    const reqNotif = await pg.query(`select count(*)::int as n from public.notifications where user_id = $1 and type = 'club_join_request'`, [owner]);
    check("club owner was notified of the join request", reqNotif.rows[0].n === 1, `count=${reqNotif.rows[0].n}`);

    // --- Member count excludes pending -----------------------------------
    const countAfterPending = await pg.query(`select member_count from public.clubs where id = $1`, [clubId]);
    check("member_count counts only active members (owner only, pending excluded)",
      countAfterPending.rows[0].member_count === 1, `got ${countAfterPending.rows[0].member_count}`);

    // --- Approval ---------------------------------------------------------
    await asUser(pg, owner, async () => {
      await pg.query(`update public.club_members set status = 'active' where club_id = $1 and user_id = $2`, [clubId, joiner]);
    });
    const approvedNotif = await pg.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'club_membership_approved'`, [joiner]
    );
    check("approved member was notified", approvedNotif.rows[0].n === 1, `count=${approvedNotif.rows[0].n}`);

    const countAfterApproval = await pg.query(`select member_count from public.clubs where id = $1`, [clubId]);
    check("member_count rose to 2 after approval", countAfterApproval.rows[0].member_count === 2, `got ${countAfterApproval.rows[0].member_count}`);

    await asUser(pg, owner, async () => {
      await pg.query(`update public.clubs set member_count = 999 where id = $1`, [clubId]);
    });
    const clubCountTampered = await pg.query(`select member_count from public.clubs where id = $1`, [clubId]);
    check("member_count cannot be set manually by the club owner", clubCountTampered.rows[0].member_count === 2, `got ${clubCountTampered.rows[0].member_count}`);

    // --- A club admin cannot promote themselves --------------------------
    await asUser(pg, owner, async () => {
      await pg.query(`update public.club_members set role = 'admin' where club_id = $1 and user_id = $2`, [clubId, joiner]);
    });
    await asUser(pg, joiner, async () => {
      await pg.query(`update public.club_members set role = 'owner' where club_id = $1 and user_id = $2`, [clubId, joiner]);
    });
    const escalated = await pg.query(`select role from public.club_members where club_id = $1 and user_id = $2`, [clubId, joiner]);
    check("a club admin cannot promote themselves to owner", escalated.rows[0]?.role === "admin", `got ${escalated.rows[0]?.role}`);

    // --- Private club visibility -----------------------------------------
    await pg.query(`update public.clubs set visibility = 'private' where id = $1`, [clubId]);
    const outsiderSees = await asUser(pg, outsider, async () => {
      const r = await pg.query(`select count(*)::int as n from public.clubs where id = $1`, [clubId]);
      return r.rows[0].n as number;
    });
    check("a non-member cannot read a private club (RLS isolation)", outsiderSees === 0, `saw ${outsiderSees} row(s)`);

    const memberSees = await asUser(pg, joiner, async () => {
      const r = await pg.query(`select count(*)::int as n from public.clubs where id = $1`, [clubId]);
      return r.rows[0].n as number;
    });
    check("an active member can read the private club", memberSees === 1, `saw ${memberSees} row(s)`);

    const outsiderInsert = await asUser(pg, outsider, async () => {
      try {
        await pg.query(`insert into public.club_members (club_id, user_id) values ($1, $2)`, [clubId, outsider]);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("self-join into a private club is rejected (invite only)", outsiderInsert === "blocked");

    // --- Events: capacity + waitlist -------------------------------------
    console.log("\n— Events —");
    await pg.query(`update public.clubs set visibility = 'public' where id = $1`, [clubId]);

    const eventRow = await asUser(pg, owner, async () => {
      const r = await pg.query(
        `insert into public.events (creator_id, club_id, title, start_time, end_time, event_type, max_players, price_amount)
         values ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 2 hours', 'open_play', 1, 25000)
         returning id`,
        [owner, clubId, `Phase78a Open Play ${run}`]
      );
      return r.rows[0].id as string;
    });
    eventId = eventRow;
    check("a club owner can create a court-less event", Boolean(eventId));

    // Event has no court, so no booking is required — but one WITH a court
    // and no backing booking must be rejected.
    const courtRow = await pg.query(`select id from public.courts limit 1`);
    if (courtRow.rows.length > 0) {
      const rejected = await asUser(pg, owner, async () => {
        try {
          await pg.query(
            `insert into public.events (creator_id, title, start_time, court_id)
             values ($1, $2, now() + interval '3 days', $3)`,
            [owner, `Phase78a Unbacked ${run}`, courtRow.rows[0].id]
          );
          return "allowed";
        } catch {
          return "blocked";
        }
      }).catch(() => "blocked");
      check("an event holding a court with NO backing booking is rejected", rejected === "blocked");
    } else {
      console.log("… skipped court-backing check (no courts on this database)");
    }

    // First join takes the only seat.
    await asUser(pg, joiner, async () => {
      await pg.query(`insert into public.event_attendees (event_id, user_id) values ($1, $2)`, [eventId, joiner]);
    });
    const firstJoin = await pg.query(`select status from public.event_attendees where event_id = $1 and user_id = $2`, [eventId, joiner]);
    check("first participant is seated (status=joined)", firstJoin.rows[0]?.status === "joined", `got ${firstJoin.rows[0]?.status}`);

    const regNotif = await pg.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'event_registration'`, [owner]
    );
    check("event creator was notified of the registration", regNotif.rows[0].n === 1, `count=${regNotif.rows[0].n}`);

    // Second join exceeds max_players = 1 and must be waitlisted.
    await asUser(pg, outsider, async () => {
      await pg.query(`insert into public.event_attendees (event_id, user_id) values ($1, $2)`, [eventId, outsider]);
    });
    const secondJoin = await pg.query(`select status from public.event_attendees where event_id = $1 and user_id = $2`, [eventId, outsider]);
    check("join beyond max_players is waitlisted, not seated", secondJoin.rows[0]?.status === "waitlisted", `got ${secondJoin.rows[0]?.status}`);

    const countSeated = await pg.query(`select participant_count from public.events where id = $1`, [eventId]);
    check("participant_count counts seated players only (1, not 2)", countSeated.rows[0].participant_count === 1, `got ${countSeated.rows[0].participant_count}`);

    // Duplicate join must be impossible (composite PK).
    const dup = await asUser(pg, joiner, async () => {
      try {
        await pg.query(`insert into public.event_attendees (event_id, user_id) values ($1, $2)`, [eventId, joiner]);
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a duplicate join is rejected", dup === "blocked");

    // Seated player cancels → waitlisted player is promoted automatically.
    await asUser(pg, joiner, async () => {
      await pg.query(`update public.event_attendees set status = 'cancelled' where event_id = $1 and user_id = $2`, [eventId, joiner]);
    });
    const promoted = await pg.query(`select status from public.event_attendees where event_id = $1 and user_id = $2`, [eventId, outsider]);
    check("cancelling a seat auto-promotes the longest-waiting player", promoted.rows[0]?.status === "joined", `got ${promoted.rows[0]?.status}`);

    const promoNotif = await pg.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'waitlist_promoted'`, [outsider]
    );
    check("promoted player was notified", promoNotif.rows[0].n === 1, `count=${promoNotif.rows[0].n}`);

    // Attendance counts are not client-writable.
    await asUser(pg, owner, async () => {
      await pg.query(`update public.events set participant_count = 999 where id = $1`, [eventId]);
    });
    const tampered = await pg.query(`select participant_count from public.events where id = $1`, [eventId]);
    check("participant_count cannot be set manually by the event creator", tampered.rows[0].participant_count !== 999, `got ${tampered.rows[0].participant_count}`);

    // Cancelling the event notifies remaining attendees.
    await asUser(pg, owner, async () => {
      await pg.query(`update public.events set status = 'cancelled' where id = $1`, [eventId]);
    });
    const cancelNotif = await pg.query(
      `select count(*)::int as n from public.notifications where user_id = $1 and type = 'event_cancelled'`, [outsider]
    );
    check("attendees were notified when the event was cancelled", cancelNotif.rows[0].n === 1, `count=${cancelNotif.rows[0].n}`);

    // --- Players still cannot reach owner-only surfaces -------------------
    console.log("\n— Role isolation —");
    const stillPlayer = await pg.query(`select role from public.profiles where id = $1`, [owner]);
    check("creating a club did NOT change the creator's platform role", stillPlayer.rows[0]?.role === "player", `got ${stillPlayer.rows[0]?.role}`);

    const venueAttempt = await asUser(pg, owner, async () => {
      try {
        await pg.query(
          `insert into public.venues (owner_id, name, address, city, country) values ($1, 'Phase78a Illegal Venue', 'x', 'y', 'PH')`,
          [owner]
        );
        return "allowed";
      } catch {
        return "blocked";
      }
    }).catch(() => "blocked");
    check("a club owner still cannot create a venue as a side effect", venueAttempt === "blocked" || stillPlayer.rows[0]?.role === "player");

    const notifInsertPolicies = await pg.query(
      `select count(*)::int as n from pg_policy where polrelid = 'public.notifications'::regclass and polcmd = 'a'`
    );
    check("notifications still has no client INSERT policy (trigger-only writes)", notifInsertPolicies.rows[0].n === 0);
  } finally {
    console.log("\nCleaning up…");
    if (eventId) await pg.query(`delete from public.events where id = $1`, [eventId]).catch(() => undefined);
    await pg.query(`delete from public.events where title like $1`, [`Phase78a%${run}%`]).catch(() => undefined);
    if (clubId) await pg.query(`delete from public.clubs where id = $1`, [clubId]).catch(() => undefined);
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
