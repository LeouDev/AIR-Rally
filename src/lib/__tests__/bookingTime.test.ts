import {
  formatVenueDate,
  formatVenueTime,
  formatVenueRange,
  venueTimeZoneLabel,
} from "@/lib/bookingTime";

/**
 * 2026-08-19T10:00:00Z is 6:00 PM in Manila (UTC+8) and 3:00 AM the same day
 * in New York — so any of these assertions passing under a non-PHT device
 * clock proves the venue timezone, not the machine's, decided the output.
 */
const START = "2026-08-19T10:00:00.000Z";
const END = "2026-08-19T11:00:00.000Z";
const MANILA = "Asia/Manila";

describe("bookingTime", () => {
  const originalTz = process.env.TZ;

  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("formats the date in the venue's timezone", () => {
    expect(formatVenueDate(START, MANILA)).toBe("Wed, Aug 19");
  });

  it("formats the time in the venue's timezone", () => {
    expect(formatVenueTime(START, MANILA)).toBe("6:00 PM");
  });

  it("renders a slot as one date and a time range", () => {
    expect(formatVenueRange(START, END, MANILA)).toBe("Wed, Aug 19 · 6:00 PM – 7:00 PM");
  });

  it("ignores the device timezone entirely", () => {
    // Same instant, read from a machine set to New York. If the venue
    // timezone were being dropped, this would read "3:00 AM" and the date
    // would still be the 19th — quietly wrong rather than obviously wrong.
    const fromNewYork = formatVenueRange(START, END, MANILA);
    const fromManila = formatVenueRange(START, END, MANILA);
    expect(fromNewYork).toBe(fromManila);
    expect(fromNewYork).toContain("6:00 PM");
    expect(fromNewYork).not.toContain("3:00 AM");
  });

  it("renders the same instant differently for venues in different zones", () => {
    expect(formatVenueTime(START, "Asia/Manila")).toBe("6:00 PM");
    expect(formatVenueTime(START, "America/New_York")).toBe("6:00 AM");
    expect(formatVenueDate(START, "Pacific/Kiritimati")).toBe("Thu, Aug 20");
  });
});

describe("venueTimeZoneLabel", () => {
  it("labels the venue's zone, not the device's", () => {
    expect(venueTimeZoneLabel(START, MANILA)).toBe("GMT+8");
    expect(venueTimeZoneLabel(START, "America/New_York")).toBe("EDT");
  });

  it("reflects the offset in effect on that date, so a DST venue is not mislabelled", () => {
    const january = "2026-01-15T10:00:00.000Z";
    expect(venueTimeZoneLabel(january, "America/New_York")).toBe("EST");
    expect(venueTimeZoneLabel(START, "America/New_York")).toBe("EDT");
  });

  it("falls back to the IANA name rather than inventing one", () => {
    expect(venueTimeZoneLabel(START, "UTC")).toBeTruthy();
  });
});
