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
  /** Whether this user gets the email copy of their notifications. Never affects the in-app notification itself. */
  email_notifications_enabled: boolean;
  /** Set once, by anonymize_account() (20260810000074), and never cleared — a self-deleted account, never re-activated. Null for every other profile. */
  deleted_at: string | null;
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
export type NotificationType =
  | "booking_confirmed"
  | "booking_received"
  | "booking_cancelled"
  | "reschedule_completed"
  | "review_received"
  // Ranked (20260810000067). The `notifications.type` column has no CHECK
  // constraint by design, so these needed no schema change of their own —
  // but they do need a route in lib/notificationRoutes.ts.
  | "ranked_match_found"
  | "ranked_officiating_confirmed"
  | "ranked_result_submitted"
  | "ranked_result_confirmed"
  | "ranked_result_disputed"
  | "ranked_dispute_resolved"
  | "ranked_rank_up"
  | "ranked_rank_down"
  | "ranked_pip_gained"
  | "ranked_pip_lost"
  | "ranked_star_protected"
  | "ranked_calibration_complete";

export type Notification = {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  message: string;
  read_at: string | null;
  /** In-app path this points at. Null falls back to a type-based route — see lib/notificationRoutes.ts. */
  link_url: string | null;
  created_at: string;
};

/**
 * Row shape of `device_push_tokens` (see
 * supabase/migrations/20260810000066_device_push_tokens.sql). One row per
 * mobile device holding an Expo push token; written exclusively through
 * the register_push_token()/unregister_push_token() RPCs.
 */
export type DevicePushToken = {
  id: string;
  user_id: string;
  token: string;
  platform: "ios" | "android";
  created_at: string;
  updated_at: string;
};

/* ---------------------------------------------------------------------------
 * AIR/Rally Ranked (supabase/migrations/20260810000067_air_rally_ranked.sql)
 *
 * Every table below is read-only to clients — `never` for both Insert and
 * Update. Ranked results are cross-user writes (four ratings move at once),
 * so they go through the SECURITY DEFINER RPCs declared in Functions.
 * ------------------------------------------------------------------------- */

/**
 * 1–7, low to high. Names live in lib/ranked.ts (RANK_THRESHOLDS,
 * re-exported from lib/rating.ts), not in the database. Was 1–8 through
 * the first Ranked build; Rally Legend (8) was retired when the rating
 * engine moved to the DUPR-inspired ladder in
 * 20260810000068_dupr_rating_engine.sql — see that migration's header.
 */
export type RankedTier = 1 | 2 | 3 | 4 | 5 | 6 | 7;
/**
 * 1–5, the star within a tier — 1-indexed, never 0. Under the DUPR-era
 * stateless derivation (ranked_rank_for_aar()) every rating lands
 * somewhere within a tier's five stars; there's no "zero stars, just
 * demoted" floor state the way the original win/loss pip ratchet had
 * one. Displayed as the sub-rank numeral I–V.
 */
export type RankedPips = 1 | 2 | 3 | 4 | 5;
export type RankedMatchType = "singles" | "doubles";
/** `player_ranks.mode` reuses this — a player's rating is tracked once per mode, independently. */
export type RankedMode = RankedMatchType;
export type RankedMatchWeightType = "self_reported_rec" | "club" | "league" | "tournament" | "air_rally_ranked";
export type RankedTeam = "a" | "b";
export type RankedMatchStatus =
  | "lobby"
  | "officiating"
  | "live"
  | "awaiting_confirmation"
  | "confirmed"
  | "disputed"
  | "cancelled";
/** A non-playing fifth person, or one of the players keeping score. */
export type RankedOfficiatingMode = "referee" | "player_scorekeeper";
export type RankedResultResponse = "pending" | "accepted" | "disputed";

export type RankedSeason = {
  id: number;
  name: string;
  started_at: string;
  ended_at: string | null;
  created_at: string;
};

