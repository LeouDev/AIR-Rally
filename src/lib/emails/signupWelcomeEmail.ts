/**
 * Signup-welcome-email template — same pattern as ownerWelcomeEmail.ts:
 * separated into its own file so it stays a plain importable/testable
 * function rather than living inline in a server action.
 *
 * Sent once, right after signup finishes, from both paths in
 * src/lib/actions/auth.ts — signUp() (email/password) and
 * completeOAuthSignup() (Google/Facebook, which has no checkbox moment
 * of its own to hang this off of, so it fires from the same place the
 * agreement gets recorded). Fully static — no per-user data to fetch,
 * same posture as the owner-welcome email — so one render function
 * covers both signup paths.
 */
export function renderSignupWelcomeEmail(siteUrl: string): string {
  const exploreLink = `${siteUrl}/explore`;
  const openPlayLink = `${siteUrl}/events`;
  const clubsLink = `${siteUrl}/clubs`;
  const termsLink = `${siteUrl}/terms`;
  const privacyLink = `${siteUrl}/privacy`;

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>You're ready to play on AIR/Rally</title>
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
<span style="display:none !important; visibility:hidden; opacity:0; color:transparent; height:0; width:0; overflow:hidden; mso-hide:all; font-size:1px; line-height:1px;">Your account is ready. Here's what to know before your first booking, and where to find what you agreed to.</span>

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
              Players
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>
    <tr><td style="height:4px; background-color:#f3700f; font-size:0; line-height:0;">&nbsp;</td></tr>

    <tr>
      <td class="pad" style="padding:36px 32px 8px 32px;">
        <p style="margin:0 0 14px 0; font-family:'Courier New',Courier,monospace; font-size:11px; line-height:14px; mso-line-height-rule:exactly; letter-spacing:1.5px; color:#f3700f; text-transform:uppercase;">Account created</p>
        <h1 class="h1" style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:32px; line-height:38px; mso-line-height-rule:exactly; font-weight:bold; letter-spacing:-0.8px; color:#0f2747;">You're ready to play.</h1>
      </td>
    </tr>
    <tr>
      <td class="pad" style="padding:16px 32px 28px 32px; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#2b3a4f;">
        <p style="margin:0 0 14px 0;">Welcome to AIR/Rally — the fastest way to find and book a pickleball court in the Philippines. Your account is set up, so here's what's next.</p>
        <p style="margin:0;">Browse courts near you, book by the hour, and get a confirmation the moment your payment goes through.</p>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:22px 32px 30px 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0">
          <tbody><tr>
            <td bgcolor="#f3700f" style="background-color:#f3700f; border-radius:0; padding:14px 26px;">
              <a href="${exploreLink}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff; text-decoration:none;">Find a court</a>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr><td class="pad" style="padding:0 32px;"><table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%"><tbody><tr><td style="height:2px; background-color:#0f2747; font-size:0; line-height:0;">&nbsp;</td></tr></tbody></table></td></tr>

    <tr>
      <td class="pad" style="padding:28px 32px 0 32px;">
        <p style="margin:0 0 16px 0; font-family:Arial,Helvetica,sans-serif; font-size:13px; line-height:16px; mso-line-height-rule:exactly; letter-spacing:1px; font-weight:bold; color:#0f2747; text-transform:uppercase;">Good to know</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
          <tbody>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">Bookings are whole hours, 1 to 4 hours long, from 30 minutes to 30 days ahead.</td>
          </tr>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">Cancel 48 hours or more ahead and you get AIR/Rally Credits, not cash — they never expire.</td>
          </tr>
          <tr>
            <td style="padding:12px 0; border-top:1px solid #e6dac6; border-bottom:1px solid #e6dac6; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:24px; mso-line-height-rule:exactly; color:#2b3a4f;">Playing with others? Join an <a href="${openPlayLink}" style="color:#c25309; text-decoration:underline;">Open Play</a> game, or find your people in a <a href="${clubsLink}" style="color:#c25309; text-decoration:underline;">Club</a>.</td>
          </tr>
          </tbody>
        </table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:28px 32px 0 32px;">
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f6f1e8; border:2px solid #f3700f;">
          <tbody><tr>
            <td style="padding:22px 22px 24px 22px;">
              <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:18px; line-height:24px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747;">What you agreed to</p>
              <p style="margin:0 0 18px 0; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:25px; mso-line-height-rule:exactly; color:#2b3a4f;">Creating an account means you accepted our User Agreement and Privacy Policy. Nothing to sign, nothing to do — just worth knowing where to find them.</p>
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tbody><tr>
                  <td class="stack" width="50%" valign="top" style="width:50%; padding-right:8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tbody><tr>
                        <td style="border:2px solid #0f2747; padding:13px 16px;">
                          <a href="${termsLink}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; text-decoration:none;">User Agreement</a>
                        </td>
                      </tr>
                    </tbody></table>
                  </td>
                  <td class="stack" width="50%" valign="top" style="width:50%; padding-left:8px;">
                    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                      <tbody><tr>
                        <td style="border:2px solid #0f2747; padding:13px 16px;">
                          <a href="${privacyLink}" style="display:block; font-family:Arial,Helvetica,sans-serif; font-size:15px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#0f2747; text-decoration:none;">Privacy Policy</a>
                        </td>
                      </tr>
                    </tbody></table>
                  </td>
                </tr>
              </tbody></table>
            </td>
          </tr>
        </tbody></table>
      </td>
    </tr>

    <tr>
      <td class="pad" style="padding:28px 32px 36px 32px; font-family:Arial,Helvetica,sans-serif; font-size:14px; line-height:23px; mso-line-height-rule:exactly; color:#5a6675;">
        Questions about anything above, reply to this email or write to <a href="mailto:support@air-rally.com" style="color:#c25309; text-decoration:underline;">support@air-rally.com</a>.
      </td>
    </tr>

    <tr>
      <td class="pad" style="background-color:#0f2747; padding:26px 32px;">
        <p style="margin:0 0 10px 0; font-family:Arial,Helvetica,sans-serif; font-size:16px; line-height:20px; mso-line-height-rule:exactly; font-weight:bold; color:#ffffff;">AIR<span style="color:#f3700f;">/Rally</span></p>
        <p style="margin:0 0 12px 0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">Book courts. Play more.<br>Pilit Cabancalan, Mandaue City, Cebu 6014, Philippines</p>
        <p style="margin:0; font-family:Arial,Helvetica,sans-serif; font-size:12px; line-height:19px; mso-line-height-rule:exactly; color:#a9b6c7;">You are receiving this because you created an account on air-rally.com.</p>
      </td>
    </tr>

  </tbody></table>

</td></tr>
</tbody></table>


</body></html>`;
}
