"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { PostCard, initialsFrom } from "@/components/court-side/PostCard";
import { FollowListDialog } from "@/components/court-side/FollowListDialog";
import { ShareDialog } from "@/components/court-side/ShareDialog";
import { createClient } from "@/lib/supabase/client";
import { listPostsByUser, type PostWithAuthor } from "@/lib/services/posts";
import { deletePostAction, toggleLikeAction } from "@/lib/actions/posts";
import { toggleFollowAction } from "@/lib/actions/follows";
import { listFollowerProfiles, listFollowingProfiles } from "@/lib/services/follows";
import type { PublicProfile } from "@/lib/supabase/types";

type UserRallyProfileProps = {
  viewerId: string;
  isAdmin: boolean;
  profile: PublicProfile;
  initialFollowerCount: number;
  initialFollowingCount: number;
  initialIsFollowing: boolean;
  initialPosts: PostWithAuthor[];
  initialNextCursor: string | null;
  initialLikedPostIds: string[];
};

/**
 * "My/Rally" — a user's own COURT/Side post history (works for any user
 * id, not just the viewer's own; viewing your own id just hides the
 * Follow button). All posts on this page share one author, so following
 * is a single boolean, not a per-post Set like the main feed needs.
 */
export function UserRallyProfile({
  viewerId,
  isAdmin,
  profile,
  initialFollowerCount,
  initialFollowingCount,
  initialIsFollowing,
  initialPosts,
  initialNextCursor,
  initialLikedPostIds,
}: UserRallyProfileProps) {
  const isOwnProfile = profile.id === viewerId;
  const displayName = profile.display_name || "Player";

  const [posts, setPosts] = useState(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set(initialLikedPostIds));
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(new Set());
  const [isFollowing, setIsFollowing] = useState(initialIsFollowing);
  const [followerCount, setFollowerCount] = useState(initialFollowerCount);
  // Not stateful — this page's own actions (viewer follows/unfollows
  // this profile) change *their* follower count, never their following
  // count, so there's nothing here that would ever update it.
  const followingCount = initialFollowingCount;
  const [shareOpen, setShareOpen] = useState(false);

  const [followersDialogOpen, setFollowersDialogOpen] = useState(false);
  const [followingDialogOpen, setFollowingDialogOpen] = useState(false);
  const [followersList, setFollowersList] = useState<PublicProfile[] | null>(null);
  const [followingList, setFollowingList] = useState<PublicProfile[] | null>(null);

  function openFollowers() {
    setFollowersDialogOpen(true);
    if (followersList === null) {
      const supabase = createClient();
      listFollowerProfiles(supabase, profile.id)
        .then(setFollowersList)
        .catch(() => setFollowersList([]));
    }
  }

  function openFollowing() {
    setFollowingDialogOpen(true);
    if (followingList === null) {
      const supabase = createClient();
      listFollowingProfiles(supabase, profile.id)
        .then(setFollowingList)
        .catch(() => setFollowingList([]));
    }
  }

  async function toggleFollow() {
    const wasFollowing = isFollowing;
    setIsFollowing(!wasFollowing);
    setFollowerCount((count) => count + (wasFollowing ? -1 : 1));

    const result = await toggleFollowAction(profile.id, wasFollowing);
    if (!result.success) {
      setIsFollowing(wasFollowing);
      setFollowerCount((count) => count + (wasFollowing ? 1 : -1));
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

  async function handleDeleteOwnPost(postId: string) {
    const previous = posts;
    setPosts((current) => current.filter((p) => p.id !== postId));
    const result = await deletePostAction(postId);
    if (!result.success) {
      setPosts(previous);
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
      const { posts: morePosts, nextCursor: newCursor } = await listPostsByUser(supabase, profile.id, { cursor: nextCursor });
      setPosts((current) => [...current, ...morePosts]);
      setNextCursor(newCursor);
    } catch {
      toast.error("We couldn't load more posts.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-6 text-center sm:flex-row sm:text-left">
        <Avatar className="size-16">
          {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
          <AvatarFallback className="bg-secondary text-lg font-semibold text-secondary-foreground">
            {initialsFrom(displayName)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <h1 className="text-xl font-semibold text-foreground">{displayName}</h1>
          <div className="mt-1 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 sm:justify-start">
            <button type="button" onClick={openFollowers} className="text-sm text-muted-foreground hover:text-foreground">
              <span className="font-semibold text-foreground">{followerCount}</span> followers
            </button>
            <button type="button" onClick={openFollowing} className="text-sm text-muted-foreground hover:text-foreground">
              <span className="font-semibold text-foreground">{followingCount}</span> following
            </button>
          </div>
        </div>
        {!isOwnProfile && (
          <Button type="button" variant={isFollowing ? "secondary" : "default"} onClick={toggleFollow}>
            {isFollowing ? "Following" : "Follow"}
          </Button>
        )}
      </div>

      <div className="mt-6 flex flex-col gap-3">
        {posts.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {isOwnProfile ? "You haven't posted yet." : `${displayName} hasn't posted yet.`}
          </p>
        ) : (
          posts.map((post) => (
            <PostCard
              key={post.id}
              post={post}
              currentUserId={viewerId}
              isAdmin={isAdmin}
              liked={likedPostIds.has(post.id)}
              isFollowingAuthor={isFollowing}
              expanded={expandedPostIds.has(post.id)}
              onToggleLike={toggleLike}
              onToggleFollow={toggleFollow}
              onToggleComments={toggleComments}
              onDeleteOwnPost={handleDeleteOwnPost}
              onShare={() => setShareOpen(true)}
              onCommentCountChange={handleCommentCountChange}
            />
          ))
        )}

        {nextCursor && (
          <div className="flex justify-center">
            <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      <ShareDialog open={shareOpen} onOpenChange={setShareOpen} />
      <FollowListDialog
        open={followersDialogOpen}
        onOpenChange={setFollowersDialogOpen}
        title="Followers"
        profiles={followersList}
        emptyMessage="No followers yet."
      />
      <FollowListDialog
        open={followingDialogOpen}
        onOpenChange={setFollowingDialogOpen}
        title="Following"
        profiles={followingList}
        emptyMessage="Not following anyone yet."
      />
    </div>
  );
}
