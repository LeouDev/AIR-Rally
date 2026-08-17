"use client";

import { useState } from "react";
import { toast } from "sonner";
import { updateEmailNotificationPreferenceAction } from "@/lib/actions/profile";

type EmailNotificationToggleProps = {
  initialEnabled: boolean;
};

/**
 * On/off, not a per-notification-type matrix — see the migration
 * (20260810000060) for why. Optimistic like NotificationBell's own
 * mark-read pattern: flip immediately, revert only if the write fails.
 */
export function EmailNotificationToggle({ initialEnabled }: EmailNotificationToggleProps) {
  const [enabled, setEnabled] = useState(initialEnabled);
  const [isSaving, setIsSaving] = useState(false);

  async function handleToggle() {
    const next = !enabled;
    setEnabled(next);
    setIsSaving(true);
    const result = await updateEmailNotificationPreferenceAction(next);
    setIsSaving(false);
    if (!result.success) {
      setEnabled(!next);
      toast.error(result.error);
      return;
    }
    toast.success(next ? "Email notifications turned on" : "Email notifications turned off");
  }

  return (
    <div className="flex items-center justify-between gap-4 rounded-xl border border-border p-4">
      <div>
        <p className="text-sm font-medium text-foreground">Email notifications</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          Get an email copy of your notifications — bookings, credits, and more. This never affects what shows up in the app itself.
        </p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={enabled}
        onClick={handleToggle}
        disabled={isSaving}
        className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:opacity-60 ${
          enabled ? "bg-primary" : "bg-muted"
        }`}
      >
        <span
          className={`inline-block size-4 transform rounded-full bg-white transition-transform ${enabled ? "translate-x-6" : "translate-x-1"}`}
        />
      </button>
    </div>
  );
}
