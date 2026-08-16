import { OwnerDashboardNav } from "@/components/owner/OwnerDashboardNav";
import { getCurrentUserWithProfile } from "@/lib/supabase/auth";

/**
 * Deliberately non-blocking: `/list-your-court` is also the public
 * onboarding entry point for a still-`player` visitor (a player becomes
 * `venue_owner` automatically on their first `createVenueDraftAction`
 * call), so a layout-level redirect for non-owners would break new-owner
 * onboarding. This only conditionally renders the dashboard tabs — every
 * page underneath still does its own `getCurrentUser()` + redirect, and
 * RLS remains the real access boundary, not this layout.
 */
export default async function OwnerDashboardLayout({ children }: { children: React.ReactNode }) {
  const auth = await getCurrentUserWithProfile();
  const showNav = auth?.profile?.role === "venue_owner" || auth?.profile?.role === "admin";

  return (
    <div className="flex flex-col">
      {showNav && (
        <div className="mx-auto w-full max-w-4xl px-4 pt-8 sm:px-6 lg:px-8">
          <OwnerDashboardNav />
        </div>
      )}
      {children}
    </div>
  );
}
