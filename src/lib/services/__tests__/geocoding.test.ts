/**
 * @jest-environment node
 */
import { geocodeAddress, reverseGeocodeCity } from "../geocoding";

const originalFetch = global.fetch;
const mockFetch = jest.fn();

beforeEach(() => {
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, ok = true) {
  return { ok, json: () => Promise.resolve(body) } as Response;
}

describe("geocodeAddress", () => {
  it("returns lat/lng parsed from the first Nominatim result", async () => {
    mockFetch.mockResolvedValue(jsonResponse([{ lat: "10.3157", lon: "123.8854" }]));

    const result = await geocodeAddress({ address: "123 Test St", city: "Cebu City", country: "Philippines" });

    expect(result).toEqual({ lat: 10.3157, lng: 123.8854 });
    const [url, init] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("nominatim.openstreetmap.org/search");
    expect((init as RequestInit).headers).toMatchObject({ "User-Agent": expect.any(String) });
  });

  it("returns null without calling fetch when every address part is empty", async () => {
    const result = await geocodeAddress({ address: null, city: null, country: null });
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when Nominatim finds no results", async () => {
    mockFetch.mockResolvedValue(jsonResponse([]));
    const result = await geocodeAddress({ address: "nowhere", city: null, country: null });
    expect(result).toBeNull();
  });

  it("returns null on a non-ok response rather than throwing", async () => {
    mockFetch.mockResolvedValue(jsonResponse([], false));
    const result = await geocodeAddress({ address: "123 Test St", city: null, country: null });
    expect(result).toBeNull();
  });

  it("returns null when fetch itself rejects, rather than throwing", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    const result = await geocodeAddress({ address: "123 Test St", city: null, country: null });
    expect(result).toBeNull();
  });
});

describe("reverseGeocodeCity", () => {
  it("returns the city from Nominatim's reverse-geocode address block", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ address: { city: "Cebu City", country: "Philippines" } }));

    const result = await reverseGeocodeCity(10.3157, 123.8854);

    expect(result).toBe("Cebu City");
    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("nominatim.openstreetmap.org/reverse");
  });

  it("falls back to town, then municipality, then county when city is absent", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse({ address: { town: "Some Town" } }));
    expect(await reverseGeocodeCity(1, 1)).toBe("Some Town");

    mockFetch.mockResolvedValueOnce(jsonResponse({ address: { municipality: "Some Municipality" } }));
    expect(await reverseGeocodeCity(1, 1)).toBe("Some Municipality");

    mockFetch.mockResolvedValueOnce(jsonResponse({ address: { county: "Some County" } }));
    expect(await reverseGeocodeCity(1, 1)).toBe("Some County");
  });

  it("returns null when no address field matches", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ address: {} }));
    expect(await reverseGeocodeCity(1, 1)).toBeNull();
  });

  it("returns null on a non-ok response rather than throwing", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, false));
    expect(await reverseGeocodeCity(1, 1)).toBeNull();
  });

  it("returns null when fetch itself rejects, rather than throwing", async () => {
    mockFetch.mockRejectedValue(new Error("network down"));
    expect(await reverseGeocodeCity(1, 1)).toBeNull();
  });
});
