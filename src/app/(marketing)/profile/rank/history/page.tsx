import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listRecentMatches } from "@/lib/services/ranked";
import { MatchSummaryRow } from "@/components/ranked/MatchSummaryRow";
import { ModeTabs, parseMode } from "@/components/ranked/ModeTabs";

export const metadata: Metadata = { title: "Match history — Ranked" };
export const dynamic = "force-dynamic";

export default async function RankedHistoryPage({ searchParams }: { searchParams: Promise<{ mode?: string }> }) {
  const { mode: modeParam } = await searchParams;
  const mode = parseMode(modeParam);
  const user = await requireSignedIn("/profile/rank/history");
  const supabase = await createClient();
  const matches = await listRecentMatches(supabase, user.id, mode, 50);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">AIR/Rally Ranked</p>
        <h1 className="mt-2 text-[1.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] text-navy">MATCH HISTORY</h1>
      </div>

      <ModeTabs current={mode} basePath="/profile/rank/history" />

      {matches.length === 0 ? (
        <div className="border-2 border-navy bg-white px-6 py-14 text-center">
          <p className="text-sm font-semibold text-navy/60">No confirmed ranked matches yet.</p>
        </div>
      ) : (
        <div className="flex flex-col border-2 border-navy bg-white px-4">
          {matches.map((summary) => (
            <MatchSummaryRow key={summary.match.id} summary={summary} />
          ))}
        </div>
      )}
    </div>
  );
}
