"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import { Search, MapPin, Share2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverAnchor } from "@/components/ui/popover";
import {
  createVenueRequestAction,
  getVenueRequestSuggestionsAction,
  getMyVenueRequestDemandAction,
} from "@/lib/actions/venueRequests";
import type { VenueRequestSuggestion } from "@/lib/services/venueRequests";
import { toast } from "sonner";

/**
 * The capture surface on /explore's empty state. Two jobs: submit a
 * `venue_requests` row, and hand the player something to share afterward —
 * see /venues/requests/[requestId], the same page the founder shares from
 * the admin view.
 *
 * Autocomplete calls venue_request_place_suggestions() (migration
 * 20260810000106), which deliberately matches only OPEN FREE-TEXT requests,
 * never a draft/pending_review venue's name — see that migration for why
 * exposing an onboarding venue's name to autocomplete would be a real
 * decision made in service of a nice-to-have. Selecting a suggestion is what
 * performs the dedup: two players typing the same suggestion produce one
 * cluster, not two near-identical ones.
 */
export function RequestVenueForm() {
  const [isPending, startTransition] = useTransition();
  const [placeName, setPlaceName] = useState("");
  const [placeCity, setPlaceCity] = useState("");
  const [suggestions, setSuggestions] = useState<VenueRequestSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [submitted, setSubmitted] = useState<{ id: string } | null>(null);
  const [demand, setDemand] = useState<{ requesters: number; showCount: boolean } | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Derived at render time rather than reset via a synchronous setState
  // inside the effect below (React flags that as a cascading-render risk).
  // Below two characters there is nothing to show regardless of what a
  // stale fetch from a moment ago returned.
  const effectiveSuggestions = placeName.trim().length < 2 ? [] : suggestions;

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (placeName.trim().length < 2) return;
    debounceRef.current = setTimeout(async () => {
      const result = await getVenueRequestSuggestionsAction(placeName);
      if (result.success) setSuggestions(result.data);
    }, 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [placeName]);

  function pickSuggestion(s: VenueRequestSuggestion) {
    setPlaceName(s.placeName);
    setPlaceCity(s.placeCity);
    setShowSuggestions(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createVenueRequestAction({
        placeName,
        placeCity: placeCity || undefined,
      });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      setSubmitted(result.data);
      const demandResult = await getMyVenueRequestDemandAction(result.data.id);
      if (demandResult.success) setDemand(demandResult.data);
    });
  }

  async function handleShare() {
    if (!submitted) return;
    const url = `${window.location.origin}/venues/requests/${submitted.id}`;
    const text = `I asked my venue to join AIR/Rally — help me get ${placeName} listed.`;
    if (navigator.share) {
      try {
        await navigator.share({ text, url });
      } catch {
        // The user cancelled the share sheet — not an error to surface.
      }
      return;
    }
    await navigator.clipboard.writeText(`${text} ${url}`);
    toast.success("Link copied — send it to your venue.");
  }

  if (submitted) {
    return (
      <div className="mt-4 flex flex-col items-center gap-3 rounded-xl border border-border bg-card p-4">
        <p className="text-sm font-medium text-foreground">{placeName} is on our list.</p>
        {/* The player's own feedback uses venue_request_demand_for_me() — the
            authenticated, ownership-checked function. showCount can only be
            true at the function's threshold of 5 or more
            (v_threshold constant integer := 5; returns v_count >= v_threshold),
            so the count is never 1 and "players" is never pluralized down. */}
        {demand?.showCount && (
          <p className="text-sm text-muted-foreground">{demand.requesters} players have asked for this venue.</p>
        )}
        <p className="text-sm font-medium text-foreground">
          The fastest way to get them on AIR/Rally: send them this.
        </p>
        <Button onClick={handleShare} variant="outline" size="sm" className="gap-2">
          <Share2 className="size-4" aria-hidden="true" />
          Share with your venue
        </Button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex w-full max-w-sm flex-col gap-3">
      <Popover open={showSuggestions && effectiveSuggestions.length > 0}>
        <PopoverAnchor asChild>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input
              value={placeName}
              onChange={(e) => {
                setPlaceName(e.target.value);
                setShowSuggestions(true);
              }}
              onFocus={() => setShowSuggestions(true)}
              placeholder="Venue name"
              className="pl-11"
              required
              minLength={2}
              maxLength={160}
            />
          </div>
        </PopoverAnchor>
        <PopoverContent
          className="w-[--radix-popover-trigger-width] p-1"
          onOpenAutoFocus={(e) => e.preventDefault()}
        >
          {effectiveSuggestions.map((s) => (
            <button
              key={`${s.placeName}-${s.placeCity}`}
              type="button"
              onClick={() => pickSuggestion(s)}
              className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-left text-sm hover:bg-muted"
            >
              <MapPin className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="truncate">
                {s.placeName}
                {s.placeCity && <span className="text-muted-foreground"> · {s.placeCity}</span>}
              </span>
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Input
        value={placeCity}
        onChange={(e) => setPlaceCity(e.target.value)}
        placeholder="City (optional)"
        maxLength={160}
      />

      <Button type="submit" disabled={isPending || placeName.trim().length < 2}>
        {isPending ? "Sending…" : "Ask us to bring a court here"}
      </Button>
    </form>
  );
}
