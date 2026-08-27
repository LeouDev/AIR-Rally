import type { SupabaseClient, PostgrestError } from "@supabase/supabase-js";
import type {
  Database,
  PlayerRank,
  PublicProfile,
  RankedLeaderboardRow,
  RankedMatch,
  RankedMatchPlayer,
  RankedMatchPoint,
  RankedMatchType,
  RankedMode,
  RankedOfficiatingMode,
  RankedTeam,
} from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * A ranked rule the player is meant to read verbatim — "Party rank
 * difference too large", "Only the scorekeeper can submit the final score".
 *
 * Every RAISE in 20260810000067_air_rally_ranked.sql carries SQLSTATE
 * `AR001`, which exists purely to mark "this text was written for a person".
 * Without it these messages would fall into lib/errors.ts's generic
 * constraint mapping and every one of them would read "We couldn't save
 * that — please check the form and try again", which tells the player
 * nothing about what actually stopped them.
 *
 * Same shape and intent as BookingError in lib/services/bookings.ts.
 */
export class RankedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RankedError";
  }
}

/** SQLSTATE reserved by this feature for player-facing rule violations. */
const RANKED_RULE_SQLSTATE = "AR001";

function throwRanked(error: PostgrestError): never {
  if (error.code === RANKED_RULE_SQLSTATE) throw new RankedError(error.message);
  throw error;
}

/* -------------------------------------------------------------------------
 * Reads
 * ---------------------------------------------------------------------- */

/**
 * The signed-in player's standing for the open season IN THIS MODE, or
 * null if they have never opened Ranked in it — singles and doubles are
 * independent rows now, so a player can have one without the other.
 * Callers that are about to show a Ranked screen should use
 * `ensureMyPlayerRank` first so a first-time visitor sees a real (empty)
 * standing rather than a "not playing" dead end.
 */
