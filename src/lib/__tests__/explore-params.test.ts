import { parseExploreFilters, filtersToSearchParams } from "@/lib/explore-params";

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
