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

/**
 * Booking-specific eligibility, unlike getReviewEligibility() above which
 * only ever reports the single *most recent* eligible booking at a venue.
 * That venue-level shape is fine for Court Details ("show the form for my
 * last visit here"), but it's wrong for a My Bookings row: a customer
 * with two completed bookings at the same venue must be able to review
 * the *older* one too, and getReviewEligibility()'s "most recent only"
 * result would reject that. This checks the exact booking instead:
 * belongs to the caller, confirmed, already ended, and not already
 * reviewed (belt-and-suspenders alongside the DB's own unique constraint
 * on reviews.booking_id — see the migration that added it).
 */
export async function canReviewBooking(
  supabase: Client,
  userId: string,
  bookingId: string
): Promise<{ eligible: boolean; venueId: string | null }> {
  const { data: booking, error: bookingError } = await supabase
    .from("bookings")
    .select("user_id, status, end_time, court_id")
    .eq("id", bookingId)
    .maybeSingle();
  if (bookingError) throw bookingError;
  if (!booking || booking.user_id !== userId) return { eligible: false, venueId: null };
  if (booking.status !== "confirmed") return { eligible: false, venueId: null };
  if (new Date(booking.end_time).getTime() >= Date.now()) return { eligible: false, venueId: null };

  const { data: court, error: courtError } = await supabase
    .from("courts")
    .select("venue_id")
    .eq("id", booking.court_id)
    .maybeSingle();
  if (courtError) throw courtError;
  if (!court) return { eligible: false, venueId: null };

  const { data: existingReview, error: reviewError } = await supabase
    .from("reviews")
    .select("id")
    .eq("booking_id", bookingId)
    .maybeSingle();
  if (reviewError) throw reviewError;
  if (existingReview) return { eligible: false, venueId: court.venue_id };

  return { eligible: true, venueId: court.venue_id };
}

export type ReviewableBooking = { bookingId: string; venueId: string };

/**
 * Every one of the caller's own confirmed, already-ended bookings that
 * doesn't have a review yet — what My Bookings uses to decide which rows
 * get a "How was your experience?" prompt. Three batched queries across
 * the whole list (bookings, then their courts, then any existing
 * reviews), not one query per booking.
 */
export async function listReviewableBookings(supabase: Client, userId: string): Promise<ReviewableBooking[]> {
  const { data: bookings, error: bookingsError } = await supabase
    .from("bookings")
    .select("id, court_id")
    .eq("user_id", userId)
    .eq("status", "confirmed")
    .lt("end_time", new Date().toISOString());
  if (bookingsError) throw bookingsError;
  if (!bookings || bookings.length === 0) return [];

  const courtIds = Array.from(new Set(bookings.map((b) => b.court_id)));
  const { data: courts, error: courtsError } = await supabase.from("courts").select("id, venue_id").in("id", courtIds);
  if (courtsError) throw courtsError;
  const venueIdByCourtId = new Map((courts ?? []).map((c) => [c.id, c.venue_id]));

  const { data: existingReviews, error: reviewsError } = await supabase
    .from("reviews")
    .select("booking_id")
    .in(
      "booking_id",
      bookings.map((b) => b.id)
    );
  if (reviewsError) throw reviewsError;
  const reviewedBookingIds = new Set((existingReviews ?? []).map((r) => r.booking_id));

  return bookings
    .filter((b) => !reviewedBookingIds.has(b.id) && venueIdByCourtId.has(b.court_id))
    .map((b) => ({ bookingId: b.id, venueId: venueIdByCourtId.get(b.court_id)! }));
}

/**
 * No ownership check happens here — RLS is the real enforcement (a
 * review's own "delete" policy allows the author or is_admin(), see
 * supabase/migrations/20260809000007_reviews.sql), same posture as every
 * other RLS-backed delete in this codebase. In practice the only caller
 * is the admin moderation action (lib/actions/review.ts), since a
 * reviewer editing/removing their own review isn't a UI this app exposes
 * yet — but the function itself doesn't assume that.
 */
export async function deleteReview(supabase: Client, reviewId: string): Promise<void> {
  const { error } = await supabase.from("reviews").delete().eq("id", reviewId);
  if (error) throw error;
}

export type CreateReviewInput = {
  venueId: string;
  bookingId: string;
  rating: number;
  title?: string;
  comment?: string;
};

/**
 * Never trusts client-supplied input at face value — re-verifies
 * eligibility server-side against the specific bookingId (canReviewBooking,
 * not the venue-level getReviewEligibility — see its doc comment for why)
 * before inserting. `venues.average_rating`/`review_count` update
 * automatically via the existing `update_venue_rating_stats()` trigger
 * (Phase 2) — nothing here recomputes them.
 */
export async function createReview(supabase: Client, userId: string, input: CreateReviewInput): Promise<Review> {
  const eligibility = await canReviewBooking(supabase, userId, input.bookingId);
  if (!eligibility.eligible) {
    throw new ReviewError("not_eligible", "You can review a venue after you've played a confirmed booking there.");
  }
  if (eligibility.venueId !== input.venueId) {
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
