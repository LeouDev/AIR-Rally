"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { setSupportRequestStatusAction } from "@/lib/actions/reports";
import type { SupportStatus } from "@/lib/supabase/types";

const NEXT_STATES: Record<SupportStatus, { value: SupportStatus; label: string }[]> = {
  open: [
    { value: "in_progress", label: "Start" },
    { value: "resolved", label: "Resolve" },
  ],
  in_progress: [
    { value: "resolved", label: "Resolve" },
    { value: "closed", label: "Close" },
  ],
  // Reopening clears resolved_by/resolved_at in the service, because the
  // support_resolution_complete CHECK would otherwise leave the row
  // claiming a resolver it no longer has.
  resolved: [{ value: "open", label: "Reopen" }],
  closed: [{ value: "open", label: "Reopen" }],
};

export function SupportStatusButtons({ requestId, status }: { requestId: string; status: SupportStatus }) {
  const router = useRouter();
  const [pending, setPending] = useState<SupportStatus | null>(null);

  async function move(next: SupportStatus) {
    setPending(next);
    const result = await setSupportRequestStatusAction(requestId, next);
    setPending(null);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Updated.");
    router.refresh();
  }

  return (
    <div className="flex flex-wrap gap-2">
      {NEXT_STATES[status].map((option, i) => (
        <Button
          key={option.value}
          type="button"
          size="sm"
          variant={i === 0 ? "default" : "outline"}
          onClick={() => move(option.value)}
          disabled={pending !== null}
        >
          {pending === option.value ? "Saving…" : option.label}
        </Button>
      ))}
    </div>
  );
}
