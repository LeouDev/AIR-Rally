/**
 * @jest-environment node
 */
import { submitReviewAction, deleteReviewAsAdminAction } from "../review";
import { getServerClient } from "../auth";
import { createReview, deleteReview, ReviewError } from "../../services/reviews";
import type { Review } from "../../supabase/types";

// Relative paths for jest.mock — see MEMORY.md (air-rally-jest-mock-colon-path-bug).
jest.mock("../auth", () => ({ getServerClient: jest.fn() }));
jest.mock("../../services/reviews", () => {
  class ReviewError extends Error {
    reason: string;
    constructor(reason: string, message: string) {
      super(message);
      this.reason = reason;
      this.name = "ReviewError";
    }
  }
  return {
    createReview: jest.fn(),
    deleteReview: jest.fn(),
    ReviewError,
  };
});
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const mockGetServerClient = getServerClient as jest.MockedFunction<typeof getServerClient>;
const mockCreateReview = createReview as jest.MockedFunction<typeof createReview>;
const mockDeleteReview = deleteReview as jest.MockedFunction<typeof deleteReview>;

function fakeClient(user: { id: string } | null) {
  return { auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) } } as never;
}

/** Matches refund.test.ts's own fakeClient — exercises the real requireAdmin() against a stubbed profiles lookup, rather than mocking requireAdmin itself. */
function fakeAdminClient(user: { id: string } | null, role: string | null) {
  return {
    auth: { getUser: jest.fn().mockResolvedValue({ data: { user } }) },
    from: jest.fn(() => ({
      select: jest.fn(() => ({ eq: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: role ? { role } : null, error: role ? null : { message: "not found" } }) })) })),
    })),
  } as never;
}

const validInput = {
  venueId: "3fabfd53-6792-4b28-b9b4-8d31e0df5298",
  bookingId: "6c7c0e1a-1111-4b28-b9b4-8d31e0df5298",
  rating: 5,
};

const REVIEW_ROW = { id: "review-1", rating: 5 } as Review;

beforeEach(() => {
  mockGetServerClient.mockReset();
  mockCreateReview.mockReset();
  mockDeleteReview.mockReset();
});

describe("submitReviewAction", () => {
  it("rejects invalid input before contacting Supabase", async () => {
    const result = await submitReviewAction({ ...validInput, rating: 6 });
    expect(result.success).toBe(false);
    expect(mockGetServerClient).not.toHaveBeenCalled();
  });

  it("requires an authenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient(null) });
    const result = await submitReviewAction(validInput);
    expect(result).toEqual({ success: false, error: "Sign in to write a review." });
    expect(mockCreateReview).not.toHaveBeenCalled();
  });

  it("submits a review for the authenticated user", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateReview.mockResolvedValue(REVIEW_ROW);

    const result = await submitReviewAction(validInput);

    expect(result).toEqual({ success: true, data: REVIEW_ROW });
    expect(mockCreateReview).toHaveBeenCalledWith(expect.anything(), "user-1", validInput);
  });

  it("surfaces a ReviewError's own message directly for an ineligible submission", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateReview.mockRejectedValue(new ReviewError("not_eligible", "You can review a venue after you've played a confirmed booking there."));

    const result = await submitReviewAction(validInput);

    expect(result).toEqual({
      success: false,
      error: "You can review a venue after you've played a confirmed booking there.",
    });
  });

  it("falls back to the generic friendly-error mapper for a non-ReviewError failure", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeClient({ id: "user-1" }) });
    mockCreateReview.mockRejectedValue(new Error("connection reset"));

    const result = await submitReviewAction(validInput);

    expect(result).toEqual({ success: false, error: "We couldn't submit your review." });
  });
});

describe("deleteReviewAsAdminAction", () => {
  it("rejects a non-admin session before ever calling deleteReview", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "user-1" }, "player") });
    const result = await deleteReviewAsAdminAction("review-1", "venue-1");
    expect(result).toEqual({ success: false, error: "This area is admin-only." });
    expect(mockDeleteReview).not.toHaveBeenCalled();
  });

  it("rejects an unauthenticated session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient(null, null) });
    const result = await deleteReviewAsAdminAction("review-1", "venue-1");
    expect(result.success).toBe(false);
    expect(mockDeleteReview).not.toHaveBeenCalled();
  });

  it("deletes the review for an admin session", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockDeleteReview.mockResolvedValue(undefined);

    const result = await deleteReviewAsAdminAction("review-1", "venue-1");

    expect(result).toEqual({ success: true, data: undefined });
    expect(mockDeleteReview).toHaveBeenCalledWith(expect.anything(), "review-1");
  });

  it("falls back to the generic friendly-error mapper when deleteReview throws", async () => {
    mockGetServerClient.mockResolvedValue({ ok: true, client: fakeAdminClient({ id: "admin-1" }, "admin") });
    mockDeleteReview.mockRejectedValue(new Error("connection reset"));

    const result = await deleteReviewAsAdminAction("review-1", "venue-1");

    expect(result).toEqual({ success: false, error: "We couldn't remove that review." });
  });
});
