// Runs migration 125 against real Postgres (PGlite, in-process) on a minimal
// stub of the tables it touches, and checks what it actually does: which
// bookings get a reminder and only once, and who hears about an expired
// Open Match. No database or credentials needed.
//
//   npm i --no-save @electric-sql/pglite && node scripts/verify-migration-125.mjs
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";

const migration = readFileSync(
  process.argv[2] ?? new URL("../supabase/migrations/20260810000125_booking_reminders_and_open_match_expiry_notice.sql", import.meta.url),
  "utf8",
);
const db = new PGlite();
const one = async (sql, params) => (await db.query(sql, params)).rows;

await db.exec(`
  create role anon; create role authenticated;
  create schema cron;
  create table cron.job (jobname text primary key, schedule text, command text);
  create function cron.schedule(p_name text, p_schedule text, p_command text) returns bigint
    language sql as $$ insert into cron.job values (p_name, p_schedule, p_command)
      on conflict (jobname) do update set schedule = excluded.schedule, command = excluded.command; select 1::bigint $$;

  create table venues (id uuid primary key default gen_random_uuid(), name text not null, timezone text not null default 'Asia/Manila');
  create table courts (id uuid primary key default gen_random_uuid(), venue_id uuid not null references venues, name text not null);
  create table bookings (id uuid primary key default gen_random_uuid(), court_id uuid not null references courts,
    user_id uuid not null, start_time timestamptz not null, end_time timestamptz not null, status text not null,
    created_at timestamptz not null default now());
  create table notifications (id uuid primary key default gen_random_uuid(), user_id uuid not null, type text not null,
    title text not null, message text not null, link_url text, created_at timestamptz not null default now());
  create table open_matches (id uuid primary key default gen_random_uuid(), host_id uuid not null,
    status text not null default 'open', scheduled_at timestamptz not null);
  create table open_match_join_requests (id uuid primary key default gen_random_uuid(),
    open_match_id uuid not null references open_matches, user_id uuid not null, status text not null);

  -- Verbatim from migration 116.
  create or replace function public.open_match_accepted_count(p_open_match_id uuid)
  returns integer language sql stable security definer set search_path = public as $$
    select 1 + count(*)::integer from public.open_match_join_requests
    where open_match_id = p_open_match_id and status = 'accepted';
  $$;
  -- Stand-ins for the conversions: only their effect on status matters here.
  create function public.convert_open_match_to_singles(p uuid) returns void language sql as
    $$ update public.open_matches set status = 'converted' where id = p $$;
  create function public.convert_open_match_to_doubles(p uuid) returns void language sql as
    $$ update public.open_matches set status = 'converted' where id = p $$;
`);

await db.exec(migration);

// --- Booking reminders --------------------------------------------------------
const [venue] = await one(`insert into venues (name) values ('Rally House') returning id`);
const [court] = await one(`insert into courts (venue_id, name) values ($1, 'Court 2') returning id`, [venue.id]);
const booking = async (label, startIn, createdAgo, status = "confirmed") =>
  (await one(
    `insert into bookings (court_id, user_id, start_time, end_time, status, created_at)
     values ($1, gen_random_uuid(), now() + $2::interval, now() + $2::interval + interval '1 hour', $3, now() - $4::interval)
     returning id, start_time`,
    [court.id, startIn, status, createdAgo],
  ))[0];

const due = await booking("due", "110 minutes", "1 day");
await booking("booked inside the window", "60 minutes", "30 minutes");
await booking("not yet in the window", "3 hours", "1 day");
await booking("cancelled", "100 minutes", "1 day", "cancelled");
await booking("already started", "-10 minutes", "1 day");

const [{ sent }] = await one(`select public.send_booking_reminders() as sent`);
assert.equal(sent, 1, "exactly one booking is due");
const reminders = await one(`select user_id, title, message, link_url from notifications where type = 'booking_reminder'`);
assert.equal(reminders.length, 1);
const [{ local }] = await one(`select to_char($1::timestamptz at time zone 'Asia/Manila', 'FMHH12:MI AM') as local`, [due.start_time]);
assert.equal(reminders[0].title, "Your court is in 2 hours");
assert.equal(reminders[0].message, `Rally House · Court 2 at ${local}`);
assert.equal(reminders[0].link_url, `/bookings/${due.id}/confirmation`);
const [{ again }] = await one(`select public.send_booking_reminders() as again`);
assert.equal(again, 0, "a booking is reminded once");
assert.deepEqual(await one(`select jobname, schedule from cron.job where jobname = 'send-booking-reminders'`), [
  { jobname: "send-booking-reminders", schedule: "*/5 * * * *" },
]);
console.log(`reminders ok: 1 of 5 bookings reminded ("${reminders[0].message}"), none twice`);

// --- Open Match expiry at kickoff -----------------------------------------------
const match = async (accepted, other = []) => {
  const [m] = await one(`insert into open_matches (host_id, scheduled_at) values (gen_random_uuid(), now() - interval '1 minute') returning id, host_id`);
  const players = [];
  for (const status of [...Array(accepted).fill("accepted"), ...other]) {
    const [r] = await one(`insert into open_match_join_requests (open_match_id, user_id, status) values ($1, gen_random_uuid(), $2) returning user_id, status`, [m.id, status]);
    players.push(r);
  }
  return { ...m, players };
};
const three = await match(2, ["kicked", "withdrawn"]); // host + 2 accepted = 3: expires
const alone = await match(0);                           // host alone: expires
const singles = await match(1);                         // host + 1 = 2: starts
const doubles = await match(3);                         // host + 3 = 4: starts
const [{ resolved }] = await one(`select public.resolve_open_matches_at_kickoff() as resolved`);
assert.equal(resolved, 4);

const statusOf = async (m) => (await one(`select status from open_matches where id = $1`, [m.id]))[0].status;
assert.equal(await statusOf(three), "expired");
assert.equal(await statusOf(alone), "expired");
assert.equal(await statusOf(singles), "converted");
assert.equal(await statusOf(doubles), "converted");

const notified = async (m) =>
  (await one(`select user_id, title, message, link_url from notifications where type = 'open_match_expired' and link_url = $1 order by user_id`, [`/ranked/open/${m.id}`]));
const expected = (ids) => ids.sort();
assert.deepEqual(
  (await notified(three)).map((n) => n.user_id).sort(),
  expected([three.host_id, ...three.players.filter((p) => p.status === "accepted").map((p) => p.user_id)]),
  "host and accepted players, not kicked or withdrawn ones",
);
assert.deepEqual((await notified(alone)).map((n) => n.user_id), [alone.host_id]);
assert.equal((await notified(singles)).length, 0);
assert.equal((await notified(doubles)).length, 0);
assert.equal((await notified(three))[0].title, "Your Open Match didn't fill");
console.log("expiry ok: 3-player game told host + 2 accepted (not kicked/withdrawn), solo host told, started games untouched");
