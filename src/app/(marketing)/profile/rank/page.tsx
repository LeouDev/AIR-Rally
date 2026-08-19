import Link from "next/link";
import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureMyPlayerRank, getPlayerRank, getActiveMatch, listRecentMatches } from "@/lib/services/ranked";
import { RankBadge } from "@/components/ranked/RankBadge";
import { PipRow } from "@/components/ranked/PipRow";
import { ClimbBar } from "@/components/ranked/ClimbBar";
import { MatchSummaryRow } from "@/components/ranked/MatchSummaryRow";
import { ModeTabs, parseMode } from "@/components/ranked/ModeTabs";
import { calibrationState, formatRating, formatReliability, formatWinRate, pipNumeral, tierInfo, matchStatusLabel } from "@/lib/ranked";

export const metadata: Metadata = { title: "Ranked" };
export const dynamic = "force-dynamic";

export default async function RankedHomePage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: modeParam } = await searchParams;
  const mode = parseMode(modeParam);
  const user = await requireSignedIn("/profile/rank");
  const supabase = await createClient();

  // Idempotent — a first-time visitor gets a real (empty) standing instead
  // of every query below coming back null.
  await ensureMyPlayerRank(supabase, mode);

  // Mode-agnostic on purpose — a live match banner should surface
  // regardless of which tab (singles/doubles) the player happens to be
  // looking at right now.
  const [rank, activeMatch] = await Promise.all([getPlayerRank(supabase, user.id, mode), getActiveMatch(supabase, user.id)]);

  if (!rank) {
    // ensureMyPlayerRank only fails when the season itself is closed.
    return (
      <div className="flex flex-col items-center gap-3 border-2 border-navy bg-white px-6 py-14 text-center">
        <p className="text-lg font-extrabold text-navy">Ranked is between seasons</p>
        <p className="max-w-sm text-sm text-navy/60">Check back soon — the next season will pick up where the ladder left off.</p>
      </div>
    );
  }

  const calibration = calibrationState(rank);
  const recent = rank.is_calibrated ? await listRecentMatches(supabase, user.id, mode, 4) : [];
  const info = tierInfo(rank.tier);

  return (
    <div className="flex flex-col gap-6">
      <ModeTabs current={mode} basePath="/profile/rank" />

      {activeMatch && (
        <Link
          href={`/ranked/match/${activeMatch.id}`}
          className="flex items-center justify-between gap-3 border-2 border-rally bg-rally px-4 py-3.5 text-navy-foreground"
        >
          <span className="text-[0.8125rem] font-bold">{matchStatusLabel(activeMatch)} — tap to continue</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      {!rank.is_calibrated ? (
        <div className="flex flex-col gap-3 border-2 border-navy bg-navy px-5 py-6 text-navy-foreground">
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">Calibrating</p>
          <p className="text-lg font-extrabold">
            {calibration.played} of {calibration.total} calibration matches played
          </p>
          <div className="grid grid-cols-10 gap-1 h-3">
            {Array.from({ length: calibration.total }, (_, i) => (
              <span key={i} className={i < calibration.played ? "bg-rally" : "bg-navy-foreground/20"} />
            ))}
          </div>
          <p className="text-[0.8125rem] leading-relaxed text-navy-foreground/80">
            Your tier stays hidden until match {calibration.total}. Results still count — they place you.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3.5 border-2 border-navy bg-navy px-5 py-6 text-navy-foreground">
          <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">
            {`Tier ${String(rank.tier).padStart(2, "0")}`}
          </p>
          <div className="flex items-center gap-4">
            <RankBadge tier={rank.tier} on="navy" size="xl" />
            <div className="flex flex-col gap-2">
              <p className="text-4xl leading-none font-extrabold tracking-[-0.02em]">{info.name.toUpperCase()}</p>
              <PipRow pips={rank.pips} on="navy" size="lg" />
              <p className="text-[0.6875rem] font-semibold tracking-[0.1em] text-navy-foreground/55">SUB-RANK {pipNumeral(rank.pips)}</p>
            </div>
          </div>
          <div className="h-0.5 bg-navy-foreground/20" />
          <div className="flex items-baseline justify-between">
            <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/50">AAR</span>
            <span className="text-base font-medium text-navy-foreground/85">{formatRating(rank.rating)}</span>
          </div>
          <div className="flex items-baseline justify-between">
            <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/50">CONFIDENCE</span>
            <span className="text-base font-medium text-navy-foreground/85">{formatReliability(rank.reliability)}</span>
          </div>
        </div>
      )}

      <div className="grid grid-cols-3 border-2 border-navy">
        <Stat value={rank.wins} label="Wins" />
        <Stat value={rank.losses} label="Losses" border />
        <Stat value={formatWinRate(rank)} label="Win rate" accent />
      </div>

      {rank.is_calibrated && (
        <div className="flex flex-col gap-3 border-2 border-navy bg-white px-5 py-5">
          <ClimbBar rank={rank} />
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <Link
          href={activeMatch ? `/ranked/match/${activeMatch.id}` : `/events/new?mode=ranked`}
          className="bg-rally px-5 py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] text-white uppercase"
        >
          {activeMatch ? "Continue match" : "Play ranked"}
        </Link>
        {!activeMatch && (
          <Link
            href="/ranked/new"
            className="self-start text-[0.6875rem] font-semibold tracking-[0.08em] text-navy/55 uppercase hover:text-navy"
          >
            Playing on a court you didn&apos;t book here? Start a match without a booking →
          </Link>
        )}
        <Link
          href={`/profile/rank/history?mode=${mode}`}
          className="border-2 border-navy px-5 py-4 text-left text-[0.8125rem] font-bold tracking-[0.08em] text-navy uppercase"
        >
          Match history
        </Link>
        <Link
          href={`/ranked/leaderboard?mode=${mode}`}
          className="border-2 border-navy px-5 py-4 text-left text-[0.8125rem] font-bold tracking-[0.08em] text-navy uppercase"
        >
          Leaderboard
        </Link>
      </div>

      {recent.length > 0 && (
        <div className="flex flex-col">
          <p className="pb-2 text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">Recent ranked</p>
          {recent.map((summary) => (
            <MatchSummaryRow key={summary.match.id} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}

function Stat({ value, label, border, accent }: { value: string | number; label: string; border?: boolean; accent?: boolean }) {
  return (
    <div className={`flex flex-col gap-1 px-4 py-3.5 ${border ? "border-x-2 border-navy" : ""}`}>
      <span className={`text-2xl font-extrabold ${accent ? "text-rally" : "text-navy"}`}>{value}</span>
      <span className="text-[0.5625rem] font-semibold tracking-[0.12em] text-navy/55 uppercase">{label}</span>
    </div>
  );
}
