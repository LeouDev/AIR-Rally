import { NextResponse } from "next/server";
import { logServerError } from "@/lib/errors";

/**
 * TEMPORARY — one-shot live verification of the critical-error alert
 * pipeline (see errors.ts's `critical` flag), fired against real
 * production env vars (OPS_ALERT_EMAIL, RESEND_API_KEY) rather than a
 * mocked test. Deleted immediately after this single use; not meant to
 * remain in the codebase.
 */
export async function GET(request: Request): Promise<Response> {
  const secret = new URL(request.url).searchParams.get("secret");
  if (secret !== process.env.TEST_LIVE_ALERT_SECRET) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  logServerError(
    "TEST.liveOpsAlertCheck",
    new Error("One-off live verification of the critical-error alert pipeline — not a real incident, safe to ignore."),
    { critical: true }
  );

  return NextResponse.json({ triggered: true });
}
