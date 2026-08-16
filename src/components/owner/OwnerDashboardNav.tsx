"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/list-your-court/overview", label: "Overview" },
  { href: "/list-your-court", label: "Venues" },
  { href: "/list-your-court/calendar", label: "Calendar" },
  { href: "/list-your-court/bookings", label: "Bookings" },
  { href: "/list-your-court/earnings", label: "Earnings" },
  { href: "/list-your-court/settings", label: "Settings" },
];

/**
 * In-page tabs for the owner dashboard — deliberately separate from the
 * global bottom `MobileNav`, which has its own unrelated "Bookings" tab
 * pointing to the *customer's* booking list at `/bookings`. Both can be
 * visible in the same viewport on mobile, so this only ever says "your
 * bookings" in nearby owner-facing copy, never bare "Bookings", to avoid
 * ambiguity between the two.
 */
export function OwnerDashboardNav() {
  const pathname = usePathname();

  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border">
      {TABS.map((tab) => {
        // "Venues" (/list-your-court) must not stay highlighted on its
        // own child detail routes like /list-your-court/[venueId] — only
        // an exact match, unlike the other tabs which have no children.
        const isActive = tab.href === "/list-your-court" ? pathname === tab.href : pathname.startsWith(tab.href);
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "shrink-0 border-b-2 px-3 py-3 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
