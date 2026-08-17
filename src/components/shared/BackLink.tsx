import Link from "next/link";
import { ArrowLeft } from "lucide-react";

/**
 * Hierarchical back navigation: a real link to a known parent, not
 * `router.back()`.
 *
 * BackButton (router.back()) is right for Court Details, which is reached
 * from Explore, Favorites or the landing page and has no single parent.
 * These pages are the opposite case — /admin/payouts/[batchId] always sits
 * under /admin/payouts — and a link is better there for three reasons: it
 * survives a page opened in a new tab or arrived at by URL, where there is
 * no history to go back to; it stays correct after a redirect-on-submit
 * has rewritten history; and it can say where it goes, which `back()`
 * never can.
 *
 * Styling matches the existing back link on the admin venue detail page so
 * the two are indistinguishable.
 */
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="inline-flex items-center gap-1.5 text-sm text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </Link>
  );
}
