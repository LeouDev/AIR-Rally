/**
 * Booking-receipt-email template — extracted out of
 * src/app/api/webhooks/notification-created/route.ts (same reasoning as
 * ownerWelcomeEmail.ts: a plain importable/testable function, not inlined
 * in a route file) and restyled onto that email's design system. The
 * input shape, the values it receives, and the escaping discipline are
 * unchanged from the version this replaces — venueName and courtName are
 * venue-owner-entered text, not server-generated, so every field still
 * gets escaped before it lands in the markup, including the ones that
 * happen to be server-formatted today.
 */
export type BookingReceiptEmailInput = {
  confirmationCode: string;
  courtName: string;
  venueName: string;
  when: string;
  amountPaid: string;
  paidWithCredits: boolean;
  link: string;
};

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function renderBookingReceiptEmail(input: BookingReceiptEmailInput): string {
  const confirmationCode = escapeHtml(input.confirmationCode);
  const venueName = escapeHtml(input.venueName);
  const courtName = escapeHtml(input.courtName);
  const when = escapeHtml(input.when);
  const amountPaid = escapeHtml(input.amountPaid);
  const paidLine = input.paidWithCredits ? "Paid with AIR/Rally Credits." : "Paid in full.";

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>Your AIR/Rally booking is confirmed</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  @media only screen and (max-width:600px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#e6dac6; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">Confirmation ${confirmationCode} — ${venueName}, ${when}.</span>

<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#e6dac6;">
<tbody><tr><td align="center" style="padding:24px 12px;">

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" class="wrap" style="width:600px; max-width:600px; background-color:#f6f1e8;">

    <tbody><tr>
      <td class="pad" style="background-color:#0f2747; padding:24px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tbody><tr>
            <td align="left" style="font-family:Arial,Helvetica,sans-serif; font-size:26px; line-height:30px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.5px; color:#ffffff;">
              AIR<span style="color:#f3700f;">/Rally</span>
            </td>
            <td align="right" style="font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#e6dac6; text-transform:uppercase;">
              Receipt
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>
    <tr><td style="height:4px; background-color:#f3700f; font-size:0; line-height:0;">&nbsp;</td></tr>

    <tr>
      <td class="pad" style="padding:36px 32px 8px 32px;">
        <p style="margin:0 0 14px 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Payment confirmed</p>
        <h1 class="h1" style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:32px; line-height:38px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.8px; color:#0f2747;">You're on court.</h1>
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:16px 32px 28px 32px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#2b3a4f;">
        <p style="margin:0;">${paidLine} Show the code below at the venue.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 32px 28px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#0f2747;">
          <tbody><tr>
            <td align="center" style="padding:22px 18px;">
              <p style="margin:0 0 8px 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Confirmation code</p>
              <p style="margin:0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:28px; line-height:32px; mso-line-height-rule:exactly; letter-spacing:2px; font-weight:bold; color:#ffffff;">${confirmationCode}</p>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f6f1e8; border:1px solid #d8c9ab;">
          <tbody>
          <tr><td style="padding:18px 20px 6px 20px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">Booking details</td></tr>
          <tr>
            <td style="padding:0 20px 18px 20px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tbody>
                <tr>
                  <td style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#2b3a4f;">Venue</td>
                  <td align="right" style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">${venueName}</td>
                </tr>
                <tr>
                  <td style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#2b3a4f;">Court</td>
                  <td align="right" style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">${courtName}</td>
                </tr>
                <tr>
                  <td style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#2b3a4f;">Date &amp; time</td>
                  <td align="right" style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,Arial,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#0f2747;">${when}</td>
                </tr>
                <tr>
                  <td style="padding:12px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">Amount paid</td>
                  <td align="right" style="padding:12px 0 0 0; font-family:'Courier New',Courier,Arial,sans-serif; font-size:20px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#1f9d55;">${amountPaid}</td>
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
      <td class="pad" style="padding:26px 32px 30px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tbody><tr>
            <td bgcolor="#f3700f" style="background-color:#f3700f; border-radius:0; padding:14px 26px;">
              <a href="${input.link}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff; text-decoration:none;">View booking</a>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="background-color:#0f2747; padding:26px 32px;">
        <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff;">AIR<span style="color:#f3700f;">/Rally</span></p>
        <p style="margin:0 0 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">Book courts. Play more.<br>Pilit Cabancalan, Mandaue City, Cebu 6014, Philippines</p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">You are receiving this because you made a booking on air-rally.com.</p>
      </td>
    </tr>

  </tbody></table>

</td></tr>
</tbody></table>


</body></html>`;
}
