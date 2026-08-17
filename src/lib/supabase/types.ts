/**
 * Hand-written to match supabase/migrations/*.sql. If you have the Supabase
 * CLI linked to a real project, prefer regenerating this file from the
 * live schema instead of hand-editing it:
 *
 *   npx supabase gen types typescript --linked > src/lib/supabase/types.ts
 */

export type UserRole = "player" | "venue_owner" | "admin";
export type VenueStatus = "draft" | "pending_review" | "active" | "suspended" | "archived";
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

/**
 * Account-level owner approval state (Phase 6), independent of `role`.
 * `role` only ever flips to `venue_owner` at the moment an admin
 * approves the matching `owner_applications` row — see
 * supabase/migrations/20260810000025_owner_approval.sql. `none` is the
 * default for every account; `pending` is the one self-service
 * transition (requestOwnerAccessAction); `approved`/`rejected` are
 * admin-only.
 */
export type OwnerStatus = "none" | "pending" | "approved" | "rejected";

export type Profile = {
  id: string;
  first_name: string | null;
  last_name: string | null;
  display_name: string | null;
  avatar_url: string | null;
  phone: string | null;
  role: UserRole;
  owner_status: OwnerStatus;
  /** Stable per-user code embedded in their shareable referral link — generated unconditionally on signup, never null. */
  referral_code: string;
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
 * Row shape of `notifications` (see
 * supabase/migrations/20260810000024_notifications.sql). Every row is
 * written exclusively by security-definer trigger functions — there is
 * no insert policy for any client role, so `type`/`title`/`message`
 * are never client-writable; the only client mutation is marking a row
 * read (see lib/services/notifications.ts).
 */
export type NotificationType = "booking_confirmed" | "booking_received" | "booking_cancelled" | "reschedule_completed" | "review_received";

export type Notification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  read_at: string | null;
  created_at: string;
};

/**
 * Row shape of `owner_applications` (see
 * supabase/migrations/20260810000025_owner_approval.sql). A lightweight
 * pre-approval application, not a venue draft — a real venue can't exist
 * yet at this point (the applicant isn't `venue_owner` until an admin
 * approves). Only `status`/`reviewed_at`/`reviewed_by` are ever admin-set;
 * every other field is submitted once by the applicant.
 */
export type OwnerApplicationStatus = "pending" | "approved" | "rejected";

