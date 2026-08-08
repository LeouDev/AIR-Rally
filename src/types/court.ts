export type CourtSurfaceColor = "blue" | "green" | "terracotta" | "teal" | "navy" | "sand";

export type CourtImage = {
  /** Deterministic illustrated placeholder — see components/court/CourtSurface.tsx */
  surfaceColor: CourtSurfaceColor;
  indoor: boolean;
};

export type Amenity = {
  id: string;
  label: string;
  /** lucide-react icon name, resolved by <AmenityList /> */
  icon: string;
};

export type TimeSlot = {
  id: string;
  time: string;
  available: boolean;
};

export type DayAvailability = {
  date: string;
  label: string;
  slots: TimeSlot[];
};

export type Review = {
  id: string;
  courtId: string;
  authorName: string;
  authorInitials: string;
  rating: number;
  date: string;
  comment: string;
};

export type Location = {
  id: string;
  city: string;
  region: string;
  courtCount: number;
};

export type CourtType = "indoor" | "outdoor" | "both";

export type Court = {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  city: string;
  area: string;
  address: string;
  rating: number;
  reviewCount: number;
  pricePerHour: number;
  courtType: CourtType;
  numberOfCourts: number;
  surfaceType: string;
  amenityIds: string[];
  images: CourtImage[];
  availability: DayAvailability[];
  featured: boolean;
};
