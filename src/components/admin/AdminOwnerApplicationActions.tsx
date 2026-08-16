"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { approveOwnerApplicationAction, rejectOwnerApplicationAction } from "@/lib/actions/ownerApplications";
import type { OwnerApplicationStatus } from "@/lib/supabase/types";

type AdminOwnerApplicationActionsProps = {
  applicationId: string;
  applicantName: string;
  status: OwnerApplicationStatus;
};

export function AdminOwnerApplicationActions({ applicationId, applicantName, status }: AdminOwnerApplicationActionsProps) {
  const [openDialog, setOpenDialog] = useState<"approve" | "reject" | null>(null);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function handleApprove() {
    startTransition(async () => {
      const result = await approveOwnerApplicationAction(applicationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${applicantName} is now an approved venue owner.`);
      setOpenDialog(null);
      router.refresh();
    });
  }

  function handleReject() {
    startTransition(async () => {
      const result = await rejectOwnerApplicationAction(applicationId);
      if (!result.success) {
        toast.error(result.error);
        return;
      }
      toast.success(`${applicantName}'s application was rejected.`);
      setOpenDialog(null);
      router.refresh();
    });
  }

  if (status !== "pending") return null;

  return (
    <div className="flex shrink-0 gap-2">
      <Dialog open={openDialog === "reject"} onOpenChange={(open) => setOpenDialog(open ? "reject" : null)}>
        <DialogTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            Reject
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Reject {applicantName}&apos;s application?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">They can submit a new application at any time afterward.</p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpenDialog(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" variant="destructive" disabled={isPending} onClick={handleReject}>
              {isPending ? "Rejecting…" : "Yes, reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={openDialog === "approve"} onOpenChange={(open) => setOpenDialog(open ? "approve" : null)}>
        <DialogTrigger asChild>
          <Button type="button" size="sm">
            Approve
          </Button>
        </DialogTrigger>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Approve {applicantName} as a venue owner?</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground">
            This grants their account venue-owner access — they&apos;ll be able to create and manage real venues from
            their owner dashboard.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpenDialog(null)} disabled={isPending}>
              Cancel
            </Button>
            <Button type="button" disabled={isPending} onClick={handleApprove}>
              {isPending ? "Approving…" : "Yes, approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
