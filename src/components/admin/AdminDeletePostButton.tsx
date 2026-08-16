"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { deletePostAction } from "@/lib/actions/posts";

type AdminDeletePostButtonProps = {
  postId: string;
};

/**
 * `deletePostAction` needs no separate admin-only variant — RLS's own
 * `posts` DELETE policy (`auth.uid() = user_id or is_admin()`) already
 * lets an admin remove any post through the exact same call an author
 * uses to remove their own, same posture as AdminDeleteReviewButton.
 */
export function AdminDeletePostButton({ postId }: AdminDeletePostButtonProps) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleConfirm() {
    startTransition(async () => {
      const result = await deletePostAction(postId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success("Post removed");
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="icon" aria-label="Remove post" className="text-muted-foreground hover:text-destructive">
          <Trash2 className="size-4" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Remove this post?</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">This permanently deletes the post and its comments. This can&apos;t be undone.</p>
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
