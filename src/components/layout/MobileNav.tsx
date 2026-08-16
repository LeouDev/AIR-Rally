"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Compass, CalendarCheck, Heart, User, Store } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/services/profiles";
import type { UserRole } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

const PLAYER_TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/favorites", label: "Favorites", icon: Heart },
  { href: "/profile", label: "Profile", icon: User },
];

// Same 5-slot bar, but Favorites (a player-centric feature) is swapped
// for an Owner-dashboard shortcut — a venue_owner/admin running their
// business doesn't need favorites front-and-center. Self-contained
// client fetch, same posture as AuthNavSection/NotificationBell — this
// is a sibling of AuthNavSection in AppShell, not a child, so it can't
// receive role as a prop without lifting state; a second small profile
// read is the accepted trade-off this codebase already makes elsewhere.
const OWNER_TABS = [
  { href: "/", label: "Home", icon: Home },
  { href: "/explore", label: "Explore", icon: Compass },
  { href: "/bookings", label: "Bookings", icon: CalendarCheck },
  { href: "/list-your-court", label: "Owner", icon: Store },
  { href: "/profile", label: "Profile", icon: User },
];

export function MobileNav() {
  const pathname = usePathname();
  const [role, setRole] = useState<UserRole | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      let supabase: ReturnType<typeof createClient>;
      try {
        supabase = createClient();
      } catch {
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!user || cancelled) return;

      const profile = await getProfile(supabase, user.id).catch(() => null);
      if (cancelled) return;
      setRole(profile?.role ?? null);
    }

    loadRole();

    let unsubscribe: (() => void) | undefined;
    try {
      const {
        data: { subscription },
      } = createClient().auth.onAuthStateChange(() => loadRole());
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      // Not configured — nothing to subscribe to.
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  const tabs = role === "venue_owner" || role === "admin" ? OWNER_TABS : PLAYER_TABS;

  return (
    <nav
      aria-label="Primary"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/85 md:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5">
        {tabs.map(({ href, label, icon: Icon }) => {
          const isActive = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              aria-current={isActive ? "page" : undefined}
              className={cn(
                "flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                isActive ? "text-primary" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Icon className={cn("size-5", isActive && "fill-primary/15")} aria-hidden="true" />
              {label}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
