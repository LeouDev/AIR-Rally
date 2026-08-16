import Link from "next/link";
import type { ReactNode } from "react";
import { Apple } from "lucide-react";
import { Logo } from "@/components/layout/Logo";

const PRODUCT_LINKS = [
  { href: "/explore", label: "Explore Courts" },
  { href: "/list-your-court", label: "List Your Court" },
  { href: "/#how-it-works", label: "How It Works" },
];

const ACCOUNT_LINKS = [
  { href: "/login", label: "Sign In" },
  { href: "/signup", label: "Create Account" },
  { href: "/favorites", label: "Favorites" },
];

export function Footer() {
  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <Logo />
            <p className="text-sm text-muted-foreground">Play More. Rally More.</p>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Account" links={ACCOUNT_LINKS} />

          {/* Web-only (Phase 6) — the store badges aren't real download
              links yet, and a dead App Store/Google Play row read as
              wasted vertical space on the mobile footer specifically;
              kept for desktop/tablet visitors. */}
          <div className="col-span-2 hidden flex-col gap-3 sm:col-span-1 sm:flex">
            <h3 className="text-sm font-semibold text-foreground">Get the app</h3>
            <p className="text-sm text-muted-foreground">
              Native apps are on the way. For now, Air/Rally installs straight from your browser.
            </p>
            <div className="flex flex-wrap gap-2">
              <AppStoreBadge />
              <GooglePlayBadge />
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Air/Rally. All rights reserved.</p>
          <div className="flex items-center gap-4">
            <Link href="/terms" className="hover:text-foreground">
              Terms
            </Link>
            <Link href="/privacy" className="hover:text-foreground">
              Privacy
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

/**
 * Neither badge is a real download link yet — no native app has
 * shipped. Kept non-interactive (a div, not a link/button) and
 * slightly dimmed, relying on the "Native apps are on the way" copy
 * right above for context rather than a ribbon overlaid on the
 * artwork, which clipped into the App Store badge's top line.
 */
function StoreBadgeShell({ children }: { children: ReactNode }) {
  return (
    <div
      aria-disabled="true"
      title="Coming soon"
      className="flex h-10 w-fit cursor-not-allowed items-center gap-2 rounded-lg border border-white/15 bg-black px-2.5 opacity-80"
    >
      {children}
    </div>
  );
}

function AppStoreBadge() {
  return (
    <StoreBadgeShell>
      <Apple className="size-6 shrink-0 text-white" aria-hidden="true" />
      <span className="flex flex-col leading-tight whitespace-nowrap text-white">
        <span className="text-[9px]">Download on the</span>
        <span className="-mt-0.5 text-base font-semibold tracking-tight">App Store</span>
      </span>
    </StoreBadgeShell>
  );
}

function GooglePlayBadge() {
  return (
    <StoreBadgeShell>
      <svg viewBox="0 0 24 24" className="size-6 shrink-0" aria-hidden="true">
        <path fill="#00d2ff" d="M5 3.6c-.3.3-.5.7-.5 1.2v14.4c0 .5.2.9.5 1.2l.1.1L13.4 12v-.2L5.1 3.5z" />
        <path fill="#ffcc00" d="M16.2 14.8 13.4 12v-.2l2.8-2.8.1.1 3.3 1.9c.9.5.9 1.4 0 2l-3.4 1.8z" />
        <path fill="#ff3b30" d="M16.3 14.7 13.4 11.8 5 20.4c.3.3.9.4 1.5.1z" />
        <path fill="#00e676" d="M16.3 9.1 6.5 3.5c-.6-.3-1.2-.3-1.5.1l8.4 8.4z" />
      </svg>
      <span className="flex flex-col leading-tight whitespace-nowrap text-white">
        <span className="text-[9px]">GET IT ON</span>
        <span className="-mt-0.5 text-base font-semibold tracking-tight">Google Play</span>
      </span>
    </StoreBadgeShell>
  );
}

function FooterColumn({
  title,
  links,
}: {
  title: string;
  links: { href: string; label: string }[];
}) {
  return (
    <div className="flex flex-col gap-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      <ul className="flex flex-col gap-2.5">
        {links.map((link) => (
          <li key={link.href}>
            <Link
              href={link.href}
              className="text-sm text-muted-foreground transition-colors hover:text-foreground"
            >
              {link.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
