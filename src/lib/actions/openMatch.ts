"use server";

import { getServerClient, type ActionResult } from "@/lib/actions/auth";
import { getPublicOpenMatch, type PublicOpenMatch } from "@/lib/services/openMatch";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";

/**
 * NO-SESSION READ. The public open-match invite page's only data source
 * — see getPublicOpenMatch()'s own comment for exactly what it returns
 * and withholds. getServerClient() works unauthenticated the same way it
 * does for getPublicRankedMatchSummaryAction(); the grant on
 * get_open_match_public() itself is what actually gates this, not this
 * action.
 */
export async function getPublicOpenMatchAction(openMatchId: string): Promise<ActionResult<PublicOpenMatch | null>> {
  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  try {
    const match = await getPublicOpenMatch(supabase, openMatchId);
    return { success: true, data: match };
  } catch (error) {
    logServerError("openMatch.publicSummary", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }
}
