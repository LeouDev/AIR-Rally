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
import type { Amenity } from "@/lib/supabase/types";

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
    <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
      {amenities.map((amenity) => {
        const Icon = (amenity.icon && ICONS[amenity.icon]) || CircleCheck;
        return (
          <li key={amenity.id} className="flex items-center gap-2.5 text-[0.9375rem]/[1.375rem] text-foreground">
            {/* The tile carries the surface, so the row itself needs no border
                — a bordered box per amenity turns a plain list into a grid of
                buttons that cannot be pressed. */}
            <span
              aria-hidden="true"
              className="flex size-7 shrink-0 items-center justify-center rounded-md bg-card text-primary"
            >
              <Icon className="size-4" />
            </span>
            {amenity.name}
          </li>
        );
      })}
    </ul>
  );
}
