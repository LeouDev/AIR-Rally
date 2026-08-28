/**
 * Payout payslip — what a venue owner receives when a transfer for their
 * earnings is attested as sent.
 *
 * SUMMARY, NOT ITEMIZED — MEASURED, NOT ASSUMED. The prior version listed
 * every booking as its own row. Rendered from real code and measured: an
 * 11KB fixed shell plus ~1,153 bytes per booking. Gmail clips around
 * 102KB, which is 79 bookings — reachable by exactly the venue this
 * feature most needs to work for (multiple courts, most of the day,
 * seven days). Past the clip point, everything below the fold disappears,
 * including the totals. This version is fixed height at any booking
 * count: 23 or 230, it never gets clipped. The itemized detail still
 * exists — see `link`, which points at the owner's earnings dashboard,
 * where every booking behind the total is listed individually
 * (`listOwnerSettlements` / `SettlementPanel`).
 *
 * ONE TEMPLATE, ONE CALLER SHAPE, TWO CALLERS. `sendPayslipPreviewAction()`
 * (admin preview) and the real send wired through
 * `/api/webhooks/notification-created` (see that route's `payout_sent`
 * branch) both call `getPayoutSummaryForTransfer()` for the data and this
 * function for the render. If the preview and the live email could
 * diverge, the preview would be theatre rather than evidence of what an
 * owner actually receives — which is exactly what happened with the
 * itemized version this replaces (see [[payslip-never-actually-sent]]).
 *
 * A RE-SKIN OF THE BOOKING RECEIPT, NOT A REUSE OF IT — same reasoning as
 * before: the design language (palette, structure, typography, the navy
 * header with the orange rule) is shared; the markup is not, because a
 * payslip's shape (multiple money lines, a bank/reference line) doesn't
 * fit a single booking's seven scalars. Not extracting a shared shell for
 * the same reason as always: the live receipt already works and reaches
 * real customers, and a de-duplication that risks it to save markup is
 * the wrong trade to make in the same change that reworks a second email.
 *
 * DARK MODE: same approach as every other transactional email here — the
 * `color-scheme` / `supported-color-schemes` meta tags declare both, and
 * every surface carries an explicit background AND text colour, so a
 * client that inverts anyway flips a known pair rather than leaving text
 * on a background it never set.
 *
 * WHAT THIS EMAIL MAY AND MAY NOT CLAIM. It is sent when an admin attests
 * that PayMongo's report shows the transfer went out — NOT when the
 * venue's bank has credited it. Owner Agreement §3.12 commits AIR/Rally
 * to sending on time, not to when a bank settles. So the wording says
 * "sent"/"on its way", never "delivered", "received", or "in your
 * account".
 *
 * THE PERIOD IS STATED HONESTLY, WHATEVER IT ACTUALLY IS. `periodLabel` is
 * not forced into a Sunday–Saturday shape — it's whatever range the
 * batch's own bookings actually span (see `getPayoutSummaryForTransfer`).
 * A batch built entirely from the usual week reads as one week, same as
 * always. A batch containing a resurfaced older settlement reads as the
 * true multi-week range rather than a label that quietly doesn't match
 * its own contents. An honest range never contradicts itself; a fixed
 * label eventually does.
 */

export type PayoutPayslipEmailInput = {
  venueName: string;
  /** The batch's own true date range, venue-local — see this file's header comment on why it is never forced to one week. */
  periodLabel: string;
  bookingCount: number;
  /** Sum of what customers paid, in centavos. */
  courtEarningsTotal: number;
  /** AIR/Rally's 5% commission across the batch, in centavos. Never omitted — dropping our own cut from a summary reads as hiding it. */
  commissionTotal: number;
  /** The provider's per-transfer fee, in centavos — charged once per payout, not per booking. */
  transferFee: number;
  /** courtEarningsTotal minus commissionTotal minus transferFee — what was actually sent. */
  amountTransferred: number;
  bankName: string;
  /** Last 4 digits only — never the full account number in an email. */
  bankAccountLast4: string;
  /** AIR/Rally's own reference_number (payout_transfers), not PayMongo's provider id — the one a venue can quote back to support. */
  reference: string;
  /** The owner's earnings dashboard — where every booking behind this total is listed individually. */
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
  const periodLabel = escapeHtml(input.periodLabel);
  const bankName = escapeHtml(input.bankName);
  const bankAccountLast4 = escapeHtml(input.bankAccountLast4);
  const reference = escapeHtml(input.reference);
  const bookingCount = input.bookingCount;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your AIR/Rally payout for ${periodLabel}</title>
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
<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">${peso(input.amountTransferred)} sent to ${venueName} for ${periodLabel}.</span>

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
        <p style="margin:0;">Your earnings for <strong style="color:#0f2747;">${periodLabel}</strong> have been sent to your bank. Banks usually credit transfers the same or next banking day.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 32px 28px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#0f2747" style="background-color:#0f2747;">
          <tbody><tr>
            <td style="padding:20px 24px;">
              <p style="margin:0 0 8px 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Transferred</p>
              <p style="margin:0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:28px; line-height:32px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff;">${peso(input.amountTransferred)}</p>
              <p style="margin:8px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:18px; mso-line-height-rule:exactly; color:#a9b6c7;">to ${bankName} &bull;&bull;&bull;&bull;${bankAccountLast4} &middot; ref ${reference}</p>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#ffffff" style="background-color:#ffffff; border:1px solid #e6dac6;">
          <tbody>
          <tr>
            <td colspan="2" style="padding:18px 20px 6px 20px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">${venueName} &mdash; ${bookingCount} booking${bookingCount === 1 ? "" : "s"}</td>
          </tr>
          <tr>
            <td style="padding:14px 0 0 20px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">Court earnings</td>
            <td align="right" style="padding:14px 20px 0 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#0f2747; white-space:nowrap;">${peso(input.courtEarningsTotal)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0 0 20px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">AIR/Rally commission (5%)</td>
            <td align="right" style="padding:8px 20px 0 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f; white-space:nowrap;">&minus;${peso(input.commissionTotal)}</td>
          </tr>
          <tr>
            <td style="padding:8px 0 14px 20px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">Bank transfer fee</td>
            <td align="right" style="padding:8px 20px 14px 12px; font-family:'Courier New',Courier,Arial,sans-serif; font-size:14px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f; white-space:nowrap;">&minus;${peso(input.transferFee)}</td>
          </tr>
          <tr>
            <td style="padding:12px 0 18px 20px; border-top:2px solid #d8c9ab; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">Sent to your bank</td>
            <td align="right" style="padding:12px 20px 18px 12px; border-top:2px solid #d8c9ab; font-family:'Courier New',Courier,Arial,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; white-space:nowrap;">${peso(input.amountTransferred)}</td>
          </tr>
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:24px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tbody><tr>
            <td bgcolor="#f3700f" style="background-color:#f3700f; padding:14px 28px;">
              <a href="${input.link}" style="display:inline-block; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:19px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff; text-decoration:none;">See all ${bookingCount} booking${bookingCount === 1 ? "" : "s"}</a>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:20px 32px 0 32px; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:19px; mso-line-height-rule:exactly; color:#2b3a4f;">
        <p style="margin:0;">The ${peso(input.transferFee)} bank transfer fee is charged once per payout by our payment provider &mdash; not per booking.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" bgcolor="#0f2747" style="background-color:#0f2747; padding:26px 32px; margin-top:20px;">
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