export async function getPlayerRank(supabase: Client, userId: string, mode: RankedMode): Promise<PlayerRank | null> {
  const { data, error } = await supabase
    .from("player_ranks")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", mode)
    .order("season_id", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** Batched — one query for a whole lobby, not one per player card. Always for one mode: a doubles lobby needs everyone's doubles rank, never a mix. */
export async function getPlayerRanks(supabase: Client, userIds: string[], mode: RankedMode): Promise<Map<string, PlayerRank>> {
  if (userIds.length === 0) return new Map();
  const { data, error } = await supabase.from("player_ranks").select("*").in("user_id", userIds).eq("mode", mode);
  if (error) throw error;
  return new Map(data.map((row) => [row.user_id, row]));
}

export async function listLeaderboard(supabase: Client, mode: RankedMode, limit = 50): Promise<RankedLeaderboardRow[]> {
  const { data, error } = await supabase
    .from("ranked_leaderboard")
    .select("*")
    .eq("mode", mode)
    .order("position", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return data;
}

/**
 * One player's row on the leaderboard, wherever it falls. Fetched separately
 * from the top N so the "you are 48th" footer works without pulling the 47
 * rows above it.
 */
export async function getLeaderboardEntry(supabase: Client, userId: string, mode: RankedMode): Promise<RankedLeaderboardRow | null> {
  const { data, error } = await supabase
    .from("ranked_leaderboard")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", mode)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export type RankedMatchParticipant = RankedMatchPlayer & {
  profile: PublicProfile | null;
  rank: PlayerRank | null;
};

export type RankedMatchDetail = RankedMatch & {
  players: RankedMatchParticipant[];
  /** Null when nobody has been proposed yet, or when the referee isn't a player. */
  scorekeeper: PublicProfile | null;
};

/**
 * Resolves profiles through `public_profiles` rather than a `profiles`
 * embed — the same reasoning as everywhere else in this codebase that
 * answers "whose id is this" for someone other than the viewer.
 */
async function attachParticipants(
  supabase: Client,
  players: RankedMatchPlayer[],
  mode: RankedMode
): Promise<RankedMatchParticipant[]> {
  const ids = players.map((p) => p.user_id);
  if (ids.length === 0) return [];

  const [profilesResult, ranks] = await Promise.all([
    supabase.from("public_profiles").select("*").in("id", ids),
    getPlayerRanks(supabase, ids, mode),
  ]);
  if (profilesResult.error) throw profilesResult.error;

  const byId = new Map(profilesResult.data.map((p) => [p.id, p]));
  return players.map((player) => ({
    ...player,
    profile: byId.get(player.user_id) ?? null,
    rank: ranks.get(player.user_id) ?? null,
  }));
}

export type PublicRankedMatchSummary = {
  matchType: RankedMatchType;
  scoreA: number;
  scoreB: number;
  winningTeam: RankedTeam | null;
  rated: boolean;
  confirmedAt: string | null;
  venueName: string | null;
  players: { displayName: string; team: RankedTeam }[];
};

/**
 * No-session read of a single CONFIRMED match — public_ranked_match_summary()
 * (migration 20260810000107) returns no row at all for anything else
 * (live/lobby/disputed/nonexistent), same 404-not-error shape as
 * getPublicVenueRequestSummary(). Carries no rating_delta/tier_before/
 * tier_after for anyone — a visitor sees the result, not what it did to
 * anyone's standing. `rated` is the one exception: a match-level flag set
 * once at creation, never a per-player figure, so the page can label a
 * casual result as casual without implying rating movement that never
 * happened.
 */
export async function getPublicMatchSummary(supabase: Client, matchId: string): Promise<PublicRankedMatchSummary | null> {
  const { data, error } = await supabase.rpc("public_ranked_match_summary", { p_match_id: matchId }).single();
  if (error) {
    if (error.code === "PGRST116") return null;
    throw error;
  }
  return {
    matchType: data.match_type as RankedMatchType,
    scoreA: data.score_a,
    scoreB: data.score_b,
    winningTeam: data.winning_team as RankedTeam | null,
    rated: data.rated,
    confirmedAt: data.confirmed_at,
    venueName: data.venue_name,
    players: (data.players ?? []) as { displayName: string; team: RankedTeam }[],
  };
}

export async function getMatch(supabase: Client, matchId: string): Promise<RankedMatchDetail | null> {
  const { data: match, error } = await supabase.from("ranked_matches").select("*").eq("id", matchId).maybeSingle();
  if (error) throw error;
  if (!match) return null;

  const { data: playerRows, error: playersError } = await supabase
    .from("ranked_match_players")
    .select("*")
    .eq("match_id", matchId);
  if (playersError) throw playersError;

  const players = await attachParticipants(supabase, playerRows, match.match_type);

  // The scorekeeper is usually one of the players; under 'referee' mode
  // they are a fifth person who needs their own lookup.
  let scorekeeper = players.find((p) => p.user_id === match.scorekeeper_id)?.profile ?? null;
  if (!scorekeeper && match.scorekeeper_id) {
    const { data } = await supabase.from("public_profiles").select("*").eq("id", match.scorekeeper_id).maybeSingle();
    scorekeeper = data ?? null;
  }

  // Team A first, then B, host first within each — the order every screen
  // in the design reads the lobby in.
  players.sort((a, b) => (a.team === b.team ? Number(b.is_host) - Number(a.is_host) : a.team.localeCompare(b.team)));

  return { ...match, players, scorekeeper };
}

export async function listMatchPoints(supabase: Client, matchId: string): Promise<RankedMatchPoint[]> {
  const { data, error } = await supabase
    .from("ranked_match_points")
    .select("*")
    .eq("match_id", matchId)
    .order("seq", { ascending: true });
  if (error) throw error;
  return data;
}

/**
 * The match a player should be dropped back into when they reopen the app —
 * a lobby they never readied up in, a game in progress, a result waiting on
 * their confirmation. Most recent first; there is normally at most one.
 */
export async function getActiveMatch(supabase: Client, userId: string): Promise<RankedMatchDetail | null> {
  const { data, error } = await supabase
    .from("ranked_match_players")
    .select("match_id")
    .eq("user_id", userId);
  if (error) throw error;
  if (data.length === 0) return null;

  const { data: matches, error: matchError } = await supabase
    .from("ranked_matches")
    .select("id")
    .in("id", data.map((row) => row.match_id))
    .in("status", ["lobby", "officiating", "live", "awaiting_confirmation"])
    .order("created_at", { ascending: false })
    .limit(1);
  if (matchError) throw matchError;
  if (matches.length === 0) return null;

  return getMatch(supabase, matches[0].id);
}

export type RankedMatchSummary = {
  match: RankedMatch;
  /** The viewer's own line in this match — what it cost or paid them. */
  me: RankedMatchPlayer;
  opponents: PublicProfile[];
  partner: PublicProfile | null;
  won: boolean;
};

/**
 * Confirmed matches only. An unresolved dispute has moved nothing, so
 * showing it in a history of results would be a lie about the record.
 * Filtered to one mode — a singles-only view mixed with doubles results
 * under the same "recent ranked" heading would misrepresent which
 * rating actually moved.
 */
export async function listRecentMatches(
  supabase: Client,
  userId: string,
  mode: RankedMode,
  limit = 10
): Promise<RankedMatchSummary[]> {
  const { data: mine, error } = await supabase
    .from("ranked_match_players")
    .select("*")
    .eq("user_id", userId)
    .eq("mode", mode)
    .order("created_at", { ascending: false })
    .limit(limit * 2);
  if (error) throw error;
  if (mine.length === 0) return [];

  const { data: matches, error: matchError } = await supabase
    .from("ranked_matches")
    .select("*")
    .in("id", mine.map((row) => row.match_id))
    .eq("status", "confirmed")
    .order("confirmed_at", { ascending: false })
    .limit(limit);
  if (matchError) throw matchError;
  if (matches.length === 0) return [];

  const { data: everyone, error: everyoneError } = await supabase
    .from("ranked_match_players")
    .select("*")
    .in("match_id", matches.map((m) => m.id));
  if (everyoneError) throw everyoneError;

  const otherIds = [...new Set(everyone.filter((p) => p.user_id !== userId).map((p) => p.user_id))];
  const { data: profiles, error: profileError } = await supabase
    .from("public_profiles")
    .select("*")
    .in("id", otherIds.length > 0 ? otherIds : ["00000000-0000-0000-0000-000000000000"]);
  if (profileError) throw profileError;
  const profileById = new Map(profiles.map((p) => [p.id, p]));

  const myLineByMatch = new Map(mine.map((row) => [row.match_id, row]));

  return matches.flatMap((match) => {
    const me = myLineByMatch.get(match.id);
    if (!me) return [];
    const others = everyone.filter((p) => p.match_id === match.id && p.user_id !== userId);
    return [
      {
        match,
        me,
        partner: profileById.get(others.find((p) => p.team === me.team)?.user_id ?? "") ?? null,
        opponents: others
          .filter((p) => p.team !== me.team)
          .map((p) => profileById.get(p.user_id))
          .filter((p): p is PublicProfile => p !== undefined),
        won: match.winning_team === me.team,
      },
    ];
  });
}

/**
 * Players in the same Open Play session who could referee — anyone attending
 * who is not on court for this match. The design's "6 players are courtside
 * and not in a match".
 */
export async function listRefereeCandidates(
  supabase: Client,
  eventId: string,
  excludeUserIds: string[]
): Promise<PublicProfile[]> {
  const { data, error } = await supabase
    .from("event_attendees")
    .select("user_id")
    .eq("event_id", eventId)
    .eq("status", "joined");
  if (error) throw error;

  const excluded = new Set(excludeUserIds);
  const ids = data.map((row) => row.user_id).filter((id) => !excluded.has(id));
  if (ids.length === 0) return [];

  const { data: profiles, error: profileError } = await supabase.from("public_profiles").select("*").in("id", ids);
  if (profileError) throw profileError;
  return profiles;
}

/* -------------------------------------------------------------------------
 * Writes — thin wrappers over the RPCs
 *
 * Every one of these is a SECURITY DEFINER function; none of the ranked
 * tables has a client insert/update policy. The mobile app calls exactly
 * these same RPCs directly over PostgREST with the player's own JWT, so the
 * rules below are enforced once, in Postgres, for both clients.
 * ---------------------------------------------------------------------- */

export async function ensureMyPlayerRank(supabase: Client, mode: RankedMode): Promise<void> {
  const { error } = await supabase.rpc("ensure_my_player_rank", { p_mode: mode });
  if (error) throwRanked(error);
}

export type CreateRankedMatchInput = {
  matchType: RankedMatchType;
  teamA: string[];
  teamB: string[];
  eventId?: string | null;
  courtId?: string | null;
};

/** Returns the new match's id. The caller must be one of the players. */
export async function createRankedMatch(supabase: Client, input: CreateRankedMatchInput): Promise<string> {
  const { data, error } = await supabase.rpc("create_ranked_match", {
    p_match_type: input.matchType,
    p_team_a: input.teamA,
    p_team_b: input.teamB,
    p_event_id: input.eventId ?? null,
    p_court_id: input.courtId ?? null,
  });
  if (error) throwRanked(error);
  return data as string;
}

export async function setReady(supabase: Client, matchId: string, ready: boolean): Promise<void> {
  const { error } = await supabase.rpc("set_ranked_ready", { p_match_id: matchId, p_ready: ready });
  if (error) throwRanked(error);
}

export async function proposeOfficiating(
  supabase: Client,
  matchId: string,
  mode: RankedOfficiatingMode,
  scorekeeperId: string
): Promise<void> {
  const { error } = await supabase.rpc("propose_ranked_officiating", {
    p_match_id: matchId,
    p_mode: mode,
    p_scorekeeper_id: scorekeeperId,
  });
  if (error) throwRanked(error);
}

export async function voteOfficiating(supabase: Client, matchId: string, approve: boolean): Promise<void> {
  const { error } = await supabase.rpc("vote_ranked_officiating", { p_match_id: matchId, p_approve: approve });
  if (error) throwRanked(error);
}

export async function recordPoint(supabase: Client, matchId: string, team: RankedTeam): Promise<void> {
  const { error } = await supabase.rpc("record_ranked_point", { p_match_id: matchId, p_team: team });
  if (error) throwRanked(error);
}

export async function undoPoint(supabase: Client, matchId: string): Promise<void> {
  const { error } = await supabase.rpc("undo_ranked_point", { p_match_id: matchId });
  if (error) throwRanked(error);
}

export async function submitResult(supabase: Client, matchId: string): Promise<void> {
  const { error } = await supabase.rpc("submit_ranked_result", { p_match_id: matchId });
  if (error) throwRanked(error);
}

export async function respondToResult(
  supabase: Client,
  matchId: string,
  accept: boolean,
  reason?: string
): Promise<void> {
  const { error } = await supabase.rpc("respond_ranked_result", {
    p_match_id: matchId,
    p_accept: accept,
    p_reason: reason ?? null,
  });
  if (error) throwRanked(error);
}

export async function cancelMatch(supabase: Client, matchId: string): Promise<void> {
  const { error } = await supabase.rpc("cancel_ranked_match", { p_match_id: matchId });
  if (error) throwRanked(error);
}
