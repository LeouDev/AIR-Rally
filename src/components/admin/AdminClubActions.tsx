"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setClubStatusAdminAction } from "@/lib/actions/clubs";
import type { Club } from "@/lib/supabase/types";

/**
 * Approve / suspend / restore controls for one club. Which buttons show
 * depends on where the club currently sits in moderation, so an admin is
 * never offered a transition that wouldn't change anything.
 */
export function AdminClubActions({ clubId, status }: { clubId: string; status: Club["status"] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function apply(next: Club["status"], successMessage: string) {
    if (busy) return;
    setBusy(true);
    const result = await setClubStatusAdminAction(clubId, next);
    setBusy(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(successMessage);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {status === "pending_review" && (
        <>
          <Button type="button" size="sm" disabled={busy} onClick={() => apply("active", "Club approved.")}>
            Approve
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => apply("suspended", "Club rejected.")}
          >
            Reject
          </Button>
        </>
      )}

      {status === "active" && (
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => apply("suspended", "Club suspended.")}>
          Suspend
        </Button>
      )}

      {status === "suspended" && (
        <Button type="button" size="sm" disabled={busy} onClick={() => apply("active", "Club restored.")}>
          Restore
        </Button>
      )}
    </div>
  );
}
