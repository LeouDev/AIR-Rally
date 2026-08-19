import type { ReactNode } from "react";
import Link from "next/link";
import { Archivo } from "next/font/google";

// Scoped wherever this is mounted — Ranked is a deliberately distinct
// competitive-mode skin (navy ground, one orange accent, zero radius,
// flush-left labels) over the rest of the app's rounded warm-cream
// Geist look, matching the source design's "Modernist" system. The rest
// of the app is untouched: this font variable only exists inside the
// wrapper below, and every color used throughout Ranked is still the
// app's own --navy/--rally tokens (see globals.css), not new hex values,
// so dark mode keeps working for free.
const archivo = Archivo({
  variable: "--font-archivo",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
});

/**
 * The Ranked route family's shared chrome — extracted from a single
 * layout.tsx so a second layout (the account-level dashboard/leaderboard/
 * history pages under /profile/rank) can reuse it without loading the
 * Archivo font a second time in a second module scope.
 */
export function RankedShell({ children, homeHref = "/profile/rank" }: { children: ReactNode; homeHref?: string }) {
  return (
    // Fixed cream ground, not `bg-background`: the rank badges are baked
    // two-tone SVGs (navy ink for a light surface, cream ink for a navy
    // one — see public/ranks/ and RankBadge's `on` prop), not currentColor
    // art, so they can't repaint themselves for a dark surface. Rather
    // than a light-surface badge going illegible on a dark `bg-background`
    // when the app theme flips, Ranked keeps one fixed light/navy palette
    // in both themes — the same choice a lot of competitive-mode UIs make.
    // `text-navy`/`bg-navy` stay theme tokens because both light and dark
    // resolve `--navy` to a dark blue, so they never conflict with cream ink.
    <div className={`${archivo.variable} min-h-screen bg-[#f6f1e8] font-[family-name:var(--font-archivo)]`}>
      <div className="border-b-2 border-navy bg-[#f6f1e8] px-4 py-3">
        <div className="mx-auto flex max-w-2xl items-center justify-between">
          <Link href={homeHref} className="text-sm font-extrabold tracking-[0.02em] text-navy">
            AIR<span className="text-rally">/</span>RALLY <span className="text-rally">RANKED</span>
          </Link>
          <Link
            href="/"
            className="text-[0.6875rem] font-semibold tracking-[0.1em] text-navy/55 uppercase hover:text-navy"
          >
            Exit
          </Link>
        </div>
      </div>
      <div className="mx-auto max-w-2xl px-4 py-6 sm:px-6">{children}</div>
    </div>
  );
}
