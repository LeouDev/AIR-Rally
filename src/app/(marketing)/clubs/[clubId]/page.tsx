import { notFound } from "next/navigation";
import Image from "next/image";
import { Users, MapPin, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ClubMembership } from "@/components/clubs/ClubMembership";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { getClubForViewer, listClubMembers } from "@/lib/services/clubs";
import { listEventsForClub } from "@/lib/services/events";
import type { Club, CommunityEvent } from "@/lib/supabase/types";
import { BackLink } from "@/components/shared/BackLink";
import { ReportButton } from "@/components/trust/ReportButton";
import { clubImagePublicUrl } from "@/lib/services/clubImages";

// Per-viewer: RLS decides whether this club is even visible, and the
// viewer's own role drives what renders.
export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ clubId: string }> };

const SKILL_LABELS: Record<Club["skill_level"], string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
  mixed: "All levels",
};

const TYPE_LABELS: Record<Club["club_type"], string> = {
  social: "Social",
  competitive: "Competitive",
  training: "Training",
  casual: "Casual",
};

/** Published events still ahead of now, against a single captured instant. */
function upcomingOnly(events: CommunityEvent[]): CommunityEvent[] {
  const now = Date.now();
  return events.filter((e) => e.status === "published" && new Date(e.start_time).getTime() > now);
}

export async function generateMetadata({ params }: PageProps) {
  const { clubId } = await params;
  // Deliberately NOT the signed-in caller's own identity for this
  // lookup — a link-unfurl crawler (Messages, Facebook, Instagram) never
  // carries a session, so it sees exactly what an anonymous visitor
  // does. getClubForViewer(..., null) is the same call the page body
  // already makes for that visitor — a private or approval-required
  // club the anonymous caller isn't a member of already resolves to
  // null here, the same as it does below, so no separate privacy check
  // is needed for the metadata path.
  const supabase = await createClient();
  const club = await getClubForViewer(supabase, clubId, null);
  if (!club) return { title: "Club" };

  const description = club.description
    ? club.description.slice(0, 155)
    : `${club.name} on Air/Rally — ${TYPE_LABELS[club.club_type]} club${club.location ? ` in ${club.location}` : ""}.`;
  const imageUrl = clubImagePublicUrl(club.image_url) ?? "/brand/og-image.png";

  return {
    title: club.name,
    description,
    openGraph: {
      title: club.name,
      description,
      url: `/clubs/${clubId}`,
      images: [{ url: imageUrl, width: 1200, height: 630, alt: club.name }],
    },
    twitter: {
      card: "summary_large_image",
      title: club.name,
      description,
      images: [imageUrl],
    },
  };
}

export default async function ClubDetailPage({ params }: PageProps) {
  const { clubId } = await params;
  const user = await getCurrentUser();
  const supabase = await createClient();

  const club = await getClubForViewer(supabase, clubId, user?.id ?? null);
  // A private club the viewer isn't in reads as not-found — never as
  // "exists but forbidden", which would leak its existence.
  if (!club) notFound();

  const [members, events] = await Promise.all([listClubMembers(supabase, clubId), listEventsForClub(supabase, clubId)]);
  const clubImageUrl = clubImagePublicUrl(club.image_url);
  const upcoming = upcomingOnly(events);

  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <BackLink href="/clubs" label="Back to clubs" />

      {clubImageUrl && (
        <div className="relative mt-4 h-48 w-full overflow-hidden rounded-2xl border border-border sm:h-64">
          {/* The club's hero — `priority` because it's the largest element
              above the fold here, so it's this page's LCP candidate. */}
          <Image src={clubImageUrl} alt="" fill priority sizes="(max-width: 768px) 100vw, 768px" className="object-cover" />
        </div>
      )}

      <header className="mt-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-foreground">{club.name}</h1>
          {club.visibility !== "public" && (
            <Badge variant="outline" className="gap-1">
              <Lock className="size-3" aria-hidden="true" />
              {club.visibility === "private" ? "Invite only" : "Approval required"}
            </Badge>
          )}
        </div>

        {club.description && <p className="text-muted-foreground">{club.description}</p>}

        <div className="flex flex-wrap items-center gap-2">
          <Badge className="border-transparent bg-accent text-accent-foreground">{SKILL_LABELS[club.skill_level]}</Badge>
          <Badge variant="outline">{TYPE_LABELS[club.club_type]}</Badge>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Users className="size-3.5" aria-hidden="true" />
            {club.member_count} {club.member_count === 1 ? "member" : "members"}
          </span>
          {club.location && (
            <span className="flex items-center gap-1.5">
              <MapPin className="size-3.5" aria-hidden="true" />
              {club.location}
            </span>
          )}
        </div>
      </header>

      {upcoming.length > 0 && (
        <section className="mt-8">
          <h2 className="text-base font-semibold text-foreground">Upcoming events</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {upcoming.map((event) => (
              <li key={event.id} className="rounded-xl border border-border bg-card p-4">
                <p className="font-medium text-foreground">{event.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(new Date(event.start_time))}
                  {event.max_players !== null && ` · ${event.participant_count}/${event.max_players} players`}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Not offered to the owner: reporting your own club is noise in the
          queue, and they can edit or delete it directly instead. */}
      {user && user.id !== club.owner_id && (
        <div className="mt-6">
          <ReportButton targetType="club" targetId={club.id} targetLabel="club" variant="button" />
        </div>
      )}

      <div className="mt-8">
        <ClubMembership
          clubId={club.id}
          visibility={club.visibility}
          viewerRole={club.viewerRole}
          viewerPending={club.viewerPending}
          members={members}
        />
      </div>
    </div>
  );
}
