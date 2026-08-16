"use client";

import { useState } from "react";
import { Image as ImageIcon, AtSign, Smile, MessageCircle, Repeat2, Heart, Share2, Copy } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CourtSurface, deterministicSurfaceColor } from "@/components/court/CourtSurface";
import { cn } from "@/lib/utils";

const TAG_SUGGESTIONS = ["@migsdecastro", "@pickleballcebu", "@courtsofbgy"];
const FEED_TABS = ["For you", "Following", "Near you"] as const;
const SHARE_NETWORKS = ["Instagram", "Messenger", "Messages", "Copy link"] as const;

type Post = {
  id: string;
  authorName: string;
  handle: string;
  location?: string;
  timeLabel: string;
  verified?: boolean;
  body: string;
  showCourtPhoto?: boolean;
  comments: number;
  reshares: number;
  likes: number;
  liked: boolean;
  reshared: boolean;
};

const INITIAL_POSTS: Post[] = [
  {
    id: "seed-1",
    authorName: "Miguel de Castro",
    handle: "@migsdecastro",
    location: "Cebu City",
    timeLabel: "32m",
    verified: true,
    body: "Golden hour games at @pickleballcebu just hit different. Who's up for another round this Thursday?",
    showCourtPhoto: true,
    comments: 18,
    reshares: 6,
    likes: 124,
    liked: false,
    reshared: false,
  },
  {
    id: "seed-2",
    authorName: "Kat Santos",
    handle: "@katsmash",
    location: "Taguig",
    timeLabel: "1h",
    body: "First time playing an actual kitchen battle and I'm officially obsessed. Shoutout to the strangers who became teammates today!",
    comments: 9,
    reshares: 2,
    likes: 47,
    liked: false,
    reshared: false,
  },
];

const EVENTS = [
  { id: "evt-1", day: "THU", date: "18", title: "Sunset Social Rally", venue: "Pickleball Cebu · 6:00 PM" },
  { id: "evt-2", day: "SAT", date: "20", title: "Beginner Open Play", venue: "BGC Smash · 9:00 AM" },
];

const PEOPLE = [
  { id: "ppl-1", name: "Jules Garcia", handle: "@julesplays" },
  { id: "ppl-2", name: "Nico Cruz", handle: "@nicocruz" },
  { id: "ppl-3", name: "Ana Mercado", handle: "@anainplay" },
];

