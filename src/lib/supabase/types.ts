/**
 * Hand-written to match supabase/migrations/*.sql. If you have the Supabase
 * CLI linked to a real project, prefer regenerating this file from the
 * live schema instead of hand-editing it:
 *
 *   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
 */

export type UserRole = "player" | "venue_owner" | "admin";
export type VenueStatus = "draft" | "pending_review" | "active" | "suspended";
export type CourtStatus = "active" | "inactive" | "maintenance";
export type IndoorOutdoor = "indoor" | "outdoor" | "both";
export type CourtIndoorOutdoor = "indoor" | "outdoor";
/**
 * 'unlinked' is AIR/Rally's own sentinel (no PayMongo account created
 * yet) — the other four mirror PayMongo's real Platforms account
 * `activation_status` values, confirmed via a real `POST /v2/accounts`
 * response. See ARCHITECTURE.md's PayMongo Platforms section.
 */
export type VenuePaymongoActivationStatus = "unlinked" | "pending" | "under_review" | "activated" | "declined";

export type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: UserRole;
  created_at: string;
  updated_at: string;
};

export type PublicProfile = Pick<Profile, "id" | "display_name" | "avatar_url">;

/** Recorded once per signup via record_agreement_acceptance() — see lib/legal.ts. */
export type AgreementAcceptance = {
  id: string;
  user_id: string;
  agreement_version: string;
  accepted_at: string;
  created_at: string;
};

export type Venue = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  state_province: string | null;
  country: string | null;
  latitude: number | null;
  longitude: number | null;
  phone: string | null;
  email: string | null;
  website: string | null;
  indoor_outdoor: IndoorOutdoor;
  number_of_courts: number;
  average_rating: number;
  review_count: number;
  status: VenueStatus;
  /** IANA identifier (e.g. "Asia/Manila") — never an offset/abbreviation. See ARCHITECTURE.md's Phase 4A timezone strategy. */
  timezone: string;
  /**
   * PayMongo Platforms marketplace linking (see ARCHITECTURE.md's
   * PayMongo Platforms section). Never exposed via venue_marketplace —
   * these are owner/admin-only fields. Written only through
   * sync_venue_paymongo_status() (owner-initiated) and
   * sync_venue_paymongo_activation() (webhook-driven) — never a direct
   * table write, enforced by the venues_prevent_paymongo_tampering trigger.
   */
  paymongo_account_id: string | null;
  paymongo_activation_status: VenuePaymongoActivationStatus;
  paymongo_onboarding_started_at: string | null;
  paymongo_activated_at: string | null;
  paymongo_declined_reason: string | null;
  created_at: string;
  updated_at: string;
};

export type Court = {
  id: string;
  venue_id: string;
  name: string;
  description: string | null;
  surface_type: string | null;
  indoor_outdoor: CourtIndoorOutdoor;
  capacity: number | null;
  hourly_price: number;
  status: CourtStatus;
  created_at: string;
  updated_at: string;
};

export type Amenity = {
  id: string;
  name: string;
  icon: string | null;
  created_at: string;
};

export type VenueAmenity = {
  venue_id: string;
  amenity_id: string;
  created_at: string;
};

export type CourtImage = {
  id: string;
  venue_id: string;
  court_id: string | null;
  storage_path: string;
  alt_text: string | null;
  sort_order: number;
  created_at: string;
};

export type Favorite = {
  user_id: string;
  venue_id: string;
  created_at: string;
};

