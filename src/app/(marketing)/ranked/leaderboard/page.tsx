import type { Metadata } from "next";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listLeaderboard, getLeaderboardEntry } from "@/lib/services/ranked";
import { RankBadge } from "@/components/ranked/RankBadge";
import { ModeTabs, parseMode } from "@/components/ranked/ModeTabs";
import { pipNumeral, formatRating } from "@/lib/ranked";

export const metadata: Metadata = { title: "Leaderboard — Ranked" };
export const dynamic = "force-dynamic";

/**
 * Public — anyone can see standings, signed in or not (same posture as
 * `ranked_leaderboard`'s RLS: "Ranks are public"). The "you" footer only
 * appears for a signed-in, calibrated player. Singles and doubles are
 * separate leaderboards now — `?mode=` picks which.
 *
 * Deliberately NOT under /profile/rank like the dashboard/history: the
 * whole /profile prefix is middleware-gated behind sign-in
 * (PROTECTED_PREFIXES in lib/supabase/middleware.ts), which would make
 * this page stop being public the moment it moved there. It stays under
 * /ranked for the same reason /ranked/new and /ranked/match/[matchId]
 * do — not every page here is "your account," some are public or
 * session-scoped rather than account-scoped.
 */
export default async function RankedLeaderboardPage({
  searchParams,
}: {
  searchParams: Promise<{ mode?: string }>;
}) {
  const { mode: modeParam } = await searchParams;
  const mode = parseMode(modeParam);
  const user = await getCurrentUser();
  const supabase = await createClient();

  const [leaders, myEntry] = await Promise.all([
    listLeaderboard(supabase, mode, 25),
    user ? getLeaderboardEntry(supabase, user.id, mode) : Promise.resolve(null),
  ]);

  const myRowVisible = myEntry && leaders.some((l) => l.user_id === myEntry.user_id);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">AIR/Rally Ranked</p>
        <h1 className="mt-2 text-[1.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] text-navy">LEADERBOARD</h1>
      </div>

      <ModeTabs current={mode} basePath="/ranked/leaderboard" />

      {leaders.length === 0 ? (
        <div className="border-2 border-navy bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-navy/60">Nobody has placed yet this season.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          <div className="grid grid-cols-[34px_1fr_44px_60px] gap-2.5 border-b-2 border-navy px-1 pb-2.5 text-[0.5625rem] font-semibold tracking-[0.12em] text-navy/55 uppercase">
            <span>#</span>
            <span>Player</span>
            <span>Star</span>
            <span className="text-right">AAR</span>
          </div>
          {leaders.map((entry) => (
            <div
              key={entry.user_id}
              className={`grid grid-cols-[34px_1fr_44px_60px] items-center gap-2.5 border-b-2 border-navy/10 px-1 py-2.5 ${
                entry.user_id === user?.id ? "bg-rally/10" : ""
              }`}
            >
              <span className={`text-base font-extrabold ${entry.position <= 3 ? "text-rally" : "text-navy/60"}`}>
                {entry.position}
              </span>
              <span className="flex min-w-0 items-center gap-2.5">
                <RankBadge tier={entry.tier} size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] font-bold text-navy">{entry.display_name ?? "Player"}</span>
                  <span className="block text-[0.5625rem] font-semibold tracking-[0.08em] text-navy/55 uppercase">
                    {`tier ${entry.tier}`}
                  </span>
                </span>
              </span>
              <span className="text-[0.75rem] font-extrabold text-rally">{pipNumeral(entry.pips)}</span>
              <span className="text-right text-[0.8125rem] font-bold text-navy">{formatRating(entry.rating)}</span>
            </div>
          ))}
          {myEntry && !myRowVisible && (
            <div className="mt-1 grid grid-cols-[34px_1fr_44px_60px] items-center gap-2.5 bg-navy px-4 py-4 text-navy-foreground">
              <span className="text-base font-extrabold text-rally">{myEntry.position}</span>
              <span className="flex min-w-0 items-center gap-2.5">
                <RankBadge tier={myEntry.tier} on="navy" size={32} />
                <span className="min-w-0">
                  <span className="block truncate text-[0.8125rem] font-bold">{myEntry.display_name ?? "You"} (you)</span>
                  <span className="block text-[0.5625rem] font-semibold tracking-[0.08em] text-navy-foreground/60 uppercase">
                    {`tier ${myEntry.tier}`}
                  </span>
                </span>
              </span>
              <span className="text-[0.75rem] font-extrabold text-rally">{pipNumeral(myEntry.pips)}</span>
              <span className="text-right text-[0.8125rem] font-bold">{formatRating(myEntry.rating)}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
