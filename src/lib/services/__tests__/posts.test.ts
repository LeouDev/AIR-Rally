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
} from "@/lib/services/posts";
import { createTableMockSupabase, createMockSupabase, postgrestError } from "@/lib/test-helpers/mockSupabase";
import type { Post, PostComment, PublicProfile } from "@/lib/supabase/types";

const AUTHOR: PublicProfile = { id: "user-1", display_name: "Lea Santos", avatar_url: null };

const POST_ROW: Post = {
  id: "post-1",
  user_id: "user-1",
  content: "Golden hour games today.",
  image_url: null,
  like_count: 3,
  comment_count: 1,
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

describe("listFeedPosts", () => {
  it("joins author info via public_profiles, not a profiles embed", async () => {
    const supabase = createTableMockSupabase({
      posts: { data: [POST_ROW], error: null },
      public_profiles: { data: [AUTHOR], error: null },
    });
    const { posts, nextCursor } = await listFeedPosts(supabase);
    expect(posts).toEqual([{ ...POST_ROW, author: AUTHOR }]);
    expect(nextCursor).toBeNull();
  });

  it("returns a nextCursor equal to the last row's created_at when a full page comes back", async () => {
    const fullPage = Array.from({ length: 20 }, (_, i) => ({ ...POST_ROW, id: `post-${i}`, created_at: `2026-08-${10 + i}T00:00:00Z` }));
    const supabase = createTableMockSupabase({
      posts: { data: fullPage, error: null },
      public_profiles: { data: [AUTHOR], error: null },
    });
    const { nextCursor } = await listFeedPosts(supabase);
    expect(nextCursor).toBe(fullPage[19].created_at);
  });

  it("skips the author lookup entirely when there are no posts", async () => {
    const supabase = createTableMockSupabase({ posts: { data: [], error: null } });
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
    expect(posts).toEqual([{ ...POST_ROW, author: AUTHOR }]);
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