export type PlayerRank = {
  season_id: number;
  user_id: string;
  /** Which of a player's two independent ratings this row is — singles and doubles never cross-pollinate. Part of the primary key (season_id, user_id, mode). */
  mode: RankedMode;
  /** DUPR-inspired AAR. Meaningful from day one, but hidden from the player until `is_calibrated`. Starts at 1000. */
  rating: number;
  /** Stateless — derived from `rating` by ranked_rank_for_aar() every time it changes, never independently incremented. */
  tier: RankedTier;
  pips: RankedPips;
  /**
   * 0-100 confidence in `rating`, NOT a measure of skill — see
   * ranked_reliability() in 20260810000068_dupr_rating_engine.sql. AAR
   * 1700 at reliability 25% means "we think ~1700 but need more
   * evidence"; the same 1700 at reliability 92% means "strong evidence
   * that's accurate." Grows with match volume, decays with inactivity.
   */
  reliability: number;
  /** 0-100, admin-review signal only — never an automatic penalty. See apply_ranked_result()'s sandbag-score update. */
  sandbag_risk_score: number;
  /** Read at the start of a player's next match to gauge how long they've been away; written at the end of every one of their confirmed matches. */
  last_match_at: string | null;
  /**
   * Retired as a rating mechanic once rank/star became a stateless
   * function of `rating` — there's no discrete "pip" left to protect.
   * Column stays populated (always false/0 on any row this engine
   * writes) purely so old confirmed-match history that already rendered
   * `ranked_match_players.star_protected` keeps reading correctly.
   */
  in_promotion_series: boolean;
  star_protection: number;
  calibration_matches: number;
  is_calibrated: boolean;
  wins: number;
  losses: number;
  /** Positive on a win streak, negative on a losing one — tracks the literal match result, not the performance gap. */
  current_streak: number;
  best_streak: number;
  best_tier: RankedTier | null;
  best_pips: RankedPips | null;
  created_at: string;
  updated_at: string;
};

export type RankedMatch = {
  id: string;
  season_id: number;
  /** The Open Play session this was struck inside, when there was one. */
  event_id: string | null;
  court_id: string | null;
  venue_id: string | null;
  match_type: RankedMatchType;
  /** How much this match counts toward rating (ranked_match_weight()). Every match created through create_ranked_match() today is air_rally_ranked — the other four values are for a self-report/club/league/tournament entry point that doesn't exist yet. */
  match_weight_type: RankedMatchWeightType;
  status: RankedMatchStatus;
  officiating_mode: RankedOfficiatingMode | null;
  /** Whoever holds the scoreboard, under either mode. */
  scorekeeper_id: string | null;
  target_score: number;
  win_by: number;
  score_a: number;
  score_b: number;
  serving_team: RankedTeam;
  winning_team: RankedTeam | null;
  /** True once ratings have moved. The database's own double-apply guard. */
  rank_applied: boolean;
  dispute_reason: string | null;
  created_by: string;
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  confirmed_at: string | null;
  updated_at: string;
};

export type RankedMatchPlayer = {
  match_id: string;
  user_id: string;
  team: RankedTeam;
  is_host: boolean;
  /** Denormalized from the match at creation time — which of the player's two ratings this row moves. Null only on a row created before the DUPR-era migration shipped. */
  mode: RankedMode | null;
  ready: boolean;
  ready_at: string | null;
  /** Null means "hasn't answered", which is not the same as voting no. */
  officiating_vote: boolean | null;
  result_response: RankedResultResponse;
  dispute_reason: string | null;
  /** All null until the match is confirmed; frozen at that moment thereafter. */
  rating_before: number | null;
  rating_after: number | null;
  rating_delta: number | null;
  /** Null for a match played during calibration — there was no visible ladder to move. */
  tier_before: RankedTier | null;
  pips_before: RankedPips | null;
  tier_after: RankedTier | null;
  pips_after: RankedPips | null;
  pip_delta: number | null;
  /** Retired — see PlayerRank.star_protection. Never true on a row this engine writes; kept for old confirmed-match history. */
  star_protected: boolean;
  /** The full "why did my rating change" breakdown (DUPR-rewrite migration §17) — null until confirmation, same as the columns above. */
  expected_score: number | null;
  /** The point SHARE this player's team actually won (e.g. 9/20 = 0.45 for an 11-9 game) — not the raw score, and not a binary win/loss. */
  actual_score: number | null;
  performance_gap: number | null;
  match_weight: number | null;
  recency_multiplier: number | null;
  reliability_modifier: number | null;
  created_at: string;
};

