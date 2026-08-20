"use client";

import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Repeat2, Heart, Share2, Trash2, CalendarDays, MapPin, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PostComments } from "@/components/court-side/PostComments";
import { AdminDeletePostButton } from "@/components/admin/AdminDeletePostButton";
import { ReportButton } from "@/components/trust/ReportButton";
import type { PostWithAuthor } from "@/lib/services/posts";
import type { ClubMentionMap } from "@/lib/services/clubs";
import type { EventAttendeeStatus, PublicProfile } from "@/lib/supabase/types";
import { postImagePublicUrl } from "@/lib/services/postImages";
import { cn } from "@/lib/utils";

function formatEventWhen(iso: string): string {
  return new Date(iso).toLocaleString("en-PH", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

const JOIN_LABEL: Record<EventAttendeeStatus, string> = {
  pending_approval: "Requested",
  joined: "Joined",
  waitlisted: "Waitlisted",
  cancelled: "Join",
};

/** The card a "share this game" post embeds — post.event is populated by
 * listFeedPosts/listPostsByUser whenever post.event_id is set. Join is
 * only interactive where the parent tracks event status (the main feed);
 * elsewhere (a profile's own posts) it falls back to a plain link through
 * to the full game page, which has its own working join/approve UI. */
function EmbeddedEventCard({
  event,
  status,
  onToggleJoin,
}: {
  event: NonNullable<PostWithAuthor["event"]>;
  status?: EventAttendeeStatus | null;
  onToggleJoin?: (eventId: string) => void;
}) {
  return (
    <Link
      href={`/events/${event.id}`}
      className="mt-3 flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-3 transition-colors hover:border-primary/40"
    >
      <p className="text-sm font-semibold text-foreground">{event.title}</p>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1">
          <CalendarDays className="size-3.5" aria-hidden="true" />
          {formatEventWhen(event.start_time)}
        </span>
        {event.venue && (
          <span className="flex items-center gap-1">
            <MapPin className="size-3.5" aria-hidden="true" />
            {event.venue.name}
          </span>
        )}
        <span className="flex items-center gap-1">
          <Users className="size-3.5" aria-hidden="true" />
          {event.attendeeCount}
          {event.max_players ? ` / ${event.max_players}` : ""} playing
          {event.isFull ? " · full" : ""}
        </span>
      </div>
      {onToggleJoin ? (
        <Button
          type="button"
          size="sm"
          variant={status ? "secondary" : "outline"}
          className="h-7 w-fit shrink-0 px-2.5 text-xs"
          onClick={(e) => {
            e.preventDefault();
            onToggleJoin(event.id);
          }}
        >
          {status ? JOIN_LABEL[status] : "Ask to join"}
        </Button>
      ) : (
        <span className="text-xs font-medium text-primary">View game →</span>
      )}
    </Link>
  );
}

export function initialsFrom(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

/**
 * Renders post text with mentions picked out. A mention that resolves to
 * a club the viewer can see becomes a link to it; everything else — a
 * person, a typo, a private club — stays highlighted plain text, so an
 * unresolvable mention degrades instead of producing a dead link.
 */
export function highlightMentions(text: string, clubMentions: ClubMentionMap = {}) {
  const parts = text.split(/(@[a-zA-Z0-9_]+)/g);
  return parts.map((part, i) => {
    if (!part.startsWith("@")) return <span key={i}>{part}</span>;

    const club = clubMentions[part.slice(1)];
    if (club) {
      return (
        <Link
          key={i}
          href={`/clubs/${club.id}`}
          title={club.name}
          className="font-semibold text-primary hover:underline"
        >
          {part}
        </Link>
      );
    }

    return (
      <strong key={i} className="font-semibold text-primary">
        {part}
      </strong>
    );
  });
}

type PostCardProps = {
  post: PostWithAuthor;
  currentUserId: string;
  isAdmin: boolean;
  liked: boolean;
  isFollowingAuthor: boolean;
  expanded: boolean;
  onToggleLike: (postId: string) => void;
  onToggleFollow: (userId: string) => void;
  onToggleComments: (postId: string) => void;
  onDeleteOwnPost: (postId: string) => void;
  onShare: () => void;
  onCommentCountChange: (postId: string, delta: number) => void;
  /** Resolved club mentions, so "@ClubName" in the body can link through. */
  clubMentions?: ClubMentionMap;
  reshared: boolean;
  onToggleReshare: (postId: string) => void;
  /**
   * Set when this row is in the feed because someone reshared it, which
   * drives the attribution line. Absent on a user's own profile, where
   * every post is theirs by definition.
   */
  resharer?: PublicProfile | null;
  /** The viewer's status on post.event, if this post shared a game and
   * the parent tracks it (only CourtSideFeed does today). */
  eventStatus?: EventAttendeeStatus | null;
  onToggleJoinEvent?: (eventId: string) => void;
};

/**
 * Shared post card — used by both the main feed (CourtSideFeed) and a
 * user's own COURT/Side profile (My/Rally), so the two never drift.
 * Purely presentational: all mutation logic (optimistic state + the
 * server action call) lives in the parent, passed down as callbacks.
 */
export function PostCard({
  post,
  currentUserId,
  isAdmin,
  liked,
  isFollowingAuthor,
  expanded,
  onToggleLike,
  onToggleFollow,
  onToggleComments,
  onDeleteOwnPost,
  onShare,
  onCommentCountChange,
  clubMentions,
  reshared,
  onToggleReshare,
  resharer,
  eventStatus,
  onToggleJoinEvent,
}: PostCardProps) {
  const authorName = post.author?.display_name || "Player";
  const isOwnPost = post.user_id === currentUserId;

  return (
    <article className="rounded-xl bg-card p-3.5 shadow-card">
      {/* Above the author, not beside them: this line explains why the post
          is in the feed at all, which the reader needs before they read
          whose post it is. */}
      {resharer && (
        <p className="mb-2.5 flex items-center gap-1.5 text-xs/4 text-muted-foreground">
          <Repeat2 className="size-3.5 shrink-0" aria-hidden="true" />
          <Link href={`/court-side/${resharer.id}`} className="hover:underline">
            {resharer.display_name || "A player"}
          </Link>
          {resharer.id === currentUserId ? " (you) reshared this" : " reshared this"}
        </p>
      )}
      <div className="flex items-center gap-2.5">
        <Link href={`/court-side/${post.user_id}`} className="shrink-0">
          <Avatar>
            {post.author?.avatar_url && <AvatarImage src={post.author.avatar_url} alt="" />}
            <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
              {initialsFrom(authorName)}
            </AvatarFallback>
          </Avatar>
        </Link>
        <div className="min-w-0 flex-1 text-[0.9375rem]/5">
          <Link href={`/court-side/${post.user_id}`} className="font-semibold text-foreground hover:underline">
            {authorName}
          </Link>
          <span className="ml-1 text-[0.8125rem]/[1.125rem] text-muted-foreground">
            · {new Date(post.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          </span>
        </div>
        {!isOwnPost && (
          <Button
            type="button"
            size="sm"
            variant={isFollowingAuthor ? "secondary" : "outline"}
            className="h-7 shrink-0 px-2.5 text-xs"
            onClick={() => onToggleFollow(post.user_id)}
          >
            {isFollowingAuthor ? "Following" : "Follow"}
          </Button>
        )}
        {isOwnPost && (
          <button
            type="button"
            onClick={() => onDeleteOwnPost(post.id)}
            aria-label="Delete post"
            className="text-muted-foreground hover:text-destructive"
          >
            <Trash2 className="size-4" aria-hidden="true" />
          </button>
        )}
        {!isOwnPost && isAdmin && <AdminDeletePostButton postId={post.id} />}
        {/* Only on other people's posts — reporting your own is noise in
            the moderation queue, and deleting it is right there instead. */}
        {!isOwnPost && <ReportButton targetType="post" targetId={post.id} targetLabel="post" />}
      </div>

      <p className="mt-3 text-[0.9375rem]/[1.375rem] text-foreground text-pretty">
        {highlightMentions(post.content, clubMentions)}
      </p>

      {post.event && <EmbeddedEventCard event={post.event} status={eventStatus} onToggleJoin={onToggleJoinEvent} />}

      {post.image_paths.length > 0 && (
        <div
          className={cn(
            "mt-3 grid gap-1.5 overflow-hidden rounded-xl",
            post.image_paths.length === 1 ? "grid-cols-1" : "grid-cols-2"
          )}
        >
          {post.image_paths.map((path) => {
            const url = postImagePublicUrl(path);
            if (!url) return null;
            const single = post.image_paths.length === 1;
            return (
              // next/image handles these: next.config's remotePatterns
              // already trusts *.supabase.co/storage/v1/object/public/**.
              // A `fill` image needs a positioned, sized parent, which also
              // reserves the space and stops the feed jumping as photos
              // decode.
              <div key={path} className={cn("relative w-full overflow-hidden", single ? "h-96" : "aspect-square")}>
                <Image
                  src={url}
                  alt=""
                  fill
                  // One column on phones; the grid halves each image above
                  // the sm breakpoint, and the feed column caps out ~600px.
                  sizes={single ? "(max-width: 640px) 100vw, 600px" : "(max-width: 640px) 50vw, 300px"}
                  className="object-cover"
                />
              </div>
            );
          })}
        </div>
      )}

      {/* The feed is quieter than the marketplace: the only orange on this
          card is the action YOU took. A like and a reshare you haven't made
          stay muted, so a screen of posts has no colour competing for the
          tap — and the one you did make is unmistakable. */}
      <div className="mt-3 flex items-center gap-5 border-t border-hairline pt-2.5">
        <button
          type="button"
          onClick={() => onToggleComments(post.id)}
          className="flex items-center gap-1.5 text-sm/5 font-medium text-muted-foreground transition-colors hover:text-foreground"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          {post.comment_count}
        </button>
        <button
          type="button"
          onClick={() => onToggleReshare(post.id)}
          aria-pressed={reshared}
          className={cn(
            "flex items-center gap-1.5 text-sm/5 font-medium transition-colors",
            reshared ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Repeat2 className="size-4" aria-hidden="true" />
          {post.reshare_count}
        </button>
        <button
          type="button"
          onClick={() => onToggleLike(post.id)}
          aria-pressed={liked}
          className={cn(
            "flex items-center gap-1.5 text-sm/5 font-medium transition-colors",
            liked ? "text-primary" : "text-muted-foreground hover:text-foreground"
          )}
        >
          <Heart className={cn("size-4", liked && "fill-current")} aria-hidden="true" />
          {post.like_count}
        </button>
        <button
          type="button"
          onClick={onShare}
          className="ml-auto text-muted-foreground transition-colors hover:text-foreground"
          aria-label="Share"
        >
          <Share2 className="size-4" aria-hidden="true" />
        </button>
      </div>

      {expanded && (
        <PostComments
          postId={post.id}
          currentUserId={currentUserId}
          isAdmin={isAdmin}
          onCountChange={(delta) => onCommentCountChange(post.id, delta)}
        />
      )}
    </article>
  );
}
