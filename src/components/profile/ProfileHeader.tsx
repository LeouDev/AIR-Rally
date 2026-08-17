import Link from "next/link";
import { AvatarUploadButton } from "@/components/profile/AvatarUploadButton";
import { OwnerApplicationCTA } from "@/components/profile/OwnerApplicationCTA";
import { ReferralCard } from "@/components/profile/ReferralCard";
import type { Profile, UserRole } from "@/lib/supabase/types";
import type { ProfileStats } from "@/lib/services/profiles";
import type { FollowCounts } from "@/lib/services/follows";

const ROLE_LABELS: Record<UserRole, string> = {
  player: "Player",
  venue_owner: "Venue Owner",
  admin: "Admin",
};

/** Role reads at a glance rather than as another line of grey text. */
const ROLE_STYLES: Record<UserRole, string> = {
  player: "bg-muted text-muted-foreground",
  venue_owner: "bg-success/15 text-success",
  admin: "bg-accent text-accent-foreground",
};

function formatMemberSince(iso: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric" }).format(new Date(iso));
}

/**
 * One stat. Rendered as a link when there is somewhere real to go —
 * followers and following lead to the user's own COURT/Side profile, where
 * the actual lists live. Plays and reviews are counts with no list page, so
 * they stay static rather than pretending to be clickable.
 */
function Stat({ value, label, href }: { value: number; label: string; href?: string }) {
  const body = (
    <>
      <dt className="text-2xl font-semibold tabular-nums text-foreground">{value}</dt>
      <dd className="mt-0.5 text-xs text-muted-foreground">{label}</dd>
    </>
  );

  if (!href) {
    return <div className="flex flex-col items-center px-2 text-center sm:items-start sm:text-left">{body}</div>;
  }

  return (
    <Link
      href={href}
      className="flex flex-col items-center rounded-lg px-2 py-1 text-center transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 sm:items-start sm:text-left"
    >
      {body}
    </Link>
  );
}

export function ProfileHeader({
  profile,
  email,
  stats,
  followCounts,
}: {
  profile: Profile;
  email: string;
  stats: ProfileStats;
  followCounts: FollowCounts;
}) {
  const displayName = profile.display_name || email;
  const courtSideHref = `/court-side/${profile.id}`;

  return (
    <div className="flex flex-col gap-5">
      <div className="overflow-hidden rounded-2xl border border-border bg-card">
        {/* A quiet brand band instead of a hard edge — gives the avatar
            something to sit against without turning into a hero banner. */}
        <div className="h-20 bg-gradient-to-r from-primary/15 via-accent/20 to-primary/5" />

        <div className="px-6 pb-6">
          <div className="-mt-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex items-end gap-4">
              <div className="rounded-full ring-4 ring-card">
                <AvatarUploadButton userId={profile.id} currentAvatarUrl={profile.avatar_url} displayName={displayName} />
              </div>
              <div className="pb-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2 className="text-xl font-semibold text-foreground">{displayName}</h2>
                  <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${ROLE_STYLES[profile.role]}`}>
                    {ROLE_LABELS[profile.role]}
                  </span>
                </div>
                <p className="mt-0.5 text-sm text-muted-foreground">Playing since {formatMemberSince(stats.memberSince)}</p>
              </div>
            </div>

            <Link
              href={courtSideHref}
              className="shrink-0 self-start rounded-full border border-border px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted sm:self-auto"
            >
              View public profile
            </Link>
          </div>

          {/* Four stats now that "member since" has moved up into the
              identity block, where it reads as a fact about the person
              rather than a number to compare. */}
          <dl className="mt-6 grid grid-cols-2 gap-2 border-t border-border pt-5 sm:grid-cols-4 sm:gap-4">
            <Stat value={stats.tripCount} label={stats.tripCount === 1 ? "Play" : "Plays"} />
            <Stat value={stats.reviewCount} label={stats.reviewCount === 1 ? "Review" : "Reviews"} />
            <Stat
              value={followCounts.followers}
              label={followCounts.followers === 1 ? "Follower" : "Followers"}
              href={courtSideHref}
            />
            <Stat value={followCounts.following} label="Following" href={courtSideHref} />
          </dl>
        </div>
      </div>

      {profile.role === "player" && <OwnerApplicationCTA ownerStatus={profile.owner_status} />}

      <ReferralCard referralCode={profile.referral_code} />
    </div>
  );
}
