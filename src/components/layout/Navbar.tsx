import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { AuthNavSection } from "@/components/layout/AuthNavSection";

// "List Your Court" deliberately lives in AuthNavSection, not here — it
// should only ever appear to a signed-out visitor (a legitimate
// top-of-funnel acquisition link). A signed-in player should never see
// it post-login (Phase 6, Part 1); a signed-in owner/admin already has
// their own entry point via UserMenu's role-branched items. Putting it
// here would show it unconditionally to everyone, signed in or not.
const NAV_LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/#how-it-works", label: "How It Works" },
];

export function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-border bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8">
        <Logo />

        <nav className="hidden items-center gap-1 md:flex" aria-label="Primary">
          {NAV_LINKS.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {link.label}
            </Link>
          ))}
        </nav>

        <AuthNavSection />
      </div>
    </header>
  );
}