export type Review = {
  id: string;
  venue_id: string;
  user_id: string;
  booking_id: string | null;
  rating: number;
  title: string | null;
  comment: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Phase 4A: availability + booking engine foundation. No booking UI or
 * payments yet — see ARCHITECTURE.md's Phase 4A section for the full
 * model (timezone strategy, operating hours, blocked periods, the
 * database-level double-booking guarantee, price snapshotting).
 */
export type BookingStatus = "pending" | "confirmed" | "cancelled";

export type VenueOperatingHours = {
  id: string;
  venue_id: string;
  /** 0 = Sunday .. 6 = Saturday, matching Postgres's own extract(dow from ...). */
  day_of_week: number;
  /** Local wall-clock time in the venue's timezone — plain "HH:MM:SS", not an instant. */
  start_time: string;
  end_time: string;
  created_at: string;
  updated_at: string;
};

export type CourtBlockedPeriod = {
  id: string;
  court_id: string;
  start_time: string;
  end_time: string;
  reason: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type Booking = {
  id: string;
  court_id: string;
  user_id: string;
  start_time: string;
  end_time: string;
  status: BookingStatus;
  /** Integer minor units (centavos) — never a float. Snapshotted at creation; never recalculated. */
  price_amount: number;
  currency: string;
  confirmation_code: string;
  cancelled_at: string | null;
  cancelled_by: string | null;
  /**
   * Phase 4B payment reconciliation (see ARCHITECTURE.md). Set by the
   * booking's own owner while attaching a freshly-created Stripe Checkout
   * Session to their still-pending booking — never by anyone else.
   */
  stripe_checkout_session_id: string | null;
  /** Set only by confirm_booking_payment() (SECURITY DEFINER) once Stripe payment is verified — never client-writable. */
  stripe_payment_intent_id: string | null;
  paid_at: string | null;
  /**
   * Experimental second provider (see ARCHITECTURE.md's PayMongo TEST MODE
   * section) — defaults to 'stripe' for every existing/future Stripe-path
   * booking. Never touch stripe_checkout_session_id/stripe_payment_intent_id
   * for a PayMongo booking, or vice versa; the two providers' columns are
   * deliberately separate, never shared.
   */
  payment_provider: "stripe" | "paymongo";
  /** Set by the booking's own owner while attaching a freshly-created PayMongo Checkout Session — same posture as stripe_checkout_session_id. */
  paymongo_checkout_session_id: string | null;
  /** Set only by confirm_paymongo_booking_payment() (SECURITY DEFINER) once PayMongo payment is verified — never client-writable. */
  paymongo_payment_intent_id: string | null;
  /**
   * PayMongo Platforms marketplace split (see ARCHITECTURE.md's PayMongo
   * Platforms section). Immutable snapshot computed once, server-side, at
   * booking creation from price_amount — never from a post-processing-fee
   * amount, never recalculated. Null for bookings that predate the
   * marketplace split or that use the non-split payment path (Stripe, or
   * a PayMongo venue that isn't onboarded yet). platform_fee_amount +
   * venue_amount always sums exactly to price_amount when both are set.
   */
  platform_fee_amount: number | null;
  venue_amount: number | null;
  /** Snapshot of the venue's paymongo_account_id at checkout-session-creation time. */
  paymongo_venue_account_id: string | null;
  /**
   * Purely informational settlement timestamps, persisted opportunistically
   * from a real PayMongo payment retrieval when present (see
   * reconcilePaymongoPendingBooking() in lib/services/bookings.ts) — never
   * required for correctness, never used as a refund-eligibility gate.
   * PayMongo's own live refund-attempt response remains authoritative; see
   * the PayMongo Refund & Cancellation Accounting Design Report.
   */
  paymongo_available_at: string | null;
  paymongo_credited_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RefundStatus = "pending" | "provider_unavailable" | "succeeded" | "failed";

/**
 * Which total a refund was computed against — a snapshot of the business
 * decision made *for this one refund*, never inferred/defaulted by code.
 * See the PayMongo Refund & Cancellation Accounting Design Report for the
 * full A/B/C/D options analysis this exists to eventually support.
 * `gross_only`: refund = booking gross only (customer's processing fee is
 * not refunded) — proven to exactly mirror the original platform/venue
 * split with zero discrepancy. `gross_plus_fee`: refund = the full amount
 * the customer paid, including their processing fee — proven to debit
 * platform/venue proportionally for that fee, in excess of what either
 * party actually received. Null until a real refund has actually
 * recorded a basis; no default is ever silently applied.
 */
export type RefundBasis = "gross_only" | "gross_plus_fee";

/**
 * Audit trail. platform_refund_amount/venue_refund_amount/
 * provider_available_at are populated ONLY from a genuine PayMongo
 * split_refund API response — never computed locally from AIR/Rally's
 * own 5%/95% formula (see supabase/migrations/20260810000014_paymongo_
 * refund_accounting_scaffolding.sql). lib/services/refunds.ts is the
 * only writer.
 */
export type BookingRefund = {
  id: string;
  booking_id: string;
  payment_provider: "stripe" | "paymongo";
  provider_payment_id: string;
  provider_refund_id: string | null;
  amount: number;
  currency: string;
  status: RefundStatus;
  reason: string | null;
  failure_reason: string | null;
  initiated_by: string;
  /** Which total (gross vs. gross+fee) this specific refund was computed against — see RefundBasis. Null until set by a real refund decision. */
  refund_basis: RefundBasis | null;
  /** From the real PayMongo split_refund response's parent-organization leg only — never computed locally. */
  platform_refund_amount: number | null;
  /** From the real PayMongo split_refund response's child-organization leg only — never computed locally. */
  venue_refund_amount: number | null;
  /** From the real PayMongo refund response, when present — the refund's own settlement estimate, distinct from the original payment's. */
  provider_available_at: string | null;
  created_at: string;
  updated_at: string;
};

export type RescheduleStatus = "pending_payment" | "pending_refund" | "completed" | "failed" | "provider_unavailable";

/**
 * Row shape of `booking_reschedules` (see supabase/migrations/20260810000015_
 * booking_reschedules.sql). Connects exactly two bookings — the original
 * (cancelled on completion) and the replacement (confirmed on completion).
 * Every field but status/failure_reason/refund_id is immutable once
 * created; those three only ever change via complete_reschedule()/
 * mark_reschedule_failed() — see lib/services/reschedules.ts.
 */
export type BookingReschedule = {
  id: string;
  original_booking_id: string;
  new_booking_id: string;
  /** Signed: new_booking.price_amount - original_booking.price_amount. */
  price_difference: number;
  status: RescheduleStatus;
  /** Set only once a gross-only refund has actually been attempted for a price-decrease reschedule — never guessed. */
  refund_id: string | null;
  initiated_by: string;
  reason: string | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
};

/** A bookable interval returned by the get_available_slots() RPC. */
export type AvailableSlot = {
  slot_start: string;
  slot_end: string;
};

/**
 * Row shape of the `venue_marketplace` view (see
 * supabase/migrations/20260809000008_marketplace_view.sql) — active
 * venues only, no `owner_id`, plus a computed `starting_price`. This is
 * the type every player-facing query returns; `Venue` (the full table
 * row, including `status`/`owner_id`) is only for owner-facing code.
 */
export type VenueMarketplaceRow = Pick<
  Venue,
  | "id"
  | "name"
  | "description"
  | "address"
  | "city"
  | "state_province"
  | "country"
  | "latitude"
  | "longitude"
  | "phone"
  | "email"
  | "website"
  | "indoor_outdoor"
  | "number_of_courts"
  | "average_rating"
  | "review_count"
  | "created_at"
  | "timezone"
> & {
  starting_price: number | null;
  active_court_count: number;
};

export type VenueDetail = VenueMarketplaceRow & {
  courts: Court[];
  amenities: Amenity[];
  images: CourtImage[];
};

export type ReviewWithAuthor = Review & {
  author: PublicProfile | null;
};

// Matches supabase-js's GenericTable/GenericSchema shape (Row/Insert/Update
// + Relationships, plus Views/Functions on the schema) so the typed client
// (`SupabaseClient<Database>`) resolves `.from(...)` correctly. Relationships
// is left empty — we don't use the typed nested-select join features.
type TableDef<Row, Insert, Update = Partial<Insert>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      profiles: TableDef<
        Profile,
        Pick<Profile, "id"> & Partial<Omit<Profile, "id" | "created_at" | "updated_at">>
      >;
      venues: TableDef<
        Venue,
        Pick<Venue, "owner_id" | "name"> &
          Partial<Omit<Venue, "id" | "owner_id" | "name" | "created_at" | "updated_at" | "average_rating" | "review_count">>
      >;
      courts: TableDef<
        Court,
        Pick<Court, "venue_id" | "name"> &
          Partial<Omit<Court, "id" | "venue_id" | "name" | "created_at" | "updated_at">>
      >;
      amenities: TableDef<Amenity, Pick<Amenity, "name"> & Partial<Omit<Amenity, "id" | "name" | "created_at">>>;
      venue_amenities: TableDef<VenueAmenity, Pick<VenueAmenity, "venue_id" | "amenity_id">>;
      court_images: TableDef<
        CourtImage,
        Pick<CourtImage, "venue_id" | "storage_path"> &
          Partial<Omit<CourtImage, "id" | "venue_id" | "storage_path" | "created_at">>
      >;
      favorites: TableDef<Favorite, Pick<Favorite, "user_id" | "venue_id">>;
      reviews: TableDef<
        Review,
        Pick<Review, "venue_id" | "user_id" | "rating"> &
          Partial<Omit<Review, "id" | "venue_id" | "user_id" | "rating" | "created_at" | "updated_at">>
      >;
      public_profiles: TableDef<PublicProfile, never, never>;
      venue_marketplace: TableDef<VenueMarketplaceRow, never, never>;
      venue_operating_hours: TableDef<
        VenueOperatingHours,
        Pick<VenueOperatingHours, "venue_id" | "day_of_week" | "start_time" | "end_time"> &
          Partial<Omit<VenueOperatingHours, "id" | "venue_id" | "day_of_week" | "start_time" | "end_time" | "created_at" | "updated_at">>
      >;
      court_blocked_periods: TableDef<
        CourtBlockedPeriod,
        Pick<CourtBlockedPeriod, "court_id" | "start_time" | "end_time"> &
          Partial<Omit<CourtBlockedPeriod, "id" | "court_id" | "start_time" | "end_time" | "created_at" | "updated_at">>
      >;
      bookings: TableDef<
        Booking,
        Pick<Booking, "court_id" | "user_id" | "start_time" | "end_time" | "price_amount"> &
          Partial<Omit<Booking, "id" | "court_id" | "user_id" | "start_time" | "end_time" | "price_amount" | "confirmation_code" | "created_at" | "updated_at">>
      >;
      agreement_acceptances: TableDef<AgreementAcceptance, never, never>;
      booking_refunds: TableDef<
        BookingRefund,
        Pick<BookingRefund, "booking_id" | "payment_provider" | "provider_payment_id" | "amount" | "currency" | "initiated_by"> &
          Partial<Omit<BookingRefund, "id" | "booking_id" | "payment_provider" | "provider_payment_id" | "amount" | "currency" | "initiated_by" | "created_at" | "updated_at">>
      >;
      booking_reschedules: TableDef<
        BookingReschedule,
        Pick<BookingReschedule, "original_booking_id" | "new_booking_id" | "price_difference" | "initiated_by"> &
          Partial<Omit<BookingReschedule, "id" | "original_booking_id" | "new_booking_id" | "price_difference" | "initiated_by" | "created_at" | "updated_at">>
      >;
    };
    Views: Record<string, never>;
    Functions: {
      get_available_slots: {
        Args: {
          p_court_id: string;
          p_local_date: string;
          p_duration_minutes?: number;
          p_increment_minutes?: number;
          p_min_lead_minutes?: number;
        };
        Returns: AvailableSlot[];
      };
      is_court_time_bookable: {
        Args: {
          p_court_id: string;
          p_start: string;
          p_end: string;
          p_min_lead_minutes?: number;
          p_max_window_days?: number;
        };
        Returns: boolean;
      };
      confirm_booking_payment: {
        Args: {
          p_booking_id: string;
          p_stripe_checkout_session_id: string;
          p_stripe_payment_intent_id: string;
          p_expected_amount: number;
          p_expected_currency: string;
        };
        Returns: boolean;
      };
      confirm_paymongo_booking_payment: {
        Args: {
          p_booking_id: string;
          p_paymongo_checkout_session_id: string;
          p_paymongo_payment_intent_id: string;
          p_expected_amount: number;
          p_expected_currency: string;
        };
        Returns: boolean;
      };
      /** Owner-initiated, once, right after creating the venue's PayMongo Platforms account. */
      sync_venue_paymongo_status: {
        Args: {
          p_venue_id: string;
          p_paymongo_account_id: string;
          p_activation_status?: VenuePaymongoActivationStatus;
        };
        Returns: boolean;
      };
      /** Webhook-only — looked up purely by paymongo_account_id, no venue_id needed or accepted. */
      sync_venue_paymongo_activation: {
        Args: {
          p_paymongo_account_id: string;
          p_activation_status: VenuePaymongoActivationStatus;
          p_declined_reason?: string | null;
        };
        Returns: boolean;
      };
      /** Called once, right after auth.signUp() returns — see lib/actions/auth.ts. */
      record_agreement_acceptance: {
        Args: {
          p_user_id: string;
          p_agreement_version: string;
        };
        Returns: void;
      };
      /** One-directional 'player' -> 'venue_owner' self-service role grant — see lib/actions/venue.ts and the role/permission audit. Never reaches 'admin', idempotent. */
      request_venue_owner_role: {
        Args: Record<PropertyKey, never>;
        Returns: boolean;
      };
      /** Owner-only per-court day schedule (every candidate slot labeled available/booked/blocked) — see lib/services/ownerAvailability.ts. Returns nothing for a court the caller doesn't own. */
      get_owner_court_schedule: {
        Args: {
          p_court_id: string;
          p_local_date: string;
          p_duration_minutes?: number;
          p_increment_minutes?: number;
        };
        Returns: {
          slot_start: string;
          slot_end: string;
          status: "booked" | "blocked" | "available";
          booking_id: string | null;
          booking_status: string | null;
          customer_name: string | null;
          block_id: string | null;
          block_reason: string | null;
        }[];
      };
      /** Atomically confirms the replacement booking (if not already) + cancels the original + marks the reschedule completed. See lib/services/reschedules.ts. */
      complete_reschedule: {
        Args: {
          p_reschedule_id: string;
          p_refund_id?: string | null;
        };
        Returns: boolean;
      };
      mark_reschedule_failed: {
        Args: {
          p_reschedule_id: string;
          p_status: "failed" | "provider_unavailable";
          p_failure_reason: string;
          p_refund_id?: string | null;
        };
        Returns: boolean;
      };
      /** Durable checkpoint for a decrease reschedule's succeeded refund — see lib/services/reschedules.ts and the production-readiness audit's finding B3. service_role-only, same as complete_reschedule/mark_reschedule_failed. */
      record_reschedule_refund_success: {
        Args: {
          p_reschedule_id: string;
          p_refund_id: string;
        };
        Returns: boolean;
      };
    };
  };
};
