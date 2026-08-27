import Link from "next/link";
import { Apple } from "lucide-react";
import { Logo } from "@/components/layout/Logo";
import { getCurrentUser } from "@/lib/supabase/auth";

const PRODUCT_LINKS = [
  { href: "/explore", label: "Explore Courts" },
  { href: "/list-your-court", label: "List Your Court" },
  { href: "/how-it-works", label: "How It Works" },
];

/**
 * The Account column depends on whether anyone is signed in. The navbar
 * has always known this (AuthNavSection); the footer did not, so a
 * signed-in visitor was still being offered "Sign In" and "Create
 * Account" at the bottom of every page.
 */
const SIGNED_OUT_LINKS = [
  { href: "/login", label: "Sign In" },
  { href: "/signup", label: "Create Account" },
  { href: "/favorites", label: "Favorites" },
];

const SIGNED_IN_LINKS = [
  { href: "/profile", label: "Profile" },
  { href: "/bookings", label: "My Bookings" },
  { href: "/favorites", label: "Favorites" },
];

export async function Footer() {
  // Never throws — getCurrentUser swallows its own errors and returns
  // null, so a session lookup failing degrades to the signed-out footer
  // rather than taking down every page that renders the shell.
  const user = await getCurrentUser();
  const accountLinks = user ? SIGNED_IN_LINKS : SIGNED_OUT_LINKS;

  return (
    <footer className="border-t border-border bg-background">
      <div className="mx-auto max-w-7xl px-4 pt-12 pb-28 sm:px-6 md:pb-12 lg:px-8">
        <div className="grid grid-cols-2 gap-8 sm:grid-cols-4">
          <div className="col-span-2 flex flex-col gap-3 sm:col-span-1">
            <Logo />
            <p className="text-sm text-muted-foreground">Play More. Rally More.</p>
          </div>

          <FooterColumn title="Product" links={PRODUCT_LINKS} />
          <FooterColumn title="Account" links={accountLinks} />

          {/* The iOS app went live on the App Store 2026-08-26 — this used
              to say "on the way" and link nowhere, wrong on every page
              since this footer is site-wide. No Google Play badge: there
              is no Android app and no tooling here to verify one, and a
              dead badge for a store we don't ship to is worse than no
              badge. Kept hidden on the mobile web footer specifically
              (Phase 6) to avoid wasted vertical space there; shown for
              desktop/tablet visitors. */}
          <div className="col-span-2 hidden flex-col gap-3 sm:col-span-1 sm:flex">
            <h3 className="text-sm font-semibold text-foreground">Get the app</h3>
            <p className="text-sm text-muted-foreground">Air/Rally is on the App Store.</p>
            <div className="flex flex-wrap gap-2">
              <AppStoreBadge />
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
            <Link href="/support" className="hover:text-foreground">
              Support
            </Link>
          </div>
        </div>
      </div>
    </footer>
  );
}

// apps.apple.com/app/id6803324731 — Apple redirects to the localized,
// slugged URL (…/us/app/air-rally/id6803324731) on its own; verified live
// (200) before wiring this in. ascAppId 6803324731 is the same id EAS
// submit uses (air-rally-mobile/eas.json), not a separately-sourced number.
const APP_STORE_URL = "https://apps.apple.com/app/id6803324731";

function AppStoreBadge() {
  return (
    <a
      href={APP_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="flex h-10 w-fit items-center gap-2 rounded-lg border border-white/15 bg-black px-2.5 transition-opacity hover:opacity-90"
    >
      <Apple className="size-6 shrink-0 text-white" aria-hidden="true" />
      <span className="flex flex-col leading-tight whitespace-nowrap text-white">
        <span className="text-[9px]">Download on the</span>
        <span className="-mt-0.5 text-base font-semibold tracking-tight">App Store</span>
      </span>
    </a>
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
