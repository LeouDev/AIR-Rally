"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { resolveReportAction } from "@/lib/actions/reports";

/**
 * Two outcomes, both terminal. "Reviewed" means the moderator acted on it
 * (the content was removed, the account warned); "Dismissed" means there
 * was nothing to act on. Re-opening is deliberately not offered — a
 * resolved report that needs revisiting is better served by the reporter
 * filing again, which the partial unique index allows.
 */
export function ResolveReportButtons({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<"reviewed" | "dismissed" | null>(null);

  async function resolve(status: "reviewed" | "dismissed") {
    setPending(status);
    const result = await resolveReportAction({ reportId, status });
    setPending(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success(status === "reviewed" ? "Marked as actioned." : "Dismissed.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      <Button type="button" size="sm" onClick={() => resolve("reviewed")} disabled={pending !== null}>
        {pending === "reviewed" ? "Saving…" : "Mark actioned"}
      </Button>
      <Button
        type="button"
        size="sm"
        variant="outline"
        onClick={() => resolve("dismissed")}
        disabled={pending !== null}
      >
        {pending === "dismissed" ? "Saving…" : "Dismiss"}
      </Button>
    </div>
  );
}
