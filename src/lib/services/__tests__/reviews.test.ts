import { getReviewEligibility, createReview, ReviewError } from "@/lib/services/reviews";
import { createTableMockSupabase } from "@/lib/test-helpers/mockSupabase";
import type { Review } from "@/lib/supabase/types";

const REVIEW_ROW: Review = {
  id: "review-1",
  venue_id: "venue-1",
  user_id: "user-1",
  booking_id: "booking-1",
  rating: 5,
  title: "Great courts",
  comment: "Loved it.",
  created_at: "2026-08-12T00:00:00Z",
  updated_at: "2026-08-12T00:00:00Z",
};

describe("getReviewEligibility", () => {
  it("is ineligible when the venue has no courts at all", async () => {
    const supabase = createTableMockSupabase({ courts: { data: [], error: null } });
    await expect(getReviewEligibility(supabase, "user-1", "venue-1")).resolves.toEqual({ eligible: false, bookingId: null });
  });

  it("is ineligible when the user has no confirmed, past booking at any of the venue's courts", async () => {
    const supabase = createTableMockSupabase({
      courts: { data: [{ id: "court-1" }], error: null },
      bookings: { data: [], error: null },
    });
    await expect(getReviewEligibility(supabase, "user-1", "venue-1")).resolves.toEqual({ eligible: false, bookingId: null });
  });

  it("is eligible and returns the most recent matching booking id", async () => {
    const supabase = createTableMockSupabase({
      courts: { data: [{ id: "court-1" }], error: null },
      bookings: { data: [{ id: "booking-1" }], error: null },
    });
    await expect(getReviewEligibility(supabase, "user-1", "venue-1")).resolves.toEqual({ eligible: true, bookingId: "booking-1" });
  });
});

describe("createReview", () => {
  it("rejects when the caller has no eligible booking at the venue", async () => {
    const supabase = createTableMockSupabase({
      courts: { data: [{ id: "court-1" }], error: null },
      bookings: { data: [], error: null },
    });
    await expect(
      createReview(supabase, "user-1", { venueId: "venue-1", bookingId: "booking-1", rating: 5 })
    ).rejects.toMatchObject({ reason: "not_eligible" } satisfies Partial<ReviewError>);
  });

  it("rejects when the given bookingId doesn't match the eligible booking (a client can't point a review at an arbitrary booking)", async () => {
    const supabase = createTableMockSupabase({
      courts: { data: [{ id: "court-1" }], error: null },
      bookings: { data: [{ id: "booking-1" }], error: null },
    });
    await expect(
      createReview(supabase, "user-1", { venueId: "venue-1", bookingId: "some-other-booking", rating: 5 })
    ).rejects.toMatchObject({ reason: "booking_mismatch" });
  });

  it("inserts the review with the caller's id and the verified booking id when eligible", async () => {
    let insertedPayload: unknown;
    const supabase = createTableMockSupabase({
      courts: { data: [{ id: "court-1" }], error: null },
      bookings: { data: [{ id: "booking-1" }], error: null },
    });
    const originalFrom = (supabase as unknown as { from: jest.Mock }).from;
    (supabase as unknown as { from: jest.Mock }).from = jest.fn((table: string) => {
      if (table !== "reviews") return originalFrom(table);
      return {
        insert: jest.fn((payload: unknown) => {
          insertedPayload = payload;
          return { select: jest.fn(() => ({ single: jest.fn().mockResolvedValue({ data: REVIEW_ROW, error: null }) })) };
        }),
      };
    });

    const result = await createReview(supabase, "user-1", {
      venueId: "venue-1",
      bookingId: "booking-1",
      rating: 5,
      title: "Great courts",
      comment: "Loved it.",
    });

    expect(result).toEqual(REVIEW_ROW);
    expect(insertedPayload).toEqual({
      venue_id: "venue-1",
      user_id: "user-1",
      booking_id: "booking-1",
      rating: 5,
      title: "Great courts",
      comment: "Loved it.",
    });
  });
});
