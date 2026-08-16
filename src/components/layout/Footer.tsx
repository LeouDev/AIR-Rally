import Link from "next/link";
import { Apple, Play } from "lucide-react";
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

          <div className="flex flex-col gap-3">
            <h3 className="text-sm font-semibold text-foreground">Get the app</h3>
            <p className="text-sm text-muted-foreground">
              Native apps are on the way. For now, Air/Rally installs straight from your browser.
            </p>
            <div className="flex flex-col gap-2">
              <StoreBadge icon={Apple} storeLabel="Download on the" storeName="App Store" />
              <StoreBadge icon={Play} storeLabel="Get it on" storeName="Google Play" />
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border pt-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <p>&copy; {new Date().getFullYear()} Air/Rally. All rights reserved.</p>
          <p>Find your court. Find your game.</p>
        </div>
      </div>
    </footer>
  );
}

/**
 * Not a real download link yet — no native app has shipped. Rendered
 * disabled with a "Coming soon" tag rather than as a functional badge,
 * so it can't be mistaken for a working App Store / Play Store link.
 */
function StoreBadge({
  icon: Icon,
  storeLabel,
  storeName,
}: {
  icon: typeof Apple;
  storeLabel: string;
  storeName: string;
}) {
  return (
    <div
      aria-disabled="true"
      title="Coming soon"
      className="flex w-fit cursor-not-allowed items-center gap-2.5 rounded-lg border border-border bg-foreground/90 px-3 py-1.5 text-background opacity-70"
    >
      <Icon className="size-5 shrink-0" aria-hidden="true" />
      <span className="flex flex-col leading-none">
        <span className="text-[10px] uppercase tracking-wide text-background/70">{storeLabel}</span>
        <span className="text-sm font-semibold">{storeName}</span>
      </span>
      <span className="ml-1 rounded-full bg-background/15 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide">
        Soon
      </span>
    </div>
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
