import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { ensureMyPlayerRank, getPlayerRank } from "@/lib/services/ranked";
import { getPublicProfile } from "@/lib/services/profiles";
import { RankedPartyBuilder } from "@/components/ranked/RankedPartyBuilder";
import type { RankedMatchType } from "@/lib/supabase/types";

export const metadata: Metadata = { title: "Build your party — Ranked" };
export const dynamic = "force-dynamic";

/**
 * Build a ranked party directly — no booking required. Reached two ways:
 * with `?event=<id>&court=<id>` when struck from inside an Open Play
 * session (the primary path now lives in the unified /events/new form;
 * this is what its "Start a Ranked match here" bridge lands on), or with
 * neither, as the de-emphasized standalone entry point for a match
 * played on a court AIR/Rally never booked (a public park, an unlisted
 * club court) — see the ranked_matches table comment in
 * 20260810000067_air_rally_ranked.sql for why that path stays open.
 * `?type=singles|doubles` picks the match type either way.
 */
export default async function RankedNewMatchPage({
  searchParams,
}: {
  searchParams: Promise<{ type?: string; event?: string; court?: string }>;
}) {
  const { type, event, court } = await searchParams;
  const matchType: RankedMatchType = type === "doubles" ? "doubles" : "singles";
  const user = await requireSignedIn("/ranked/new");
  const supabase = await createClient();
  await ensureMyPlayerRank(supabase, matchType);

  const [rank, host] = await Promise.all([
    getPlayerRank(supabase, user.id, matchType),
    getPublicProfile(supabase, user.id),
  ]);

  if (!host) {
    return (
      <div className="border-2 border-navy bg-white px-6 py-10 text-center text-sm text-navy/60">
        We couldn&apos;t load your profile. Try again in a moment.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <p className="text-[0.625rem] font-semibold tracking-[0.16em] text-rally uppercase">Ranked setup</p>
        <h1 className="mt-2 text-[1.75rem] leading-[0.95] font-extrabold tracking-[-0.02em] text-navy">BUILD YOUR PARTY</h1>
      </div>
      <RankedPartyBuilder
        host={host}
        hostRank={rank}
        initialMatchType={matchType}
        eventId={event}
        courtId={court}
      />
    </div>
  );
}