export type RankedMatchPoint = {
  match_id: string;
  seq: number;
  team: RankedTeam;
  recorded_by: string;
  recorded_at: string;
};

/** Calibrated players only — an unplaced player has no position to show. One leaderboard per mode; `position` is ranked within (season_id, mode). */
export type RankedLeaderboardRow = {
  season_id: number;
  mode: RankedMode;
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
  rating: number;
  tier: RankedTier;
  pips: RankedPips;
  wins: number;
  losses: number;
  reliability: number;
  position: number;
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
  /**
   * All three null for applications submitted before the Venue Owner
   * Agreement acknowledgement step existed (migration
   * 20260810000064_owner_agreement_acceptance.sql) — never backfilled.
   * Non-null on every new submission: the INSERT policy's WITH CHECK
   * enforces it at the database layer, not just in application code.
   */
  agreement_accepted_at: string | null;
  agreement_version: string | null;
  has_liability_insurance: boolean | null;
  /**
   * Payout destination captured at application time (migration
   * 20260810000090), carried forward into venue_payment_accounts by the
   * mirror trigger when the approved owner creates a venue. All three
   * together or all null — the database rejects a half-filled set.
   *
   * PII. Nullable only because existing rows predate the requirement; the
   * submit and approve paths both require them. NEVER select these in a
   * LIST — use `bank_details_complete`, which exists precisely so a list
   * can know the details are present without receiving the account number.
   */
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  /** Generated in Postgres from `bank_name is not null`. Read-only. */
  bank_details_complete: boolean;
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
  /** Set to embed a joinable match card — "share this game" into COURT/Side. */
  event_id: string | null;
  /** Set to scope this post to one club's own feed — see club_role_of() RLS. */
  club_id: string | null;
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
  /** The admin who made a manual adjustment. Null for system rows (booking payments, cancellation compensation) and every row predating migration 20260810000057. */
  actor_id: string | null;
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
  /**
   * The payout destination (migration 20260810000053). All three together
   * or all null — the database rejects a half-filled destination. Only the
   * owning venue and admins can read these; only the owner can write them.
   */
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_details_updated_at: string | null;
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

/**
 * Where AIR/Rally sends a venue's earnings. These three fields map exactly
 * onto the first three columns of PayMongo's PESONet transfer template.
 * All three or none — a half-filled destination is rejected by the
 * database, because it looks configured and fails at upload.
 */
export type VenueBankDetails = {
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_details_updated_at: string | null;
};

export type ReportTargetType = "post" | "comment" | "club" | "event" | "user";
export type ReportReason =
  | "spam"
  | "harassment"
  | "hate_speech"
  | "sexual_content"
  | "violence"
  | "misinformation"
  | "impersonation"
  | "other";
export type ReportStatus = "open" | "reviewed" | "dismissed";

export type Report = {
  id: string;
  reporter_id: string;
  target_type: ReportTargetType;
  /**
   * Points at one of five tables depending on `target_type`, so it carries
   * no foreign key. That is deliberate: a report has to survive the
   * deletion of what it describes, or removing an abusive post would erase
   * the moderation record along with it.
   */
  target_id: string;
  reason: ReportReason;
  details: string | null;
  status: ReportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type SupportCategory = "booking" | "payment" | "account" | "venue" | "safety" | "bug" | "other";
export type SupportStatus = "open" | "in_progress" | "resolved" | "closed";

export type SupportRequest = {
  id: string;
  user_id: string;
  category: SupportCategory;
  subject: string;
  message: string;
  status: SupportStatus;
  resolved_by: string | null;
  resolved_at: string | null;
  /** The admin's single reply (20260810000088) — required when status is resolved/closed, null otherwise. */
  resolution_note: string | null;
  created_at: string;
  updated_at: string;
};

export type EventType = "open_play" | "club_meetup" | "training" | "tournament";
export type EventStatus = "draft" | "published" | "cancelled" | "completed";
export type EventAttendeeStatus = "pending_approval" | "joined" | "waitlisted" | "cancelled";

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
  /**
   * PayMongo's processing fee, passed on to the customer on top of
   * price_amount, in integer minor units. Computed server-side at checkout
   * by lib/services/bookingFee.ts from the POST-credit amount and written
   * only through set_booking_processing_fee(); never client-supplied.
   * confirm_paymongo_booking_payment() adds this to the amount it expects,
   * so it is guarded by prevent_booking_tampering(). 0 for every booking
   * made before the fee was passed on, and whenever the gate is off.
   */
  processing_fee_amount: number;
  /** Set by the booking's own owner while attaching a freshly-created PayMongo Checkout Session — same posture as stripe_checkout_session_id. */
  paymongo_checkout_session_id: string | null;
  /** Set only by confirm_paymongo_booking_payment() (SECURITY DEFINER) once PayMongo payment is verified — never client-writable. */
  paymongo_payment_intent_id: string | null;
  /**
   * PayMongo Platforms marketplace split (see ARCHITECTURE.md's PayMongo
   * Platforms section). Immutable snapshot computed once, server-side, at
   * checkout-session-creation time — never from a post-processing-fee
   * amount, never recalculated. Null for bookings that predate the
   * marketplace split or that use the non-split payment path (Stripe, or
   * a PayMongo venue that isn't onboarded yet).
   *
   * Written ONLY by set_booking_marketplace_split() — all three columns are
   * guarded by prevent_booking_tampering() and a plain update silently
   * reverts, even as service_role. See migration 20260810000056.
   *
   * The two sum to the amount PayMongo was asked to COLLECT, which equals
   * price_amount on a straightforward booking but not always: credit-funded
   * checkout splits price_amount minus the credit applied, and a reschedule
   * difference splits only the difference while attaching the snapshot to a
   * replacement booking priced at the full new price.
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
      // never for Insert/Update — writes go through register_push_token();
      // clients can only select and delete their own rows.
      device_push_tokens: TableDef<DevicePushToken, never, never>;
      owner_applications: TableDef<
        OwnerApplication,
        Pick<
          OwnerApplication,
          | "user_id"
          | "business_name"
          | "business_phone"
          | "business_email"
          | "venue_name"
          | "venue_address"
          | "venue_city"
          | "court_count"
          | "agreement_accepted_at"
          | "agreement_version"
          | "has_liability_insurance"
          // Required at the type layer even though the columns are nullable
          // in Postgres: the columns stay nullable only because existing
          // rows predate the requirement (see migration 20260810000090),
          // while every NEW application must carry a payout destination.
          | "bank_name"
          | "bank_account_name"
          | "bank_account_number"
        > &
          Partial<
            Omit<
              OwnerApplication,
              | "id"
              | "user_id"
              | "business_name"
              | "business_phone"
              | "business_email"
              | "venue_name"
              | "venue_address"
              | "venue_city"
              | "court_count"
              | "agreement_accepted_at"
              | "agreement_version"
              | "has_liability_insurance"
              | "bank_name"
              | "bank_account_name"
              | "bank_account_number"
              // Generated column — Postgres rejects any write to it.
              | "bank_details_complete"
              | "created_at"
              | "updated_at"
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
      /**
       * Insert stays `never` — rows are created for every venue by the
       * mirroring trigger. Update is narrowed to exactly the four columns
       * the database GRANTs to `authenticated` (migration 20260810000053),
       * so the type mirrors the privilege: status, verified_at and the
       * PayMongo id are not expressible here, and are reverted by the
       * guard trigger even if they were.
       */
      venue_payment_accounts: TableDef<
        VenuePaymentAccount,
        never,
        Partial<Pick<VenuePaymentAccount, "bank_name" | "bank_account_name" | "bank_account_number" | "bank_details_updated_at">>
      >;
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
      reports: TableDef<
        Report,
        Pick<Report, "reporter_id" | "target_type" | "target_id" | "reason"> & Partial<Pick<Report, "details">>,
        // Only the resolution fields are updatable, and only by an admin
        // (the reports UPDATE policy requires is_admin()). Nothing else
        // about a filed report should ever change.
        Partial<Pick<Report, "status" | "resolved_by" | "resolved_at" | "resolution_note">>
      >;
      support_requests: TableDef<
        SupportRequest,
        Pick<SupportRequest, "user_id" | "category" | "subject" | "message">,
        Partial<Pick<SupportRequest, "status" | "resolved_by" | "resolved_at" | "resolution_note">>
      >;
      // Ranked: read-only to every client role. See the block comment above
      // RankedTier for why, and the RPCs below for the write surface.
      ranked_seasons: TableDef<RankedSeason, never, never>;
      player_ranks: TableDef<PlayerRank, never, never>;
      ranked_matches: TableDef<RankedMatch, never, never>;
      ranked_match_players: TableDef<RankedMatchPlayer, never, never>;
      ranked_match_points: TableDef<RankedMatchPoint, never, never>;
      ranked_leaderboard: TableDef<RankedLeaderboardRow, never, never>;
    };
    Views: Record<string, never>;
    Functions: {
      register_push_token: {
        Args: { p_token: string; p_platform: "ios" | "android" };
        Returns: undefined;
      };
      unregister_push_token: {
        Args: { p_token: string };
        Returns: undefined;
      };
      court_side_feed: {
        Args: { p_limit?: number; p_cursor?: string };
        Returns: (Post & { effective_at: string; resharer_id: string | null })[];
      };
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
      /**
       * Records the PayMongo processing fee passed on to the customer.
       * service_role only — confirm_paymongo_booking_payment() trusts
       * processing_fee_amount, so this cannot be client-reachable. Returns
       * false if the booking isn't pending or the fee exceeds its price.
       */
      set_booking_processing_fee: {
        Args: {
          p_booking_id: string;
          p_amount: number;
        };
        Returns: boolean;
      };
      /**
       * Records the PayMongo marketplace split snapshot. service_role only —
       * all three columns are guarded by prevent_booking_tampering(), which
       * reverts silently, so this is the ONLY path that can write them (a
       * plain update, even as service_role, is a no-op). Returns false if the
       * booking isn't pending or the split exceeds its price.
       */
      set_booking_marketplace_split: {
        Args: {
          p_booking_id: string;
          p_platform_fee_amount: number;
          p_venue_amount: number;
          p_paymongo_venue_account_id: string;
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
      /** Admin-only manual credit adjustment — is_admin() checked inside the function, not by the grant. See migration 20260810000057. */
      admin_adjust_credit: {
        Args: {
          p_user_id: string;
          p_amount: number;
          p_reason: string;
        };
        Returns: number;
      };
      /** Total unspent credit across all wallets — the outstanding liability. Admin-only. */
      admin_total_outstanding_credit: {
        Args: Record<string, never>;
        Returns: number;
      };
      /** One user's credit ledger, newest first. Admin-only. */
      admin_list_credit_transactions: {
        Args: {
          p_user_id: string;
          p_limit?: number;
        };
        Returns: CreditTransaction[];
      };
      apply_credit_to_booking: {
        Args: {
          p_booking_id: string;
          p_user_id: string;
          p_amount: number;
        };
        Returns: number;
      };
      /**
       * Notifies specific players that the organiser wants them in a game.
       * Creator-only (checked inside), capped at 20 per call, one invite
       * per player per event. Returns how many were newly invited.
       */
      invite_event_players: {
        Args: { p_event_id: string; p_user_ids: string[] };
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
      /**
       * Cancels every `pending` booking older than p_older_than_minutes,
       * releasing its exclusion-constraint hold on the court/time slot.
       * service_role-only. Called by a pg_cron job, not application code —
       * see supabase/migrations/20260810000062_expire_stale_pending_bookings.sql.
       * Returns the ids it cancelled.
       */
      expire_stale_pending_bookings: {
        Args: {
          p_older_than_minutes: number;
        };
        Returns: string[];
      };
      /**
       * Cancels one specific pending booking, after the app layer has
       * already verified against PayMongo's own API that no non-failed
       * payment attempt exists for it. service_role-only. Called by
       * src/app/api/cron/expire-stale-paymongo-bookings/route.ts — see
       * supabase/migrations/20260810000065_paymongo_aware_expiry_sweep.sql.
       * Returns false if the booking wasn't pending (already handled).
       */
      expire_specific_pending_booking: {
        Args: {
          p_booking_id: string;
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
      /** Anonymizes a profile's PII in place — never deletes the row. See lib/services/accountDeletion.ts and supabase/migrations/20260810000074_account_deletion.sql. service_role-only. */
      anonymize_account: {
        Args: {
          p_user_id: string;
        };
        Returns: undefined;
      };

      /* --- Ranked -------------------------------------------------------
       * The mobile app calls these directly over PostgREST with the
       * player's own JWT; the web app reaches them through
       * lib/services/ranked.ts. There is no other write path — the tables
       * themselves have no client insert/update policy.
       * ----------------------------------------------------------------- */

      /** The open season's id, or null between seasons. */
      current_ranked_season: {
        Args: Record<string, never>;
        Returns: number | null;
      };
      /** Idempotent. Creates the caller's standing for the open season, in the given mode, if they have none yet. */
      ensure_my_player_rank: {
        Args: { p_mode: RankedMode };
        Returns: undefined;
      };
      /** Widest AAR gap among the calibrated players in a proposed party, for the given mode. Ranked parties must stay within 250 AAR of each other. */
      ranked_party_spread: {
        Args: { p_user_ids: string[]; p_mode: RankedMode };
        Returns: number;
      };
      /** Returns the new match's id. The caller must be one of the players. */
      create_ranked_match: {
        Args: {
          p_match_type: RankedMatchType;
          p_team_a: string[];
          p_team_b: string[];
          p_event_id?: string | null;
          p_court_id?: string | null;
        };
        Returns: string;
      };
      set_ranked_ready: {
        Args: { p_match_id: string; p_ready: boolean };
        Returns: undefined;
      };
      /** Proposing resets every vote, including the proposer's. */
      propose_ranked_officiating: {
        Args: { p_match_id: string; p_mode: RankedOfficiatingMode; p_scorekeeper_id: string };
        Returns: undefined;
      };
      /** Unanimity starts the match; one abstention or objection holds it. */
      vote_ranked_officiating: {
        Args: { p_match_id: string; p_approve: boolean };
        Returns: undefined;
      };
      /** Scorekeeper only. */
      record_ranked_point: {
        Args: { p_match_id: string; p_team: RankedTeam };
        Returns: undefined;
      };
      /** Scorekeeper only. A no-op at 0–0 rather than an error. */
      undo_ranked_point: {
        Args: { p_match_id: string };
        Returns: undefined;
      };
      /** Scorekeeper only. Rejects a score that isn't a finished game. */
      submit_ranked_result: {
        Args: { p_match_id: string };
        Returns: undefined;
      };
      /** A dispute is absorbing: nothing is applied, and no later acceptance reverses it. */
      respond_ranked_result: {
        Args: { p_match_id: string; p_accept: boolean; p_reason?: string | null };
        Returns: undefined;
      };
      cancel_ranked_match: {
        Args: { p_match_id: string };
        Returns: undefined;
      };
      /** Admin only — the sole way out of `disputed`. */
      resolve_ranked_dispute: {
        Args: {
          p_match_id: string;
          p_uphold: boolean;
          p_score_a?: number | null;
          p_score_b?: number | null;
        };
        Returns: undefined;
      };
    };
  };
};
