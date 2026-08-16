/**
 * @jest-environment node
 */
import { createPostAction, deletePostAction, toggleLikeAction, createCommentAction, deleteCommentAction } from "../posts";
import { getServerClient } from "../auth";
import { createPost, deletePost, likePost, unlikePost, createComment, deleteComment } from "../../services/posts";

// Relative paths, not the `@/` alias — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({
  getServerClient: jest.fn(),
}));
jest.mock("../../services/posts", () => ({
  createPost: jest.fn(),
  deletePost: jest.fn(),
  likePost: jest.fn(),
  unlikePost: jest.fn(),
  createComment: jest.fn(),
  deleteComment: jest.fn(),
}));
jest.mock("next/cache", () => ({
  revalidatePath: jest.fn(),
}));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreatePost = createPost as jest.MockedFunction<typeof createPost>;
const mockDeletePost = deletePost as jest.MockedFunction<typeof deletePost>;
const mockLikePost = likePost as jest.MockedFunction<typeof likePost>;
const mockUnlikePost = unlikePost as jest.MockedFunction<typeof unlikePost>;
const mockCreateComment = createComment as jest.MockedFunction<typeof createComment>;
const mockDeleteComment = deleteComment as jest.MockedFunction<typeof deleteComment>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCreatePost.mockReset();
  mockDeletePost.mockReset();
  mockLikePost.mockReset();
  mockUnlikePost.mockReset();
  mockCreateComment.mockReset();
  mockDeleteComment.mockReset();
});

describe("createPostAction", () => {
  it("rejects an unauthenticated caller without touching the database", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createPostAction({ content: "hi" });
    expect(result).toEqual({ success: false, error: "Sign in to post on COURT/Side." });
    expect(mockCreatePost).not.toHaveBeenCalled();
  });

  it("rejects empty content before ever reaching the service", async () => {
    const result = await createPostAction({ content: "" });
    expect(result.success).toBe(false);
    expect(mockCreatePost).not.toHaveBeenCalled();
  });

  it("creates a post as the authenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreatePost.mockResolvedValue({
      id: "post-1",
      user_id: "user-1",
      content: "hi",
      image_url: null,
      like_count: 0,
      comment_count: 0,
      reshare_count: 0,
      created_at: "now",
      updated_at: "now",
    });

    const result = await createPostAction({ content: "hi" });

    expect(result.success).toBe(true);
    expect(mockCreatePost).toHaveBeenCalledWith(expect.anything(), "user-1", "hi", undefined);
  });
});

describe("toggleLikeAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await toggleLikeAction("post-1", false);
    expect(result).toEqual({ success: false, error: "Sign in to like posts." });
  });

  it("likes when currently unliked", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleLikeAction("post-1", false);
    expect(mockLikePost).toHaveBeenCalledWith(expect.anything(), "user-1", "post-1");
    expect(mockUnlikePost).not.toHaveBeenCalled();
    expect(result).toEqual({ success: true, data: { liked: true } });
  });

  it("unlikes when currently liked", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await toggleLikeAction("post-1", true);
    expect(mockUnlikePost).toHaveBeenCalledWith(expect.anything(), "user-1", "post-1");
    expect(result).toEqual({ success: true, data: { liked: false } });
  });
});

describe("deletePostAction", () => {
  it("rejects an unauthenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await deletePostAction("post-1");
    expect(result.success).toBe(false);
    expect(mockDeletePost).not.toHaveBeenCalled();
  });

  it("deletes for an authenticated caller — RLS is the real gate, not this action", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await deletePostAction("post-1");
    expect(mockDeletePost).toHaveBeenCalledWith(expect.anything(), "post-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});

const POST_UUID = "3fabfd53-6792-4b28-b9b4-8d31e0df5298";

describe("createCommentAction / deleteCommentAction", () => {
  it("rejects an unauthenticated commenter", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await createCommentAction({ postId: POST_UUID, content: "nice" });
    expect(result).toEqual({ success: false, error: "Sign in to comment." });
  });

  it("creates a comment as the authenticated caller", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateComment.mockResolvedValue({ id: "c-1", post_id: POST_UUID, user_id: "user-1", content: "nice", created_at: "now" });
    const result = await createCommentAction({ postId: POST_UUID, content: "nice" });
    expect(result.success).toBe(true);
  });

  it("deletes for an authenticated caller — RLS is the real gate", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    const result = await deleteCommentAction("c-1");
    expect(mockDeleteComment).toHaveBeenCalledWith(expect.anything(), "c-1");
    expect(result).toEqual({ success: true, data: undefined });
  });
});
