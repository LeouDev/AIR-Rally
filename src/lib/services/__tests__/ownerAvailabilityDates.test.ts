/**
 * The owner availability calendar's date navigation.
 *
 * The bug these cover only reproduces away from UTC, because the broken
 * implementation parsed `"YYYY-MM-DDT00:00:00"` — no zone suffix — which
 * JS reads as *local* midnight, then read the day back off
 * `.toISOString()`. In any UTC+ zone that round-trip loses a day. A CI
 * box sitting in UTC would have watched this ship.
 *
 * So the zone is pinned here rather than inherited, and the first test
 * asserts the broken idiom is *actually broken in this process* — if the
 * pin ever stops taking effect, that test fails loudly instead of the
 * rest of the suite passing for the wrong reason.
 */
process.env.TZ = "Asia/Manila";

import { shiftLocalDate, todayInTimezone } from "@/lib/services/ownerAvailability";

describe("test environment", () => {
  it("actually reproduces the UTC+8 offset these tests depend on", () => {
    // The exact idiom OwnerAvailabilityCalendar used to use.
    expect(new Date("2026-09-01T00:00:00").toISOString()).toBe("2026-08-31T16:00:00.000Z");
  });
});

describe("shiftLocalDate", () => {
  it("moves forward a day instead of standing still (Manila 'Next day')", () => {
    // Was "2026-09-01" — the button did nothing at all.
    expect(shiftLocalDate("2026-09-01", 1)).toBe("2026-09-02");
  });

  it("moves back exactly one day instead of two (Manila 'Previous day')", () => {
    // Was "2026-08-30" — a day was skipped on every press.
    expect(shiftLocalDate("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("crosses a month boundary in both directions", () => {
    expect(shiftLocalDate("2026-08-31", 1)).toBe("2026-09-01");
    expect(shiftLocalDate("2026-09-01", -1)).toBe("2026-08-31");
  });

  it("crosses a year boundary in both directions", () => {
    expect(shiftLocalDate("2026-12-31", 1)).toBe("2027-01-01");
    expect(shiftLocalDate("2027-01-01", -1)).toBe("2026-12-31");
  });

  it("handles a leap day", () => {
    expect(shiftLocalDate("2028-02-28", 1)).toBe("2028-02-29");
    expect(shiftLocalDate("2028-03-01", -1)).toBe("2028-02-29");
  });

  it("is a no-op for 0, and round-trips", () => {
    expect(shiftLocalDate("2026-09-01", 0)).toBe("2026-09-01");
    expect(shiftLocalDate(shiftLocalDate("2026-09-01", 7), -7)).toBe("2026-09-01");
  });
});

describe("todayInTimezone — the 'Today' button", () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it("lands on the venue's date, not the browser's UTC date", () => {
    // 2026-09-01 06:00 in Manila. UTC is still on 2026-08-31, and the old
    // button used the UTC date — so an owner pressing "Today" at 6am got
    // yesterday's schedule.
    jest.useFakeTimers().setSystemTime(new Date("2026-08-31T22:00:00.000Z"));
    expect(new Date().toISOString().slice(0, 10)).toBe("2026-08-31"); // what it used to do
    expect(todayInTimezone("Asia/Manila")).toBe("2026-09-01"); // what it does now
  });

  it("is venue-local, not owner-local: the same instant differs per venue", () => {
    jest.useFakeTimers().setSystemTime(new Date("2026-08-31T22:00:00.000Z"));
    expect(todayInTimezone("Asia/Manila")).toBe("2026-09-01");
    expect(todayInTimezone("America/New_York")).toBe("2026-08-31");
    expect(todayInTimezone("UTC")).toBe("2026-08-31");
  });

  it("handles a western venue whose local date trails UTC's", () => {
    // 2026-08-31 20:00 in New York, while UTC has already rolled to Sept 1.
    jest.useFakeTimers().setSystemTime(new Date("2026-09-01T00:00:00.000Z"));
    expect(todayInTimezone("America/New_York")).toBe("2026-08-31");
    expect(todayInTimezone("Asia/Manila")).toBe("2026-09-01");
  });
});
