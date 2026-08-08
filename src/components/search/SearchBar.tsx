"use client";

import { useState } from "react";
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
import { mockLocations } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

const WHEN_OPTIONS = ["Today", "Tomorrow", "This Weekend", "Next Week"];
const PLAYER_OPTIONS = [2, 4, 6, 8];

type SearchBarProps = {
  className?: string;
  variant?: "hero" | "compact";
};

export function SearchBar({ className, variant = "hero" }: SearchBarProps) {
  const router = useRouter();
  const [location, setLocation] = useState(mockLocations[0].city);
  const [when, setWhen] = useState(WHEN_OPTIONS[0]);
  const [players, setPlayers] = useState(PLAYER_OPTIONS[1]);

  function handleSearch() {
    const params = new URLSearchParams({ location, when, players: String(players) });
    router.push(`/explore?${params.toString()}`);
  }

  return (
    <div
      className={cn(
        "flex w-full flex-col gap-2 rounded-2xl border border-border bg-card p-2 shadow-sm sm:flex-row sm:items-center sm:gap-0 sm:rounded-full",
        variant === "hero" && "sm:p-2",
        className
      )}
    >
      <Field
        icon={MapPin}
        label="Where?"
        className="sm:flex-1"
      >
        <Select value={location} onValueChange={setLocation}>
          <SelectTrigger className="h-auto w-full border-none bg-transparent p-0 shadow-none focus-visible:ring-0 [&>svg]:hidden">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {mockLocations.map((loc) => (
              <SelectItem key={loc.id} value={loc.city}>
                {loc.city}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
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
        className="mt-1 h-12 gap-2 rounded-full px-6 text-base sm:mt-0 sm:ml-2"
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
    <div className={cn("flex items-center gap-2.5 px-4 py-2.5 sm:px-5", className)}>
      <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      <div className="flex min-w-0 flex-col">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {children}
      </div>
    </div>
  );
}

function Divider() {
  return <div className="hidden h-8 w-px shrink-0 bg-border sm:block" aria-hidden="true" />;
}
