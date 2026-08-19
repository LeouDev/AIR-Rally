"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { respondToRankedResultAction } from "@/lib/actions/ranked";
import { rankedDisputeSchema, formatDisputeReason, type RankedDisputeValues } from "@/lib/validations/ranked";
import { RANKED_DISPUTE_REASONS, confirmationTally, formatRating, formatRatingDelta, rankLabel, tierInfo } from "@/lib/ranked";
import { RankBadge } from "@/components/ranked/RankBadge";
import { ShareResultButton } from "@/components/ranked/match/ShareResultButton";
import type { RankedMatchDetail } from "@/lib/services/ranked";
import type { RankedDisputeReason } from "@/lib/ranked";

export function ResultPhase({ match, currentUserId }: { match: RankedMatchDetail; currentUserId: string }) {
  if (match.status === "disputed") return <DisputedView match={match} />;
  if (match.status === "confirmed") return <ConfirmedView match={match} currentUserId={currentUserId} />;
  return <AwaitingConfirmationView match={match} currentUserId={currentUserId} />;
}

function AwaitingConfirmationView({ match, currentUserId }: { match: RankedMatchDetail; currentUserId: string }) {
  const [isPending, startTransition] = useTransition();
  const [disputing, setDisputing] = useState(false);
  const [reason, setReason] = useState<RankedDisputeReason | null>(null);
  const [detail, setDetail] = useState("");

  const me = match.players.find((p) => p.user_id === currentUserId);
  const submitter = match.scorekeeper?.display_name ?? "the scorekeeper";
  const tally = confirmationTally(match.players);

  function respond(accept: boolean, reasonText?: string) {
    if (isPending) return;
    startTransition(async () => {
      const result = await respondToRankedResultAction(match.id, accept, reasonText);
      if (!result.success) toast.error(result.error);
    });
  }

  function submitDispute() {
    if (!reason) return;
    const parsed: RankedDisputeValues | null = (() => {
      const candidate = { reason, detail: detail.trim() || undefined };
      const result = rankedDisputeSchema.safeParse(candidate);
      return result.success ? result.data : null;
    })();
    if (!parsed) {
      toast.error("Tell us what happened.");
      return;
    }
    respond(false, formatDisputeReason(parsed));
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">
          Result submitted · {match.players.length} players notified
        </p>
        <h2 className="mt-2 text-[1.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] text-navy">CONFIRM RESULT</h2>
      </div>

      <div className="flex flex-col gap-3.5 border-2 border-navy bg-white px-5 py-5">
        <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">
          Final score · submitted by {submitter}
        </p>
        <div className="flex items-baseline gap-4">
          <span className="text-[3.5rem] leading-[0.85] font-extrabold text-navy">{match.score_a}</span>
          <span className="text-3xl font-extrabold text-navy/30">—</span>
          <span className="text-[3.5rem] leading-[0.85] font-extrabold text-navy/50">{match.score_b}</span>
        </div>
        <p className="text-[0.6875rem] font-semibold tracking-[0.08em] text-navy/60 uppercase">
          Team {match.winning_team?.toUpperCase()} wins · {match.match_type}
        </p>
      </div>

      <div className="flex flex-col gap-2.5 border-2 border-navy bg-white px-5 py-5">
        <p className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">Player confirmations</p>
        {match.players.map((p) => (
          <div key={p.user_id} className="flex items-center justify-between">
            <span className="text-sm font-semibold text-navy">{p.profile?.display_name ?? "Player"}</span>
            <span
              className={`text-[0.625rem] font-bold tracking-[0.1em] ${
                p.result_response === "accepted"
                  ? "text-rally"
                  : p.result_response === "disputed"
                    ? "text-rally"
                    : "text-navy/40"
              }`}
            >
              {p.result_response.toUpperCase()}
            </span>
          </div>
        ))}
      </div>

      {!me || me.result_response !== "pending" ? (
        <p className="text-center text-[0.8125rem] text-navy/55">
          {me?.result_response === "accepted"
            ? `You accepted. ${tally.accepted} of ${tally.total} in.`
            : me?.result_response === "disputed"
              ? "You disputed this result."
              : "Waiting on your teammates."}
        </p>
      ) : disputing ? (
        <div className="flex flex-col gap-3">
          <p className="text-base font-extrabold text-navy">Why are you disputing this result?</p>
          {RANKED_DISPUTE_REASONS.map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setReason(option)}
              className={`flex items-center justify-between border-2 border-navy px-4 py-3.5 text-left transition-colors ${
                reason === option ? "bg-navy text-navy-foreground" : "bg-white text-navy"
              }`}
            >
              <span className="text-sm font-semibold">{option}</span>
              <span
                className={`size-3.5 border-2 ${
                  reason === option ? "border-navy-foreground bg-rally" : "border-navy bg-transparent"
                }`}
              />
            </button>
          ))}
          {reason === "Other" && (
            <textarea
              value={detail}
              onChange={(e) => setDetail(e.target.value)}
              placeholder="What happened?"
              rows={3}
              className="w-full resize-none border-2 border-navy bg-white p-3 text-sm text-navy outline-none placeholder:text-navy/40"
            />
          )}
          <button
            type="button"
            onClick={submitDispute}
            disabled={!reason || isPending}
            className="w-full bg-rally py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] text-white uppercase disabled:opacity-40"
          >
            Submit dispute
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2.5">
          <button
            type="button"
            onClick={() => respond(true)}
            disabled={isPending}
            className="w-full bg-rally py-5 text-left text-[0.9375rem] font-extrabold tracking-[0.08em] text-white uppercase disabled:opacity-60"
          >
            Accept
          </button>
          <button
            type="button"
            onClick={() => setDisputing(true)}
            disabled={isPending}
            className="w-full border-2 border-navy py-4 text-left text-[0.8125rem] font-bold tracking-[0.08em] text-navy uppercase"
          >
            Dispute
          </button>
        </div>
      )}
    </div>
  );
}

