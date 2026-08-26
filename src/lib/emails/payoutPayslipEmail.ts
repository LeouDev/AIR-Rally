/**
 * Payout payslip — what a venue owner receives when a transfer for their
 * week's earnings is attested as sent.
 *
 * A RE-SKIN OF THE BOOKING RECEIPT, NOT A REUSE OF IT.
 *
 * renderBookingReceiptEmail() takes seven scalars describing ONE booking.
 * A payslip needs a date range, an arbitrary number of line items, and four
 * separate money lines. None of that fits that input shape, so this shares
 * the design language — palette, structure, typography, the navy header
 * with the orange rule — while being its own template.
 *
 * The live booking receipt is deliberately NOT refactored to extract a
 * shared shell. It works and it goes to real customers; a de-duplication
 * that risks a working email to save some markup is the wrong trade to make
 * in the same change that introduces a new one. If the duplication becomes
 * a maintenance problem, extracting the shell later is a small, isolated
 * change that can be verified on its own.
 *
 * DARK MODE: inherits the existing approach rather than inventing a second.
 * The `color-scheme` / `supported-color-schemes` meta tags declare that this
 * email handles both, which stops clients like Apple Mail from aggressively
 * inverting it, and every surface carries an explicit background colour
 * (both `bgcolor` and inline `background-color`) with an explicit text
 * colour on top. A client that inverts anyway then flips a known pair
 * rather than leaving text on a background it never set.
 *
 * WHAT THIS EMAIL MAY AND MAY NOT CLAIM
 *
 * It is sent when an admin attests that PayMongo's report shows the
 * transfer went out — NOT when the venue's bank has credited it. Owner
 * Agreement §3.12 commits AIR/Rally to sending on time, not to when a bank
 * settles. So the wording says "sent"/"on its way", never "delivered",
 * "received", or "in your account". A payslip that overclaims is a support
 * message the day a bank takes an extra day.
 */

export type PayslipLineItem = {
  /** Court-time date, venue-local — the basis a venue reconciles against. */
  date: string;
  courtName: string;
  confirmationCode: string;
  /** What the customer paid for the court, in centavos. */
  courtPrice: number;
  /** What the venue earned from it after commission, in centavos. */
  earned: number;
};