function initialsFrom(name: string) {
  return name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

function highlightMentions(text: string) {
  const parts = text.split(/(@[a-zA-Z0-9_]+)/g);
  return parts.map((part, i) =>
    part.startsWith("@") ? (
      <strong key={i} className="font-semibold text-primary">
        {part}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

type CourtSideFeedProps = {
  displayName: string;
  avatarUrl: string | null;
};

/**
 * A client-only, non-persisted community feed — COURT/Side has no
 * backend yet (no posts/follows tables), so composing, liking, and
 * following only affect this component's own local state and reset on
 * reload. Seeded with two demo posts so the feed never looks empty.
 */
export function CourtSideFeed({ displayName, avatarUrl }: CourtSideFeedProps) {
  const [activeTab, setActiveTab] = useState<(typeof FEED_TABS)[number]>("For you");
  const [posts, setPosts] = useState<Post[]>(INITIAL_POSTS);
  const [draft, setDraft] = useState("");
  const [showTagSuggestions, setShowTagSuggestions] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [followingIds, setFollowingIds] = useState<Set<string>>(new Set());
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());

  const initials = initialsFrom(displayName);

  function handleDraftChange(value: string) {
    setDraft(value);
    setShowTagSuggestions(value.endsWith("@"));
  }

  function insertTag(tag: string) {
    setDraft((current) => current.replace(/@$/, tag) + " ");
    setShowTagSuggestions(false);
  }

  function handlePost() {
    if (!draft.trim()) return;
    const newPost: Post = {
      id: `local-${Date.now()}`,
      authorName: displayName,
      handle: "@you",
      timeLabel: "now",
      body: draft.trim(),
      comments: 0,
      reshares: 0,
      likes: 0,
      liked: false,
      reshared: false,
    };
    setPosts((current) => [newPost, ...current]);
    setDraft("");
    setShowTagSuggestions(false);
    toast.success("Your rally is live.");
  }

  function toggleLike(id: string) {
    setPosts((current) =>
      current.map((p) => (p.id === id ? { ...p, liked: !p.liked, likes: p.likes + (p.liked ? -1 : 1) } : p))
    );
  }

  function toggleReshare(id: string) {
    setPosts((current) =>
      current.map((p) =>
        p.id === id ? { ...p, reshared: !p.reshared, reshares: p.reshares + (p.reshared ? -1 : 1) } : p
      )
    );
  }

  function toggleFollow(id: string) {
    setFollowingIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleJoin(id: string) {
    setJoinedIds((current) => new Set(current).add(id));
    toast.success("You're on the list!");
  }

  function handleShareChoice(network: (typeof SHARE_NETWORKS)[number]) {
    setShareOpen(false);
    if (network === "Copy link") {
      navigator.clipboard?.writeText(window.location.href);
      toast.success("Link copied to clipboard.");
    } else {
      toast(`Opening ${network} share…`);
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
          <div className="flex-1">
            <textarea
              rows={2}
              maxLength={280}
              value={draft}
              onChange={(e) => handleDraftChange(e.target.value)}
              placeholder="What's happening on your court?"
              className="w-full resize-none rounded-lg border-0 bg-transparent p-1 text-sm outline-none placeholder:text-muted-foreground"
            />
            {showTagSuggestions && (
              <div className="flex flex-wrap gap-1.5 pb-1">
                {TAG_SUGGESTIONS.map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => insertTag(tag)}
                    className="rounded-full border border-accent bg-accent px-2.5 py-1 text-xs font-medium text-primary"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
            <div className="mt-2 flex items-center gap-1 border-t border-border pt-2.5">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => toast("Media upload is coming soon.")}
              >
                <ImageIcon className="size-3.5" aria-hidden="true" />
                Media
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => handleDraftChange(draft ? `${draft.trimEnd()} @` : "@")}
              >
                <AtSign className="size-3.5" aria-hidden="true" />
                Tag
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 px-2 text-xs text-muted-foreground"
                onClick={() => toast("Feeling picker is coming soon.")}
              >
                <Smile className="size-3.5" aria-hidden="true" />
                Feeling
              </Button>
              <span className="ml-auto text-[10px] text-muted-foreground">{draft.length} / 280</span>
              <Button type="button" size="sm" className="ml-1.5 h-7 px-3" disabled={!draft.trim()} onClick={handlePost}>
                Post
              </Button>
            </div>
          </div>
        </div>

        {/* Posts */}
        <div className="mt-8 flex items-center gap-3 text-xs font-semibold text-muted-foreground">
          <span>Trending in your community</span>
          <span className="h-px flex-1 bg-border" />
        </div>

        <div className="mt-4 flex flex-col gap-3">
          {posts.map((post) => (
            <article key={post.id} className="rounded-2xl border border-border bg-card p-4 shadow-sm">
              <div className="flex items-center gap-2.5">
                <Avatar>
                  <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
                    {initialsFrom(post.authorName)}
                  </AvatarFallback>
                </Avatar>
                <div className="text-sm leading-tight">
                  <div className="flex items-center gap-1">
                    <span className="font-semibold text-foreground">{post.authorName}</span>
                    {post.verified && (
                      <span className="grid size-3.5 place-items-center rounded-full bg-secondary text-[8px] text-secondary-foreground">
                        ✓
                      </span>
                    )}
                    <span className="text-muted-foreground">· {post.timeLabel}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {post.handle}
                    {post.location ? ` · ${post.location}` : ""}
                  </p>
                </div>
              </div>

              <p className="mt-3 text-sm leading-relaxed text-foreground">{highlightMentions(post.body)}</p>

              {post.showCourtPhoto && (
                <div className="mt-3 aspect-[16/9] w-full overflow-hidden rounded-xl">
                  <CourtSurface surfaceColor={deterministicSurfaceColor(post.id)} indoor={false} />
                </div>
              )}

              <div className="mt-3 flex items-center gap-5 border-t border-border pt-3">
                <button
                  type="button"
                  onClick={() => toast("Replies are coming soon.")}
                  className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  <MessageCircle className="size-4" aria-hidden="true" />
                  {post.comments}
                </button>
                <button
                  type="button"
                  onClick={() => toggleReshare(post.id)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
                    post.reshared && "text-success"
                  )}
                >
                  <Repeat2 className="size-4" aria-hidden="true" />
                  {post.reshares}
                </button>
                <button
                  type="button"
                  onClick={() => toggleLike(post.id)}
                  className={cn(
                    "flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground",
                    post.liked && "text-destructive"
                  )}
                >
                  <Heart className={cn("size-4", post.liked && "fill-current")} aria-hidden="true" />
                  {post.likes}
                </button>
                <button
                  type="button"
                  onClick={() => setShareOpen(true)}
                  className="ml-auto text-muted-foreground hover:text-foreground"
                  aria-label="Share"
                >
                  <Share2 className="size-4" aria-hidden="true" />
                </button>
              </div>
            </article>
          ))}
        </div>
      </div>

      {/* Right rail */}
      <aside className="flex flex-col gap-4">
        <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5">
          <Input placeholder="Search rallies, players, clubs" className="h-6 border-0 p-0 shadow-none focus-visible:ring-0" />
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold tracking-wide text-primary uppercase">Happening Now</p>
          </div>
          <h2 className="mt-1 text-lg font-semibold tracking-tight text-foreground">Play more this week.</h2>
          <p className="mt-1 text-xs text-muted-foreground">Local games waiting for a few more players.</p>
          <div className="mt-3 flex flex-col">
            {EVENTS.map((event) => {
              const joined = joinedIds.has(event.id);
              return (
                <div key={event.id} className="flex items-center gap-3 border-t border-border py-3 first:border-t-0">
                  <div className="grid min-w-10 place-items-center rounded-lg bg-accent px-1.5 py-1 text-center text-primary">
                    <span className="text-[8px] font-bold">{event.day}</span>
                    <span className="text-sm font-bold">{event.date}</span>
                  </div>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="font-semibold text-foreground">{event.title}</p>
                    <p className="text-muted-foreground">{event.venue}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={joined ? "secondary" : "outline"}
                    className="h-7 shrink-0 px-2.5 text-xs"
                    disabled={joined}
                    onClick={() => toggleJoin(event.id)}
                  >
                    {joined ? "Joined" : "Join"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-border bg-card p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-foreground">Players to follow</h3>
          <div className="mt-3 flex flex-col gap-3.5">
            {PEOPLE.map((person) => {
              const following = followingIds.has(person.id);
              return (
                <div key={person.id} className="flex items-center gap-2.5">
                  <Avatar size="sm">
                    <AvatarFallback className="bg-secondary text-[10px] font-semibold text-secondary-foreground">
                      {initialsFrom(person.name)}
                    </AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1 text-xs">
                    <p className="truncate font-semibold text-foreground">{person.name}</p>
                    <p className="truncate text-muted-foreground">{person.handle}</p>
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant={following ? "secondary" : "outline"}
                    className="h-7 shrink-0 px-2.5 text-xs"
                    onClick={() => toggleFollow(person.id)}
                  >
                    {following ? "Following" : "Follow"}
                  </Button>
                </div>
              );
            })}
          </div>
        </div>
      </aside>

      <Dialog open={shareOpen} onOpenChange={setShareOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send it your way.</DialogTitle>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2.5">
            {SHARE_NETWORKS.map((network) => (
              <button
                key={network}
                type="button"
                onClick={() => handleShareChoice(network)}
                className="flex flex-col items-center gap-2 rounded-xl border border-border p-4 text-xs font-medium text-foreground hover:bg-muted"
              >
                {network === "Copy link" ? (
                  <Copy className="size-5" aria-hidden="true" />
                ) : (
                  <span className="text-lg font-bold">{network[0]}</span>
                )}
                {network}
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
