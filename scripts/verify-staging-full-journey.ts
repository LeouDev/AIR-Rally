/**
 * One pass over the whole product with throwaway accounts, asserting the
 * rules that live BEHIND the forms — roles, RLS, triggers, constraints,
 * notifications and payment gates.
 *
 * WHAT THIS CANNOT COVER, and why: signing up and logging in through the
 * browser means typing a password into a form, which I won't do. So this
 * creates its accounts directly in the database. Everything the signup and
 * login screens themselves do — the forms, the redirects, the session
 * cookie — is covered only by the unit tests and the build, not here.
 *
 * WRITES: throwaway users, a venue, courts, bookings, a club, posts and
 * reports, all removed in a `finally`. Cleanup failures are REPORTED, not
 * swallowed — the sibling scripts' `.catch(() => undefined)` is what left
 * orphaned rows in staging and made this exercise necessary.
 *
 * Gated by assert-staging-env.ts: it refuses to run against production.
 *
 * Usage (after sourcing .env.staging):
 *   TS_NODE_COMPILER_OPTIONS='{"module":"CommonJS","moduleResolution":"node"}' \
 *     node -r ts-node/register scripts/verify-staging-full-journey.ts
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
    console.log(`  ✓ ${label}`);
    passed += 1;
  } else {
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ""}`);
    failed += 1;
  }
}

function section(title: string) {
  console.log(`\n— ${title} —`);
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

/** Runs fn as the user, returning the rejection message or null if it succeeded. */
async function attempt(pg: Client, userId: string, fn: () => Promise<unknown>): Promise<string | null> {
  try {
    await asUser(pg, userId, fn);
    return null;
  } catch (error) {
    return (error as Error).message;
  }
}

async function roleOf(pg: Client, userId: string): Promise<string> {
  const r = await pg.query(`select role from public.profiles where id = $1`, [userId]);
  return r.rows[0]?.role ?? "(none)";
}

async function notificationsFor(pg: Client, userId: string): Promise<string[]> {
  const r = await pg.query(`select type from public.notifications where user_id = $1`, [userId]);
  return r.rows.map((x: { type: string }) => x.type);
}

