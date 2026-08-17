"use client";

import { useState } from "react";
import { Flag } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { createReportAction } from "@/lib/actions/reports";
import { REPORT_REASONS, REPORT_REASON_LABELS } from "@/lib/validations/report";
import type { ReportReason, ReportTargetType } from "@/lib/supabase/types";
import { cn } from "@/lib/utils";

type ReportButtonProps = {
  targetType: ReportTargetType;
  targetId: string;
  /** What the reader is reporting, for the dialog copy: "post", "club", "player". */
  targetLabel: string;
  /** Icon-only in a crowded card footer; a full button on a detail page. */
  variant?: "icon" | "button";
  className?: string;
};

/**
 * Reporting is intentionally low-friction: pick a reason, optionally say
 * more, done. Requiring an explanation suppresses reports of exactly the
 * content that most needs reporting, because the reader has to re-read
 * and describe something they wanted to get away from.
 *
 * The dialog closes on success and does not reveal what happens next.
 * Telling a reporter "this will be reviewed within X" is a promise the
 * platform cannot currently keep, and telling them the outcome would leak
 * moderation decisions about other people.
 */
export function ReportButton({ targetType, targetId, targetLabel, variant = "icon", className }: ReportButtonProps) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [details, setDetails] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function submit() {
    if (!reason) return;
    setSubmitting(true);
    const result = await createReportAction({
      targetType,
      targetId,
      reason,
      details: details.trim() ? details.trim() : undefined,
    });
    setSubmitting(false);

    if (!result.success) {
      toast.error(result.error);
      return;
    }
    toast.success("Thanks — we've got it.");
    setOpen(false);
    setReason(null);
    setDetails("");
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {variant === "icon" ? (
          <button
            type="button"
            aria-label={`Report this ${targetLabel}`}
            className={cn("text-muted-foreground transition-colors hover:text-destructive", className)}
          >
            <Flag className="size-4" aria-hidden="true" />
          </button>
        ) : (
          <Button type="button" variant="outline" size="sm" className={cn("gap-1.5", className)}>
            <Flag className="size-4" aria-hidden="true" />
            Report
          </Button>
        )}
      </DialogTrigger>

      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Report this {targetLabel}</DialogTitle>
          <DialogDescription>
            Tell us what&apos;s wrong. Reports are private — the person you&apos;re reporting won&apos;t know who filed it.
          </DialogDescription>
        </DialogHeader>

        <fieldset className="flex flex-col gap-1.5">
          <legend className="sr-only">Reason</legend>
          {REPORT_REASONS.map((value) => (
            <label
              key={value}
              className={cn(
                "flex cursor-pointer items-center gap-3 rounded-lg border px-3 py-2 text-sm transition-colors",
                reason === value ? "border-primary bg-accent text-accent-foreground" : "border-border hover:bg-muted/50"
              )}
            >
              <input
                type="radio"
                name="report-reason"
                value={value}
                checked={reason === value}
                onChange={() => setReason(value)}
                className="size-4 accent-primary"
              />
              {REPORT_REASON_LABELS[value]}
            </label>
          ))}
        </fieldset>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="report-details">Anything else? (optional)</Label>
          <textarea
            id="report-details"
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1000}
            rows={3}
            className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="Add context that would help us understand."
          />
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={submit} disabled={!reason || submitting}>
            {submitting ? "Sending…" : "Send report"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
