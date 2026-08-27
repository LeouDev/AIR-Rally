"use server";

import { revalidatePath } from "next/cache";
import {
  ensureMyPlayerRank,
  createRankedMatch,
  setReady,
  proposeOfficiating,
  voteOfficiating,
  recordPoint,
  undoPoint,
  submitResult,
  respondToResult,
  cancelMatch,
  getPublicMatchSummary,
  RankedError,
  type CreateRankedMatchInput,
  type PublicRankedMatchSummary,
} from "@/lib/services/ranked";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import type { RankedMode, RankedOfficiatingMode, RankedTeam } from "@/lib/supabase/types";

/**
 * Server Actions for AIR/Rally Ranked's web surface.
 *
 * Every action here is a thin wrapper: parse who's calling, call the one
 * matching function in lib/services/ranked.ts, map the result to
 * ActionResult. All the actual ranked rules — party spread, unanimity,
 * the rating/pip engine — live in the database RPCs those service
 * functions call (20260810000067_air_rally_ranked.sql), which is also
 * exactly what the mobile app calls directly. Nothing below is a second
 * copy of that logic.
 *
 * `RankedError` carries a message written for a player ("Only the
 * scorekeeper can submit the final score") — it's surfaced verbatim
 * rather than through getFriendlyErrorMessage's generic constraint
 * mapping, the same split BookingError uses in lib/actions/booking.ts.
 */
function friendlyRankedError(error: unknown, fallback: string): string {
  return error instanceof RankedError ? error.message : getFriendlyErrorMessage(error, fallback);
}

async function requireUser() {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { ok: false as const, error: clientResult.error };
  const supabase = clientResult.client;
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false as const, error: "Sign in to play Ranked." };
  return { ok: true as const, supabase, user };
}

export async function ensureMyPlayerRankAction(mode: RankedMode): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await ensureMyPlayerRank(ctx.supabase, mode);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.ensureRank", error);
    return { success: false, error: friendlyRankedError(error, "Couldn't set up Ranked for your account.") };
  }
}

export async function createRankedMatchAction(input: CreateRankedMatchInput): Promise<ActionResult<{ matchId: string }>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    const matchId = await createRankedMatch(ctx.supabase, input);
    revalidatePath("/profile/rank");
    return { success: true, data: { matchId } };
  } catch (error) {
    logServerError("ranked.createMatch", error);
    return { success: false, error: friendlyRankedError(error, "We couldn't start that match.") };
  }
}

export async function setRankedReadyAction(matchId: string, ready: boolean): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await setReady(ctx.supabase, matchId, ready);
    revalidatePath(`/ranked/match/${matchId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.setReady", error);
    return { success: false, error: friendlyRankedError(error, "That didn't go through.") };
  }
}

export async function proposeRankedOfficiatingAction(
  matchId: string,
  mode: RankedOfficiatingMode,
  scorekeeperId: string
): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await proposeOfficiating(ctx.supabase, matchId, mode, scorekeeperId);
    revalidatePath(`/ranked/match/${matchId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.proposeOfficiating", error);
    return { success: false, error: friendlyRankedError(error, "We couldn't set that up.") };
  }
}

export async function voteRankedOfficiatingAction(matchId: string, approve: boolean): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await voteOfficiating(ctx.supabase, matchId, approve);
    revalidatePath(`/ranked/match/${matchId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.voteOfficiating", error);
    return { success: false, error: friendlyRankedError(error, "That vote didn't go through.") };
  }
}

/**
 * Not used by the live scoreboard — that calls record_ranked_point via a
 * direct Supabase client call so a referee's tap round-trips over Realtime
 * in milliseconds, not a Server Action's page-revalidate cycle. This
 * exists for any server-rendered surface that needs the same write (tests,
 * an admin tool).
 */
export async function recordRankedPointAction(matchId: string, team: RankedTeam): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await recordPoint(ctx.supabase, matchId, team);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.recordPoint", error);
    return { success: false, error: friendlyRankedError(error, "That point didn't record.") };
  }
}

export async function undoRankedPointAction(matchId: string): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await undoPoint(ctx.supabase, matchId);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.undoPoint", error);
    return { success: false, error: friendlyRankedError(error, "Couldn't undo that.") };
  }
}

export async function submitRankedResultAction(matchId: string): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await submitResult(ctx.supabase, matchId);
    revalidatePath(`/ranked/match/${matchId}`);
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.submitResult", error);
    return { success: false, error: friendlyRankedError(error, "We couldn't submit that score.") };
  }
}

export async function respondToRankedResultAction(
  matchId: string,
  accept: boolean,
  reason?: string
): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await respondToResult(ctx.supabase, matchId, accept, reason);
    revalidatePath(`/ranked/match/${matchId}`);
    revalidatePath("/profile/rank");
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.respondToResult", error);
    return { success: false, error: friendlyRankedError(error, "That response didn't go through.") };
  }
}

export async function cancelRankedMatchAction(matchId: string): Promise<ActionResult<void>> {
  const ctx = await requireUser();
  if (!ctx.ok) return { success: false, error: ctx.error };

  try {
    await cancelMatch(ctx.supabase, matchId);
    revalidatePath("/profile/rank");
    return { success: true, data: undefined };
  } catch (error) {
    logServerError("ranked.cancelMatch", error);
    return { success: false, error: friendlyRankedError(error, "Couldn't cancel that match.") };
  }
}

/**
 * NO-SESSION READ. The public match-result page's only data source —
 * see getPublicMatchSummary()'s own comment for exactly what it withholds
 * (anything not 'confirmed', every rating field except the match-level
 * `rated` flag). getServerClient() works unauthenticated the same way it
 * does for getPublicVenueRequestSummaryAction(); grants on the RPC itself
 * are what actually gate this, not this action.
 */
export async function getPublicRankedMatchSummaryAction(matchId: string): Promise<ActionResult<PublicRankedMatchSummary | null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  try {
    const summary = await getPublicMatchSummary(supabase, matchId);
    return { success: true, data: summary };
  } catch (error) {
    logServerError("ranked.publicMatchSummary", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}
