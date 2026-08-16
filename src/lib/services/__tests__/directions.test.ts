import { detectPlatform, buildDirectionsUrls, getPreferredDirectionsUrl } from "@/lib/services/directions";

describe("detectPlatform", () => {
  it("detects iOS from an iPhone user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)")).toBe("ios");
  });

  it("detects iOS from an iPad user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)")).toBe("ios");
  });

  it("detects Android from an Android user agent", () => {
    expect(detectPlatform("Mozilla/5.0 (Linux; Android 14; Pixel 8)")).toBe("android");
  });

  it("falls back to 'other' for desktop user agents", () => {
    expect(detectPlatform("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("other");
  });

  it("falls back to 'other' for an empty string", () => {
    expect(detectPlatform("")).toBe("other");
  });
});

describe("buildDirectionsUrls", () => {
  it("builds Google, Apple, and Waze URLs with the given coordinates", () => {
    const urls = buildDirectionsUrls(10.3465194, 123.911112, "Banilad Pickle Club");
    expect(urls.google).toBe("https://www.google.com/maps/dir/?api=1&destination=10.3465194,123.911112");
    expect(urls.apple).toBe("https://maps.apple.com/?daddr=10.3465194,123.911112&q=Banilad%20Pickle%20Club");
    expect(urls.waze).toBe("https://waze.com/ul?ll=10.3465194,123.911112&navigate=yes");
  });

  it("URL-encodes a label with special characters", () => {
    const urls = buildDirectionsUrls(1, 2, "[DEMO] Banilad & Friends");
    expect(urls.apple).toContain(encodeURIComponent("[DEMO] Banilad & Friends"));
  });
});

describe("getPreferredDirectionsUrl", () => {
  const urls = buildDirectionsUrls(10, 20, "Test Venue");

  it("prefers Apple Maps on iOS", () => {
    expect(getPreferredDirectionsUrl(urls, "ios")).toBe(urls.apple);
  });

  it("prefers Google Maps on Android", () => {
    expect(getPreferredDirectionsUrl(urls, "android")).toBe(urls.google);
  });

  it("prefers Google Maps on other platforms", () => {
    expect(getPreferredDirectionsUrl(urls, "other")).toBe(urls.google);
  });
});
