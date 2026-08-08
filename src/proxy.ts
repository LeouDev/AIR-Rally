import type { NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export function proxy(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Run on everything except static assets and image optimization
     * requests, so auth cookies stay fresh across normal navigation
     * without proxy paying to re-run on every CSS/JS/image fetch.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|brand/).*)",
  ],
};
