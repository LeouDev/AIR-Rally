import { NextResponse } from "next/server";
import { createBearerClient } from "@/lib/supabase/bearer";
import { deleteAccount } from "@/lib/services/accountDeletion";
import { logServerError } from "@/lib/errors";

/**
 * Self-service account deletion, called from the mobile app's Account
 * settings screen (see the mobile repo's src/lib/account.ts). Bearer auth
 * only, same shape as /api/mobile/checkout and /api/mobile/cancel — the
 * token is verified with auth.getUser() before anything runs, then the
 * real work happens in lib/services/accountDeletion.ts under the
 * service-role client, because banning the auth.users row and scrubbing
 * its email needs the Supabase Admin API, which no RLS-scoped client can
 * reach. See that module and supabase/migrations/20260810000074 for why
 * this anonymizes in place rather than deleting the row outright.
 */
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, content-type",
} as const;

export function OPTIONS(): NextResponse {
  return new NextResponse(null, { status: 204, headers: CORS_HEADERS });
}

export async function POST(request: Request): Promise<NextResponse> {
  const authorization = request.headers.get("authorization") ?? "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice("Bearer ".length).trim() : "";
  if (!token) {
    return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401, headers: CORS_HEADERS });
  }

  const supabase = createBearerClient(token);
  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser(token);
  if (userError || !user) {
    return NextResponse.json({ success: false, error: "Sign in first." }, { status: 401, headers: CORS_HEADERS });
  }

  try {
    const result = await deleteAccount(user.id);
    if (!result.success) {
      logServerError("account.delete", new Error(result.error));
      return NextResponse.json({ success: false, error: result.error }, { headers: CORS_HEADERS });
    }
    return NextResponse.json({ success: true, data: null }, { headers: CORS_HEADERS });
  } catch (error) {
    logServerError("account.delete", error);
    return NextResponse.json(
      { success: false, error: "We couldn't delete your account. Please try again." },
      { headers: CORS_HEADERS }
    );
  }
}
