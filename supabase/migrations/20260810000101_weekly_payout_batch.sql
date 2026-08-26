-- ============================================================================
-- The Wednesday job: assemble the week's payout batch as a DRAFT, and tell an
-- admin it is waiting.
--
-- WHAT IT DOES NOT DO: send anything. Creating a batch and paying it are
-- different acts and only the first can be automated. Nothing here marks a
-- transfer, attests a payment, or touches a settlement's status. A human
-- still exports the file, uploads it, and attests each transfer.
--
-- WHY IT CANNOT PROMISE A DATE. PayMongo's own template states the rule:
-- PESONet runs on BANKING DAYS ONLY, and transfers sent before 3:00 PM are
-- reflected within the banking day while later ones land the next one. This
-- job runs at 09:00 Manila to leave the whole cut-off window available — but
-- when the money actually lands depends on when the ADMIN uploads, which this
-- code cannot know. So the notification states the rule and never a date.
-- Holidays make it worse: there is no Philippine holiday calendar in this
-- schema, so a Wednesday holiday is invisible here. Saying "banking days
-- only" is honest; naming a credit date would not be.
--
-- SELECTION IS NOT REIMPLEMENTED. Eligibility comes from
-- available_settlements_for_payout() and from enforce_payout_batch_item(),
-- exactly as the manual path uses them — so the venue activation gate, the
-- bank-details requirement and the verified-account check apply here without
-- a second copy that could drift.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Who a system-created batch is attributed to.
--
-- payout_batches.created_by is NOT NULL and references profiles, so an
-- automated batch still needs a name against it. Taking it from app_config
-- rather than "any admin" makes the choice explicit and reviewable — and if
-- the key is absent the job FAILS rather than attributing a financial record
-- to whichever admin a query happened to return first.
--
-- The batch's notes say plainly that the job created it, so nobody reads
-- created_by as "this person clicked a button". The id records on whose
-- authority the automation runs; the note records that it was automation.
-- ---------------------------------------------------------------------------
create or replace function public.payout_automation_actor()
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_raw text;
  v_id uuid;
begin
  select value into v_raw from public.app_config where key = 'payout_automation_actor';

  if v_raw is null or btrim(v_raw) = '' then
    raise exception 'payout_automation_actor is not configured — the weekly payout job has no identity to create batches under.'
      using errcode = 'config_file_error',
            hint = 'insert into public.app_config (key, value) values (''payout_automation_actor'', ''<an admin profile id>'');';
  end if;

  begin
    v_id := btrim(v_raw)::uuid;
  exception when others then
    raise exception 'payout_automation_actor is not a valid uuid.' using errcode = 'config_file_error';
  end;

  if not exists (select 1 from public.profiles where id = v_id and role = 'admin') then
    raise exception 'payout_automation_actor % is not an admin profile.', v_id
      using errcode = 'config_file_error';
  end if;

  return v_id;
end;
$$;

revoke all on function public.payout_automation_actor() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- NO NEW BYPASS. An earlier draft of this migration added a transaction-local
-- "system" flag to create_payout_batch() so the job could skip is_admin().
-- That was the wrong shape: available_settlements_for_payout() is admin-gated
-- too, so the flag would have had to spread to a second function, and every
-- future guard on the payout path would need to learn about it.
--
-- Instead the job ACTS AS the configured admin -- it sets request.jwt.claim.sub
-- for its own transaction, so auth.uid() and is_admin() resolve exactly as they
-- do for a human admin clicking the button. Nothing is bypassed, no guard is
-- weakened, and create_payout_batch() is left untouched.
--
-- The impersonation is transaction-local and reset before returning. What
-- makes it honest rather than a disguise is the batch's own notes, which say
-- the job created it and that nothing has been sent.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- The job.
--
-- Returns jsonb rather than void so cron.job_run_details carries a readable
-- outcome. A cron that errors silently every Wednesday is worse than no cron;
-- one that says "skipped: nothing payable" is a job doing its work.
--
-- EVERY UNEXPECTED STATE IS A NAMED OUTCOME, NOT AN EXCEPTION:
--
--   no_payable_settlements  Nothing to pay. Normal in a quiet week. No batch,
--                           no notification — an empty batch would be a chore
--                           for an admin and a row to explain later.
--
--   open_batch_exists       A draft or approved batch is still outstanding.
--                           Creating a second one risks the same settlements
--                           being uploaded twice, and the eligibility trigger
--                           would refuse them anyway. The admin is told,
--                           because a silently skipped week looks identical
--                           to a broken job.
--
--   all_below_floor         Every venue's total is under the PHP 80 PESONet
--                           minimum. Their settlements stay payable and roll
--                           into next week, which is what should happen — a
--                           venue earning PHP 50 a week gets paid PHP 100
--                           after two, not refused forever.
--
--   created                 A draft batch exists and an admin has been told.
--
-- Venues below the floor are dropped from an OTHERWISE VIABLE batch too, and
-- counted in the result, so "why is this venue missing" has an answer.
-- ---------------------------------------------------------------------------
create or replace function public.create_weekly_payout_batch()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  c_floor constant integer := 8000;   -- PHP 80.00 in centavos. See pesonetExport.ts.
  v_actor uuid;
  v_result jsonb;
  v_open integer;
  v_batch_id uuid;
  v_reference text;
  v_ids uuid[];
  v_venues integer;
  v_total bigint;
  v_below integer := 0;
  v_below_total bigint := 0;
