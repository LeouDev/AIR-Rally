import Link from "next/link";
import { ArrowRight } from "lucide-react";
import type { FeedPost } from "@/lib/services/posts";

/**
 * One line of COURT/SIDE on Home — enough to show the feed is alive without
 * turning Home into a second feed. Renders nothing when there are no posts,
 * rather than an empty shell inviting a tap into an empty room.
 */
export function CourtSideTeaser({ post }: { post: FeedPost | null }) {
  if (!post) return null;

  const author = post.resharer ?? post.author;
  const name = author?.display_name ?? "Someone";
  const initials = name
    .split(" ")
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <Link
      href="/court-side"
      className="group flex items-center gap-3.5 rounded-xl bg-secondary p-4 text-secondary-foreground transition-colors hover:bg-navy-raised focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
    >
      <span
        aria-hidden="true"
        className="flex size-9 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-semibold text-primary-foreground"
      >
        {initials || "AR"}
      </span>

      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-[0.6875rem]/[0.875rem] font-semibold tracking-[0.12em] text-primary uppercase">
          COURT/SIDE
        </span>
        <span className="truncate text-[0.9375rem]/5 font-medium">
          {post.resharer ? `${name} reshared a post` : `${name} posted`}
        </span>
      </span>

      <ArrowRight
        className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
        aria-hidden="true"
      />
    </Link>
  );
}