export type PayoutPayslipEmailInput = {
  venueName: string;
  /** Sunday–Saturday, venue-local — the same window as the clause and the transfer remark. */
  weekLabel: string;
  batchReference: string;
  items: PayslipLineItem[];
  /** Sum of court prices, in centavos. */
  totalCourtPrice: number;
  /** AIR/Rally's 5% commission across the week, in centavos. */
  totalCommission: number;
  /** Sum of what the venue earned — totalCourtPrice minus totalCommission. */
  totalEarned: number;
  /** The provider's per-transfer fee, in centavos. */
  transferFee: number;
  /** What was actually sent — totalEarned minus transferFee. */
  amountTransferred: number;
  link: string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** Centavos to a displayed peso amount. Mirrors formatSettlementMoney's arithmetic. */
function peso(centavos: number): string {
  const negative = centavos < 0;
  const absolute = Math.abs(centavos);
  return `${negative ? "−" : ""}₱${(absolute / 100).toLocaleString("en-PH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function renderPayoutPayslipEmail(input: PayoutPayslipEmailInput): string {
  const venueName = escapeHtml(input.venueName);
  const weekLabel = escapeHtml(input.weekLabel);
  const batchReference = escapeHtml(input.batchReference);

  // Venue and court names are owner-entered text, so every interpolated
  // value is escaped — the same discipline bookingReceiptEmail documents,
  // applied here including to fields that happen to be server-formatted.
  const rows = input.items
    .map(
      (item) => `
                <tr>
                  <td class="rowcell" style="padding:10px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">
                    <span style="color:#0f2747; font-weight:bold; white-space:nowrap;">${escapeHtml(item.date)}</span><br>
                    ${escapeHtml(item.courtName)}
                    <span style="font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; color:#6b7a8f;">&nbsp;${escapeHtml(item.confirmationCode)}</span>
                  </td>
                  <td align="right" width="1%" class="money" style="padding:10px 0; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#6b7a8f; white-space:nowrap;">${peso(item.courtPrice)}</td>
                  <td align="right" width="1%" class="money" style="padding:10px 0 10px 12px; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; white-space:nowrap;">${peso(item.earned)}</td>
                </tr>`
    )
    .join("");

  const bookingCount = input.items.length;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your AIR/Rally payout for ${weekLabel}</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  @media only screen and (max-width:600px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
  }
  @media only screen and (max-width:400px) {
    .pad { padding-left:14px !important; padding-right:14px !important; }
    .card { padding-left:12px !important; padding-right:12px !important; }
    .rowcell { font-size:13px !important; }
    .money { font-size:12px !important; }
    .colhead { font-size:10px !important; letter-spacing:0.5px !important; }
    .h1 { font-size:23px !important; line-height:29px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#e6dac6; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">${peso(input.amountTransferred)} sent to ${venueName} for ${weekLabel}.</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#e6dac6" style="background-color:#e6dac6;">
<tbody><tr><td align="center" style="padding:24px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" bgcolor="#f6f1e8" style="width:600px; max-width:600px; background-color:#f6f1e8;">

    <tbody><tr>
      <td class="pad" bgcolor="#0f2747" style="background-color:#0f2747; padding:24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tbody><tr>
            <td align="left" style="font-family:Arial,Helvetica,sans-serif; font-size:26px; line-height:30px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.5px; color:#ffffff;">
              AIR<span style="color:#f3700f;">/Rally</span>
            </td>
            <td align="right" style="font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#e6dac6; text-transform:uppercase;">
              Payslip
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>
    <tr><td bgcolor="#f3700f" style="height:4px; background-color:#f3700f; font-size:0; line-height:0;">&nbsp;</td></tr>

    <tr>
      <td class="pad" style="padding:36px 32px 8px 32px;">
        <p style="margin:0 0 14px 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Payout sent</p>
        <h1 class="h1" style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:32px; line-height:38px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.8px; color:#0f2747;">${peso(input.amountTransferred)} is on its way.</h1>
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:16px 32px 28px 32px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#2b3a4f;">
        <p style="margin:0;">Your earnings for <strong style="color:#0f2747;">${weekLabel}</strong> have been sent to your bank. Banks usually credit transfers the same or next banking day.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 32px 28px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0f2747" style="background-color:#0f2747;">
          <tbody><tr>
            <td align="center" style="padding:22px 18px;">
              <p style="margin:0 0 8px 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Transferred</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:30px; line-height:34px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.5px; color:#ffffff;">${peso(input.amountTransferred)}</p>
              <p style="margin:8px 0 0 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1px; color:#a9b6c7;">${batchReference}</p>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f6f1e8" style="background-color:#f6f1e8; border:1px solid #d8c9ab;">
          <tbody>
          <tr><td colspan="3" style="padding:18px 20px 6px 20px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">${venueName} &mdash; ${bookingCount} booking${bookingCount === 1 ? "" : "s"}</td></tr>
          <tr>
            <td colspan="3" class="card" style="padding:0 20px 18px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tbody>
                <tr>
                  <td style="padding:0 0 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1px; color:#6b7a8f; text-transform:uppercase; white-space:nowrap;" class="colhead">Court time</td>
                  <td align="right" style="padding:0 0 6px 0; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1px; color:#6b7a8f; text-transform:uppercase; white-space:nowrap;" class="colhead">Price</td>
                  <td align="right" style="padding:0 0 6px 12px; font-family:Arial,Helvetica,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1px; color:#6b7a8f; text-transform:uppercase; white-space:nowrap;" class="colhead">You earned</td>
                </tr>${rows}
                <tr>
                  <td colspan="2" style="padding:14px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">Court prices</td>
                  <td align="right" style="padding:14px 0 0 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#0f2747; white-space:nowrap;">${peso(input.totalCourtPrice)}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:6px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">AIR/Rally commission (5%)</td>
                  <td align="right" style="padding:6px 0 0 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#0f2747;">&minus;${peso(input.totalCommission)}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:6px 0 8px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">Your earnings</td>
                  <td align="right" style="padding:6px 0 8px 12px; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; white-space:nowrap;">${peso(input.totalEarned)}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:10px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">Bank transfer fee</td>
                  <td align="right" style="padding:10px 0 0 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#0f2747;">&minus;${peso(input.transferFee)}</td>
                </tr>
                <tr>
                  <td colspan="2" style="padding:12px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">Transferred to your bank</td>
                  <td align="right" style="padding:12px 0 0 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:20px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#1f9d55; white-space:nowrap;">${peso(input.amountTransferred)}</td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:20px 32px 0 32px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:20px; mso-line-height-rule:exactly; color:#6b7a8f;">
        <p style="margin:0;">The ₱10.00 bank transfer fee is charged once per payout by our payment provider &mdash; not per booking.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:26px 32px 30px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tbody><tr>
            <td bgcolor="#f3700f" style="background-color:#f3700f; border-radius:0; padding:14px 26px;">
              <a href="${input.link}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff; text-decoration:none;">View your earnings</a>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" bgcolor="#0f2747" style="background-color:#0f2747; padding:26px 32px;">
        <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff;">AIR<span style="color:#f3700f;">/Rally</span></p>
        <p style="margin:0 0 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">Book courts. Play more.<br>Pilit Cabancalan, Mandaue City, Cebu 6014, Philippines</p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">You are receiving this because you list a venue on air-rally.com.</p>
      </td>
    </tr>

  </tbody></table>

</td></tr>
</tbody></table>


</body></html>`;
}
