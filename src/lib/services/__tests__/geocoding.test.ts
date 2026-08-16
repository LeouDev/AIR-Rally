/**
 * @jest-environment node
 */
import { geocodeAddress } from "../geocoding";

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
