import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Review, ReviewWithAuthor } from "@/lib/supabase/types";

type Client = SupabaseClient<Database>;

/**
 * Joins author display_name/avatar via `public_profiles`, not `profiles`,
 * and as a *separate* query rather than a PostgREST embed
 * (`reviews?select=*,profiles(...)`) — an embed would go through
 * `profiles`' own RLS (own-row-only), which would silently return null
 * for every author who isn't the current viewer. `public_profiles` is the
 * view built for exactly this: the three columns safe to show about any
 * user, not just yourself.
 */
export async function listReviewsByVenue(
  supabase: Client,
  venueId: string,
  limit?: number
): Promise<ReviewWithAuthor[]> {
  let query = supabase.from("reviews").select("*").eq("venue_id", venueId).order("created_at", { ascending: false });
  if (limit) query = query.limit(limit);

  const { data: reviews, error } = await query;
  if (error) throw error;
  if (reviews.length === 0) return [];

  const authorIds = Array.from(new Set(reviews.map((r) => r.user_id)));
  const { data: authors, error: authorsError } = await supabase
    .from("public_profiles")
    .select("*")
    .in("id", authorIds);
  if (authorsError) throw authorsError;

  const authorsById = new Map(authors.map((a) => [a.id, a]));
  return reviews.map((review) => ({ ...review, author: authorsById.get(review.user_id) ?? null }));
}

export type ReviewErrorReason = "not_eligible" | "booking_mismatch";

/**
 * Typed domain error for review-submission failures, same shape as
 * BookingError/PaymentError — `message` is already user-safe.
 */
export class ReviewError extends Error {
  constructor(
    public reason: ReviewErrorReason,
    message: string
  ) {
    super(message);
    this.name = "ReviewError";
  }
}

/**
 * "Eligible to review this venue" means: the caller has at least one of
 * their own bookings, at a court belonging to this venue, whose status is
 * `confirmed` (the payment-verified state — see ARCHITECTURE.md's Phase 4B
 * webhook-is-authoritative section, there is no separate "was it paid"
 * check to invent) and whose `end_time` has already passed. Two separate
 * queries (courts, then bookings) rather than a `courts!inner(...)`
 * PostgREST embed, deliberately — an embed would apply `courts`' own RLS
 * to the join, which would silently drop a real past booking from
 * eligibility if that court has since gone inactive, even though the
 * booking itself is still perfectly valid. Same reasoning
 * lib/services/bookings.ts#createBooking() already documents for its own
 * courts/venues lookup.
 */
export async function getReviewEligibility(
  supabase: Client,
  userId: string,
  venueId: string
): Promise<{ eligible: boolean; bookingId: string | null }> {
  const { data: courts, error: courtsError } = await supabase.from("courts").select("id").eq("venue_id", venueId);
  if (courtsError) throw courtsError;
  if (!courts || courts.length === 0) return { eligible: false, bookingId: null };

  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .in(
      "court_id",
      courts.map((c) => c.id)
    )
    .lt("end_time", new Date().toISOString())
    .order("end_time", { ascending: false })
    .limit(1);
  if (bookingsError) throw bookingsError;

  const booking = bookings?.[0];
  return booking ? { eligible: true, bookingId: booking.id } : { eligible: false, bookingId: null };
}

export type CreateReviewInput = {
  venueId: string;
  bookingId: string;
  rating: number;
  title?: string;
  comment?: string;
};

/**
 * Never trusts a client-supplied bookingId at face value — re-verifies
 * eligibility server-side (same posture as every other write in this
 * codebase: the client's input shapes the request, live server data
 * decides whether it's allowed) before inserting. `venues.average_rating`/
 * `review_count` update automatically via the existing
 * `update_venue_rating_stats()` trigger (Phase 2) — nothing here
 * recomputes them.
 */
export async function createReview(supabase: Client, userId: string, input: CreateReviewInput): Promise<Review> {
  const eligibility = await getReviewEligibility(supabase, userId, input.venueId);
  if (!eligibility.eligible) {
    throw new ReviewError("not_eligible", "You can review a venue after you've played a confirmed booking there.");
  }
  if (eligibility.bookingId !== input.bookingId) {
    throw new ReviewError("booking_mismatch", "That booking doesn't match an eligible booking for this venue.");
  }

  const { data, error } = await supabase
    .from("reviews")
    .insert({
      venue_id: input.venueId,
      user_id: userId,
      booking_id: input.bookingId,
      rating: input.rating,
      title: input.title || null,
      comment: input.comment || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
