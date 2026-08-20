import {
  listFeedPosts,
  listPostsByUser,
  createPost,
  deletePost,
  likePost,
  unlikePost,
  listLikedPostIds,
  listCommentsForPost,
  createComment,
  deleteComment,
  resharePost,
  unresharePost,
  recordPostMentions,
} from "@/lib/services/posts";
import { createTableMockSupabase, createMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { Post, PostComment, PublicProfile } from "@/lib/supabase/types";

const AUTHOR: PublicProfile = { id: "user-1", display_name: "Lea Santos", avatar_url: null };

const POST_ROW: Post = {
  id: "post-1",
  user_id: "user-1",
  content: "Golden hour games today.",
  image_url: null,
  image_paths: [],
  like_count: 3,
  comment_count: 1,
  reshare_count: 0,
  event_id: null,
  club_id: null,
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

const RESHARER: PublicProfile = { id: "user-2", display_name: "Miguel Cruz", avatar_url: null };

/** A row as court_side_feed() returns it — a post plus the two ordering fields. */
function feedRow(overrides: Partial<Post> & { effective_at?: string; resharer_id?: string | null } = {}) {
  return {
    ...POST_ROW,
    effective_at: POST_ROW.created_at,
    resharer_id: null,
    ...overrides,
  };
}

describe("listFeedPosts", () => {
  // Reads the court_side_feed() RPC rather than the posts table since
  // migration 20260810000050 — that union is what makes a reshare surface
  // in the feed at all.
  it("joins author info via public_profiles, not a profiles embed", async () => {
    const supabase = createTableMockSupabase(
      { public_profiles: { data: [AUTHOR], error: null } },
      { court_side_feed: { data: [feedRow()], error: null } }
    );
    const { posts, nextCursor } = await listFeedPosts(supabase);
    expect(posts).toEqual([
      { ...POST_ROW, effective_at: POST_ROW.created_at, resharer_id: null, author: AUTHOR, resharer: null, event: null },
    ]);
    expect(nextCursor).toBeNull();
  });

  it("paginates on effective_at, so a reshare's position drives the cursor rather than the post's own age", async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) =>
      feedRow({ id: `post-${i}`, effective_at: `2026-08-${10 + i}T00:00:00Z` })
    );
    const supabase = createTableMockSupabase(
      { public_profiles: { data: [AUTHOR], error: null } },
      { court_side_feed: { data: fullPage, error: null } }
    );
    const { nextCursor } = await listFeedPosts(supabase);
    expect(nextCursor).toBe(fullPage[19].effective_at);
  });

  it("attaches the resharer so the card can say who put it in the feed", async () => {
    const supabase = createTableMockSupabase(
      { public_profiles: { data: [AUTHOR, RESHARER], error: null } },
      { court_side_feed: { data: [feedRow({ resharer_id: RESHARER.id, effective_at: "2026-08-15T00:00:00Z" })], error: null } }
    );
    const { posts } = await listFeedPosts(supabase);
    expect(posts[0].resharer).toEqual(RESHARER);
    // The author is still the original poster — a reshare never reattributes.
    expect(posts[0].author).toEqual(AUTHOR);
  });

  it("leaves resharer null on an original post", async () => {
    const supabase = createTableMockSupabase(
      { public_profiles: { data: [AUTHOR], error: null } },
      { court_side_feed: { data: [feedRow()], error: null } }
    );
    const { posts } = await listFeedPosts(supabase);
    expect(posts[0].resharer).toBeNull();
  });

  it("skips the author lookup entirely when there are no posts", async () => {
    const supabase = createTableMockSupabase({}, { court_side_feed: { data: [], error: null } });
    const { posts } = await listFeedPosts(supabase);
    expect(posts).toEqual([]);
  });
});

describe("listPostsByUser", () => {
  it("scopes the query to one author, joining the same way listFeedPosts does", async () => {
    const supabase = createTableMockSupabase({
      posts: { data: [POST_ROW], error: null },
      public_profiles: { data: [AUTHOR], error: null },
    });
    const { posts } = await listPostsByUser(supabase, "user-1");
    expect(posts).toEqual([{ ...POST_ROW, author: AUTHOR, event: null }]);
  });
});

