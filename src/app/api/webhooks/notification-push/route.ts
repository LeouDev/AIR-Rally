import { NextResponse } from "next/server";
import { createServiceRoleClient } from "@/lib/supabase/serviceRole";
import { notificationHref, displayMessage } from "@/lib/notificationRoutes";
import { logServerError } from "@/lib/errors";

/**
 * Receives the pg_net webhook fired on INSERT to `notifications` (see
 * supabase/migrations/20260810000066_device_push_tokens.sql) and forwards
 * a push notification to every Expo push token the notified user has
 * registered. The sibling of /api/webhooks/notification-created, which
 * does the same for email — same shared-secret authority
 * (SUPABASE_DB_WEBHOOK_SECRET), same fail-open posture: the in-app
 * notification already exists by the time this runs, so nothing here is
 * ever allowed to look like a failure to the flow that inserted it.
 * Every failure after auth is caught, logged, and answered with a 200.
 *
 * Sends through Expo's push service (https://exp.host/--/api/v2/push/send)
 * rather than talking to APNs/FCM directly — the tokens the mobile app
 * registers are Expo push tokens, and Expo handles the per-platform
 * delivery, batching (max 100 messages per request), and receipt
 * semantics. A DeviceNotRegistered error in the response means the token
 * is permanently dead (app uninstalled, permissions revoked) and Expo
 * requires senders to stop using it — those rows are deleted here, which
 * also re-arms the trigger's "has any tokens" fast-path skip.
 */
export async function POST(request: Request): Promise<Response> {
  const expectedSecret = process.env.SUPABASE_DB_WEBHOOK_SECRET;
  if (!expectedSecret) {
    logServerError("notificationPushWebhook", new Error("SUPABASE_DB_WEBHOOK_SECRET isn't set"));
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
    logServerError("notificationPushWebhook.parse", error);
    return NextResponse.json({ error: "Malformed payload" }, { status: 400 });
  }

  if (payload.type !== "INSERT" || payload.table !== "notifications" || !payload.record) {
    return NextResponse.json({ received: true, ignored: true });
  }

  const notification = payload.record;

  try {
    const supabase = createServiceRoleClient();
    const { data: tokens, error } = await supabase
      .from("device_push_tokens")
      .select("token")
      .eq("user_id", notification.user_id);

    if (error) {
      logServerError("notificationPushWebhook.loadTokens", error);
      return NextResponse.json({ received: true, pushed: 0 });
    }
    if (!tokens || tokens.length === 0) {
      return NextResponse.json({ received: true, pushed: 0 });
    }

    const messages = tokens.map(({ token }) => ({
      to: token,
      title: notification.title,
      body: displayMessage(notification.message),
      sound: "default" as const,
      // The same in-app path the web bell and the email link resolve —
      // the mobile app maps it onto its own routes when the user taps.
      data: { url: notificationHref(notification), notificationId: notification.id },
    }));

    const deadTokens: string[] = [];
    for (const chunk of chunked(messages, 100)) {
      const tickets = await sendExpoPushChunk(chunk);
      if (!tickets) continue;
      // Tickets come back in the order the messages were sent.
      tickets.forEach((ticket, i) => {
        if (ticket.status === "error" && ticket.details?.error === "DeviceNotRegistered") {
          deadTokens.push(chunk[i].to);
        }
      });
    }

    if (deadTokens.length > 0) {
      const { error: deleteError } = await supabase
        .from("device_push_tokens")
        .delete()
        .in("token", deadTokens);
      if (deleteError) logServerError("notificationPushWebhook.pruneTokens", deleteError);
    }

    return NextResponse.json({
      received: true,
      pushed: messages.length - deadTokens.length,
      pruned: deadTokens.length,
    });
  } catch (error) {
    logServerError("notificationPushWebhook.send", error);
    return NextResponse.json({ received: true, pushed: 0 });
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

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  sound: "default";
  data: Record<string, string>;
};

type ExpoPushTicket = {
  status: "ok" | "error";
  message?: string;
  details?: { error?: string };
};

/**
 * One POST to Expo's push endpoint. Returns null (after logging) on any
 * transport or shape problem — a push that can't be delivered must never
 * escalate beyond a log line, same as a bounced email in the sibling
 * route.
 */
async function sendExpoPushChunk(chunk: ExpoPushMessage[]): Promise<ExpoPushTicket[] | null> {
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
    });
    if (!response.ok) {
      logServerError(
        "notificationPushWebhook.expo",
        new Error(`Expo push API responded ${response.status}`)
      );
      return null;
    }
    const body = (await response.json()) as { data?: ExpoPushTicket[] };
    if (!Array.isArray(body.data) || body.data.length !== chunk.length) {
      logServerError(
        "notificationPushWebhook.expo",
        new Error("Expo push API returned an unexpected ticket shape")
      );
      return null;
    }
    return body.data;
  } catch (error) {
    logServerError("notificationPushWebhook.expo", error);
    return null;
  }
}

function chunked<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
