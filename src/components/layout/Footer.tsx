import Link from "next/link";
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
              Air/Rally installs straight from your browser — no app store needed.
            </p>
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
