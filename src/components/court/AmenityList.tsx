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
import { cn } from "@/lib/utils";
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
  /** The amenities this venue actually has. */
  amenities: Amenity[];
  /**
   * The fixed amenity catalogue — every amenity the product knows about.
   * Anything in here that the venue lacks is rendered dimmed. Omit it and
   * the list falls back to showing only what the venue has.
   */
  catalogue?: Amenity[];
};

/**
 * Shows what a venue has AND what it lacks.
 *
 * A missing shower or missing parking changes whether you book, and the
 * outcome worth avoiding is finding out on arrival. An absence is only
 * information if it is stated; a list of present amenities alone leaves the
 * reader unable to tell "no showers" from "nobody filled this in".
 *
 * Absent amenities are DIMMED, never struck through — a strikethrough reads
 * as "this was removed", which is a claim about history rather than about
 * what is there today.
 *
 * Rendered strictly against the passed catalogue, never a union of the
 * catalogue and whatever the venue happens to carry: a venue row pointing at
 * an amenity outside the known list would otherwise silently widen the grid
 * for that one venue and make the absences inconsistent between pages.
 */
export function AmenityList({ amenities, catalogue }: AmenityListProps) {
  const present = new Set(amenities.map((amenity) => amenity.id));
  const rows = catalogue ?? amenities;

  if (rows.length === 0) {
    return <p className="text-sm text-subtle">No amenities listed yet.</p>;
  }

  return (
    <ul className="grid grid-cols-2 gap-x-3 gap-y-2.5 sm:grid-cols-3">
      {rows.map((amenity) => {
        const Icon = (amenity.icon && ICONS[amenity.icon]) || CircleCheck;
        const has = present.has(amenity.id);
        return (
          <li
            key={amenity.id}
            className={cn(
              "flex items-center gap-2.5 text-[0.9375rem]/[1.375rem]",
              has ? "text-foreground" : "text-placeholder"
            )}
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-md",
                has ? "bg-card text-primary" : "bg-muted text-placeholder"
              )}
            >
              <Icon className="size-4" />
            </span>
            {amenity.name}
            {/* The dimming carries the meaning visually; this carries it for a
                screen reader and in forced-colors mode, where the tone
                difference does not survive. */}
            {!has && <span className="sr-only">not available</span>}
          </li>
        );
      })}
    </ul>
  );
}
