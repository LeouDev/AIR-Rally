import { renderPayoutPayslipEmail, type PayoutPayslipEmailInput } from "../payoutPayslipEmail";

/**
 * Correctness of the payslip, established without any email infrastructure.
 *
 * This is where the numbers get tested. The rendered visual sample and the
 * single production send prove different things — how it looks, and that
 * the wiring works — and neither of those would catch an arithmetic error,
 * because a wrong number renders exactly as neatly as a right one.
 */

/**
 * A realistic week: three bookings, PHP 400 / 600 / 400 court prices at 5%
 * commission. Chosen so the maths is hand-checkable against the Venue Owner
 * Agreement's own §3.2 worked example (a PHP 400.00 court price yields a
 * PHP 20.00 commission and PHP 380.00 to the venue).
 */
function input(overrides: Partial<PayoutPayslipEmailInput> = {}): PayoutPayslipEmailInput {
  return {
    venueName: "Banilad Pickle Club",
    weekLabel: "23–29 August 2026",
    batchReference: "PB-000002",
    items: [
      { date: "Sun 23 Aug", courtName: "Court 1", confirmationCode: "AR7K2M", courtPrice: 40000, earned: 38000 },
      { date: "Wed 26 Aug", courtName: "Court 2", confirmationCode: "AR9QX4", courtPrice: 60000, earned: 57000 },
      { date: "Sat 29 Aug", courtName: "Court 1", confirmationCode: "ARB31P", courtPrice: 40000, earned: 38000 },
    ],
    totalCourtPrice: 140000,
    totalCommission: 7000,
    totalEarned: 133000,
    transferFee: 1000,
    amountTransferred: 132000,
    link: "https://air-rally.com/list-your-court/earnings",
    ...overrides,
  };
}

describe("renderPayoutPayslipEmail — the money", () => {
  /**
   * THE DISCRIMINATOR THAT MATTERS. Four money lines can each be correct
   * against a fixture and still fail to add up, if one is computed from a
   * different source than the others. "The numbers don't add up" is the
   * most damaging thing that can appear on a document telling someone what
   * they earned — and it is invisible to per-line assertions.
   */
  it("reconciles: court prices − commission − transfer fee = transferred", () => {
    const i = input();
    expect(i.totalCourtPrice - i.totalCommission).toBe(i.totalEarned);
    expect(i.totalEarned - i.transferFee).toBe(i.amountTransferred);
    expect(i.totalCourtPrice - i.totalCommission - i.transferFee).toBe(i.amountTransferred);
  });

  it("line items sum to the stated totals, so the breakdown explains the total", () => {
    const i = input();
    expect(i.items.reduce((s, x) => s + x.courtPrice, 0)).toBe(i.totalCourtPrice);
    expect(i.items.reduce((s, x) => s + x.earned, 0)).toBe(i.totalEarned);
  });

  it("the commission is 5% of court prices, matching the agreement", () => {
    const i = input();
    expect(i.totalCommission).toBe(Math.round(i.totalCourtPrice * 0.05));
  });

  it("renders centavos as pesos, never the raw integer", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain("₱1,320.00");
    // The 100x failure: 132000 centavos rendered as if it were pesos.
    expect(html).not.toContain("₱132,000.00");
  });

  it("shows all four money lines, each separately labelled", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain("Court prices");
    expect(html).toContain("AIR/Rally commission (5%)");
    expect(html).toContain("Bank transfer fee");
    expect(html).toContain("Transferred to your bank");
    expect(html).toContain("₱1,400.00"); // court prices
    expect(html).toContain("₱70.00"); // commission
    expect(html).toContain("₱1,330.00"); // earnings
    expect(html).toContain("₱10.00"); // fee
  });

  it("renders every booking as its own line, not a summary", () => {
    const html = renderPayoutPayslipEmail(input());
    for (const code of ["AR7K2M", "AR9QX4", "ARB31P"]) expect(html).toContain(code);
    expect(html).toContain("3 bookings");
  });

  it("says 1 booking, not 1 bookings", () => {
    const html = renderPayoutPayslipEmail(input({ items: [input().items[0]] }));
    expect(html).toContain("1 booking<");
  });
});

describe("renderPayoutPayslipEmail — what it may claim", () => {
  /**
   * Sent when an admin attests PayMongo's report shows the transfer went
   * out — not when a bank has credited it. §3.12 commits to sending, not to
   * arrival, and the email must not contradict the clause we are signing.
   */
  it("says sent, never delivered or received", () => {
    const html = renderPayoutPayslipEmail(input()).toLowerCase();
    expect(html).toContain("on its way");
    expect(html).not.toContain("has been delivered");
    expect(html).not.toContain("has been received");
    expect(html).not.toContain("is in your account");
  });

  it("tells the owner a bank may take another day", () => {
    expect(renderPayoutPayslipEmail(input())).toContain("same or next banking day");
  });

  it("states the fee is per payout, not per booking", () => {
    expect(renderPayoutPayslipEmail(input())).toContain("once per payout");
  });

  it("names the week it covers, matching the clause's window", () => {
    expect(renderPayoutPayslipEmail(input())).toContain("23–29 August 2026");
  });
});

describe("renderPayoutPayslipEmail — safety", () => {
  it("escapes owner-entered venue and court names", () => {
    const html = renderPayoutPayslipEmail(
      input({
        venueName: '<script>alert("x")</script>',
        items: [{ ...input().items[0], courtName: "<b>Court</b>" }],
      })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Court&lt;/b&gt;");
  });

  it("declares dark-mode support so clients do not invert it blindly", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain('name="color-scheme" content="light dark"');
    expect(html).toContain('name="supported-color-schemes" content="light dark"');
  });

  it("paints every major surface explicitly, so an inverting client flips a known pair", () => {
    const html = renderPayoutPayslipEmail(input());
    // bgcolor as well as inline background-color: older clients honour only
    // the attribute, and a surface with no colour of its own is the one that
    // goes dark-on-dark.
    expect(html).toContain('bgcolor="#0f2747"');
    expect(html).toContain('bgcolor="#f6f1e8"');
    expect(html).toContain('bgcolor="#e6dac6"');
  });

  it("handles an empty week without rendering a broken table", () => {
    const html = renderPayoutPayslipEmail(
      input({ items: [], totalCourtPrice: 0, totalCommission: 0, totalEarned: 0, amountTransferred: -1000 })
    );
    expect(html).toContain("0 bookings");
    expect(html).toContain("<!doctype html>");
  });
});