export type OwnerApplication = {
  id: string;
  user_id: string;
  business_name: string;
  business_phone: string;
  business_email: string;
  venue_name: string;
  venue_address: string;
  venue_city: string;
  venue_description: string | null;
  court_count: number;
  status: OwnerApplicationStatus;
  reviewed_at: string | null;
  reviewed_by: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * Row shape of `referrals` (see
 * supabase/migrations/20260810000026_referrals.sql). Purely descriptive
 * tracking — never grants role/owner_status/venue permissions by itself.
 * `sent` is reserved for a future phase (anonymous pre-signup link
 * visits) and is never written by this phase's code.
 */
export type ReferralStatus = "sent" | "started" | "completed" | "approved";

export type Referral = {
  id: string;
  referral_code: string;
  referrer_user_id: string;
  referred_user_id: string | null;
  converted_owner_id: string | null;
  status: ReferralStatus;
  created_at: string;
  updated_at: string;
};

/**
 * Phase 7.1: COURT/Side community backend (see
 * supabase/migrations/20260810000027_court_side.sql). `like_count` /
 * `comment_count` are trigger-maintained, same convention as
 * venues.average_rating/review_count.
 */
export type Post = {
  id: string;
  user_id: string;
  content: string;
  image_url: string | null;
  /** Up to 5 storage paths (see posts_image_paths_max_5). Resolve via getPublicImageUrl(). */
  image_paths: string[];
  like_count: number;
  comment_count: number;
  /** Trigger-maintained, same as like_count. */
  reshare_count: number;
  created_at: string;
  updated_at: string;
};

export type PostReshare = {
  post_id: string;
  user_id: string;
  created_at: string;
};

/** Who a post tagged, recorded from the composer's picker at post time. */
export type PostMention = {
  post_id: string;
  user_id: string;
  created_at: string;
};

export type PostLike = {
  post_id: string;
  user_id: string;
  created_at: string;
};

export type PostComment = {
  id: string;
  post_id: string;
  user_id: string;
  content: string;
  created_at: string;
};

export type Follow = {
  follower_id: string;
  following_id: string;
  created_at: string;
};

export type CreditTransactionType =
  | "cancellation_compensation"
  | "admin_adjustment"
  | "promotion_bonus"
  | "booking_payment";

/**
 * AIR/Rally Credits ledger row — immutable. Positive amounts add credit,
 * negative amounts spend it. No client role has INSERT/UPDATE/DELETE;
 * every row comes from issue_credit()/spend_credit() (service_role only).
 */
export type CreditTransaction = {
  id: string;
  user_id: string;
  /** Integer minor units (centavos), never zero. */
  amount: number;
  transaction_type: CreditTransactionType;
  /** Booking id where relevant, otherwise null. */
  reference_id: string | null;
  description: string | null;
  created_at: string;
};

export type UserCreditWallet = {
  id: string;
  user_id: string;
  /** Derived from the ledger by trigger — never client-writable. */
  balance: number;
  created_at: string;
  updated_at: string;
};

/** How a booking's price was funded. Derived from the amounts, never asserted independently. */
export type SettlementSource = "paymongo" | "credit" | "mixed";

/**
 * `settled` is reserved for a future payout step and currently has no
 * writer anywhere in the codebase — see SETTLEMENT-LEDGER.md.
 */
export type SettlementStatus = "pending" | "payable" | "settled" | "reversed" | "on_hold";

/**
 * What a venue is owed for one booking, recorded independently of how the
 * customer paid. Every row is written by database triggers; no client role
 * has INSERT/UPDATE/DELETE. See
 * supabase/migrations/20260810000039_settlement_ledger.sql.
 */
export type BookingSettlement = {
  id: string;
  booking_id: string;
  venue_id: string;
  currency: string;
  /** The booking's full price — the customer's obligation, before funding. */
  gross_booking_amount: number;
  /** Cash actually collected through PayMongo. */
  paymongo_amount: number;
  /** Value settled from the wallet. Real entitlement, NOT cash received now. */
  credit_amount: number;
  platform_fee: number;
  venue_amount: number;
  fee_percent_applied: number;
  settlement_source: SettlementSource;
  settlement_status: SettlementStatus;
  /** Generated: paymongo_amount - venue_amount. Negative = owed more cash than collected. */
  cash_position: number;
  payable_at: string | null;
  settled_at: string | null;
  reversed_at: string | null;
  reversal_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

/** One row per problem found by reconcile_settlements(); empty means sound. */
export type SettlementIssue = {
  issue: string;
  booking_id: string;
  detail: string;
};

/** Whether AIR/Rally will pay a venue — distinct from PayMongo's own activation status. */
export type VenuePaymentAccountStatus = "not_connected" | "pending_verification" | "verified" | "restricted" | "disabled";

/**
 * Venue payout readiness. PayMongo facts are mirrored from venues.paymongo_*
 * by trigger and are never client-writable; only an admin's
 * restrict/disable decision is independently owned. See
 * supabase/migrations/20260810000043_venue_payment_accounts.sql.
 */
export type VenuePaymentAccount = {
  id: string;
  venue_id: string;
  provider: "paymongo";
  paymongo_account_id: string | null;
  status: VenuePaymentAccountStatus;
  status_reason: string | null;
  verified_at: string | null;
  created_at: string;
  updated_at: string;
};

/** An attempt to actually send money. Nothing can execute transfers yet. */
export type PayoutTransferStatus = "pending" | "processing" | "completed" | "failed" | "cancelled";

/**
 * Record of a transfer attempt. Created BEFORE any provider call, so a
 * crash mid-flight leaves a discoverable record rather than a silent
 * possible-payment. `reference_number` is our own idempotency key —
 * PayMongo documents none for transfers. See
 * supabase/migrations/20260810000044_payout_transfers.sql.
 */
export type PayoutTransfer = {
  id: string;
  payout_batch_id: string;
  venue_id: string;
  amount: number;
  currency: string;
  provider: "paymongo";
  reference_number: string;
  /** Null means we cannot prove the request reached the provider. */
  provider_transfer_id: string | null;
  status: PayoutTransferStatus;
  provider_response: unknown | null;
  failure_reason: string | null;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  failed_at: string | null;
};

/** Lifecycle of an internal payout preparation record. */
export type PayoutBatchStatus = "draft" | "reviewing" | "approved" | "processing" | "completed" | "failed" | "cancelled";

/**
 * A group of payable settlements assembled ahead of a payout. Purely
 * internal: nothing in the codebase moves money, and approving a batch does
 * NOT change any settlement_status. `processing` and `completed` are part
 * of the intended lifecycle but are actively refused by the database until
 * a real payout executor exists.
 * See supabase/migrations/20260810000041_payout_batches.sql.
 */
export type PayoutBatch = {
  id: string;
  batch_reference: string;
  status: PayoutBatchStatus;
  /** Derived from the batch's items by trigger. */
  total_amount: number;
  settlement_count: number;
  created_by: string;
  approved_by: string | null;
  notes: string | null;
  created_at: string;
  approved_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type PayoutBatchItem = {
  id: string;
  payout_batch_id: string;
  settlement_id: string;
  venue_id: string;
  /** Forced to equal the settlement's venue_amount by trigger. */
  amount: number;
  created_at: string;
};

export type ClubSkillLevel = "beginner" | "intermediate" | "advanced" | "mixed";
export type ClubType = "social" | "competitive" | "training" | "casual";
export type ClubVisibility = "public" | "approval_required" | "private";
export type ClubStatus = "pending_review" | "active" | "suspended";
export type ClubMemberRole = "owner" | "admin" | "member";
export type ClubMemberStatus = "active" | "pending" | "blocked";

export type Club = {
  id: string;
  owner_id: string;
  name: string;
  description: string | null;
  image_url: string | null;
  location: string | null;
  skill_level: ClubSkillLevel;
  club_type: ClubType;
  visibility: ClubVisibility;
  /** Clubs start as pending_review and are hidden from discovery until an admin approves. */
  status: ClubStatus;
  /** Denormalized, trigger-maintained (active members only) — never client-writable. */
  member_count: number;
  /**
   * Generated column: `name` with non-alphanumerics stripped, so a post's
   * "@CebuWeekendPicklers" can be matched back to this club. Derived by
   * Postgres, never written by the app.
   */
  mention_handle: string | null;
  created_at: string;
  updated_at: string;
};

export type ClubMember = {
  club_id: string;
  user_id: string;
  role: ClubMemberRole;
  status: ClubMemberStatus;
  created_at: string;
};

export type EventType = "open_play" | "club_meetup" | "training" | "tournament";
export type EventStatus = "draft" | "published" | "cancelled" | "completed";
export type EventAttendeeStatus = "joined" | "waitlisted" | "cancelled";

export type CommunityEvent = {
  id: string;
  creator_id: string;
  venue_id: string | null;
  club_id: string | null;
  court_id: string | null;
  /**
   * The single booking holding this event's court. Null when no court is
   * reserved. An event can never give more than one player a booking on
   * the same court/time — see bookings_no_overlap.
   */
  booking_id: string | null;
  title: string;
  description: string | null;
  event_type: EventType;
  skill_level: ClubSkillLevel | null;
  start_time: string;
  end_time: string | null;
  /** Null means unlimited. */
  max_players: number | null;
  /**
   * Integer minor units. DISPLAY ONLY as of Phase 7.8a — collected by the
   * organizer at the venue, never charged online. Online per-seat payment
   * is Phase 7.9.
   */
  price_amount: number;
  currency: string;
  status: EventStatus;
  /** Denormalized, trigger-maintained (seated players only) — never client-writable. */
  participant_count: number;
  created_at: string;
  updated_at: string;
};

export type EventAttendee = {
  event_id: string;
  user_id: string;
  status: EventAttendeeStatus;
  created_at: string;
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
  payment_provider: "stripe" | "paymongo" | "air_rally_credit";
  /** AIR/Rally Credits applied to this booking, in integer minor units. */
  credit_amount_applied: number;
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
  /** Storage path (not a resolved URL) of the venue's first venue-level
   * photo, or null if none uploaded — resolve via getPublicImageUrl(). */
  cover_image_path: string | null;
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
      // never for Insert — no client role has an insert policy; every row
      // comes from a security-definer trigger. Only read_at is updatable.
      notifications: TableDef<Notification, never, Partial<Pick<Notification, "read_at">>>;
      owner_applications: TableDef<
        OwnerApplication,
        Pick<
          OwnerApplication,
          "user_id" | "business_name" | "business_phone" | "business_email" | "venue_name" | "venue_address" | "venue_city" | "court_count"
        > &
          Partial<
            Omit<
              OwnerApplication,
              "id" | "user_id" | "business_name" | "business_phone" | "business_email" | "venue_name" | "venue_address" | "venue_city" | "court_count" | "created_at" | "updated_at"
            >
          >
      >;
      referrals: TableDef<
        Referral,
        Pick<Referral, "referral_code" | "referrer_user_id" | "referred_user_id"> &
          Partial<Omit<Referral, "id" | "referral_code" | "referrer_user_id" | "referred_user_id" | "created_at" | "updated_at">>
      >;
      posts: TableDef<
        Post,
        Pick<Post, "user_id" | "content"> &
          Partial<Omit<Post, "id" | "user_id" | "content" | "like_count" | "comment_count" | "reshare_count" | "created_at" | "updated_at">>
      >;
      post_reshares: TableDef<PostReshare, Pick<PostReshare, "post_id" | "user_id">>;
      post_mentions: TableDef<PostMention, Pick<PostMention, "post_id" | "user_id">>;
      post_likes: TableDef<PostLike, Pick<PostLike, "post_id" | "user_id">>;
      post_comments: TableDef<
        PostComment,
        Pick<PostComment, "post_id" | "user_id" | "content"> & Partial<Omit<PostComment, "id" | "post_id" | "user_id" | "content" | "created_at">>
      >;
      follows: TableDef<Follow, Pick<Follow, "follower_id" | "following_id">>;
      events: TableDef<
        CommunityEvent,
        Pick<CommunityEvent, "creator_id" | "title" | "start_time"> &
          Partial<Omit<CommunityEvent, "id" | "creator_id" | "title" | "start_time" | "participant_count" | "created_at" | "updated_at">>
      >;
      event_attendees: TableDef<
        EventAttendee,
        Pick<EventAttendee, "event_id" | "user_id"> & Partial<Pick<EventAttendee, "status">>
      >;
      user_credit_wallets: TableDef<UserCreditWallet, never, never>;
      credit_transactions: TableDef<CreditTransaction, never, never>;
      /** Read-only to every client role — written only by triggers. */
      booking_settlements: TableDef<BookingSettlement, never, never>;
      /** Read-only to clients — mirrored by trigger, changed via set_venue_payment_account_status(). */
      venue_payment_accounts: TableDef<VenuePaymentAccount, never, never>;
      /** Read-only to clients — written by backend service code only. */
      payout_transfers: TableDef<PayoutTransfer, never, never>;
      /** Created through create_payout_batch(); status moves via the admin RPCs. */
      payout_batches: TableDef<PayoutBatch, never, Partial<Pick<PayoutBatch, "status" | "notes">>>;
      payout_batch_items: TableDef<
        PayoutBatchItem,
        Pick<PayoutBatchItem, "payout_batch_id" | "settlement_id" | "venue_id" | "amount">,
        never
      >;
      clubs: TableDef<
        Club,
        Pick<Club, "owner_id" | "name"> &
          Partial<Omit<Club, "id" | "owner_id" | "name" | "member_count" | "mention_handle" | "created_at" | "updated_at">>
      >;
      club_members: TableDef<
        ClubMember,
        Pick<ClubMember, "club_id" | "user_id"> & Partial<Pick<ClubMember, "role" | "status">>
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
      /** Adds AIR/Rally Credits. service_role-only — see lib/services/credits.ts. Returns the resulting balance. */
      issue_credit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_transaction_type: string;
          p_reference_id?: string | null;
          p_description?: string | null;
        };
        Returns: number;
      };
      /** Spends AIR/Rally Credits under a wallet row lock. service_role-only. Returns the resulting balance. */
      spend_credit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reference_id: string;
          p_description?: string | null;
        };
        Returns: number;
      };
      /**
       * Debits the wallet and records the amount on the booking as one
       * atomic step. service_role-only. Throws if the booking isn't the
       * user's own pending booking, if credit was already applied to it,
       * if the amount exceeds the price, or if the balance is short.
       * Returns the resulting balance.
       */
      apply_credit_to_booking: {
        Args: {
          p_booking_id: string;
          p_user_id: string;
          p_amount: number;
        };
        Returns: number;
      };
      /** Venue payout readiness counts plus settlements blocked by missing setup. Admin-only. */
      venue_payout_readiness: {
        Args: Record<string, never>;
        Returns: {
          venues_ready: number;
          venues_missing_setup: number;
          venues_restricted: number;
          blocked_settlement_amount: number;
          blocked_settlement_count: number;
        }[];
      };
      /** Admin-only. Accepts verified | restricted | disabled; the mirror owns the rest. */
      set_venue_payment_account_status: {
        Args: { p_venue_id: string; p_status: string; p_reason?: string | null };
        Returns: boolean;
      };
      /**
       * Platform cash position for payout decisions. Admin-only (the
       * function enforces it). Returns a single row.
       */
      payout_cash_position: {
        Args: Record<string, never>;
        Returns: {
          available_payable_amount: number;
          credit_funded_exposure: number;
          cash_position_total: number;
          on_hold_amount: number;
          pending_amount: number;
          batched_amount: number;
        }[];
      };
      /** Payable settlements not already committed to a live batch. Admin-only. */
      available_settlements_for_payout: {
        Args: Record<string, never>;
        Returns: BookingSettlement[];
      };
      /**
       * Creates a draft batch from the given settlements, in one
       * transaction. Admin-only; throws if any settlement is ineligible.
       * Returns the new batch id. Moves no money.
       */
      create_payout_batch: {
        Args: { p_settlement_ids: string[]; p_notes?: string | null };
        Returns: string;
      };
      /**
       * draft/reviewing -> approved. Admin-only. Records a decision; does
       * NOT pay anyone and does NOT change any settlement_status.
       */
      approve_payout_batch: {
        Args: { p_batch_id: string };
        Returns: boolean;
      };
      /** Cancels a batch, releasing its settlements back to the candidate pool. Admin-only. */
      cancel_payout_batch: {
        Args: { p_batch_id: string; p_reason?: string | null };
        Returns: boolean;
      };
      /**
       * Ledger integrity check. Returns one row per problem found and
       * nothing when the ledger is sound. Read-only. Admin-visible through
       * the admin reconciliation page; a payout run must pass it before
       * moving money. See SETTLEMENT-LEDGER.md.
       */
      reconcile_settlements: {
        Args: Record<string, never>;
        Returns: SettlementIssue[];
      };
      /**
       * Confirms a booking whose credit covers its full price, with no
       * PayMongo session involved. service_role-only, idempotent. Returns
       * false when the booking isn't fully covered or is already confirmed.
       */
      confirm_credit_only_booking: {
        Args: {
          p_booking_id: string;
          p_user_id: string;
        };
        Returns: boolean;
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
