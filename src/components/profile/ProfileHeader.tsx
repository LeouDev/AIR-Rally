import { AvatarUploadButton } from "@/components/profile/AvatarUploadButton";
import { OwnerApplicationCTA } from "@/components/profile/OwnerApplicationCTA";
import { ReferralCard } from "@/components/profile/ReferralCard";
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

      {profile.role === "player" && <OwnerApplicationCTA ownerStatus={profile.owner_status} />}

      <ReferralCard referralCode={profile.referral_code} />
    </div>
  );
}
