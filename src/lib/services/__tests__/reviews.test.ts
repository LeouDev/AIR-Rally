import { getReviewEligibility, createReview, canReviewBooking, listReviewableBookings, deleteReview, ReviewError } from "@/lib/services/reviews";
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

const PAST_BOOKING_ROW = { user_id: "user-1", status: "confirmed", end_time: "2020-01-01T00:00:00Z", court_id: "court-1" };
const FUTURE_BOOKING_ROW = { user_id: "user-1", status: "confirmed", end_time: "2099-01-01T00:00:00Z", court_id: "court-1" };

describe("canReviewBooking", () => {
  it("is ineligible when the booking doesn't exist", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: null, error: null } });
    await expect(canReviewBooking(supabase, "user-1", "booking-1")).resolves.toEqual({ eligible: false, venueId: null });
  });

  it("is ineligible when the booking belongs to a different user", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: { ...PAST_BOOKING_ROW, user_id: "someone-else" }, error: null },
    });
    await expect(canReviewBooking(supabase, "user-1", "booking-1")).resolves.toEqual({ eligible: false, venueId: null });
  });

  it("is ineligible when the booking isn't confirmed", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: { ...PAST_BOOKING_ROW, status: "pending" }, error: null },
    });
    await expect(canReviewBooking(supabase, "user-1", "booking-1")).resolves.toEqual({ eligible: false, venueId: null });
  });

  it("is ineligible when the booking hasn't happened yet", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: FUTURE_BOOKING_ROW, error: null } });
    await expect(canReviewBooking(supabase, "user-1", "booking-1")).resolves.toEqual({ eligible: false, venueId: null });
  });

  it("is ineligible when this booking already has a review (duplicate prevention)", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: PAST_BOOKING_ROW, error: null },
      courts: { data: { venue_id: "venue-1" }, error: null },
      reviews: { data: { id: "existing-review" }, error: null },
    });
    await expect(canReviewBooking(supabase, "user-1", "booking-1")).resolves.toEqual({ eligible: false, venueId: "venue-1" });
  });

  it("is eligible for the caller's own confirmed, past, not-yet-reviewed booking", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: PAST_BOOKING_ROW, error: null },
      courts: { data: { venue_id: "venue-1" }, error: null },
      reviews: { data: null, error: null },
    });
    await expect(canReviewBooking(supabase, "user-1", "booking-1")).resolves.toEqual({ eligible: true, venueId: "venue-1" });
  });
});

describe("listReviewableBookings", () => {
  it("returns [] when the user has no confirmed, past bookings", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: [], error: null } });
    await expect(listReviewableBookings(supabase, "user-1")).resolves.toEqual([]);
  });

  it("excludes bookings that already have a review", async () => {
    const supabase = createTableMockSupabase({
      bookings: {
        data: [
          { id: "booking-1", court_id: "court-1" },
          { id: "booking-2", court_id: "court-1" },
        ],
        error: null,
      },
      courts: { data: [{ id: "court-1", venue_id: "venue-1" }], error: null },
      reviews: { data: [{ booking_id: "booking-1" }], error: null },
    });
    await expect(listReviewableBookings(supabase, "user-1")).resolves.toEqual([{ bookingId: "booking-2", venueId: "venue-1" }]);
  });
});

describe("deleteReview", () => {
  it("deletes the given review by id (RLS is the actual author/admin gate, not this function)", async () => {
    const supabase = createTableMockSupabase({ reviews: { data: null, error: null } });
    await expect(deleteReview(supabase, "review-1")).resolves.toBeUndefined();

    const fromMock = supabase.from as jest.Mock;
    const builder = fromMock.mock.results[0].value as { delete: jest.Mock };
    expect(builder.delete).toHaveBeenCalled();
  });
});

describe("createReview", () => {
  it("rejects when the caller has no eligible booking (booking not found)", async () => {
    const supabase = createTableMockSupabase({ bookings: { data: null, error: null } });
    await expect(
      createReview(supabase, "user-1", { venueId: "venue-1", bookingId: "booking-1", rating: 5 })
    ).rejects.toMatchObject({ reason: "not_eligible" } satisfies Partial<ReviewError>);
  });

  it("rejects when this booking has already been reviewed", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: PAST_BOOKING_ROW, error: null },
      courts: { data: { venue_id: "venue-1" }, error: null },
      reviews: { data: { id: "existing-review" }, error: null },
    });
    await expect(
      createReview(supabase, "user-1", { venueId: "venue-1", bookingId: "booking-1", rating: 5 })
    ).rejects.toMatchObject({ reason: "not_eligible" } satisfies Partial<ReviewError>);
  });

  it("rejects when the given venueId doesn't match the booking's actual venue (a client can't point a review at an arbitrary venue)", async () => {
    const supabase = createTableMockSupabase({
      bookings: { data: PAST_BOOKING_ROW, error: null },
      courts: { data: { venue_id: "venue-1" }, error: null },
      reviews: { data: null, error: null },
    });
    await expect(
      createReview(supabase, "user-1", { venueId: "some-other-venue", bookingId: "booking-1", rating: 5 })
    ).rejects.toMatchObject({ reason: "booking_mismatch" });
  });

  it("inserts the review with the caller's id and the verified booking id when eligible", async () => {
    let insertedPayload: unknown;
    const supabase = createTableMockSupabase({
      bookings: { data: PAST_BOOKING_ROW, error: null },
      courts: { data: { venue_id: "venue-1" }, error: null },
    });
    const originalFrom = (supabase as unknown as { from: jest.Mock }).from;
    let reviewsCallCount = 0;
    (supabase as unknown as { from: jest.Mock }).from = jest.fn((table: string) => {
      if (table !== "reviews") return originalFrom(table);
      reviewsCallCount += 1;
      if (reviewsCallCount === 1) {
        // canReviewBooking's own "does a review already exist for this booking" check.
        return { select: jest.fn(() => ({ eq: jest.fn(() => ({ maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }) })) })) };
      }
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
