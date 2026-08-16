"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deleteReviewAsAdminAction } from "@/lib/actions/review";

type AdminDeleteReviewButtonProps = {
  reviewId: string;
  venueId: string;
};

export function AdminDeleteReviewButton({ reviewId, venueId }: AdminDeleteReviewButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deleteReviewAsAdminAction(reviewId, venueId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Review removed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove review" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this review?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">This permanently deletes the review and updates the venue&apos;s rating. This can&apos;t be undone.</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button type="button" variant="destructive" disabled={isPending} onClick={handleConfirm}>
            {isPending ? "Removing…" : "Yes, remove"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
