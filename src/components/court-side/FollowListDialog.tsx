"use client";

import Link from "next/link";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { initialsFrom } from "@/components/court-side/PostCard";
import type { PublicProfile } from "@/lib/supabase/types";

type FollowListDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  profiles: PublicProfile[] | null;
  emptyMessage: string;
  onNavigate?: () => void;
};

/** Reusable follower/following list — used from both the main feed's stats row and a user's own COURT/Side profile. `profiles === null` means still loading. */
export function FollowListDialog({ open, onOpenChange, title, profiles, emptyMessage, onNavigate }: FollowListDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex max-h-96 flex-col gap-1 overflow-y-auto">
          {profiles === null ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Loading…</p>
          ) : profiles.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">{emptyMessage}</p>
          ) : (
            profiles.map((profile) => {
              const name = profile.display_name || "Player";
              return (
                <Link
                  key={profile.id}
                  href={`/court-side/${profile.id}`}
                  onClick={onNavigate}
                  className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted"
                >
                  <Avatar>
                    {profile.avatar_url && <AvatarImage src={profile.avatar_url} alt="" />}
                    <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
                      {initialsFrom(name)}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium text-foreground">{name}</span>
                </Link>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
