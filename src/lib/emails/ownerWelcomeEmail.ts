/**
 * Owner-welcome-email template — separated from route.ts because App
 * Router route files may only export HTTP method handlers, and this
 * needs to be a plain importable/testable function.
 */
/**
 * Sent once, the moment owner_applications transitions to 'approved'
 * (see supabase/migrations/20260810000065_owner_application_approved_
 * notification.sql). Fully static — no per-owner data to fetch, unlike
 * the booking receipt above — but every link had to be corrected against
 * the app's real routes: the source design referenced /dashboard/venues,
 * /owners/manual, /owners/agreement, /owners/email-preferences and
 * /unsubscribe, none of which exist. /owners/manual in particular has no
 * real destination at all — repointed at /support rather than shipping a
 * dead link in a new owner's first email.
 */
export function renderOwnerWelcomeEmail(siteUrl: string): string {
  const dashboardLink = `${siteUrl}/list-your-court`;
  const supportLink = `${siteUrl}/support`;
  const agreementLink = `${siteUrl}/owner-agreement`;
  const settingsLink = `${siteUrl}/list-your-court/settings`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>You're approved as an AIR/Rally venue owner</title>
<!--[if mso]>
<xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch></o:OfficeDocumentSettings></xml>
<![endif]-->
<style>
  @media only screen and (max-width:600px) {
    .wrap { width:100% !important; }
    .pad { padding-left:20px !important; padding-right:20px !important; }
    .h1 { font-size:26px !important; line-height:32px !important; }
    .stack { display:block !important; width:100% !important; }
  }
</style>
</head>
<body style="margin:0; padding:0; background-color:#e6dac6; -webkit-text-size-adjust:100%; -ms-text-size-adjust:100%;">
<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">Your application is approved. Seven steps to your first booking, plus exactly how the money reaches your bank.</span>

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
            <td align="right" style="font-family:'Courier New',Courier,monospace; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#e6dac6; text-transform:uppercase;">
              Venue Owners
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>
    <tr><td style="height:4px; background-color:#f3700f; font-size:0; line-height:0;">&nbsp;</td></tr>

    <tr>
      <td class="pad" style="padding:36px 32px 8px 32px;">
        <p style="margin:0 0 14px 0; font-family:'Courier New',Courier,monospace; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Application approved</p>
        <h1 class="h1" style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:32px; line-height:38px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.8px; color:#0f2747;">You can start listing your courts.</h1>
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:16px 32px 28px 32px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#2b3a4f;">
        <p style="margin:0 0 14px 0;">Thank you for applying. Your owner account is active, so the dashboard is now open to you: Overview, Venues, Calendar, Bookings, Earnings and Settings.</p>
        <p style="margin:0;">Seven things need to be complete before your venue can take a real booking. They are listed below in the order the dashboard checks them.</p>
      </td>
    </tr>

    <tr><td class="pad" style="padding:0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody><tr><td style="height:2px; background-color:#0f2747; font-size:0; line-height:0;">&nbsp;</td></tr></tbody></table></td></tr>

    <tr>
      <td class="pad" style="padding:28px 32px 8px 32px;">
        <p style="margin:0 0 18px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">Your setup checklist</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tbody>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">01</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:14px;"><strong style="color:#0f2747;">Business information</strong> — name, description, phone, email.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">02</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:14px;"><strong style="color:#0f2747;">Address</strong> — street, city, country.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">03</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:14px;"><strong style="color:#0f2747;">At least one active court</strong> — name, surface, indoor or outdoor, capacity.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">04</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:14px;"><strong style="color:#0f2747;">An hourly price above ₱0</strong> on every active court.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">05</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:14px;"><strong style="color:#0f2747;">Operating hours</strong> — set at least one window. With no hours saved, every day shows as closed and nobody can book.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">06</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:14px;"><strong style="color:#0f2747;">Platform approval</strong> — draft, then pending review, then active. We check the listing ourselves.</td>
          </tr>
          <tr>
            <td width="34" valign="top" style="width:34px; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#f3700f; font-weight:bold;">07</td>
            <td valign="top" style="font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f; padding-bottom:6px;"><strong style="color:#0f2747;">Payout details</strong> — the bank account we send your earnings to.</td>
          </tr>
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:22px 32px 30px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tbody><tr>
            <td bgcolor="#f3700f" style="background-color:#f3700f; border-radius:0; padding:14px 26px;">
              <a href="${dashboardLink}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff; text-decoration:none;">Finish my venue setup</a>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="background-color:#0f2747; padding:32px;">
        <p style="margin:0 0 14px 0; font-family:'Courier New',Courier,monospace; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">How the money works</p>
        <h2 style="margin:0 0 16px 0; font-family:Arial,Helvetica,sans-serif; font-size:24px; line-height:30px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.5px; color:#ffffff;">You keep 95% of your court price.</h2>
        <p style="margin:0 0 22px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:25px; mso-line-height-rule:exactly; color:#cfd8e4;">AIR/Rally takes a 5% commission on the court price. The payment processing fee is added on top of what the customer pays, so it never comes out of your share.</p>

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f6f1e8;">
          <tbody><tr>
            <td style="padding:16px 18px 6px 18px; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">One hour, priced at ₱400</td>
          </tr>
          <tr>
            <td style="padding:0 18px 16px 18px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tbody>
                <tr>
                  <td style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#2b3a4f;">Customer pays</td>
                  <td align="right" style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#0f2747;">₱406.09</td>
                </tr>
                <tr>
                  <td style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#2b3a4f;">AIR/Rally commission (5%)</td>
                  <td align="right" style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#0f2747;">₱20.00</td>
                </tr>
                <tr>
                  <td style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#2b3a4f;">Payment processing, paid by the customer</td>
                  <td align="right" style="padding:9px 0; border-bottom:1px solid #e6dac6; font-family:'Courier New',Courier,monospace; font-size:15px; line-height:20px; mso-line-height-rule:exactly; color:#0f2747;">₱6.09</td>
                </tr>
                <tr>
                  <td style="padding:12px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">You are owed</td>
                  <td align="right" style="padding:12px 0 0 0; font-family:'Courier New',Courier,monospace; font-size:20px; line-height:22px; mso-line-height-rule:exactly; font-weight:bold; color:#1f9d55;">₱380.00</td>
                </tr>
                </tbody>
              </table>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:28px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f6f1e8; border:2px solid #f3700f;">
          <tbody><tr>
            <td style="padding:22px 22px 20px 22px;">
              <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:18px; line-height:24px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">Payouts are not automatic yet. Please read this part.</p>
              <p style="margin:0 0 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:25px; mso-line-height-rule:exactly; color:#2b3a4f;">When a booking shows <strong>Paid</strong>, it means the customer's payment went through. It does <strong>not</strong> mean we have sent you money yet.</p>
              <p style="margin:0 0 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:25px; mso-line-height-rule:exactly; color:#2b3a4f;">Transfers are arranged manually by our team, by PESONet bank transfer, to the account on file. Your earnings become payable once the booked court time has actually been played, not when it is booked.</p>
              <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:25px; mso-line-height-rule:exactly; color:#2b3a4f;">So keep your bank details correct in Settings, and expect a transfer arranged by a person rather than a system.</p>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:32px 32px 0 32px;">
        <p style="margin:0 0 16px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">Good to know before your first booking</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tbody>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">Bookings are whole hours, 1 to 4 hours long, with at least 30 minutes' notice and up to 30 days ahead.</td>
          </tr>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">Your calendar shows four states: available, booked, blocked and closed. Block time off before someone books it.</td>
          </tr>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">A player who cancels 48 hours or more ahead receives AIR/Rally Credits, not cash. Credits never expire, and the processing fee is not refundable.</td>
          </tr>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">Players can reschedule up to 24 hours before the start time. Courts are deactivated instead of deleted, so your booking history stays intact.</td>
          </tr>
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:28px 32px 36px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tbody><tr>
            <td class="stack" width="50%" valign="top" style="width:50%; padding-right:8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tbody><tr>
                  <td style="border:2px solid #0f2747; padding:13px 16px;">
                    <a href="${supportLink}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; text-decoration:none;">Get Support</a>
                  </td>
                </tr>
              </tbody></table>
            </td>
            <td class="stack" width="50%" valign="top" style="width:50%; padding-left:8px;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tbody><tr>
                  <td style="border:2px solid #0f2747; padding:13px 16px;">
                    <a href="${agreementLink}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; text-decoration:none;">Owner Agreement</a>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
        </tbody></table>
        <p style="margin:18px 0 0 0; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:23px; mso-line-height-rule:exactly; color:#5a6675;">Questions about anything above, reply to this email or write to <a href="mailto:owners@air-rally.com" style="color:#c25309; text-decoration:underline;">owners@air-rally.com</a>.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="background-color:#0f2747; padding:26px 32px;">
        <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff;">AIR<span style="color:#f3700f;">/Rally</span></p>
        <p style="margin:0 0 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">Book courts. Play more.<br>Pilit Cabancalan, Mandaue City, Cebu 6014, Philippines</p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">You are receiving this because you applied to list a venue on air-rally.com.<br><a href="${settingsLink}" style="color:#e6dac6; text-decoration:underline;">Email preferences</a></p>
      </td>
    </tr>

  </tbody></table>

</td></tr>
</tbody></table>


</body></html>`;
}
