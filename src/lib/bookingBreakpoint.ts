/**
 * The single width at which the court page hands booking off from the
 * persistent bottom bar to the sidebar BookingWidget.
 *
 * These two classes are the whole invariant, and they are exported from one
 * place because they were once written independently: the bar hid at `md`
 * while the sidebar only appeared at `lg`, so 768-1023px — iPad portrait,
 * most Android tablets, a split-screen laptop window — had no booking UI on
 * the page at all. The court was simply unbookable at those widths, and
 * nothing failed loudly enough to notice.
 *
 * Change the breakpoint here and both sides move together. `bookingBreakpoint`
 * exists so a test can assert they still name the same one.
 */
export const BOOKING_BREAKPOINT = "lg" as const;

/** Applied to the persistent bottom bar — visible BELOW the breakpoint. */
export const BOOKING_BAR_VISIBILITY = "lg:hidden";

/** Applied to the sidebar column — visible AT and above the breakpoint. */
export const BOOKING_SIDEBAR_VISIBILITY = "hidden lg:block";

/** The breakpoint each class actually names, for the drift test. */
export function bookingBreakpointOf(className: string): string | null {
  const match = /\b([a-z]+):(?:hidden|block)\b/.exec(className);
  return match ? match[1] : null;
}
