"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Image as ImageIcon, AtSign, Smile, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PostCard, initialsFrom } from "@/components/court-side/PostCard";
import { FollowListDialog } from "@/components/court-side/FollowListDialog";
import { ShareDialog } from "@/components/court-side/ShareDialog";
import { createClient } from "@/lib/supabase/client";
import { listFeedPosts, listLikedPostIds, listResharedPostIds, type FeedPost } from "@/lib/services/posts";
import { searchPublicProfiles } from "@/lib/services/profiles";
import { searchClubs, clubMentionHandle, type ClubMentionMap } from "@/lib/services/clubs";
import { uploadPostImages, MAX_POST_IMAGES } from "@/lib/services/postImages";
import { CourtSideSearch } from "@/components/court-side/CourtSideSearch";
import { createPostAction, deletePostAction, toggleLikeAction, toggleReshareAction } from "@/lib/actions/posts";
import { toggleFollowAction } from "@/lib/actions/follows";
import { listFollowerProfiles, listFollowingProfiles } from "@/lib/services/follows";
import { toggleEventJoinAction } from "@/lib/actions/events";
import type { EventWithDetails } from "@/lib/services/events";
import type { EventAttendeeStatus, PublicProfile } from "@/lib/supabase/types";
import { suggestedPlayersFromFeed, postCountLabel } from "@/lib/suggestedPlayers";

const FEED_TABS = ["For you", "Following", "Near you"] as const;

function formatEventDate(iso: string) {
  const date = new Date(iso);
  return {
    day: date.toLocaleDateString("en-US", { weekday: "short" }).toUpperCase(),
    date: String(date.getDate()),
    time: date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
  };
}

/**
 * One row in the "@" picker. People and clubs are mentioned the same way
 * in post text, so they share a list rather than two competing dropdowns.
 */
type MentionSuggestion =
  | { kind: "person"; id: string; name: string; avatarUrl: string | null }
  | { kind: "club"; id: string; name: string; memberCount: number };

