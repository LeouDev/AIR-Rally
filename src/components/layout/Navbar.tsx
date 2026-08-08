import Link from "next/link";
import { Logo } from "@/components/layout/Logo";
import { AuthNavSection } from "@/components/layout/AuthNavSection";

const NAV_LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/#how-it-works", label: "How It Works" },
  { href: "/list-your-court", label: "List Your Court" },
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
