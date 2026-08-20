"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { createPostAction } from "@/lib/actions/posts";

/** Publishes a post embedding this game as a joinable card — the
 * composer never has an event picker; sharing starts from the game
 * itself instead, which is the only place a caller already knows which
 * event they mean. */
export function ShareToCourtSideButton({ eventId, title }: { eventId: string; title: string }) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleClick() {
    startTransition(async () => {
      const result = await createPostAction({ content: `Join my game: ${title}`, eventId });
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Shared to COURT/Side.");
      router.push("/court-side");
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-full border border-border px-4 py-2 text-center text-sm font-medium text-foreground hover:bg-muted disabled:opacity-50"
    >
      {isPending ? "Sharing…" : "Share to COURT/Side"}
    </button>
  );
}
