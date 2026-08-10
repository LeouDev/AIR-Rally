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
    };
  };
};
