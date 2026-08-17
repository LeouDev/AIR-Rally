import {
  BOOKING_BREAKPOINT,
  BOOKING_BAR_VISIBILITY,
  BOOKING_SIDEBAR_VISIBILITY,
  bookingBreakpointOf,
} from "@/lib/bookingBreakpoint";

/**
 * Guards the bug that once left 768-1023px unable to book at all: the bar
 * hiding at one breakpoint while the sidebar appeared at another. Any gap
 * between them means some range of widths has no booking control.
 */
describe("booking control handoff", () => {
  it("hides the bar at exactly the breakpoint the sidebar appears", () => {
    expect(bookingBreakpointOf(BOOKING_BAR_VISIBILITY)).toBe(BOOKING_BREAKPOINT);
    expect(bookingBreakpointOf(BOOKING_SIDEBAR_VISIBILITY)).toBe(BOOKING_BREAKPOINT);
  });

  it("keeps the bar visible below the breakpoint and the sidebar hidden there", () => {
    expect(BOOKING_BAR_VISIBILITY).toContain(`${BOOKING_BREAKPOINT}:hidden`);
    expect(BOOKING_SIDEBAR_VISIBILITY).toContain("hidden");
    expect(BOOKING_SIDEBAR_VISIBILITY).toContain(`${BOOKING_BREAKPOINT}:block`);
  });

  it("would catch a mismatched pair", () => {
    // The exact shape of the historical bug: bar hides at md, sidebar at lg.
    expect(bookingBreakpointOf("md:hidden")).not.toBe(bookingBreakpointOf("hidden lg:block"));
  });
});
