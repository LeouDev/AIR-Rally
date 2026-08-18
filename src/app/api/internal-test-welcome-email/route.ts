import { NextResponse } from "next/server";
import { sendEmail } from "@/lib/services/email";
import { renderOwnerWelcomeEmail } from "@/lib/emails/ownerWelcomeEmail";

/**
 * TEMPORARY — one-shot live verification of the owner welcome email,
 * fired against real production Resend credentials rather than a mocked
 * test. Sends to OPS_ALERT_EMAIL (already configured for the critical-
 * error alert pipeline) so no new recipient config is needed. Deleted
 * immediately after this single use; not meant to remain in the codebase.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.TEST_WELCOME_EMAIL_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const to = process.env.OPS_ALERT_EMAIL;
  if (!to) {
    return NextResponse.json({ error: "OPS_ALERT_EMAIL not configured" }, { status: 500 });
  }

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://air-rally.com";
  const sent = await sendEmail({
    to,
    subject: "You're approved as an AIR/Rally venue owner",
    html: renderOwnerWelcomeEmail(siteUrl),
  });

  return NextResponse.json({ sent });
}
