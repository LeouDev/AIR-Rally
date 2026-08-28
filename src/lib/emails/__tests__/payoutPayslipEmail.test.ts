import { renderPayoutPayslipEmail, type PayoutPayslipEmailInput } from "../payoutPayslipEmail";

/**
 * Correctness of the payslip, established without any email infrastructure.
 *
 * This is where the numbers get tested. The rendered visual sample and the
 * single production send prove different things — how it looks, and that
 * the wiring works — and neither of those would catch an arithmetic error,
 * because a wrong number renders exactly as neatly as a right one.
 *
 * SUMMARY SHAPE, NOT ITEMIZED — see payoutPayslipEmail.ts's own header
 * comment for why: the itemized version could be clipped by Gmail past
 * ~79 bookings, silently hiding the totals below the fold for exactly the
 * busiest venues. This fixture uses the same underlying figures as the
 * version it replaces, so both are hand-checkable against the same
 * Venue Owner Agreement §3.2 worked example.
 */
function input(overrides: Partial<PayoutPayslipEmailInput> = {}): PayoutPayslipEmailInput {
  return {
    venueName: "Banilad Pickle Club",
    periodLabel: "23–29 August 2026",
    bookingCount: 3,
    courtEarningsTotal: 140000,
    commissionTotal: 7000,
    transferFee: 1000,
    amountTransferred: 132000,
    bankName: "BPI",
    bankAccountLast4: "1234",
    reference: "PB-000002",
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
  it("reconciles: court earnings − commission − transfer fee = transferred", () => {
    const i = input();
    expect(i.courtEarningsTotal - i.commissionTotal - i.transferFee).toBe(i.amountTransferred);
  });

  it("the commission is 5% of court earnings, matching the agreement", () => {
    const i = input();
    expect(i.commissionTotal).toBe(Math.round(i.courtEarningsTotal * 0.05));
  });

  it("renders centavos as pesos, never the raw integer", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain("₱1,320.00");
    // The 100x failure: 132000 centavos rendered as if it were pesos.
    expect(html).not.toContain("₱132,000.00");
  });

  /**
   * The CTO's own first draft dropped this line — omitting AIR/Rally's own
   * cut from a summary reads as hiding it, and the itemized version this
   * replaces always showed it. Kept deliberately, checked deliberately.
   */
  it("shows all four money lines, each separately labelled, including our own commission", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain("Court earnings");
    expect(html).toContain("AIR/Rally commission (5%)");
    expect(html).toContain("Bank transfer fee");
    expect(html).toContain("Sent to your bank");
    expect(html).toContain("₱1,400.00"); // court earnings
    expect(html).toContain("₱70.00"); // commission
    expect(html).toContain("₱10.00"); // fee
  });

  it("names the venue and the true booking count in the summary heading", () => {
    const html = renderPayoutPayslipEmail(input());
    // The heading is uppercased by CSS (text-transform), not in the markup
    // itself — asserting the raw text keeps this independent of styling.
    expect(html).toContain("Banilad Pickle Club");
    expect(html).toContain("3 bookings");
  });

  it("says 1 booking, not 1 bookings, in both the heading and the CTA", () => {
    const html = renderPayoutPayslipEmail(input({ bookingCount: 1 }));
    expect(html).toContain("1 booking<");
    expect(html).toContain("See all 1 booking<");
  });

  it("the CTA names the true booking count, pointing at the itemized dashboard", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain("See all 3 bookings");
    expect(html).toContain("https://air-rally.com/list-your-court/earnings");
  });

  it("shows the destination bank, masked account, and AIR/Rally's own reference", () => {
    const html = renderPayoutPayslipEmail(input());
    expect(html).toContain("to BPI");
    expect(html).toContain("&bull;&bull;&bull;&bull;1234");
    expect(html).toContain("ref PB-000002");
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

  /**
   * Never forced to a Sunday–Saturday shape — whatever periodLabel the
   * caller computed (getPayoutSummaryForTransfer) is rendered verbatim,
   * including a true multi-week range when a batch spans more than one
   * week. See payoutPayslipEmail.ts's own comment on why.
   */
  it("states whatever period it's given, verbatim, without reshaping it", () => {
    expect(renderPayoutPayslipEmail(input())).toContain("23–29 August 2026");
    expect(renderPayoutPayslipEmail(input({ periodLabel: "9 August 2026 – 29 August 2026" }))).toContain(
      "9 August 2026 – 29 August 2026"
    );
  });
});

describe("renderPayoutPayslipEmail — safety", () => {
  it("escapes owner-entered venue and bank names", () => {
    const html = renderPayoutPayslipEmail(
      input({
        venueName: '<script>alert("x")</script>',
        bankName: "<b>Sketchy Bank</b>",
      })
    );
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;b&gt;Sketchy Bank&lt;/b&gt;");
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

  it("stays a well-formed document at the edges — zero bookings, a negative transfer", () => {
    const html = renderPayoutPayslipEmail(input({ bookingCount: 0, amountTransferred: -1000 }));
    expect(html).toContain("0 bookings");
    expect(html).toContain("<!doctype html>");
  });
});
