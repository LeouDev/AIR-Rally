import type { Amenity } from "@/types/court";

export const mockAmenities: Amenity[] = [
  { id: "lighting", label: "Night Lighting", icon: "Lightbulb" },
  { id: "restrooms", label: "Restrooms", icon: "DoorOpen" },
  { id: "parking", label: "Free Parking", icon: "SquareParking" },
  { id: "pro-shop", label: "Pro Shop", icon: "ShoppingBag" },
  { id: "water", label: "Water Station", icon: "GlassWater" },
  { id: "showers", label: "Showers", icon: "ShowerHead" },
  { id: "seating", label: "Spectator Seating", icon: "Armchair" },
  { id: "paddle-rental", label: "Paddle Rental", icon: "Volleyball" },
  { id: "ac", label: "Air Conditioned", icon: "Fan" },
  { id: "cafe", label: "On-site Café", icon: "Coffee" },
  { id: "lockers", label: "Lockers", icon: "Lock" },
  { id: "wheelchair", label: "Wheelchair Accessible", icon: "Accessibility" },
];

export function getAmenitiesByIds(ids: string[]): Amenity[] {
  const byId = new Map(mockAmenities.map((a) => [a.id, a]));
  return ids.map((id) => byId.get(id)).filter((a): a is Amenity => Boolean(a));
}