function ConfirmedView({ match, currentUserId }: { match: RankedMatchDetail; currentUserId: string }) {
  const me = match.players.find((p) => p.user_id === currentUserId);
  const won = match.winning_team === me?.team;
  const myScore = me?.team === "a" ? match.score_a : match.score_b;
  const theirScore = me?.team === "a" ? match.score_b : match.score_a;

  // tier_before is null exactly when this was the match that completed
  // calibration — there was no visible ladder position before it, so
  // that's a placement, not a promotion or demotion.
  const justPlaced = me !== undefined && me.tier_before === null && me.tier_after !== null;
  const promoted = me !== undefined && me.tier_before !== null && me.tier_after !== null && me.tier_after > me.tier_before;
  const demoted = me !== undefined && me.tier_before !== null && me.tier_after !== null && me.tier_after < me.tier_before;

  const shareText = me
    ? `I just ${won ? "won" : "played"} ${myScore}–${theirScore} on AIR/Rally Ranked${
        me.tier_after ? ` — now ${rankLabel(me.tier_after, me.pips_after ?? 1)}` : ""
      }.`
    : "AIR/Rally Ranked match result.";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-col gap-4 border-2 border-navy bg-navy px-5 py-5 text-navy-foreground">
        <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">Match complete</p>
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3">
          <div>
            <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/55 uppercase">Team A</p>
            <p className={`text-[2.75rem] leading-[0.85] font-extrabold ${match.winning_team === "a" ? "text-rally" : "opacity-50"}`}>
              {match.score_a}
            </p>
          </div>
          <div className="h-14 w-0.5 bg-navy-foreground/25" />
          <div>
            <p className="mb-2 text-[0.625rem] font-semibold tracking-[0.14em] text-navy-foreground/55 uppercase">Team B</p>
            <p className={`text-[2.75rem] leading-[0.85] font-extrabold ${match.winning_team === "b" ? "text-rally" : "opacity-50"}`}>
              {match.score_b}
            </p>
          </div>
        </div>
        <div className="flex items-baseline gap-3 border-t-2 border-navy-foreground/25 pt-3.5">
          <span className="text-[0.625rem] font-semibold tracking-[0.16em] text-navy-foreground/55 uppercase">Winner</span>
          <span className="text-xl font-extrabold text-rally">Team {match.winning_team?.toUpperCase()}</span>
        </div>
      </div>

      {me && me.tier_after !== null && me.pips_after !== null && (
        <div
          className={`flex flex-col gap-4 border-2 border-navy px-5 py-5 ${promoted || demoted ? "bg-navy text-navy-foreground" : "bg-white text-navy"}`}
        >
          <p
            className={`text-[0.625rem] font-semibold tracking-[0.14em] uppercase ${promoted || demoted ? "text-rally" : "text-navy/55"}`}
          >
            {promoted ? "Rank up" : demoted ? "Rank down" : justPlaced ? "Placed" : "Rank impact"}
          </p>
          <div className="flex items-center justify-center gap-4">
            {!justPlaced && me.tier_before !== null && (
              <>
                <div className="flex flex-col items-center gap-2">
                  <RankBadge tier={me.tier_before} on={promoted || demoted ? "navy" : "light"} size={64} className="opacity-45" />
                  <span className="text-[0.6875rem] font-bold opacity-60">{tierInfo(me.tier_before).name}</span>
                </div>
                <span className="text-2xl font-extrabold text-rally">→</span>
              </>
            )}
            <div className="flex flex-col items-center gap-2">
              <RankBadge tier={me.tier_after} on={promoted || demoted ? "navy" : "light"} size={promoted ? 96 : 64} />
              <span className="text-[0.8125rem] font-extrabold">{rankLabel(me.tier_after, me.pips_after)}</span>
            </div>
          </div>
          {me.star_protected ? (
            <div className="flex items-center justify-center gap-2 border-2 border-rally px-4 py-3 text-[0.8125rem] font-extrabold">
              <span className="rotate-45 bg-rally" style={{ width: 12, height: 12 }} /> STAR PROTECTED — NO PIP LOST
            </div>
          ) : me.pip_delta !== null && me.pip_delta !== 0 && !promoted && !demoted ? (
            <div className="flex items-center justify-center gap-2 border-2 border-rally px-4 py-3 text-[0.8125rem] font-extrabold text-rally">
              <span className="rotate-45 bg-rally" style={{ width: 12, height: 12 }} />
              {me.pip_delta > 0 ? "+1 PIP EARNED" : "1 PIP LOST"}
            </div>
          ) : null}
        </div>
      )}

      {me && me.rating_delta !== null && (
        <div className="flex items-center justify-between border-2 border-navy bg-white px-5 py-4">
          <span className="text-[0.625rem] font-semibold tracking-[0.14em] text-navy/55 uppercase">AAR</span>
          <div className="flex items-baseline gap-2.5">
            {me.rating_before !== null && <span className="text-base font-medium text-navy/45">{formatRating(me.rating_before)}</span>}
            <span className="text-sm font-bold text-rally">→</span>
            <span className="text-xl font-extrabold text-navy">{formatRating(me.rating_after ?? 0)}</span>
            <span className="text-sm font-bold text-rally">{formatRatingDelta(me.rating_delta)}</span>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2.5">
        <ShareResultButton text={shareText} />
        <Link
          href="/profile/rank"
          className="w-full border-2 border-navy py-4 text-center text-[0.8125rem] font-bold tracking-[0.08em] text-navy uppercase"
        >
          Back to ranked
        </Link>
      </div>
    </div>
  );
}

function DisputedView({ match }: { match: RankedMatchDetail }) {
  return (
    <div className="flex flex-col gap-4 border-2 border-rally bg-rally px-5 py-6 text-white">
      <p className="text-2xl font-extrabold">RESULT DISPUTED</p>
      <p className="text-[0.8125rem] leading-relaxed">
        Reason: {match.dispute_reason ?? "Not specified"}. No pips, AAR or win/loss changes are applied until this is resolved.
      </p>
      <p className="border-t border-white/35 pt-3 text-[0.625rem] font-semibold tracking-[0.12em] uppercase">
        All four players have been notified. AIR/Rally support will review this match.
      </p>
      <Link href="/profile/rank" className="mt-1 self-start border-2 border-white px-4 py-2.5 text-[0.625rem] font-bold tracking-[0.1em] uppercase">
        Back to ranked
      </Link>
    </div>
  );
}