type CourtSideFeedProps = {
  currentUserId: string;
  displayName: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  initialPosts: FeedPost[];
  initialNextCursor: string | null;
  initialLikedPostIds: string[];
  initialFollowingIds: string[];
  initialEvents: EventWithDetails[];
  /** Plain object, not a Map — crosses the server→client boundary. */
  initialEventStatuses: Record<string, EventAttendeeStatus>;
  initialFollowerCount: number;
  initialFollowingCount: number;
  initialResharedPostIds: string[];
  /** Club mentions resolved server-side so "@ClubName" renders as a link. */
  clubMentions: ClubMentionMap;
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
  initialEventStatuses,
  initialFollowerCount,
  initialFollowingCount,
  initialResharedPostIds,
  clubMentions,
}: CourtSideFeedProps) {
  const [activeTab, setActiveTab] = useState<(typeof FEED_TABS)[number]>("For you");
  const [posts, setPosts] = useState<FeedPost[]>(initialPosts);
  const [nextCursor, setNextCursor] = useState(initialNextCursor);
  const [loadingMore, setLoadingMore] = useState(false);
  const [likedPostIds, setLikedPostIds] = useState<Set<string>>(new Set(initialLikedPostIds));
  const [resharedPostIds, setResharedPostIds] = useState<Set<string>>(new Set(initialResharedPostIds));
  // Ids of people actually chosen from the "@" picker. Only these get a
  // mention notification — a hand-typed "@Lea" can't identify which Lea.
  const [mentionedUserIds, setMentionedUserIds] = useState<string[]>([]);
  // Files stay local until the post is submitted, so abandoning a draft
  // never leaves orphaned objects in storage.
  const [pendingImages, setPendingImages] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function addImages(files: FileList | null) {
    if (!files || files.length === 0) return;
    const room = MAX_POST_IMAGES - pendingImages.length;
    if (room <= 0) {
      toast.error(`You can attach up to ${MAX_POST_IMAGES} photos.`);
      return;
    }
    const accepted = Array.from(files).slice(0, room);
    if (files.length > room) toast(`Only ${room} more photo${room === 1 ? "" : "s"} could be added.`);

    setPendingImages((current) => [...current, ...accepted]);
    setPreviewUrls((current) => [...current, ...accepted.map((f) => URL.createObjectURL(f))]);
  }

  function removeImage(index: number) {
    // Release the object URL as it goes, or the blob leaks for the life
    // of the page.
    URL.revokeObjectURL(previewUrls[index]);
    setPendingImages((current) => current.filter((_, i) => i !== index));
    setPreviewUrls((current) => current.filter((_, i) => i !== index));
  }

  function clearImages() {
    previewUrls.forEach((url) => URL.revokeObjectURL(url));
    setPendingImages([]);
    setPreviewUrls([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set(initialFollowingIds));
  const [expandedPostIds, setExpandedPostIds] = useState<Set<string>>(new Set());
  const [draft, setDraft] = useState("");
  const [isPosting, setIsPosting] = useState(false);
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [tagResults, setTagResults] = useState<MentionSuggestion[]>([]);
  const [shareOpen, setShareOpen] = useState(false);

  const [events, setEvents] = useState<EventWithDetails[]>(initialEvents);
  const [eventStatuses, setEventStatuses] = useState<Map<string, EventAttendeeStatus>>(
    new Map(Object.entries(initialEventStatuses))
  );

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
  // Was derived inline here, and never filtered a null author — a deleted
  // account produced a suggestion card with no name. See lib/suggestedPlayers.
  const suggestedPeople = suggestedPlayersFromFeed(posts, {
    viewerId: currentUserId,
    alreadyFollowing: Array.from(followingIds),
    limit: 5,
  });

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

  function insertMention(suggestion: MentionSuggestion) {
    // A person's handle is their first name; a club's is its whole name
    // with spaces removed, since the feed highlighter only matches "@"
    // plus alphanumerics and would otherwise light up just the first word.
    const handle =
      suggestion.kind === "club"
        ? clubMentionHandle(suggestion.name)
        : suggestion.name.trim().split(/\s+/)[0].replace(/[^a-zA-Z0-9_]/g, "");
    setDraft((current) => current.replace(/@[a-zA-Z0-9_]*$/, `@${handle} `));
    if (suggestion.kind === "person") {
      setMentionedUserIds((current) => (current.includes(suggestion.id) ? current : [...current, suggestion.id]));
    }
    setTagQuery(null);
    setTagResults([]);
  }

  async function toggleReshare(postId: string) {
    const wasReshared = resharedPostIds.has(postId);
    setResharedPostIds((current) => {
      const next = new Set(current);
      if (wasReshared) next.delete(postId);
      else next.add(postId);
      return next;
    });
    setPosts((current) =>
      current.map((p) => (p.id === postId ? { ...p, reshare_count: p.reshare_count + (wasReshared ? -1 : 1) } : p))
    );

    const result = await toggleReshareAction(postId, wasReshared);
    if (!result.success) {
      setResharedPostIds((current) => {
        const next = new Set(current);
        if (wasReshared) next.add(postId);
        else next.delete(postId);
        return next;
      });
      setPosts((current) =>
        current.map((p) => (p.id === postId ? { ...p, reshare_count: p.reshare_count + (wasReshared ? 1 : -1) } : p))
      );
      toast.error(result.error);
    }
  }

  // Debounced real search across both registered users and clubs, so an
  // "@" can tag either. Clearing tagResults for an empty tagQuery happens
  // in handleDraftChange itself, not here, so this effect never calls
  // setState synchronously in its own body.
  useEffect(() => {
    if (!tagQuery) return;
    let cancelled = false;
    const handle = setTimeout(() => {
      const supabase = createClient();
      Promise.all([searchPublicProfiles(supabase, tagQuery), searchClubs(supabase, tagQuery)])
        .then(([profiles, clubs]) => {
          if (cancelled) return;
          setTagResults([
            ...profiles.map((profile) => ({
              kind: "person" as const,
              id: profile.id,
              name: profile.display_name ?? "Player",
              avatarUrl: profile.avatar_url,
            })),
            ...clubs.map((club) => ({
              kind: "club" as const,
              id: club.id,
              name: club.name,
              memberCount: club.member_count,
            })),
          ]);
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

    // Images upload first: if storage fails we can still tell the user
    // before anything is published, rather than orphaning a post.
    let imagePaths: string[] = [];
    if (pendingImages.length > 0) {
      const supabase = createClient();
      const upload = await uploadPostImages(supabase, currentUserId, pendingImages);
      imagePaths = upload.paths;
      upload.errors.forEach((message) => toast.error(message));
      if (imagePaths.length === 0) {
        setIsPosting(false);
        return;
      }
    }

    const result = await createPostAction({ content: draft.trim(), imagePaths }, mentionedUserIds);
    setIsPosting(false);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    setPosts((current) => [
      {
        ...result.data,
        author: { id: currentUserId, display_name: displayName, avatar_url: avatarUrl },
        // A post you just wrote is an original, not a reshare, and sorts
        // at its own creation time — the same shape court_side_feed()
        // would return for it on the next load.
        effective_at: result.data.created_at,
        resharer_id: null,
        resharer: null,
      },
      ...current,
    ]);
    setDraft("");
    setTagQuery(null);
    setMentionedUserIds([]);
    clearImages();
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
    // Not optimistic: a join no longer always lands a seat (it may land
    // pending_approval or waitlisted instead), so there's nothing safe
    // to guess here — apply the database's actual answer once it's back,
    // same posture as EventJoinButton.
    const previousStatus = eventStatuses.get(eventId) ?? null;
    const result = await toggleEventJoinAction(eventId, previousStatus);
    if (!result.success) {
      toast.error(result.error);
      return;
    }

    const nextStatus = result.data.status;
    setEventStatuses((current) => {
      const next = new Map(current);
      if (nextStatus) next.set(eventId, nextStatus);
      else next.delete(eventId);
      return next;
    });

    // participant_count only ever counts 'joined' rows (see
    // update_event_participant_count()), so the visible seat count only
    // moves when a seat is actually taken or actually freed.
    if (nextStatus === "joined" || previousStatus === "joined") {
      const delta = nextStatus === "joined" ? 1 : -1;
      setEvents((current) => current.map((e) => (e.id === eventId ? { ...e, attendeeCount: Math.max(0, e.attendeeCount + delta) } : e)));
    }

    if (nextStatus === "pending_approval") {
      toast.success("Request sent — the organiser will review it.");
    } else if (nextStatus === "joined") {
      toast.success("You're on the list!");
    } else if (nextStatus === "waitlisted") {
      toast.success("You're on the waitlist.");
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
      const morePostIds = morePosts.map((p) => p.id);
      const [moreLikedIds, moreResharedIds] = await Promise.all([
        listLikedPostIds(supabase, currentUserId, morePostIds),
        listResharedPostIds(supabase, currentUserId, morePostIds),
      ]);
      setPosts((current) => [...current, ...morePosts]);
      setLikedPostIds((current) => new Set([...current, ...moreLikedIds]));
      setResharedPostIds((current) => new Set([...current, ...moreResharedIds]));
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
                  <p className="px-1 py-1 text-xs text-muted-foreground">No players or clubs found.</p>
                ) : (
                  tagResults.map((suggestion) => (
                    <button
                      key={`${suggestion.kind}-${suggestion.id}`}
                      type="button"
                      onClick={() => insertMention(suggestion)}
                      className="flex items-center gap-2 rounded-lg px-1.5 py-1 text-left hover:bg-muted"
                    >
                      {suggestion.kind === "person" ? (
                        <Avatar size="sm">
                          {suggestion.avatarUrl && <AvatarImage src={suggestion.avatarUrl} alt="" />}
                          <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
                            {initialsFrom(suggestion.name)}
                          </AvatarFallback>
                        </Avatar>
                      ) : (
                        <span className="grid size-6 shrink-0 place-items-center rounded-full bg-accent text-accent-foreground">
                          <Users className="size-3" aria-hidden="true" />
                        </span>
                      )}
                      <span className="text-xs font-medium text-foreground">{suggestion.name}</span>
                      {suggestion.kind === "club" && (
                        <span className="text-[10px] text-muted-foreground">
                          Club · {suggestion.memberCount} {suggestion.memberCount === 1 ? "member" : "members"}
                        </span>
                      )}
                    </button>
                  ))
                )}
              </div>
            )}
            {previewUrls.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-2">
                {previewUrls.map((url, index) => (
                  <div key={url} className="relative">
                    {/* Local blob preview, not a remote asset — next/image
                        would add no benefit and can't optimize a blob URL. */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt="" className="size-16 rounded-lg border border-border object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage(index)}
                      aria-label={`Remove photo ${index + 1}`}
                      className="absolute -right-1.5 -top-1.5 grid size-5 place-items-center rounded-full bg-foreground text-background"
                    >
                      <X className="size-3" aria-hidden="true" />
                    </button>
                  </div>
                ))}
                <span className="self-end text-xs text-muted-foreground">
                  {previewUrls.length}/{MAX_POST_IMAGES}
                </span>
              </div>
            )}

            <div className="mt-2 flex items-center gap-0.5 border-t border-border pt-2.5 sm:gap-1">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 shrink-0 gap-1.5 px-2 text-xs text-muted-foreground"
                disabled={pendingImages.length >= MAX_POST_IMAGES}
                onClick={() => fileInputRef.current?.click()}
              >
                <ImageIcon className="size-3.5" aria-hidden="true" />
                <span className="hidden sm:inline">Media</span>
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                hidden
                onChange={(e) => {
                  addImages(e.target.files);
                  e.target.value = "";
                }}
              />
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
          /* A new user's feed is built around finding people to play with,
             not an empty box. With nobody posting yet there is nobody to
             suggest either, so this falls back to the two things that DO
             start a feed: post something, or join a club. */
          <div className="mt-6 flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <h3 className="text-2xl/[1.875rem] font-semibold tracking-[-0.01em] text-foreground">
                Your feed starts with four people
              </h3>
              <p className="text-[0.9375rem]/[1.375rem] text-subtle text-pretty">
                Follow players from courts near you. When they post an open game, you&apos;ll see it
                here first.
              </p>
            </div>

            {suggestedPeople.length > 0 && (
              <ul className="flex flex-col gap-2.5">
                {suggestedPeople.map(({ profile: author, postCount }) => {
                  const name = author.display_name || "Player";
                  return (
                    <li
                      key={author.id}
                      className="flex items-center gap-3 rounded-xl bg-card p-3.5 shadow-card"
                    >
                      <Avatar>
                        {author.avatar_url && <AvatarImage src={author.avatar_url} alt="" />}
                        <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
                          {initialsFrom(name)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[0.9375rem]/5 font-semibold text-foreground">{name}</p>
                        {/* The only secondary fact these cards carry: something
                            the player chose to publish. Never inferred location. */}
                        <p className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
                          {postCountLabel(postCount)}
                        </p>
                      </div>
                      <Button type="button" size="sm" onClick={() => toggleFollow(author.id)}>
                        Follow
                      </Button>
                    </li>
                  );
                })}
              </ul>
            )}

            <div className="h-px bg-border" />

            <div className="flex flex-col gap-2.5">
              <p className="text-xs/4 font-semibold tracking-[0.12em] text-muted-foreground uppercase">
                Or start here
              </p>
              <div className="flex items-center gap-3 rounded-xl bg-secondary p-3.5 text-secondary-foreground">
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9375rem]/5 font-semibold">Say hello to the court</p>
                  <p className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
                    Your first post gets shown to nearby players.
                  </p>
                </div>
                <span aria-hidden="true" className="text-lg font-semibold text-primary">
                  +
                </span>
              </div>
              <Link
                href="/clubs"
                className="flex items-center gap-3 rounded-xl bg-card p-3.5 shadow-card transition-transform hover:-translate-y-0.5 focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/25"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-[0.9375rem]/5 font-semibold text-foreground">Join a club</p>
                  <p className="text-[0.8125rem]/[1.125rem] text-muted-foreground">
                    Find players who already meet regularly.
                  </p>
                </div>
                <span aria-hidden="true" className="text-muted-foreground">
                  →
                </span>
              </Link>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            {posts.map((post) => (
              <PostCard
                // Not post.id alone: the same post appears once as itself
                // and once per reshare, so React would see duplicate keys
                // and drop rows. resharer_id disambiguates them.
                key={`${post.id}:${post.resharer_id ?? "original"}`}
                post={post}
                resharer={post.resharer}
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
                clubMentions={clubMentions}
                reshared={resharedPostIds.has(post.id)}
                onToggleReshare={toggleReshare}
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
        <CourtSideSearch />

        {events.length > 0 && (
          <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">Happening Now</p>
            <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Play more this week.</h2>
            <p className="mt-1 text-xs text-muted-foreground">Local games waiting for a few more players.</p>
            <div className="mt-3 flex flex-col">
              {events.map((event) => {
                const status = eventStatuses.get(event.id) ?? null;
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
                      variant={status ? "secondary" : "outline"}
                      className="h-7 shrink-0 px-2.5 text-xs"
                      onClick={() => toggleJoinEvent(event.id)}
                    >
                      {status === "joined"
                        ? "Joined"
                        : status === "waitlisted"
                          ? "Waitlisted"
                          : status === "pending_approval"
                            ? "Requested"
                            : "Join"}
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
              {suggestedPeople.map(({ profile: author, postCount }) => {
                const name = author.display_name || "Player";
                return (
                  <div key={author.id} className="flex items-center gap-2.5">
                    <Avatar size="sm">
                      {author.avatar_url && <AvatarImage src={author.avatar_url} alt="" />}
                      <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
                        {initialsFrom(name)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1 text-xs">
                      <p className="truncate font-semibold text-foreground">{name}</p>
                      <p className="text-muted-foreground">{postCountLabel(postCount)}</p>
                    </div>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-7 shrink-0 px-2.5 text-xs"
                      onClick={() => toggleFollow(author.id)}
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
