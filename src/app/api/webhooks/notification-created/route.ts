import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { sendEmail } from "@/lib/services/email";
import { renderBookingReceiptEmail } from "@/lib/emails/bookingReceiptEmail";
import { renderSignupWelcomeEmail } from "@/lib/emails/signupWelcomeEmail";
import { renderPayoutPayslipEmail } from "@/lib/emails/payoutPayslipEmail";
import { notificationHref, displayMessage } from "@/lib/notificationRoutes";
import { getBookingById } from "@/lib/services/bookings";
import { getCourtDisplayInfo } from "@/lib/services/courts";
import { getPayoutSummaryForTransfer } from "@/lib/services/payouts";
import { calculateAmountPaid } from "@/lib/services/bookingFee";
import { formatVenueRange } from "@/lib/bookingTime";
import { isCreditOnly } from "@/lib/paymentState";
import { logServerError } from "@/lib/errors";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/types";

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

    // The account-settings toggle. Checked here, not skipped upstream —
    // the in-app notification (already written by the time this route
    // runs) must exist regardless of this preference; only the EMAIL
    // copy is conditional on it. Defaults to opted-in (the column itself
    // defaults true) if the profile row can't be read for any reason —
    // failing toward "sent" rather than silently going quiet forever.
    const { data: profileRow } = await supabase
      .from("profiles")
      .select("email_notifications_enabled")
      .eq("id", notification.user_id)
      .maybeSingle();
    if (profileRow?.email_notifications_enabled === false) {
      return NextResponse.json({ received: true, emailed: false, skipped: "opted_out" });
    }

    const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://air-rally.com";
    const href = notificationHref(notification);
    const link = href.startsWith("http") ? href : `${siteUrl}${href}`;

    // A dedicated template when we can build one honestly, the generic
    // one otherwise. Never let a failed lookup here turn into a failed
    // email — same fail-open posture as everything else in this route.
    // email_confirmed is the ONLY signal that a just-confirmed email/
    // password signup actually finished (see this migration's own
    // comment: 20260810000075_email_confirmed_notification.sql) — it's
    // fully static, unlike the receipt, so there's nothing to look up.
    const customHtml =
      notification.type === "booking_confirmed"
        ? await tryBuildBookingReceiptEmail(supabase, notification.link_url, link)
        : notification.type === "email_confirmed"
          ? renderSignupWelcomeEmail(siteUrl)
          : notification.type === "payout_sent"
            ? await tryBuildPayoutPayslipEmail(supabase, notification.link_url, notification.user_id)
            : null;
    const subject = notification.type === "email_confirmed" ? "You're ready to play on AIR/Rally" : notification.title;

    const sent = await sendEmail({
      to: data.user.email,
      subject,
      html: customHtml ?? renderNotificationEmail({ title: notification.title, message: displayMessage(notification.message), link }),
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
 * A real receipt for a booking_confirmed notification — confirmation
 * code, court, venue, date/time, amount paid — instead of the generic
 * title+message template every other notification type gets.
 *
 * Returns null on ANY failure to look the booking up (not found, court or
 * venue missing, malformed link_url): the caller falls back to the
 * generic template rather than losing the email entirely. A receipt that
 * can't be built honestly should not become no email at all.
 *
 * Reuses calculateAmountPaid() and formatVenueRange() — the exact
 * functions the in-app confirmation page uses — deliberately. This app
 * already shipped a bug once from reimplementing venue-timezone
 * formatting ("a 5PM Manila booking printed 9AM"); the fix was never
 * "write the timezone math more carefully," it was "there is exactly one
 * function that does this." A second implementation here would be the
 * same mistake in a new place.
 */
async function tryBuildBookingReceiptEmail(
  supabase: SupabaseClient<Database>,
  linkUrl: string | null,
  fallbackLink: string
): Promise<string | null> {
  const bookingId = linkUrl?.match(/^\/bookings\/([0-9a-f-]{36})\/confirmation$/i)?.[1];
  if (!bookingId) return null;

  try {
    const booking = await getBookingById(supabase, bookingId);
    if (!booking) return null;

    const display = await getCourtDisplayInfo(supabase, booking.court_id);
    if (!display) return null;

    return renderBookingReceiptEmail({
      confirmationCode: booking.confirmation_code,
      courtName: display.courtName,
      venueName: display.venueName,
      when: formatVenueRange(booking.start_time, booking.end_time, display.venueTimezone),
      amountPaid: formatMoney(calculateAmountPaid(booking), booking.currency),
      paidWithCredits: isCreditOnly(booking),
      link: fallbackLink,
    });
  } catch (error) {
    logServerError("notificationWebhook.buildReceipt", error);
    return null;
  }
}

/**
 * The itemized-summary payslip for a payout_sent notification — see
 * payoutPayslipEmail.ts's own header comment for what it shows and why
 * it's a summary rather than a per-booking list. Same shape as
 * tryBuildBookingReceiptEmail() above: parse an id out of link_url
 * (attest_payout_settled() stamps '/list-your-court/earnings?transfer=
 * <uuid>' — migration 20260810000109), look it up, return null on ANY
 * failure so the caller falls back to the generic template. A payslip
 * that fails to build must never swallow the "your money was sent"
 * notification itself — the plain notification row already exists by
 * the time this route runs regardless of what happens here.
 *
 * getPayoutSummaryForTransfer() is the SAME function
 * sendPayslipPreviewAction() calls for the admin preview — one data
 * source, one render function, both callers. See that function's own
 * comment for why that's a rule, not a preference.
 *
 * Passes recipientUserId through as getPayoutSummaryForTransfer()'s
 * defense-in-depth entitlement check — see that function's own comment.
 * Not the actual boundary (there's no client-reachable way to write a
 * mismatched payout_sent row today), but this is the one path that emails
 * a venue's revenue, bank reference, and masked account number, and the
 * check costs one query.
 */
async function tryBuildPayoutPayslipEmail(
  supabase: SupabaseClient<Database>,
  linkUrl: string | null,
  recipientUserId: string
): Promise<string | null> {
  const transferId = linkUrl?.match(/[?&]transfer=([0-9a-f-]{36})/i)?.[1];
  if (!transferId) return null;

  try {
    const summary = await getPayoutSummaryForTransfer(supabase, transferId, recipientUserId);
    if (!summary) return null;
    return renderPayoutPayslipEmail(summary);
  } catch (error) {
    logServerError("notificationWebhook.buildPayslip", error);
    return null;
  }
}

function formatMoney(amountMinorUnits: number, currency: string): string {
  const symbol = currency === "PHP" ? "₱" : `${currency} `;
  return `${symbol}${(amountMinorUnits / 100).toFixed(2)}`;
}

/**
 * The fallback for every notification type EXCEPT booking_confirmed
 * (which gets the real receipt above) — see NotificationBell.tsx's own
 * comment on the DB emitting more types than any single union lists.
 * A dedicated template per type is a real feature this pass isn't
 * building for the other eleven; title + message + a link back into the
 * app covers all of them without guessing at designs nothing asked for.
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