begin
  -- Resolve the identity FIRST, so a misconfigured actor stops the job before
  -- it reads anything, rather than half-way through.
  v_actor := public.payout_automation_actor();
  perform set_config('request.jwt.claim.sub', v_actor::text, true);

  select count(*) into v_open
  from public.payout_batches
  where status in ('draft', 'approved');

  if v_open > 0 then
    insert into public.notifications (user_id, type, title, message, link_url)
    select p.id, 'payout_batch_skipped', 'Weekly payout not created',
           'There is still an unfinished payout batch, so this week''s was not created. Finish or cancel the open one, then create this week''s from the payouts page.',
           '/admin/payouts'
    from public.profiles p where p.role = 'admin';

    perform set_config('request.jwt.claim.sub', '', true);
    return jsonb_build_object('outcome', 'open_batch_exists', 'open_batches', v_open);
  end if;

  -- Venues whose eligible total clears the floor. Grouping by venue is
  -- deliberate: the floor applies to a TRANSFER, and a transfer is per venue,
  -- not per settlement. Three PHP 40 settlements for one venue are payable
  -- together and would each fail if tested alone.
  create temporary table _weekly_candidates on commit drop as
  select s.venue_id, array_agg(s.id) as ids, sum(s.venue_amount)::bigint as total
  from public.available_settlements_for_payout() s
  group by s.venue_id;

  select count(*) filter (where total < c_floor),
         coalesce(sum(total) filter (where total < c_floor), 0)
    into v_below, v_below_total
  from _weekly_candidates;

  select coalesce(array_agg(x), '{}')
    into v_ids
  from (select unnest(ids) as x from _weekly_candidates where total >= c_floor) u;

  select count(*), coalesce(sum(total), 0)
    into v_venues, v_total
  from _weekly_candidates where total >= c_floor;

  if coalesce(array_length(v_ids, 1), 0) = 0 then
    perform set_config('request.jwt.claim.sub', '', true);
    if v_below > 0 then
      return jsonb_build_object(
        'outcome', 'all_below_floor',
        'venues_below_floor', v_below,
        'held_centavos', v_below_total);
    end if;
    return jsonb_build_object('outcome', 'no_payable_settlements');
  end if;

  v_batch_id := public.create_payout_batch(
    v_ids,
    'Created automatically by the Wednesday payout job. Nothing has been sent — export the file, upload it to PayMongo, then attest each transfer.');
  select batch_reference into v_reference from public.payout_batches where id = v_batch_id;

  -- WHAT THE ADMIN IS TOLD, AND WHAT IT CAREFULLY DOES NOT SAY.
  --
  -- No claim that anything was sent, and no promised credit date. PESONet
  -- runs on banking days only and the 3:00 PM cut-off decides whether a
  -- transfer lands that day or the next — but that turns on when the ADMIN
  -- uploads, not on when this row was created. Stating the rule lets them
  -- make the deadline; stating a date would be a promise this code cannot
  -- keep, and clause 3.12 already says we do not promise credit timing.
  insert into public.notifications (user_id, type, title, message, link_url)
  select p.id, 'payout_batch_ready', 'This week''s payout is ready to review',
         v_reference || ' covers ' || v_venues || ' venue(s), ₱' ||
         to_char(v_total / 100.0, 'FM999,999,990.00') ||
         '. Nothing has been sent yet. PESONet runs on banking days only — upload before 3:00 PM for same-day credit, later uploads land the next banking day.' ||
         case when v_below > 0
              then ' ' || v_below || ' venue(s) are held back under the ₱80.00 minimum and roll into next week.'
              else '' end,
         '/admin/payouts/' || v_batch_id
  from public.profiles p where p.role = 'admin';

  v_result := jsonb_build_object(
    'outcome', 'created',
    'batch_id', v_batch_id,
    'batch_reference', v_reference,
    'venues', v_venues,
    'total_centavos', v_total,
    'venues_below_floor', v_below,
    'held_centavos', v_below_total);
  perform set_config('request.jwt.claim.sub', '', true);
  return v_result;

exception when others then
  -- Reset on the failure path too: the impersonation must not outlive this
  -- function even when it throws mid-way.
  perform set_config('request.jwt.claim.sub', '', true);
  raise;
end;
$$;

revoke all on function public.create_weekly_payout_batch() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 09:00 Manila every Wednesday = 01:00 UTC, which is when pg_cron reckons.
--
-- Early enough that the whole 3:00 PM PESONet window is still available to
-- whoever picks it up, rather than creating the batch in the afternoon and
-- pushing the money to Thursday by default.
-- ---------------------------------------------------------------------------
select cron.unschedule('weekly-payout-batch')
where exists (select 1 from cron.job where jobname = 'weekly-payout-batch');

select cron.schedule(
  'weekly-payout-batch',
  '0 1 * * 3',
  $cron$select public.create_weekly_payout_batch()$cron$
);
