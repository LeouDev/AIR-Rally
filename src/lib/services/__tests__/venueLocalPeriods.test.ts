import { payoutPeriodFor, weekRange, localDateIn } from "../venueLocalPeriods";

/**
 * The payout period a payslip and a transfer remark name.
 *
 * Owner Agreement §3.9 promises a Wednesday payout covers "court time
 * played in the week before it — Sunday through Saturday". These assert the
 * code says the same thing the document does.
 */
describe("payoutPeriodFor", () => {
  /**
   * THE DISCRIMINATOR. These bookings are Tue/Thu/Fri — midweek only. The
   * earlier min/max implementation rendered "18 Aug – 21 Aug", which
   * contradicts the clause and tells an owner nothing about which week was
   * paid. A fixture whose bookings happened to span Sunday to Saturday
   * would pass against that implementation, so it has to be midweek.
   *
   * These are the real dates from production batch PB-000001.
   */
  it("widens a midweek set of bookings to the whole Sunday–Saturday week", () => {
    expect(payoutPeriodFor(["2026-08-18", "2026-08-20", "2026-08-21"])).toEqual({
      from: "2026-08-16", // Sunday
      to: "2026-08-22", // Saturday
    });
  });

  /**
   * The other half of the same failure: a single booking rendered
   * "21 Aug – 21 Aug", from which an owner cannot tell whether a session
   * they expected was left out of the payout.
   */
  it("gives a single booking its full week rather than a one-day range", () => {
    expect(payoutPeriodFor(["2026-08-21"])).toEqual({ from: "2026-08-16", to: "2026-08-22" });
  });

  it("returns the same week whichever order the dates arrive in", () => {
    const shuffled = payoutPeriodFor(["2026-08-21", "2026-08-18", "2026-08-20"]);
    expect(shuffled).toEqual(payoutPeriodFor(["2026-08-18", "2026-08-20", "2026-08-21"]));
  });

  it("treats a Sunday booking as the START of its week, not the end", () => {
    // Sunday is day 0, so a Sunday date must anchor the week it opens.
    expect(payoutPeriodFor(["2026-08-16"])).toEqual({ from: "2026-08-16", to: "2026-08-22" });
  });

  it("treats a Saturday booking as the END of its week", () => {
    expect(payoutPeriodFor(["2026-08-22"])).toEqual({ from: "2026-08-16", to: "2026-08-22" });
  });

  /**
   * A batch spanning two weeks is not a weekly payout. Rather than
   * misreporting it as one week, the range covers every week touched —
   * naming it honestly beats naming it neatly.
   */
  it("widens across every week a multi-week batch touches", () => {
    expect(payoutPeriodFor(["2026-08-21", "2026-08-25"])).toEqual({
      from: "2026-08-16", // Sunday of the first booking's week
      to: "2026-08-29", // Saturday of the last booking's week
    });
  });

  it("returns null for an empty set rather than inventing a period", () => {
    expect(payoutPeriodFor([])).toBeNull();
  });

  it("crosses a month boundary without breaking the week", () => {
    // Mon 31 Aug 2026 sits in the week Sun 30 Aug – Sat 5 Sep.
    expect(payoutPeriodFor(["2026-08-31"])).toEqual({ from: "2026-08-30", to: "2026-09-05" });
  });

  it("agrees with weekRange, so there is one definition of a week", () => {
    expect(payoutPeriodFor(["2026-08-18"])).toEqual(weekRange("2026-08-18", 0));
  });
});

describe("payout period is venue-local", () => {
  /**
   * A booking at 00:30 Manila on Sunday 23 Aug is still Saturday 22 Aug in
   * UTC. Taking the date in the wrong zone puts it in the previous week and
   * therefore in the previous payout — the venue would be paid for it a
   * week early or a week late, and the payslip would name the wrong period.
   */
  it("puts a late-night Manila booking in the week its venue saw, not UTC's", () => {
    const instant = new Date("2026-08-22T16:30:00Z"); // 00:30 Sun 23 Aug in Manila
    expect(localDateIn(instant, "Asia/Manila")).toBe("2026-08-23");
    expect(localDateIn(instant, "UTC")).toBe("2026-08-22");

    expect(payoutPeriodFor([localDateIn(instant, "Asia/Manila")])).toEqual({
      from: "2026-08-23",
      to: "2026-08-29",
    });
    // The same instant read as UTC lands in the PREVIOUS week entirely.
    expect(payoutPeriodFor([localDateIn(instant, "UTC")])).toEqual({
      from: "2026-08-16",
      to: "2026-08-22",
    });
  });
});
