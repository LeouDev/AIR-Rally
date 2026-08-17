import {
  parseExploreFilters,
  filtersToSearchParams,
  describeActiveFilters,
  CLEAR_ALL_FILTERS,
} from "@/lib/explore-params";

describe("parseExploreFilters", () => {
  it("returns an all-undefined filter set for empty search params", () => {
    expect(parseExploreFilters({})).toEqual({
      q: undefined,
      city: undefined,
      indoorOutdoor: undefined,
      minPrice: undefined,
      maxPrice: undefined,
      minRating: undefined,
      amenityIds: undefined,
      sort: undefined,
      page: undefined,
    });
  });

  it("maps the `location` param to `city`, matching the hero SearchBar's convention", () => {
    expect(parseExploreFilters({ location: "Cebu City" }).city).toBe("Cebu City");
  });

  it("trims whitespace and drops empty strings down to undefined", () => {
    expect(parseExploreFilters({ q: "   " }).q).toBeUndefined();
    expect(parseExploreFilters({ q: "  pickle  " }).q).toBe("pickle");
  });

  it("accepts only known indoor/outdoor values, discarding anything else", () => {
    expect(parseExploreFilters({ indoor: "indoor" }).indoorOutdoor).toBe("indoor");
    expect(parseExploreFilters({ indoor: "both" }).indoorOutdoor).toBe("both");
    expect(parseExploreFilters({ indoor: "'; drop table venues;--" }).indoorOutdoor).toBeUndefined();
  });

  it("accepts only known sort values, discarding anything else", () => {
    expect(parseExploreFilters({ sort: "price_asc" }).sort).toBe("price_asc");
    expect(parseExploreFilters({ sort: "not-a-real-sort" }).sort).toBeUndefined();
  });

  it("parses numeric params and ignores non-numeric garbage", () => {
    const filters = parseExploreFilters({ minPrice: "100", maxPrice: "abc", minRating: "4.5", page: "3" });
    expect(filters.minPrice).toBe(100);
    expect(filters.maxPrice).toBeUndefined();
    expect(filters.minRating).toBe(4.5);
    expect(filters.page).toBe(3);
  });

  it("splits a comma-separated amenities param and drops empty entries", () => {
    expect(parseExploreFilters({ amenities: "a1,a2,,a3" }).amenityIds).toEqual(["a1", "a2", "a3"]);
  });

  it("takes the first value when a param repeats as an array (e.g. ?q=a&q=b)", () => {
    expect(parseExploreFilters({ q: ["first", "second"] }).q).toBe("first");
  });

  it("applies the distance filter only when lat, lng, AND radius are all present and in-range", () => {
    const full = parseExploreFilters({ lat: "10.3", lng: "123.9", radius: "25" });
    expect(full.lat).toBe(10.3);
    expect(full.lng).toBe(123.9);
    expect(full.radiusKm).toBe(25);

    expect(parseExploreFilters({ lat: "10.3", radius: "25" }).radiusKm).toBeUndefined();
    expect(parseExploreFilters({ lat: "95", lng: "123.9", radius: "25" }).lat).toBeUndefined();
    expect(parseExploreFilters({ lat: "10.3", lng: "123.9", radius: "-5" }).radiusKm).toBeUndefined();
  });

  it("accepts only well-formed date/time availability params", () => {
    const good = parseExploreFilters({ date: "2026-08-19", time: "18:00" });
    expect(good.availableOn).toBe("2026-08-19");
    expect(good.availableAt).toBe("18:00");

    expect(parseExploreFilters({ date: "yesterday" }).availableOn).toBeUndefined();
    expect(parseExploreFilters({ time: "6pm" }).availableAt).toBeUndefined();
  });

  it("passes the surface param through as surfaceType", () => {
    expect(parseExploreFilters({ surface: "Concrete" }).surfaceType).toBe("Concrete");
    expect(parseExploreFilters({ surface: "   " }).surfaceType).toBeUndefined();
  });
});

describe("filtersToSearchParams", () => {
  it("produces an empty query string for an empty filter set", () => {
    expect(filtersToSearchParams({}).toString()).toBe("");
  });

  it("round-trips a full filter set back through parseExploreFilters", () => {
    const original = {
      q: "pickle",
      city: "Cebu City",
      indoorOutdoor: "indoor" as const,
      minPrice: 100,
      maxPrice: 800,
      minRating: 4,
      amenityIds: ["a1", "a2"],
      surfaceType: "Concrete",
      lat: 10.3157,
      lng: 123.8854,
      radiusKm: 25,
      availableOn: "2026-08-19",
      availableAt: "18:00",
      sort: "rating" as const,
      page: 2,
    };
    const roundTripped = parseExploreFilters(Object.fromEntries(filtersToSearchParams(original)));
    expect(roundTripped).toEqual(original);
  });

  it("omits `indoor` for the default 'both' value, `sort` for 'recommended', and `page` for page 1 — keeps the URL clean", () => {
    const params = filtersToSearchParams({ indoorOutdoor: "both", sort: "recommended", page: 1 });
    expect(params.toString()).toBe("");
  });
});

describe("describeActiveFilters", () => {
  const amenityNames = new Map([
    ["a1", "Showers"],
    ["a2", "Night Lighting"],
  ]);

  it("returns nothing for a filter set that only carries text search, sort, and page", () => {
    expect(describeActiveFilters({ q: "riverside", sort: "rating", page: 2 })).toEqual([]);
  });

  it("describes each active filter once, with a patch that removes only that one", () => {
    const chips = describeActiveFilters(
      { indoorOutdoor: "indoor", minPrice: 100, minRating: 4.5, amenityIds: ["a1", "a2"] },
      amenityNames
    );

    expect(chips.map((c) => c.label)).toEqual(["Indoor", "Over ₱100", "4.5+", "Showers", "Night Lighting"]);
    expect(chips.find((c) => c.label === "Showers")?.clear).toEqual({ amenityIds: ["a2"] });
    expect(chips.find((c) => c.label === "Indoor")?.clear).toEqual({ indoorOutdoor: undefined });
  });

  it("collapses a min/max pair into one chip that clears both bounds together", () => {
    const chips = describeActiveFilters({ minPrice: 90, maxPrice: 250 });
    expect(chips).toHaveLength(1);
    expect(chips[0].label).toBe("₱90 – ₱250");
    expect(chips[0].clear).toEqual({ minPrice: undefined, maxPrice: undefined });
  });

  it("clears lat/lng alongside the radius, since the distance filter is all-or-nothing", () => {
    const chips = describeActiveFilters({ lat: 10.3, lng: 123.8, radiusKm: 5 });
    expect(chips[0].clear).toEqual({ lat: undefined, lng: undefined, radiusKm: undefined });
  });

  it("skips an amenity id with no known name rather than rendering a raw uuid", () => {
    expect(describeActiveFilters({ amenityIds: ["deleted-id"] }, amenityNames)).toEqual([]);
  });

  it("CLEAR_ALL_FILTERS empties every chip while leaving search and sort alone", () => {
    const filters = {
      q: "riverside",
      sort: "rating" as const,
      indoorOutdoor: "indoor" as const,
      minPrice: 100,
      minRating: 4.5,
      surfaceType: "Concrete",
      lat: 10.3,
      lng: 123.8,
      radiusKm: 5,
      availableOn: "2026-08-19",
      amenityIds: ["a1"],
    };
    const cleared = { ...filters, ...CLEAR_ALL_FILTERS };

    expect(describeActiveFilters(cleared, amenityNames)).toEqual([]);
    expect(cleared.q).toBe("riverside");
    expect(cleared.sort).toBe("rating");
  });
});