async function main() {
  const pg = new Client({ connectionString: requireEnv("DATABASE_URL") });
  await pg.connect();
  console.log("Connected.\n");

  const run = randomUUID().slice(0, 8);
  const player = randomUUID();
  const owner = randomUUID();
  const admin = randomUUID();
  const bystander = randomUUID();
  const userIds = [player, owner, admin, bystander];

  let venueId = "";
  let courtId = "";
  let bookingId = "";
  let clubId = "";
  let postId = "";

  try {
    // --- Accounts ---------------------------------------------------------
    section("Accounts start as plain players");
    for (const [i, id] of userIds.entries()) {
      await pg.query(
        `insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
         values ($1, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', $2, '', now(), now(), now())`,
        [id, `journey-${run}-${i}@example.test`]
      );
    }
    check("a new account is a 'player', not an owner or admin", (await roleOf(pg, player)) === "player", await roleOf(pg, player));
    const ownerStatus = await pg.query(`select owner_status from public.profiles where id = $1`, [owner]);
    check("and its owner_status is 'none'", ownerStatus.rows[0].owner_status === "none", ownerStatus.rows[0].owner_status);

    await pg.query(`update public.profiles set role = 'admin' where id = $1`, [admin]);

    // --- Owner onboarding -------------------------------------------------
    section("Becoming a venue owner");
    const selfPromote = await attempt(pg, owner, async () => {
      await pg.query(`update public.profiles set role = 'venue_owner' where id = $1`, [owner]);
    });
    check(
      "a player cannot promote themselves to venue_owner",
      (await roleOf(pg, owner)) === "player",
      selfPromote ?? `role is now ${await roleOf(pg, owner)}`
    );

    // The self-service promotion RPC was deliberately revoked in migration
    // 20260810000025 when owner access moved to admin approval. Asserting
    // it stays unreachable, because a regrant would silently restore the
    // auto-promotion loophole that migration exists to close.
    const rpcReachable = await attempt(pg, owner, async () => {
      await pg.query(`select public.request_venue_owner_role()`);
    });
    check(
      "the old self-promotion RPC is unreachable from a browser session",
      rpcReachable !== null,
      rpcReachable ?? "NOT REJECTED — the auto-promotion loophole is open again"
    );

    // The real path: request access, then an admin approves.
    await asUser(pg, owner, async () => {
      await pg.query(`update public.profiles set owner_status = 'pending' where id = $1`, [owner]);
      await pg.query(
        `insert into public.owner_applications (user_id, business_name, business_phone, business_email, venue_name, venue_address, venue_city, court_count)
         values ($1, $2, '09170000000', $3, $4, '1 Test St', 'Cebu', 2)`,
        [owner, `Journey Courts ${run}`, `owner-${run}@example.test`, `Journey Venue ${run}`]
      );
    });
    const pendingStatus = await pg.query(`select owner_status from public.profiles where id = $1`, [owner]);
    check("a player can request owner access (status -> pending)", pendingStatus.rows[0].owner_status === "pending", pendingStatus.rows[0].owner_status);

    const selfApproveOwner = await attempt(pg, owner, async () => {
      await pg.query(`update public.profiles set owner_status = 'approved' where id = $1`, [owner]);
    });
    const afterSelfApprove = await pg.query(`select owner_status from public.profiles where id = $1`, [owner]);
    check(
      "but cannot approve their own application",
      afterSelfApprove.rows[0].owner_status === "pending",
      selfApproveOwner ?? `owner_status is '${afterSelfApprove.rows[0].owner_status}'`
    );
    check("and is still a plain player", (await roleOf(pg, owner)) === "player", await roleOf(pg, owner));

    await asUser(pg, admin, async () => {
      await pg.query(`update public.profiles set owner_status = 'approved', role = 'venue_owner' where id = $1`, [owner]);
      await pg.query(`update public.owner_applications set status = 'approved', reviewed_at = now(), reviewed_by = $1 where user_id = $2`, [
        admin,
        owner,
      ]);
    });
    check("an admin approving it grants venue_owner", (await roleOf(pg, owner)) === "venue_owner", await roleOf(pg, owner));

    const selfAdmin = await attempt(pg, owner, async () => {
      await pg.query(`update public.profiles set role = 'admin' where id = $1`, [owner]);
    });
    check(
      "a venue owner still cannot make themselves an admin",
      (await roleOf(pg, owner)) !== "admin",
      selfAdmin ?? `role is now ${await roleOf(pg, owner)}`
    );

    // --- Venue and courts -------------------------------------------------
    section("Listing a venue");
    const venueDenied = await attempt(pg, player, async () => {
      await pg.query(`insert into public.venues (owner_id, name, status, timezone) values ($1, $2, 'draft', 'Asia/Manila')`, [
        player,
        `Player Venue ${run}`,
      ]);
    });
    check("a plain player cannot create a venue at all", venueDenied !== null, venueDenied ?? "NOT REJECTED");

    const venue = await asUser(pg, owner, async () => {
      const r = await pg.query(
        `insert into public.venues (owner_id, name, status, timezone, city) values ($1, $2, 'pending_review', 'Asia/Manila', 'Cebu') returning id`,
        [owner, `Journey Venue ${run}`]
      );
      return r.rows[0].id as string;
    });
    venueId = venue;
    check("an approved owner can create one", Boolean(venueId));

    const discoverableBefore = await pg.query(`select count(*)::int n from public.venue_marketplace where id = $1`, [venueId]);
    check(
      "a pending venue is NOT discoverable in the marketplace",
      discoverableBefore.rows[0].n === 0,
      `${discoverableBefore.rows[0].n} row(s)`
    );

    const court = await pg.query(
      `insert into public.courts (venue_id, name, hourly_price, status) values ($1, 'Court 1', 60000, 'active') returning id`,
      [venueId]
    );
    courtId = court.rows[0].id;
    // Open every day, so availability never depends on which day the
    // script happens to run.
    for (let day = 0; day < 7; day += 1) {
      await pg.query(
        `insert into public.venue_operating_hours (venue_id, day_of_week, start_time, end_time) values ($1, $2, '06:00', '22:00')`,
        [venueId, day]
      );
    }

    const selfApprove = await attempt(pg, owner, async () => {
      await pg.query(`update public.venues set status = 'active' where id = $1`, [venueId]);
    });
    const statusAfterSelf = await pg.query(`select status from public.venues where id = $1`, [venueId]);
    check(
      "an owner cannot approve their own venue",
      statusAfterSelf.rows[0].status !== "active",
      selfApprove ?? `status is '${statusAfterSelf.rows[0].status}'`
    );

    await asUser(pg, admin, async () => {
      await pg.query(`update public.venues set status = 'active' where id = $1`, [venueId]);
    });
    const discoverableAfter = await pg.query(`select count(*)::int n from public.venue_marketplace where id = $1`, [venueId]);
    check("an admin can, and it becomes discoverable", discoverableAfter.rows[0].n === 1, `${discoverableAfter.rows[0].n} row(s)`);

    // --- Booking ----------------------------------------------------------
    section("Booking and paying");
    const slots = await pg.query(
      `select slot_start from public.get_available_slots($1, (now() + interval '2 days')::date, 60, 60, 120) limit 3`,
      [courtId]
    );
    check("availability returns bookable slots", slots.rows.length > 0, `${slots.rows.length} slot(s)`);
    const wholeHours = slots.rows.every((s: { slot_start: Date }) => new Date(s.slot_start).getUTCMinutes() % 60 === 0);
    check("every slot starts on a whole hour", wholeHours);

    const slotStart = slots.rows[0].slot_start;
    const booking = await asUser(pg, player, async () => {
      const r = await pg.query(
        `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency, payment_provider, paymongo_checkout_session_id)
         values ($1, $2, $3, $3::timestamptz + interval '1 hour', 'pending', 60000, 'PHP', 'paymongo', $4) returning id`,
        [courtId, player, slotStart, `cs_journey_${run}`]
      );
      return r.rows[0].id as string;
    });
    bookingId = booking;
    check("a player can create a pending booking", Boolean(bookingId));

    // A pending booking already holds the court — this is the exclusion
    // constraint's whole purpose.
    const doubleBooked = await attempt(pg, bystander, async () => {
      await pg.query(
        `insert into public.bookings (court_id, user_id, start_time, end_time, status, price_amount, currency)
         values ($1, $2, $3, $3::timestamptz + interval '1 hour', 'pending', 60000, 'PHP')`,
        [courtId, bystander, slotStart]
      );
    });
    check("nobody else can book the same court and time", doubleBooked !== null, doubleBooked ?? "NOT REJECTED");

    // The payment-bypass hole closed in migration 20260810000047.
    const selfConfirm = await attempt(pg, player, async () => {
      await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, $3, $4, $5)`, [
        bookingId,
        `cs_journey_${run}`,
        "pi_forged",
        60000,
        "PHP",
      ]);
    });
    const statusAfterSelfConfirm = await pg.query(`select status from public.bookings where id = $1`, [bookingId]);
    check(
      "a player cannot confirm their own booking without paying",
      statusAfterSelfConfirm.rows[0].status === "pending",
      selfConfirm ?? `status is '${statusAfterSelfConfirm.rows[0].status}'`
    );

    // The real path: the webhook, as service_role, having verified payment.
    await pg.query("begin");
    await pg.query("set local role service_role");
    await pg.query(`select public.confirm_paymongo_booking_payment($1, $2, $3, $4, $5)`, [
      bookingId,
      `cs_journey_${run}`,
      `pi_journey_${run}`,
      60000,
      "PHP",
    ]);
    await pg.query("commit");

    const confirmed = await pg.query(`select status, confirmation_code, paid_at from public.bookings where id = $1`, [bookingId]);
    check("the webhook path confirms it", confirmed.rows[0].status === "confirmed", confirmed.rows[0].status);
    check("a confirmation code exists", Boolean(confirmed.rows[0].confirmation_code));
    check("paid_at is stamped", confirmed.rows[0].paid_at !== null);
    check(
      "the owner is notified of the booking",
      (await notificationsFor(pg, owner)).some((t) => t.includes("booking")),
      (await notificationsFor(pg, owner)).join(", ") || "no notifications"
    );

    // --- Settlement -------------------------------------------------------
    section("Settlement is recorded but never paid out");
    const settlement = await pg.query(
      `select gross_booking_amount, platform_fee, venue_amount, settlement_status from public.booking_settlements where booking_id = $1`,
      [bookingId]
    );
    check("a settlement row is created for the confirmed booking", settlement.rows.length === 1, `${settlement.rows.length} row(s)`);
    if (settlement.rows.length === 1) {
      const s = settlement.rows[0];
      check(
        "the split balances exactly against the gross",
        s.platform_fee + s.venue_amount === s.gross_booking_amount,
        `${s.platform_fee} + ${s.venue_amount} != ${s.gross_booking_amount}`
      );
      check("it is not marked settled — no money has moved", s.settlement_status !== "settled", s.settlement_status);
    }

    const forceSettle = await attempt(pg, owner, async () => {
      await pg.query(`update public.booking_settlements set settlement_status = 'settled' where booking_id = $1`, [bookingId]);
    });
    const afterForce = await pg.query(`select settlement_status from public.booking_settlements where booking_id = $1`, [bookingId]);
    check(
      "an owner cannot mark their own settlement as settled",
      afterForce.rows[0]?.settlement_status !== "settled",
      forceSettle ?? `status is '${afterForce.rows[0]?.settlement_status}'`
    );

    // --- Review -----------------------------------------------------------
    section("Reviewing a completed booking");
    // Move the booking into the past so it is reviewable, via the bypass
    // GUC the tampering guard honours for privileged writers.
    await pg.query(`select set_config('air_rally.bypass_booking_tampering', 'true', true)`);
    await pg.query(
      `update public.bookings set start_time = now() - interval '3 hours', end_time = now() - interval '2 hours' where id = $1`,
      [bookingId]
    );

    await asUser(pg, player, async () => {
      await pg.query(`insert into public.reviews (venue_id, user_id, booking_id, rating, comment) values ($1, $2, $3, 5, 'Great court.')`, [
        venueId,
        player,
        bookingId,
      ]);
    });
    const rated = await pg.query(`select average_rating, review_count from public.venues where id = $1`, [venueId]);
    check("the venue's rating stats update by trigger", Number(rated.rows[0].review_count) === 1, `count=${rated.rows[0].review_count}`);
    check("and the average reflects the review", Number(rated.rows[0].average_rating) === 5, `avg=${rated.rows[0].average_rating}`);

    const reviewTwice = await attempt(pg, player, async () => {
      await pg.query(`insert into public.reviews (venue_id, user_id, booking_id, rating) values ($1, $2, $3, 1)`, [
        venueId,
        player,
        bookingId,
      ]);
    });
    check("the same booking cannot be reviewed twice", reviewTwice !== null, reviewTwice ?? "NOT REJECTED");

    // --- Clubs ------------------------------------------------------------
    section("Clubs");
    clubId = await asUser(pg, player, async () => {
      const r = await pg.query(
        `insert into public.clubs (owner_id, name, visibility, status) values ($1, $2, 'approval_required', 'pending_review') returning id`,
        [player, `Journey Club ${run}`]
      );
      return r.rows[0].id as string;
    });
    check("a plain player can create a club (no venue-owner role needed)", Boolean(clubId));

    const visibleWhilePending = await asUser(pg, bystander, async () => {
      const r = await pg.query(`select id from public.clubs where id = $1 and status = 'active'`, [clubId]);
      return r.rowCount;
    });
    check("a pending club is not discoverable", visibleWhilePending === 0, `saw ${visibleWhilePending}`);

    await asUser(pg, admin, async () => {
      await pg.query(`update public.clubs set status = 'active' where id = $1`, [clubId]);
    });

    await asUser(pg, bystander, async () => {
      await pg.query(`insert into public.club_members (club_id, user_id) values ($1, $2)`, [clubId, bystander]);
    });
    const membership = await pg.query(`select status, role from public.club_members where club_id = $1 and user_id = $2`, [
      clubId,
      bystander,
    ]);
    check(
      "joining an approval-required club lands as 'pending', not active",
      membership.rows[0]?.status === "pending",
      membership.rows[0]?.status
    );

    const selfPromoteClub = await attempt(pg, bystander, async () => {
      await pg.query(`update public.club_members set role = 'owner' where club_id = $1 and user_id = $2`, [clubId, bystander]);
    });
    const clubRole = await pg.query(`select role from public.club_members where club_id = $1 and user_id = $2`, [clubId, bystander]);
    check(
      "a member cannot promote themselves to club owner",
      clubRole.rows[0]?.role !== "owner",
      selfPromoteClub ?? `role is '${clubRole.rows[0]?.role}'`
    );

    // --- COURT/Side -------------------------------------------------------
    section("COURT/Side");
    postId = await asUser(pg, player, async () => {
      const r = await pg.query(`insert into public.posts (user_id, content) values ($1, $2) returning id`, [
        player,
        `Journey post ${run}`,
      ]);
      return r.rows[0].id as string;
    });

    await asUser(pg, bystander, async () => {
      await pg.query(`insert into public.post_likes (post_id, user_id) values ($1, $2)`, [postId, bystander]);
      await pg.query(`insert into public.post_comments (post_id, user_id, content) values ($1, $2, 'Nice')`, [postId, bystander]);
      await pg.query(`insert into public.post_reshares (post_id, user_id) values ($1, $2)`, [postId, bystander]);
    });

    const counts = await pg.query(`select like_count, comment_count, reshare_count from public.posts where id = $1`, [postId]);
    check(
      "like/comment/reshare counts are trigger-maintained",
      counts.rows[0].like_count === 1 && counts.rows[0].comment_count === 1 && counts.rows[0].reshare_count === 1,
      JSON.stringify(counts.rows[0])
    );

    const feed = await pg.query(`select id, resharer_id from public.court_side_feed(50, null)`);
    check(
      "the reshare reaches the feed with attribution",
      feed.rows.some((r: { id: string; resharer_id: string | null }) => r.id === postId && r.resharer_id === bystander)
    );

    const authorNotifications = await notificationsFor(pg, player);
    check("the author is notified of engagement", authorNotifications.length > 0, authorNotifications.join(", ") || "none");

    // Self-engagement must notify nobody — otherwise every user spams
    // themselves.
    const beforeSelf = (await notificationsFor(pg, player)).length;
    await asUser(pg, player, async () => {
      await pg.query(`insert into public.post_likes (post_id, user_id) values ($1, $2)`, [postId, player]);
    });
    check(
      "liking your own post notifies nobody",
      (await notificationsFor(pg, player)).length === beforeSelf,
      `${beforeSelf} -> ${(await notificationsFor(pg, player)).length}`
    );

    // --- Trust and safety -------------------------------------------------
    section("Reports and limits");
    let reportId = "";
    await asUser(pg, bystander, async () => {
      const r = await pg.query(
        `insert into public.reports (reporter_id, target_type, target_id, reason) values ($1, 'post', $2, 'spam') returning id`,
        [bystander, postId]
      );
      reportId = r.rows[0].id;
    });
    check("any signed-in user can file a report", Boolean(reportId));

    const reportedUserSees = await asUser(pg, player, async () => {
      const r = await pg.query(`select id from public.reports where id = $1`, [reportId]);
      return r.rowCount;
    });
    check("the reported user cannot see it", reportedUserSees === 0, `saw ${reportedUserSees}`);

    const selfResolve = await attempt(pg, bystander, async () => {
      await pg.query(`update public.reports set status = 'dismissed', resolved_by = $1, resolved_at = now() where id = $2`, [
        bystander,
        reportId,
      ]);
    });
    const reportStatus = await pg.query(`select status from public.reports where id = $1`, [reportId]);
    check(
      "only an admin can resolve it",
      reportStatus.rows[0].status === "open",
      selfResolve ?? `status is '${reportStatus.rows[0].status}'`
    );

    let limitHit = false;
    for (let i = 0; i < 12; i += 1) {
      const err = await attempt(pg, bystander, async () => {
        await pg.query(`insert into public.posts (user_id, content) values ($1, $2)`, [bystander, `limit probe ${run} #${i}`]);
      });
      if (err) {
        limitHit = true;
        break;
      }
    }
    check("the posting rate limit stops a burst", limitHit);

    // --- Payment safety ---------------------------------------------------
    section("Payment safety gates");
    const settledAnywhere = await pg.query(`select count(*)::int n from public.booking_settlements where settlement_status = 'settled'`);
    check("no settlement anywhere is marked settled", settledAnywhere.rows[0].n === 0, `${settledAnywhere.rows[0].n} found`);

    const stripeWritten = await pg.query(
      `select count(*)::int n from public.bookings where stripe_checkout_session_id is not null or stripe_payment_intent_id is not null`
    );
    check("no booking has a Stripe id written by any current path", stripeWritten.rows[0].n === 0, `${stripeWritten.rows[0].n} found`);
  } finally {
    console.log("\nCleaning up…");
    const steps: [string, string, unknown[]][] = [
      ["owner_applications", `delete from public.owner_applications where user_id = any($1::uuid[])`, [userIds]],
      ["reports", `delete from public.reports where reporter_id = any($1::uuid[])`, [userIds]],
      ["post_reshares", `delete from public.post_reshares where user_id = any($1::uuid[])`, [userIds]],
      ["post_likes", `delete from public.post_likes where user_id = any($1::uuid[])`, [userIds]],
      ["post_comments", `delete from public.post_comments where user_id = any($1::uuid[])`, [userIds]],
      ["posts", `delete from public.posts where user_id = any($1::uuid[])`, [userIds]],
      ["club_members", `delete from public.club_members where club_id = $1`, [clubId]],
      ["clubs", `delete from public.clubs where id = $1`, [clubId]],
      ["reviews", `delete from public.reviews where user_id = any($1::uuid[])`, [userIds]],
      // Settlements reference the booking AND the venue, so they go first.
      ["booking_settlements", `delete from public.booking_settlements where venue_id = $1`, [venueId]],
      ["bookings", `delete from public.bookings where court_id = $1`, [courtId]],
      ["venue_operating_hours", `delete from public.venue_operating_hours where venue_id = $1`, [venueId]],
      ["courts", `delete from public.courts where id = $1`, [courtId]],
      ["venues", `delete from public.venues where id = $1`, [venueId]],
      ["notifications", `delete from public.notifications where user_id = any($1::uuid[])`, [userIds]],
      ["auth.users", `delete from auth.users where id = any($1::uuid[])`, [userIds]],
    ];
    for (const [label, sql, params] of steps) {
      if (!params[0]) continue;
      try {
        const r = await pg.query(sql, params);
        console.log(`  ${label.padEnd(22)} removed ${r.rowCount}`);
      } catch (error) {
        console.error(`  ${label.padEnd(22)} CLEANUP FAILED — ${(error as Error).message}`);
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
