"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Image as ImageIcon, AtSign, Smile, Users } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCard, initialsFrom } from "@/components/court-side/PostCard";
import { FollowListDialog } from "@/components/court-side/FollowListDialog";
import { ShareDialog } from "@/components/court-side/ShareDialog";
import { createClient } from "@/lib/supabase/client";
import { listFeedPosts, listLikedPostIds, type PostWithAuthor } from "@/lib/services/posts";
import { searchPublicProfiles } from "@/lib/services/profiles";
import { createPostAction, deletePostAction, toggleLikeAction } from "@/lib/actions/posts";
import { toggleFollowAction } from "@/lib/actions/follows";
import { listFollowerProfiles, listFollowingProfiles } from "@/lib/services/follows";
import { toggleEventJoinAction } from "@/lib/actions/events";
import type { EventWithDetails } from "@/lib/services/events";
import type { PublicProfile } from "@/lib/supabase/types";

const FEED_TABS = ["For you", "Following", "Near you"] as const;

function formatEventDate(iso: string) {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    date: String(date.getDate()),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

type CourtSideFeedProps = {
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  initialPosts: PostWithAuthor[];
  initialNextCursor: string | null;
  initialLikedPostIds: string[];
  initialFollowingIds: string[];
  initialEvents: EventWithDetails[];
  initialAttendingEventIds: string[];
  initialFollowerCount: number;
  initialFollowingCount: number;
};

/**
 * Real, database-backed feed (Phase 7.1) — posts/likes/comments/follows/
 * event RSVPs all persist via supabase/migrations/20260810000027_court_side.sql.
 * Every mutation is optimistic (update local state immediately, call the
 * server action, roll back on failure) — same posture as FavoriteButton.tsx.
 */
export function CourtSideFeed({
  currentUserId,
  displayName,
  avatarUrl,
  isAdmin,
  initialPosts,
  initialNextCursor,
  initialLikedPostIds,
  initialFollowingIds,
  initialEvents,
  initialAttendingEventIds,
  initialFollowerCount,
  initialFollowingCount,
}: CourtSideFeedProps) {
  const [activeTab, setActiveTab] = useState<(typeof FEED_TABS)[number]>("For you");
  const [posts, setPosts] = useState<PostWithAuthor[]>(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set(initialLikedPostIds));
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set(initialFollowingIds));
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<PublicProfile[]>([]);
  const [shareOpen, setShareOpen] = useState(false);

  const [events, setEvents] = useState<EventWithDetails[]>(initialEvents);
  const [attendingEventIds, setAttendingEventIds] = useState<Set<string>>(new Set(initialAttendingEventIds));

  const [followerCount] = useState(initialFollowerCount);
  const [followingCount] = useState(initialFollowingCount);
  const [followersDialogOpen, setFollowersDialogOpen] = useState(false);
  const [followingDialogOpen, setFollowingDialogOpen] = useState(false);
  const [followersList, setFollowersList] = useState<PublicProfile[] | null>(null);
  const [followingList, setFollowingList] = useState<PublicProfile[] | null>(null);

  function openFollowers() {
    setFollowersDialogOpen(true);
    if (followersList === null) {
      const supabase = createClient();
      listFollowerProfiles(supabase, currentUserId)
        .then(setFollowersList)
        .catch(() => setFollowersList([]));
    }
  }

  function openFollowing() {
    setFollowingDialogOpen(true);
    if (followingList === null) {
      const supabase = createClient();
      listFollowingProfiles(supabase, currentUserId)
        .then(setFollowingList)
        .catch(() => setFollowingList([]));
    }
  }

  const initials = initialsFrom(displayName);
  const suggestedPeople = Array.from(new Map(posts.map((p) => [p.user_id, p.author])).entries())
    .filter(([userId]) => userId !== currentUserId && !followingIds.has(userId))
    .slice(0, 5);

  function handleDraftChange(value: string) {
    setDraft(value);
    // An "@" immediately followed by (optionally) more word characters,
    // anchored to the end of the draft — matches a mention still being
    // typed. Anything else (a space, punctuation, or no trailing "@" at
    // all) closes the suggestion list.
    const match = value.match(/@([a-zA-Z0-9_]*)$/);
    setTagQuery(match ? match[1] : null);
    if (!match) setTagResults([]);
  }

  function insertMention(profile: PublicProfile) {
    const handle = (profile.display_name ?? "player").trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_]/g, "");
    setDraft((current) => current.replace(/@[a-zA-Z0-9_]*$/, `@${handle} `));
    setTagQuery(null);
    setTagResults([]);
  }

  // Debounced real search against actual registered users — replaces the
  // old hardcoded placeholder handle list. Clearing tagResults for an
  // empty tagQuery happens in handleDraftChange itself, not here, so
  // this effect never calls setState synchronously in its own body.
  useEffect(() => {
    if (!tagQuery) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      const supabase = createClient();
      searchPublicProfiles(supabase, tagQuery)
        .then((results) => {
          if (!cancelled) setTagResults(results);
        })
        .catch(() => {
          if (!cancelled) setTagResults([]);
        });
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [tagQuery]);

  async function handlePost() {
    if (!draft.trim() || isPosting) return;
    setIsPosting(true);
    const result = await createPostAction({ content: draft.trim() });
    setIsPosting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setPosts((current) => [
      { ...result.data, author: { id: currentUserId, display_name: displayName, avatar_url: avatarUrl } },
      ...current,
    ]);
    setDraft("");
    setTagQuery(null);
    toast.success("Your rally is live.");
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
    setPosts((current) =>
      current.map((p) => (p.id === postId ? { ...p, like_count: p.like_count + (wasLiked ? -1 : 1) } : p))
    );

    const result = await toggleLikeAction(postId, wasLiked);
    if (!result.success) {
      setLikedPostIds((current) => {
        const next = new Set(current);
        if (wasLiked) next.add(postId);
        else next.delete(postId);
        return next;
      });
      setPosts((current) =>
        current.map((p) => (p.id === postId ? { ...p, like_count: p.like_count + (wasLiked ? 1 : -1) } : p))
      );
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

  async function toggleJoinEvent(eventId: string) {
    const wasJoined = attendingEventIds.has(eventId);
    setAttendingEventIds((current) => {
      const next = new Set(current);
      if (wasJoined) next.delete(eventId);
      else next.add(eventId);
      return next;
    });
    setEvents((current) =>
      current.map((e) => (e.id === eventId ? { ...e, attendeeCount: e.attendeeCount + (wasJoined ? -1 : 1) } : e))
    );

    const result = await toggleEventJoinAction(eventId, wasJoined);
    if (!result.success) {
      setAttendingEventIds((current) => {
        const next = new Set(current);
        if (wasJoined) next.add(eventId);
        else next.delete(eventId);
        return next;
      });
      setEvents((current) =>
        current.map((e) => (e.id === eventId ? { ...e, attendeeCount: e.attendeeCount + (wasJoined ? 1 : -1) } : e))
      );
      toast.error(result.error);
    } else if (!wasJoined) {
      toast.success("You're on the list!");
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
      const { posts: morePosts, nextCursor: newCursor } = await listFeedPosts(supabase, { cursor: nextCursor });
      const moreLikedIds = await listLikedPostIds(
        supabase,
        currentUserId,
        morePosts.map((p) => p.id)
      );
      setPosts((current) => [...current, ...morePosts]);
      setLikedPostIds((current) => new Set([...current, ...moreLikedIds]));
      setNextCursor(newCursor);
    } catch {
      toast.error("We couldn't load more posts.");
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="mb-1 text-sm font-semibold tracking-wide text-primary uppercase">COURT/SIDE</p>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">Rally together.</h1>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1">
          <Link
            href={`/court-side/${currentUserId}`}
            className="flex items-center gap-1.5 text-sm font-semibold text-primary hover:underline"
          >
            <Users className="size-4" aria-hidden="true" />
            My/Rally
          </Link>
          <button type="button" onClick={openFollowers} className="text-sm text-muted-foreground hover:text-foreground">
            <span className="font-semibold text-foreground">{followerCount}</span> followers
          </button>
          <button type="button" onClick={openFollowing} className="text-sm text-muted-foreground hover:text-foreground">
            <span className="font-semibold text-foreground">{followingCount}</span> following
          </button>
        </div>

        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            setActiveTab(value as (typeof FEED_TABS)[number]);
            toast(`${value} feed selected`);
          }}
          className="mt-6"
        >
          <TabsList variant="line">
            {FEED_TABS.map((tab) => (
              <TabsTrigger key={tab} value={tab}>
                {tab}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>

        {/* Composer */}
        <div className="mt-6 flex gap-3 rounded-2xl border border-border bg-card p-4 shadow-sm">
          <Avatar>
            {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
            <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <textarea
              rows={2}
              maxLength={280}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder="What's happening on your court?"
              className="w-full resize-none rounded-lg border-0 bg-transparent p-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            {tagQuery !== null && (
              <div className="flex flex-col gap-1 pb-1">
                {tagQuery && tagResults.length === 0 ? (
                  <p className="px-1 py-1 text-xs text-muted-foreground">No players found.</p>
                ) : (
                  tagResults.map((profile) => (
                    <button
                      key={profile.id}
                      type="button"
                      onClick={() => insertMention(profile)}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted"
                    >
                      <Avatar size="sm">
                        {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
                        <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
                          {initialsFrom(profile.display_name || "Player")}
                        </AvatarFallback>
                      </Avatar>
                      <span className="text-xs font-medium text-foreground">{profile.display_name}</span>
                    </button>
                  ))
                )}
              </div>
            )}
            <div className="mt-2 flex items-center gap-0.5 border-t border-border pt-2.5 sm:gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => toast("Media upload is coming soon.")}
              >
                <ImageIcon className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Media</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => handleDraftChange(draft ? `${draft.trimEnd()} @` : "@")}
              >
                <AtSign className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Tag</span>
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => toast("Feeling picker is coming soon.")}
              >
                <Smile className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Feeling</span>
              </Button>
              <span className="ml-auto shrink-0 text-[10px] text-muted-foreground">{draft.length} / 280</span>
              <Button
                type="button"
                size="sm"
                className="ml-1.5 h-7 shrink-0 px-3"
                disabled={!draft.trim() || isPosting}
                onClick={handlePost}
              >
                {isPosting ? "Posting…" : "Post"}
              </Button>
            </div>
          </div>
        </div>

        {/* Posts */}
        <div className="mt-8 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
          <span>Trending in your community</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        {posts.length === 0 ? (
          <p className="mt-6 text-sm text-muted-foreground">Nobody&apos;s posted yet — be the first to say something.</p>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
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
                onShare={() => setShareOpen(true)}
                onCommentCountChange={handleCommentCountChange}
              />
            ))}
          </div>
        )}

        {nextCursor && (
          <div className="mt-4 flex justify-center">
            <Button type="button" variant="outline" size="sm" disabled={loadingMore} onClick={loadMore}>
              {loadingMore ? "Loading…" : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {/* Right rail */}
      <aside className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <Input placeholder="Search rallies, players, clubs" className="h-6 border-0 p-0 shadow-none focus-visible:ring-0" />
        </div>

        {events.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">Happening Now</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Play more this week.</h2>
            <p className="mt-1 text-xs text-muted-foreground">Local games waiting for a few more players.</p>
            <div className="mt-3 flex flex-col">
              {events.map((event) => {
                const joined = attendingEventIds.has(event.id);
                const { day, date, time } = formatEventDate(event.start_time);
                return (
                  <div key={event.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
                    <div className="grid min-w-10 place-items-center rounded-lg bg-accent px-1.5 py-1 text-center text-primary">
                      <span className="text-[8px] font-bold">{day}</span>
                      <span className="text-sm font-bold">{date}</span>
                    </div>
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="font-semibold text-foreground">{event.title}</p>
                      <p className="text-muted-foreground">
                        {event.venue?.name ?? "Location TBD"} · {time} · {event.attendeeCount} going
                      </p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant={joined ? "secondary" : "outline"}
                      className="h-7 shrink-0 px-2.5 text-xs"
                      onClick={() => toggleJoinEvent(event.id)}
                    >
                      {joined ? "Joined" : "Join"}
                    </Button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">Players to follow</h3>
          {suggestedPeople.length === 0 ? (
            <p className="mt-3 text-xs text-muted-foreground">You&apos;re following everyone active right now.</p>
          ) : (
            <div className="mt-3 flex flex-col gap-3.5">
              {suggestedPeople.map(([userId, author]) => {
                const name = author?.display_name || "Player";
                return (
                  <div key={userId} className="flex items-center gap-2.5">
                    <Avatar size="sm">
                      {author?.avatar_url && <AvatarImage src={author.avatar_url} alt="" />}
                      <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
                        {initialsFrom(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="truncate font-semibold text-foreground">{name}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2.5 text-xs"
                      onClick={() => toggleFollow(userId)}
                    >
                      Follow
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>

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
