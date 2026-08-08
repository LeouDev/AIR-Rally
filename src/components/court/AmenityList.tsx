import {
  Lightbulb,
  DoorOpen,
  SquareParking,
  ShoppingBag,
  GlassWater,
  ShowerHead,
  Armchair,
  Volleyball,
  Fan,
  Coffee,
  Lock,
  Accessibility,
  CircleCheck,
  type LucideIcon,
} from "lucide-react";
import type { Amenity } from "@/types/court";

const ICONS: Record<string, LucideIcon> = {
  Lightbulb,
  DoorOpen,
  SquareParking,
  ShoppingBag,
  GlassWater,
  ShowerHead,
  Armchair,
  Volleyball,
  Fan,
  Coffee,
  Lock,
  Accessibility,
};

type AmenityListProps = {
  amenities: Amenity[];
};

export function AmenityList({ amenities }: AmenityListProps) {
  if (amenities.length === 0) {
    return <p className="text-sm text-muted-foreground">No amenities listed yet.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3">
      {amenities.map((amenity) => {
        const Icon = ICONS[amenity.icon] ?? CircleCheck;
        return (
          <li
            key={amenity.id}
            className="flex items-center gap-2.5 rounded-xl border border-border bg-card px-3 py-2.5 text-sm text-foreground"
          >
            <Icon className="size-4 shrink-0 text-primary" aria-hidden="true" />
            {amenity.label}
          </li>
        );
      })}
    </ul>
  );
}
