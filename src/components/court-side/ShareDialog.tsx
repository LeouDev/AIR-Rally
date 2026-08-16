"use client";

import { Copy } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { InstagramIcon, MessengerIcon, IMessageIcon, ThreadsIcon, XIcon, TikTokIcon } from "@/components/court-side/ShareIcons";

const SHARE_NETWORKS = [
  { name: "Instagram", Icon: InstagramIcon },
  { name: "Messenger", Icon: MessengerIcon },
  { name: "iMessage", Icon: IMessageIcon },
  { name: "Threads", Icon: ThreadsIcon },
  { name: "X", Icon: XIcon },
  { name: "TikTok", Icon: TikTokIcon },
  { name: "Copy link", Icon: Copy },
] as const;

type ShareDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/** Shared by the main feed and a user's own COURT/Side profile — one share sheet, not two. */
export function ShareDialog({ open, onOpenChange }: ShareDialogProps) {
  function handleChoice(name: (typeof SHARE_NETWORKS)[number]["name"]) {
    onOpenChange(false);
    if (name === "Copy link") {
      navigator.clipboard?.writeText(window.location.href);
      toast.success("Link copied to clipboard.");
    } else {
      toast(`Opening ${name} share…`);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Send it your way.</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-3 gap-2.5">
          {SHARE_NETWORKS.map(({ name, Icon }) => (
            <button
              key={name}
              type="button"
              onClick={() => handleChoice(name)}
              className="flex flex-col items-center gap-2 rounded-xl border border-border p-3 text-xs font-medium text-foreground hover:bg-muted"
            >
              <Icon className="size-6" />
              {name}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
