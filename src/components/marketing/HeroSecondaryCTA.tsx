"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/services/profiles";
import type { UserRole } from "@/lib/supabase/types";

/**
 * Self-contained client fetch, same posture as AuthNavSection/MobileNav
 * — the Hero itself stays server-rendered/static; only this one button
 * needs auth state. A signed-in player sees "Refer a Court Owner"
 * instead of the acquisition CTA "List Your Court" (Phase 6, Part 1) —
 * signed-out visitors and existing owners/admins (for whom "List Your
 * Court" is still their real venue-management entry point) keep the
 * original button.
 */
export function HeroSecondaryCTA() {
  const [role, setRole] = useState<UserRole | null | "loading">("loading");

  useEffect(() => {
    let cancelled = false;

    async function loadRole() {
      let supabase: ReturnType<typeof createClient>;
      try {
        supabase = createClient();
      } catch {
        if (!cancelled) setRole(null);
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (cancelled) return;
      if (!user) {
        setRole(null);
        return;
      }

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

  if (role === "player") {
    return (
      <Button asChild variant="outline" size="lg" className="h-12 rounded-full px-6 text-base">
        <Link href="/profile">Refer a Court Owner</Link>
      </Button>
    );
  }

  return (
    <Button asChild variant="outline" size="lg" className="h-12 rounded-full px-6 text-base">
      <Link href="/list-your-court">List Your Court</Link>
    </Button>
  );
}
