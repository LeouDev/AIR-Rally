import Link from "next/link";
import Image from "next/image";
import { Users, MapPin, Lock } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { Club } from "@/lib/supabase/types";
import { clubImagePublicUrl } from "@/lib/services/clubImages";

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

export function ClubCard({ club }: { club: Club }) {
  const imageUrl = clubImagePublicUrl(club.image_url);

  return (
    <Link
      href={`/clubs/${club.id}`}
      className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card transition-colors hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      {imageUrl && (
        <div className="relative h-32 w-full overflow-hidden">
          <Image src={imageUrl} alt="" fill sizes="(max-width: 640px) 100vw, 400px" className="object-cover" />
        </div>
      )}

      <div className="flex flex-col gap-3 p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-semibold text-foreground">{club.name}</h3>
        {club.visibility !== "public" && (
          <Lock className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-label="Not an open club" />
        )}
      </div>

      {club.description && <p className="line-clamp-2 text-sm text-muted-foreground">{club.description}</p>}

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
      </div>
    </Link>
  );
}
