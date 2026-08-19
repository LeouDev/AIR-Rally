import Link from "next/link";
import { formatRatingDelta } from "@/lib/ranked";
import type { RankedMatchSummary } from "@/lib/services/ranked";

function opponentLabel(summary: RankedMatchSummary): string {
  const names = summary.opponents.map((p) => p.display_name ?? "Unknown").filter(Boolean);
  if (names.length === 0) return "Ranked match";
  if (names.length === 1) return `vs. ${names[0]}`;
  return `vs. ${names.join(" / ")}`;
}

function formatMatchDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-PH", { month: "short", day: "numeric" });
}

/** One line in a match history list — the design's "RECENT RANKED" row. */
export function MatchSummaryRow({ summary }: { summary: RankedMatchSummary }) {
  const { match, me, won } = summary;
  const barColor = won ? "bg-rally" : "bg-navy/25";
  const score = me.team === "a" ? `${match.score_a}–${match.score_b}` : `${match.score_b}–${match.score_a}`;

  return (
    <Link
      href={`/ranked/match/${match.id}`}
      className="flex items-center gap-3 border-b-2 border-navy/10 py-3.5 transition-colors last:border-b-0 hover:bg-navy/5"
    >
      <span className={`h-9 w-1.5 shrink-0 ${barColor}`} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.8125rem] font-bold text-navy">{opponentLabel(summary)}</span>
        <span className="mt-0.5 block text-[0.625rem] font-semibold tracking-[0.04em] text-navy/55 uppercase">
          {match.match_type} · {formatMatchDate(match.confirmed_at)}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-0.5">
        <span className={`text-[0.8125rem] font-extrabold ${won ? "text-rally" : "text-navy/60"}`}>
          {won ? "W" : "L"} {score}
        </span>
        {me.rating_delta !== null && (
          <span className="text-[0.625rem] font-semibold text-navy/60">
            {formatRatingDelta(me.rating_delta)}
            {me.star_protected ? " · protected" : me.pip_delta ? ` · ${me.pip_delta > 0 ? "+1 pip" : "−1 pip"}` : ""}
          </span>
        )}
      </span>
    </Link>
  );
}
