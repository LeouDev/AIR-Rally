"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { UserMenu } from "@/components/layout/UserMenu";
import { NotificationBell } from "@/components/layout/NotificationBell";
import { createClient } from "@/lib/supabase/client";
import { getProfile } from "@/lib/services/profiles";
import type { UserRole } from "@/lib/supabase/types";

type AuthState =
  | { status: "loading" }
  | { status: "signed-out" }
  | {
      status: "signed-in";
      userId: string;
      email: string;
      displayName: string;
      avatarUrl: string | null;
      role: UserRole;
    };

/**
 * Client-side by design. The Navbar renders on every marketing page, and
 * checking auth server-side there would force the whole site (landing,
 * explore, court details — all still static/mock-data-driven) into
 * per-request dynamic rendering just to decide which two nav buttons to
 * show. Checking on the client keeps those pages statically generated, at
 * the cost of a brief flash before hydration — a standard, accepted
 * trade-off for a global nav's auth state without adopting Partial
 * Prerendering (a larger change than this fix warrants).
 */
export function AuthNavSection() {
  const [state, setState] = useState<AuthState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;

    async function loadUser() {
      // createClient() throws when Supabase env vars aren't configured (see
      // .env.example) — treat that the same as signed-out rather than
      // crashing the nav on every page. Landing/Explore/Court Details must
      // keep working with zero external services configured, same as
      // Phase 1. Checked inside this async function (past a microtask
      // boundary) rather than synchronously in the effect body, so the
      // resulting setState isn't a same-tick effect-body state update.
      let supabase: ReturnType<typeof createClient>;
      try {
        supabase = createClient();
      } catch {
        if (!cancelled) setState({ status: "signed-out" });
        return;
      }

      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (cancelled) return;

      if (!user) {
        setState({ status: "signed-out" });
        return;
      }

      const profile = await getProfile(supabase, user.id).catch(() => null);
      if (cancelled) return;

      setState({
        status: "signed-in",
        userId: user.id,
        email: user.email ?? "",
        displayName: profile?.display_name || user.email || "Your account",
        avatarUrl: profile?.avatar_url ?? null,
        role: profile?.role ?? "player",
      });
    }

    loadUser();

    let unsubscribe: (() => void) | undefined;
    try {
      const {
        data: { subscription },
      } = createClient().auth.onAuthStateChange(() => loadUser());
      unsubscribe = () => subscription.unsubscribe();
    } catch {
      // Not configured — nothing to subscribe to.
    }

    return () => {
      cancelled = true;
      unsubscribe?.();
    };
  }, []);

  if (state.status === "loading") {
    return <div className="h-8 w-8 sm:w-[164px]" aria-hidden="true" />;
  }

  if (state.status === "signed-in") {
    return (
      <div className="flex items-center gap-1">
        {/* Signed-in counterpart to the signed-out "List Your Court" link:
            a primary destination that only makes sense once you have an
            account. It is also in UserMenu, but a booking someone is looking
            for should not require opening a menu to find. */}
        <Link
          href="/bookings"
          className="hidden rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 md:inline-flex"
        >
          My bookings
        </Link>
        <NotificationBell userId={state.userId} />
        <UserMenu displayName={state.displayName} email={state.email} avatarUrl={state.avatarUrl} role={state.role} />
      </div>
    );
  }

  return (
    <div className="hidden items-center gap-1 sm:flex">
      {/* Acquisition link for anonymous visitors only — a signed-in
          player never sees this (Phase 6, Part 1); owners/admins reach
          their dashboard via UserMenu instead. */}
      <Link
        href="/list-your-court"
        className="rounded-md px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        List Your Court
      </Link>
      <Button asChild variant="ghost">
        <Link href="/login">Sign In</Link>
      </Button>
      <Button asChild>
        <Link href="/signup">Get Started</Link>
      </Button>
    </div>
  );
}
