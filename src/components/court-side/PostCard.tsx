"use client";

import Link from "next/link";
import Image from "next/image";
import { MessageCircle, Repeat2, Heart, Share2, Trash2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PostComments } from "@/components/court-side/PostComments";
import { AdminDeletePostButton } from "@/components/admin/AdminDeletePostButton";
import { ReportButton } from "@/components/trust/ReportButton";
import type { PostWithAuthor } from "@/lib/services/posts";
import type { ClubMentionMap } from "@/lib/services/clubs";
import type { PublicProfile } from "@/lib/supabase/types";
import { postImagePublicUrl } from "@/lib/services/postImages";
import { cn } from "@/lib/utils";

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
}: PostCardProps) {
  const authorName = post.author?.display_name || "Player";
  const isOwnPost = post.user_id === currentUserId;

  return (
    <article className="rounded-2xl border border-border bg-card p-4 shadow-sm">
      {/* Above the author, not beside them: this line explains why the post
          is in the feed at all, which the reader needs before they read
          whose post it is. */}
      {resharer && (
        <p className="mb-2 flex items-center gap-1.5 text-xs text-muted-foreground">
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
        <div className="min-w-0 flex-1 text-sm leading-tight">
          <Link href={`/court-side/${post.user_id}`} className="font-semibold text-foreground hover:underline">
            {authorName}
          </Link>
          <span className="ml-1 text-muted-foreground">
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

      <p className="mt-3 text-sm leading-relaxed text-foreground">{highlightMentions(post.content, clubMentions)}</p>

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

      <div className="mt-3 flex items-center gap-5 border-t border-border pt-3">
        <button
          type="button"
          onClick={() => onToggleComments(post.id)}
          className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
        >
          <MessageCircle className="size-4" aria-hidden="true" />
          {post.comment_count}
        </button>
        <button
          type="button"
          onClick={() => onToggleReshare(post.id)}
          aria-pressed={reshared}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
            reshared && "text-success"
          )}
        >
          <Repeat2 className="size-4" aria-hidden="true" />
          {post.reshare_count}
        </button>
        <button
          type="button"
          onClick={() => onToggleLike(post.id)}
          className={cn(
            "flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
            liked && "text-destructive"
          )}
        >
          <Heart className={cn("size-4", liked && "fill-current")} aria-hidden="true" />
          {post.like_count}
        </button>
        <button
          type="button"
          onClick={onShare}
          className="ml-auto text-muted-foreground hover:text-foreground"
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
