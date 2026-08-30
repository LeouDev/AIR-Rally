import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { Apple, Users } from "lucide-react";
import { getPublicOpenMatchAction } from "@/lib/actions/openMatch";
import type { OpenMatchStatus } from "@/lib/services/openMatch";

/**
 * The page an Open Match notification's link_url ('/ranked/open/<id>',
 * set at creation in create_open_match()) actually resolves to. NO
 * SESSION REQUIRED, deliberately — same reasoning as
 * /ranked/results/[matchId]: the real reader is often a group chat, a
 * friend forwarded the link to, who doesn't have the app yet. Backed by
 * get_open_match_public() (migration 20260810000118), the one open-match
 * function granted to `anon` — see lib/services/openMatch.ts for exactly
 * what it returns and withholds.
 *
 * Renders for EVERY status, not just 'open' — a 404 here would read as
 * "the app is broken"; a page that says a game already filled up is
 * still the actual growth moment, since someone arriving late still
 * learns what AIR/Rally is. notFound() is reserved for the one case that
 * really means nothing exists: an id matching no row at all.
 *
 * Phone-first layout, deliberately (open-match-design memory's own
 * scoping call): most of the people this link reaches are on Android,
 * which has no native app, so the web page IS the product for them —
 * not a fallback for a desktop visitor.
 */
export const dynamic = "force-dynamic";

// Never indexed — a shared invite is for the person holding the link,
// not a search result. Same reasoning as the ranked-result share page.
export const metadata: Metadata = {
  title: "AIR/Rally Open Match",
  robots: { index: false, follow: false },
};

// Same App Store id Footer.tsx's badge and eas.json's submit config use —
// duplicated here rather than imported since Footer's badge isn't
// exported, and this is the only other place that needs it today.
const APP_STORE_URL = "https://apps.apple.com/app/id6803324731";

const STATUS_COPY: Record<OpenMatchStatus | "unknown", { heading: (city: string) => string; body: string }> = {
  open: {
    heading: (city) => `Looking for players in ${city}`,
    body: "Get AIR/Rally to see the game and request to join.",
  },
  converted: {
    heading: () => "This game is already full",
    body: "But there's always another one starting. Get AIR/Rally to find it.",
  },
  expired: {
    heading: () => "This game has ended",
    body: "Get AIR/Rally to see what's open near you right now.",
  },
  cancelled: {
    heading: () => "This game was cancelled",
    body: "Get AIR/Rally to find another game near you.",
  },
  // A status this build doesn't recognise — a future addition, or a
  // bug — must still render something safe rather than crash or claim
  // the game is one specific thing it might not be.
  unknown: {
    heading: () => "This game may no longer be available",
    body: "Get AIR/Rally to see what's open near you right now.",
  },
};

function AppStoreCta() {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-black px-4 text-white transition-opacity hover:opacity-90"
    >
      <Apple className="size-5 shrink-0" aria-hidden="true" />
      <span className="flex flex-col leading-tight">
        <span className="text-[10px]">Download on the</span>
        <span className="-mt-0.5 text-base font-semibold tracking-tight">App Store</span>
      </span>
    </a>
  );
}

export default async function PublicOpenMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = await getPublicOpenMatchAction(id);

  if (!result.success || !result.data) notFound();
  const { hostDisplayName, cityDisplayName, status, acceptedCount } = result.data;
  const copy = STATUS_COPY[status];
  const hostName = hostDisplayName || "Someone";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 px-4 py-16 text-center sm:px-6">
      <div className="flex flex-col items-center gap-2">
        <div className="flex size-14 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Users className="size-6" aria-hidden="true" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight text-foreground">{copy.heading(cityDisplayName)}</h1>
        <p className="text-sm text-muted-foreground">
          {hostName} · {cityDisplayName}
        </p>
        {status === "open" && (
          <p className="text-sm text-muted-foreground">
            {acceptedCount} {acceptedCount === 1 ? "player" : "players"} in so far
          </p>
        )}
      </div>

      <p className="text-sm text-muted-foreground">{copy.body}</p>

      <AppStoreCta />

      <p className="text-sm text-muted-foreground">AIR/Rally is a pickleball booking and ranked-play app.</p>
    </div>
  );
}
