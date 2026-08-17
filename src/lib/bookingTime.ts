/**
 * Booking times are rendered in the VENUE's timezone, never the device's.
 *
 * A player in Singapore looking at a Cebu court must see the hour the court
 * will actually be theirs. Passing no `timeZone` to Intl silently falls back
 * to the device, which reads as correct on any machine that happens to be set
 * to PHT — so the bug only ever appears for the travelling user, and only in
 * production.
 *
 * `timeZone` is deliberately required and non-optional. Every caller has a
 * venue timezone available (`BookingWithDetails.venueTimezone`, or the venue
 * row itself), and making it optional is what lets an `undefined` slip
 * through to Intl and become the device default.
 */

const DATE_WITH_WEEKDAY: Intl.DateTimeFormatOptions = {
  weekday: "short",
  month: "short",
  day: "numeric",
};

const TIME_ONLY: Intl.DateTimeFormatOptions = {
  hour: "numeric",
  minute: "2-digit",
};

export function formatVenueDate(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { ...DATE_WITH_WEEKDAY, timeZone }).format(new Date(iso));
}

export function formatVenueTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", { ...TIME_ONLY, timeZone }).format(new Date(iso));
}

/**
 * The one booking-slot string: "Wed, Aug 19 · 6:00 PM – 7:00 PM".
 *
 * Both ends are formatted against the same timezone, so a booking that spans
 * a DST boundary still reads as one continuous slot at the venue.
 */
export function formatVenueRange(startIso: string, endIso: string, timeZone: string): string {
  const date = formatVenueDate(startIso, timeZone);
  const from = formatVenueTime(startIso, timeZone);
  const to = formatVenueTime(endIso, timeZone);
  return `${date} · ${from} – ${to}`;
}

/**
 * A short, human label for the venue's timezone — "GMT+8", "EDT" — for the
 * "Venue time (…)" note that sits beside a rendered slot.
 *
 * Derived, never hardcoded. Two screens previously carried a literal "(PHT)",
 * which is right for every venue in the launch market and quietly wrong for
 * the first one outside it — the same failure mode as an omitted timeZone,
 * just in the label instead of the number.
 *
 * `short` rather than `shortGeneric`: it reflects the offset actually in
 * effect on that date, so a DST-observing venue is not labelled with its
 * standard-time name during summer.
 */
export function venueTimeZoneLabel(iso: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" }).formatToParts(
    new Date(iso)
  );
  return parts.find((part) => part.type === "timeZoneName")?.value ?? timeZone;
}

/**
 * A single instant with its date: "Wed, Aug 19, 6:00 PM".
 *
 * For owner-facing views, where each timestamp stands alone (booked at, paid
 * at, a timeline entry) rather than forming a start–end slot.
 */
export function formatVenueDateTime(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    ...DATE_WITH_WEEKDAY,
    ...TIME_ONLY,
    timeZone,
  }).format(new Date(iso));
}
