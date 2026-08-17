"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { MapPin, CalendarDays, Users, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { reverseGeocodeCity } from "@/lib/services/geocoding";
import { cn } from "@/lib/utils";

const WHEN_OPTIONS = ["Today", "Tomorrow", "This Weekend", "Next Week"];
const PLAYER_OPTIONS = [2, 4, 6, 8];
const LOCATION_PLACEHOLDER = "City, municipality, or barangay";

type SearchBarProps = {
  className?: string;
  variant?: "hero" | "compact";
};

export function SearchBar({ className, variant = "hero" }: SearchBarProps) {
  const router = useRouter();
  const [location, setLocation] = useState("");
  const [detectedCity, setDetectedCity] = useState<string | null>(null);
  const [when, setWhen] = useState(WHEN_OPTIONS[0]);
  const [players, setPlayers] = useState(PLAYER_OPTIONS[1]);

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;

    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        reverseGeocodeCity(position.coords.latitude, position.coords.longitude).then((city) => {
          if (!cancelled && city) setDetectedCity(city);
        });
      },
      () => {
        // Denied/unavailable — the field just keeps its generic placeholder.
      },
      { timeout: 5000, maximumAge: 300_000 }
    );

    return () => {
      cancelled = true;
    };
  }, []);

  function handleSearch() {
    const effectiveLocation = location.trim() || detectedCity || "";
    const params = new URLSearchParams({ when, players: String(players) });
    if (effectiveLocation) params.set("location", effectiveLocation);
    router.push(`/explore?${params.toString()}`);
  }

  return (
    <div
      className={cn(
        // 16px card radius and the card shadow — no border. The card is white
        // on cream, which already separates it; a border on top of that reads
        // as a second edge.
        "flex w-full flex-col gap-2 rounded-xl bg-card p-1.5 shadow-card sm:flex-row sm:items-center sm:gap-0",
        variant === "hero" && "sm:p-1.5",
        className
      )}
    >
      <Field
        icon={MapPin}
        label="Where?"
        className="sm:flex-1"
      >
        <input
          type="text"
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder={detectedCity ?? LOCATION_PLACEHOLDER}
          aria-label="Where"
          className="w-full min-w-0 border-none bg-transparent p-0 text-[0.9375rem]/5 font-medium text-foreground shadow-none outline-none placeholder:font-normal placeholder:text-placeholder focus-visible:ring-0"
        />
      </Field>

      <Divider />

      <Field icon={CalendarDays} label="When?" className="sm:flex-1">
        <Select value={when} onValueChange={setWhen}>
          <SelectTrigger className="h-auto w-full border-none bg-transparent p-0 shadow-none focus-visible:ring-0 [&>svg]:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {WHEN_OPTIONS.map((opt) => (
              <SelectItem key={opt} value={opt}>
                {opt}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Divider />

      <Field icon={Users} label="Players?" className="sm:flex-1">
        <Select value={String(players)} onValueChange={(v) => setPlayers(Number(v))}>
          <SelectTrigger className="h-auto w-full border-none bg-transparent p-0 shadow-none focus-visible:ring-0 [&>svg]:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAYER_OPTIONS.map((count) => (
              <SelectItem key={count} value={String(count)}>
                {count} players
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </Field>

      <Button
        onClick={handleSearch}
        size="lg"
        className="mt-1 shrink-0 sm:mt-0 sm:ml-1.5"
      >
        <Search className="size-4" />
        Find Courts
      </Button>
    </div>
  );
}

function Field({
  icon: Icon,
  label,
  children,
  className,
}: {
  icon: typeof MapPin;
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-2.5 px-3 py-2.5", className)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="text-[0.6875rem]/[0.875rem] font-semibold tracking-[0.1em] text-muted-foreground uppercase">
          {label}
        </span>
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="hidden h-9 w-px shrink-0 bg-hairline sm:block" aria-hidden="true" />;
}
