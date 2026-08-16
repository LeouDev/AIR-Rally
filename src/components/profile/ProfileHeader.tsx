import Link from "next/link";
import { AvatarUploadButton } from "@/components/profile/AvatarUploadButton";
import type { Profile, UserRole } from "@/lib/supabase/types";
import type { ProfileStats } from "@/lib/services/profiles";

const ROLE_LABELS: Record<UserRole, string> = {
  player: "Player",
  venue_owner: "Venue Owner",
  admin: "Admin",
};

function formatMemberSince(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(iso));
}

// No pickleball-paddle glyph exists in lucide-react, so this is a small
// custom line icon (paddle face + handle) kept in the same stroke style
// as the rest of the app's icons rather than reaching for an unrelated
// generic sport icon.
function PaddleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <rect x="6" y="2" width="12" height="14" rx="6" />
      <line x1="12" y1="16" x2="12" y2="21" />
      <line x1="9" y1="21" x2="15" y2="21" />
    </svg>
  );
}

export function ProfileHeader({ profile, email, stats }: { profile: Profile; email: string; stats: ProfileStats }) {
  const displayName = profile.display_name || email;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <AvatarUploadButton userId={profile.id} currentAvatarUrl={profile.avatar_url} displayName={displayName} />
          <div>
            <p className="text-xl font-semibold text-foreground">{displayName}</p>
            <p className="text-sm text-muted-foreground">{ROLE_LABELS[profile.role]}</p>
          </div>
        </div>

        <dl className="grid grid-cols-3 gap-4 border-t border-border pt-4 sm:gap-8 sm:border-t-0 sm:border-l sm:pt-0 sm:pl-8">
          <div className="flex flex-col">
            <dt className="text-2xl font-semibold text-foreground">{stats.tripCount}</dt>
            <dd className="text-xs text-muted-foreground">{stats.tripCount === 1 ? "Play" : "Plays"}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-2xl font-semibold text-foreground">{stats.reviewCount}</dt>
            <dd className="text-xs text-muted-foreground">{stats.reviewCount === 1 ? "Review" : "Reviews"}</dd>
          </div>
          <div className="flex flex-col">
            <dt className="text-base font-semibold text-foreground whitespace-nowrap">{formatMemberSince(stats.memberSince)}</dt>
            <dd className="text-xs text-muted-foreground">Member since</dd>
          </div>
        </dl>
      </div>

      {profile.role === "player" && (
        <Link
          href="/list-your-court"
          className="flex items-center gap-4 rounded-2xl border border-border bg-card p-5 transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
            <PaddleIcon className="size-6" />
          </div>
          <div>
            <p className="font-semibold text-foreground">Become a Venue Owner</p>
            <p className="text-sm text-muted-foreground">List your court and start earning.</p>
          </div>
        </Link>
      )}
    </div>
  );
}
