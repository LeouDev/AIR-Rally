"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Settings, LayoutGrid, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ProfileForm } from "@/components/profile/ProfileForm";
import type { Profile } from "@/lib/supabase/types";

type ProfileActionsMenuProps = {
  profile: Profile;
  email: string;
};

/**
 * Replaces the always-visible account-details form with three explicit
 * entry points: Account Settings (the form, now behind a dialog),
 * COURT/Side (the community hub at /court-side), and Play (routes into
 * the real find-a-court flow, the closest existing equivalent).
 */
export function ProfileActionsMenu({ profile, email }: ProfileActionsMenuProps) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const router = useRouter();

  return (
    <>
      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" className="gap-2" onClick={() => setSettingsOpen(true)}>
          <Settings className="size-4" aria-hidden="true" />
          Account Settings
        </Button>
        <Button type="button" variant="outline" className="gap-2" onClick={() => router.push("/court-side")}>
          <LayoutGrid className="size-4" aria-hidden="true" />
          COURT/Side
        </Button>
        <Button type="button" variant="outline" className="gap-2" onClick={() => router.push("/explore")}>
          <Play className="size-4" aria-hidden="true" />
          Play
        </Button>
      </div>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Account settings</DialogTitle>
          </DialogHeader>
          <ProfileForm profile={profile} email={email} />
        </DialogContent>
      </Dialog>
    </>
  );
}
