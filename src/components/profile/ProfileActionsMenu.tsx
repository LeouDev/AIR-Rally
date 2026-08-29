"use client";

import { useState } from "react";
import Link from "next/link";
import { Settings, LayoutGrid, Play, Users, ShieldCheck, Building2, CalendarCheck, CalendarDays, Heart, Wallet, Trophy } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProfileForm } from "@/components/profile/ProfileForm";
import type { Profile } from "@/lib/supabase/types";

type ProfileActionsMenuProps = {
  profile: Profile;
  email: string;
};

type Destination = {
  key: string;
  href?: string;
  icon: typeof Settings;
  title: string;
  description: string;
};

/**
 * The account's entry points, as a card grid rather than a row of equal
 * buttons — a flat row gave "Account Settings" and "Play" the same visual
 * weight and said nothing about where either one goes.
 *
 * Role-aware: an admin previously had no route to /admin from their own
 * profile at all, and a venue owner none to their dashboard.
 */
export function ProfileActionsMenu({ profile, email }: ProfileActionsMenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);

  const destinations: Destination[] = [
    {
      key: "ranked",
      href: "/profile/rank",
      icon: Trophy,
      title: "AIR/Rally Ranked",
      description: "Your tier, pips, and the ladder.",
    },
    {
      key: "court-side",
      href: "/court-side",
      icon: LayoutGrid,
      title: "COURT/Side",
      description: "Posts, players you follow, and the community feed.",
    },
    {
      key: "clubs",
      href: "/clubs",
      icon: Users,
      title: "Clubs",
      description: "Find a club or manage the ones you're in.",
    },
    {
      key: "events",
      href: "/events",
      icon: CalendarCheck,
      title: "Play",
      description: "Join a game, or start one on a court you've booked.",
    },
    {
      key: "bookings",
      href: "/bookings",
      icon: CalendarDays,
      title: "My bookings",
      description: "Upcoming games and your booking history.",
    },
    {
      key: "credits",
      href: "/profile/credits",
      icon: Wallet,
      title: "AIR/Rally Credits",
      description: "Your balance and where it came from.",
    },
    {
      key: "favorites",
      href: "/favorites",
      icon: Heart,
      title: "Saved courts",
      description: "Venues you've favourited.",
    },
    {
      key: "play",
      href: "/explore",
      icon: Play,
      title: "Find a court",
      description: "Browse venues and book your next rally.",
    },
  ];

  if (profile.role === "venue_owner") {
    destinations.push({
      key: "owner",
      href: "/list-your-court/overview",
      icon: Building2,
      title: "Venue dashboard",
      description: "Bookings, earnings, and your courts.",
    });
  }

  if (profile.role === "admin") {
    destinations.push({
      key: "admin",
      href: "/admin",
      icon: ShieldCheck,
      title: "Admin",
      description: "Moderation queues, finance, and settlements.",
    });
  }

  const cardClass =
    "flex items-start gap-3 rounded-xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/40 hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <>
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold text-foreground">Shortcuts</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {destinations.map(({ key, href, icon: Icon, title, description }) => (
            <Link key={key} href={href ?? "#"} className={cardClass}>
              <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
                <Icon className="size-4" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">{title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
              </span>
            </Link>
          ))}

          {/* A button, not a link — it opens the settings dialog in place. */}
          <button type="button" onClick={() => setSettingsOpen(true)} className={cardClass}>
            <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground">
              <Settings className="size-4" aria-hidden="true" />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Account settings</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">Name, photo, and contact details.</span>
            </span>
          </button>
        </div>
      </section>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Account settings</DialogTitle>
          </DialogHeader>
          <ProfileForm profile={profile} email={email} />
        </DialogContent>
      </Dialog>
    </>
  );
}
