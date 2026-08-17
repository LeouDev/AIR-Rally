import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { sendEmail } from "@/lib/services/email";
import { notificationHref, displayMessage } from "@/lib/notificationRoutes";
import { logServerError } from "@/lib/errors";

/**
 * Receives a Supabase Database Webhook fired on INSERT to `notifications`,
 * and emails a copy of it. Configured in the Supabase dashboard (Database
 * → Webhooks), NOT by a migration — same posture as the PayMongo webhook
 * URL, which is registered in PayMongo's own dashboard rather than
 * anything in this repo (see docs/DEPLOYMENT.md). Point it at
 * POST /api/webhooks/notification-created, table `notifications`, event
 * `INSERT`, with an HTTP header `x-webhook-secret` set to the same value
 * as SUPABASE_DB_WEBHOOK_SECRET below.
 *
 * Every notification already exists in-app the instant its row is
 * inserted — this route only ever adds an email on top. It must never be
 * able to make that worse: a slow, failing, or misconfigured mail
 * provider cannot be allowed to affect the notification that already
 * happened, so every failure here is caught, logged, and answered with a
 * 200 (retrying can't fix "the address bounced" or "the API key is
 * wrong," and Supabase, like PayMongo/Stripe, retries on non-2xx).
 *
 * The shared secret is the entire authority — this endpoint carries no
 * user session and reaches auth.admin, so it must not be guessable or
 * left unauthenticated. Same idiom as verifying a payment webhook's
 * signature, just symmetric (one static secret) rather than HMAC, because
 * Supabase Database Webhooks sign with a header value you choose, not a
 * computed signature.
 */
export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.SUPABASE_DB_WEBHOOK_SECRET;
  if (!expectedSecret) {
    logServerError("notificationWebhook", new Error("SUPABASE_DB_WEBHOOK_SECRET isn't set"));
    return NextResponse.json({ error: "Not configured" }, { status: 500 });
  }

  const providedSecret = request.headers.get("x-webhook-secret");
  if (providedSecret !== expectedSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let payload: SupabaseInsertWebhookPayload;
  try {
    payload = await request.json();
  } catch (error) {
    logServerError("notificationWebhook.parse", error);
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "notifications" || !payload.record) {
    // Not the event this route cares about — acknowledge and move on
    // rather than error, in case the webhook is ever configured broader
    // than intended.
    return NextResponse.json({ received: true, ignored: true });
  }

  const notification = payload.record;

  try {
    // Service role: this route carries no user session, and reading
    // another user's email requires the admin API. Authority is the
    // shared secret verified above, the same shape as every other
    // service-role call in this app being gated on a caller-independent
    // proof rather than auth.uid().
    const supabase = createServiceRoleClient();
    const { data, error } = await supabase.auth.admin.getUserById(notification.user_id);
    if (error || !data.user?.email) {
      logServerError(
        "notificationWebhook.noEmail",
        error ?? new Error(`user ${notification.user_id} has no email on file`)
      );
      return NextResponse.json({ received: true, emailed: false });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://air-rally.com";
    const href = notificationHref(notification);
    const link = href.startsWith("http") ? href : `${siteUrl}${href}`;

    const sent = await sendEmail({
      to: data.user.email,
      subject: notification.title,
      html: renderNotificationEmail({ title: notification.title, message: displayMessage(notification.message), link }),
    });

    return NextResponse.json({ received: true, emailed: sent });
  } catch (error) {
    logServerError("notificationWebhook.send", error);
    // Still 200 — see the file-level comment on why a mail failure must
    // never look like the notification itself failed.
    return NextResponse.json({ received: true, emailed: false });
  }
}

/** What Supabase POSTs for a Database Webhook configured on an INSERT event. */
type SupabaseInsertWebhookPayload = {
  type: string;
  table: string;
  schema: string;
  record: {
    id: string;
    user_id: string;
    type: string;
    title: string;
    message: string;
    link_url: string | null;
  } | null;
};

/**
 * One generic template for every notification type, deliberately — see
 * NotificationBell.tsx's own comment on the DB emitting more types than
 * any single union lists. A per-type template system is a real feature
 * this pass isn't building; title + message + a link back into the app
 * covers every type that exists today without guessing at 12 designs.
 */
function renderNotificationEmail(input: { title: string; message: string; link: string }): string {
  const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f5f1ea;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
    <table role="presentation" width="100%" style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:16px;overflow:hidden;">
      <tr><td style="padding:24px;">
        <p style="margin:0 0 4px;font-size:13px;font-weight:600;letter-spacing:0.02em;color:#ea580c;">AIR/RALLY</p>
        <h1 style="margin:0 0 12px;font-size:20px;line-height:1.3;color:#1f2937;">${escape(input.title)}</h1>
        <p style="margin:0 0 20px;font-size:14px;line-height:1.5;color:#4b5563;">${escape(input.message)}</p>
        <a href="${input.link}" style="display:inline-block;padding:10px 20px;background:#ea580c;color:#ffffff;text-decoration:none;border-radius:999px;font-size:14px;font-weight:600;">Open in AIR/Rally</a>
      </td></tr>
    </table>
  </body>
</html>`;
}