describe("createPost / deletePost", () => {
  it("inserts with the caller's own user_id", async () => {
    const supabase = createMockSupabase({ data: POST_ROW, error: null });
    const result = await createPost(supabase, "user-1", "Golden hour games today.");
    expect(result).toEqual(POST_ROW);
  });

  it("delete relies on RLS — a mismatched id is a silent no-op, not a thrown error", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(deletePost(supabase, "post-1")).resolves.toBeUndefined();
  });
});

describe("likePost / unlikePost", () => {
  it("is idempotent — a duplicate like (unique violation) does not throw", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23505") });
    await expect(likePost(supabase, "user-1", "post-1")).resolves.toBeUndefined();
  });

  it("propagates a genuine, unrelated database error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("500", "boom") });
    await expect(likePost(supabase, "user-1", "post-1")).rejects.toBeTruthy();
  });

  it("unliking is a plain delete, always resolves", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(unlikePost(supabase, "user-1", "post-1")).resolves.toBeUndefined();
  });
});

describe("listLikedPostIds", () => {
  it("returns an empty array without querying when postIds is empty", async () => {
    const supabase = createMockSupabase({ data: [], error: null });
    await expect(listLikedPostIds(supabase, "user-1", [])).resolves.toEqual([]);
  });

  it("returns the liked subset of the given post ids", async () => {
    const supabase = createMockSupabase({ data: [{ post_id: "post-1" }, { post_id: "post-3" }], error: null });
    await expect(listLikedPostIds(supabase, "user-1", ["post-1", "post-2", "post-3"])).resolves.toEqual(["post-1", "post-3"]);
  });
});

describe("comments", () => {
  const COMMENT_ROW: PostComment = { id: "comment-1", post_id: "post-1", user_id: "user-1", content: "Nice!", created_at: "2026-08-12T00:00:00Z" };

  it("listCommentsForPost joins author info via public_profiles", async () => {
    const supabase = createTableMockSupabase({
      post_comments: { data: [COMMENT_ROW], error: null },
      public_profiles: { data: [AUTHOR], error: null },
    });
    await expect(listCommentsForPost(supabase, "post-1")).resolves.toEqual([{ ...COMMENT_ROW, author: AUTHOR }]);
  });

  it("createComment inserts with the caller's own user_id", async () => {
    const supabase = createMockSupabase({ data: COMMENT_ROW, error: null });
    await expect(createComment(supabase, "user-1", "post-1", "Nice!")).resolves.toEqual(COMMENT_ROW);
  });

  it("deleteComment relies on RLS — a mismatched id is a silent no-op", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(deleteComment(supabase, "comment-1")).resolves.toBeUndefined();
  });
});

describe("resharePost / unresharePost", () => {
  it("is idempotent — resharing twice does not throw", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("23505") });
    await expect(resharePost(supabase, "user-1", "post-1")).resolves.toBeUndefined();
  });

  it("propagates a genuine, unrelated database error", async () => {
    const supabase = createMockSupabase({ data: null, error: postgrestError("42501", "denied") });
    await expect(resharePost(supabase, "user-1", "post-1")).rejects.toBeTruthy();
  });

  it("undoing a reshare is a plain delete", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await expect(unresharePost(supabase, "user-1", "post-1")).resolves.toBeUndefined();
  });
});

describe("recordPostMentions", () => {
  it("does nothing at all when there are no mentions", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await recordPostMentions(supabase, "post-1", "user-1", []);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  // Being notified that you mentioned yourself is noise.
  it("drops a self-mention, and skips the write when that leaves nothing", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await recordPostMentions(supabase, "post-1", "user-1", ["user-1"]);
    expect(supabase.from).not.toHaveBeenCalled();
  });

  it("dedupes repeated mentions of the same person into one row", async () => {
    const supabase = createMockSupabase({ data: null, error: null });
    await recordPostMentions(supabase, "post-1", "user-1", ["user-2", "user-2", "user-3"]);

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { insert: jest.Mock };
    expect(builder.insert).toHaveBeenCalledWith([
      { post_id: "post-1", user_id: "user-2" },
      { post_id: "post-1", user_id: "user-3" },
    ]);
  });
});
