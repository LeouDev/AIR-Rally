"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PostCard, initialsFrom } from "@/components/court-side/PostCard";
import { createClient } from "@/lib/supabase/client";
import { listClubPosts, type PostWithAuthor } from "@/lib/services/posts";
import { createPostAction, deletePostAction, toggleLikeAction } from "@/lib/actions/posts";
import { toggleFollowAction } from "@/lib/actions/follows";
import type { Club } from "@/lib/supabase/types";

type MyClubFeedProps = {
  club: Club;
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  initialPosts: PostWithAuthor[];
  initialNextCursor: string | null;
  initialLikedPostIds: string[];
  initialFollowingIds: string[];
};

/**
 * "My Club" — a leaner sibling of CourtSideFeed scoped to one club.
 * Deliberately smaller: no reshare (blocked at the database for club
 * posts, 20260810000071), no @club mentions (posting already IS the
 * club-scoping action), no images/right-rail — just text posts, likes,
 * comments (via PostCard's own expand), and delete. RLS is the real
 * membership boundary; this component trusts the server already checked
 * the viewer belongs before rendering it at all.
 */
export function MyClubFeed({
  club,
  currentUserId,
  displayName,
  avatarUrl,
  isAdmin,
  initialPosts,
  initialNextCursor,
  initialLikedPostIds,
  initialFollowingIds,
}: MyClubFeedProps) {
  const [posts, setPosts] = useState<PostWithAuthor[]>(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set(initialLikedPostIds));
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set(initialFollowingIds));
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);

  const initials = initialsFrom(displayName);

  async function handlePost() {
    if (!draft.trim() || isPosting) return;
    setIsPosting(true);
    const result = await createPostAction({ content: draft.trim(), clubId: club.id });
    setIsPosting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setPosts((current) => [
      {
        ...result.data,
        author: { id: currentUserId, display_name: displayName, avatar_url: avatarUrl },
        event: null,
      },
      ...current,
    ]);
    setDraft("");
    toast.success(`Posted to ${club.name}.`);
  }

  async function handleDeleteOwnPost(postId: string) {
    const previous = posts;
    setPosts((current) => current.filter((p) => p.id !== postId));
    const result = await deletePostAction(postId);
    if (!result.success) {
      setPosts(previous);
      toast.error(result.error);
    }
  }

  async function toggleLike(postId: string) {
    const wasLiked = likedPostIds.has(postId);
    setLikedPostIds((current) => {
      const next = new Set(current);
      if (wasLiked) next.delete(postId);
      else next.add(postId);
      return next;
    });
    setPosts((current) => current.map((p) => (p.id === postId ? { ...p, like_count: p.like_count + (wasLiked ? -1 : 1) } : p)));

    const result = await toggleLikeAction(postId, wasLiked);
    if (!result.success) {
      setLikedPostIds((current) => {
        const next = new Set(current);
        if (wasLiked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      setPosts((current) => current.map((p) => (p.id === postId ? { ...p, like_count: p.like_count + (wasLiked ? 1 : -1) } : p)));
      toast.error(result.error);
    }
  }

  async function toggleFollow(userId: string) {
    const wasFollowing = followingIds.has(userId);
    setFollowingIds((current) => {
      const next = new Set(current);
      if (wasFollowing) next.delete(userId);
      else next.add(userId);
      return next;
    });
    const result = await toggleFollowAction(userId, wasFollowing);
    if (!result.success) {
      setFollowingIds((current) => {
        const next = new Set(current);
        if (wasFollowing) next.add(userId);
        else next.delete(userId);
        return next;
      });
      toast.error(result.error);
    }
  }

  function toggleComments(postId: string) {
    setExpandedPostIds((current) => {
      const next = new Set(current);
      if (next.has(postId)) next.delete(postId);
      else next.add(postId);
      return next;
    });
  }

  function handleCommentCountChange(postId: string, delta: number) {
    setPosts((current) => current.map((p) => (p.id === postId ? { ...p, comment_count: p.comment_count + delta } : p)));
  }

  async function loadMore() {
    if (!nextCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const supabase = createClient();
      const { posts: more, nextCursor: newCursor } = await listClubPosts(supabase, club.id, { cursor: nextCursor });
      setPosts((current) => [...current, ...more]);
      setNextCursor(newCursor);
    } catch {
      toast.error("We couldn't load more posts.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <div>
        <p className="mb-1 text-sm font-semibold tracking-wide text-primary uppercase">My Club</p>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">{club.name}</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Members-only — {club.member_count} member{club.member_count === 1 ? "" : "s"}.
        </p>
      </div>

      <div className="flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
        <Avatar>
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">{initials}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <textarea
            rows={2}
            maxLength={280}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={`Share something with ${club.name}…`}
            className="w-full resize-none rounded-lg border-0 bg-transparent p-1 text-sm outline-none placeholder:text-muted-foreground"
          />
          <div className="mt-2 flex items-center justify-end gap-1.5 border-t border-border pt-2.5">
            <span className="mr-auto text-[10px] text-muted-foreground">{draft.length} / 280</span>
            <Button type="button" size="sm" className="h-7 px-3" disabled={!draft.trim() || isPosting} onClick={handlePost}>
              {isPosting ? "Posting…" : "Post"}
            </Button>
          </div>
        </div>
      </div>

      {posts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border bg-muted/30 px-4 py-10 text-center">
          <p className="text-sm font-medium text-foreground">Nobody&apos;s posted here yet</p>
          <p className="mt-1 text-sm text-muted-foreground">Be the first to say something to {club.name}.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={currentUserId}
              isAdmin={isAdmin}
              liked={likedPostIds.has(post.id)}
              isFollowingAuthor={followingIds.has(post.user_id)}
              expanded={expandedPostIds.has(post.id)}
              onToggleLike={toggleLike}
              onToggleFollow={toggleFollow}
              onToggleComments={toggleComments}
              onDeleteOwnPost={handleDeleteOwnPost}
              onShare={() => {}}
              onCommentCountChange={handleCommentCountChange}
              reshared={false}
              onToggleReshare={() => {}}
            />
          ))}
        </div>
      )}

      {nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
            {loadingMore ? "Loading…" : "Load more"}
          </Button>
        </div>
      )}
    </div>
  );
}
