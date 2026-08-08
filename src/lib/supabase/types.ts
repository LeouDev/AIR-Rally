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
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};
