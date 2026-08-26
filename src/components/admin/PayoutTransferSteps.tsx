"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { formatSettlementMoney } from "@/lib/settlementFormat";
import {
  recordPayoutTransfersAction,
  attestPayoutSentAction,
  attestPayoutSettledAction,
  cancelPayoutTransferAction,
} from "@/lib/actions/payoutAttestation";
import { sendPayslipPreviewAction } from "@/lib/actions/payslipPreview";
import type { PayoutTransferStatus } from "@/lib/supabase/types";

/**
 * The weekly payout routine, rendered as a numbered sequence rather than a
 * set of controls.
 *
 * This gets done once a week. Between Wednesdays the order is forgettable,
 * and an interface that assumes it is remembered produces skipped steps and
 * an admin staring at a page with nothing to confirm and no indication why.
 * Showing the sequence means the page teaches the routine, and "why is
 * there nothing to confirm?" answers itself.
 *
 * NOTHING HERE MOVES MONEY. Step 3 records that a human uploaded a file;
 * step 4 records that PayMongo's report showed it went out. Both are
 * attestations — the system cannot verify either, which is the whole reason
 * the flow is manual.
 */

export type TransferRow = {
  transferId: string | null;
  venueId: string;
  venueName: string;
  amount: number;
  providerFee: number;
  currency: string;
  settlementCount: number;
  status: PayoutTransferStatus | null;
  providerTransferId: string | null;
  attestedAt: string | null;
  payable: boolean;
};

const STATE_LABEL: Record<string, { text: string; className: string }> = {
  none: { text: "Not uploaded", className: "bg-muted text-muted-foreground" },
  pending: {
    text: "Not uploaded",
    className: "bg-muted text-muted-foreground",
  },
  processing: {
    text: "Uploaded — awaiting confirmation",
    className: "bg-warning/15 text-warning",
  },
  completed: {
    text: "Sent — venue paid",
    className: "bg-success/15 text-success",
  },
  failed: { text: "Failed", className: "bg-destructive/10 text-destructive" },
  cancelled: { text: "Cancelled", className: "bg-muted text-muted-foreground" },
};

function Step({
  n,
  title,
  done,
  active,
  children,
}: {
  n: number;
  title: string;
  done: boolean;
  active: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`rounded-2xl border p-5 ${active ? "border-primary bg-card" : "border-border bg-card/60"}`}
    >
      <div className="flex items-center gap-3">
        <span
          className={`flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
            done
              ? "bg-success/20 text-success"
              : active
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground"
          }`}
        >
          {done ? "✓" : n}
        </span>
        <p
          className={`text-sm font-medium ${active || done ? "text-foreground" : "text-muted-foreground"}`}
        >
          {title}
        </p>
      </div>
      {children && <div className="mt-4 pl-9">{children}</div>}
    </div>
  );
}

export function PayoutTransferSteps({
  batchId,
  batchApproved,
  weekLabel,
  transfers,
}: {
  batchId: string;
  batchApproved: boolean;
  /** The Sunday–Saturday window this batch covers, as the payslip will state it. */
  weekLabel: string;
  transfers: TransferRow[];
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const [confirming, setConfirming] = useState<TransferRow | null>(null);
  const [cancelling, setCancelling] = useState<TransferRow | null>(null);
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");

  const recorded = transfers.some((t) => t.transferId !== null);
  const live = transfers.filter(
    (t) =>
      t.status === "pending" ||
      t.status === "processing" ||
      t.status === "completed",
  );
  const allUploaded =
    live.length > 0 &&
    live.every((t) => t.status === "processing" || t.status === "completed");
  const allConfirmed =
    live.length > 0 && live.every((t) => t.status === "completed");

  function run(
    fn: () => Promise<{ success: boolean; error?: string }>,
    ok: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (!result.success) {
        toast.error(result.error ?? "Something went wrong.");
        return;
      }
      toast.success(ok);
      setConfirming(null);
      setCancelling(null);
      setReference("");
      setReason("");
      router.refresh();
    });
  }

  return (
    <section className="flex flex-col gap-4">
      <div>
        <h2 className="text-base font-semibold text-foreground">
          Paying this batch
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Four steps, once per batch. AIR/Rally cannot send money — steps 3 and
          4 record what you did.
        </p>
      </div>

      <Step
        n={1}
        title="Create the transfer records"
        done={recorded}
        active={!recorded}
      >
        {recorded ? (
          <p className="text-sm text-muted-foreground">
            {live.length} transfer{live.length === 1 ? "" : "s"} prepared, one
            per venue.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            <p className="text-sm text-muted-foreground">
              One record per venue in this batch. Nothing is sent — this just
              gives each transfer something to track.
            </p>
            <Button
              size="sm"
              disabled={!batchApproved || isPending}
              onClick={() =>
                run(
                  () => recordPayoutTransfersAction({ batchId }),
                  "Transfer records created.",
                )
              }
            >
              Create transfer records
            </Button>
            {!batchApproved && (
              <p className="text-xs text-warning">Approve the batch first.</p>
            )}
          </div>
        )}
      </Step>

      <Step
        n={2}
        title="Export the PesoNet file"
        done={false}
        active={recorded && !allUploaded}
      >
        {/* The export is not built yet. Saying so plainly beats omitting the
            step and leaving a four-step routine with a hole in the middle. */}
        <p className="text-sm text-muted-foreground">
          Not built yet — for now, copy the bank details from the table below
          into PayMongo by hand.
        </p>
      </Step>

      <Step
        n={3}
        title="Upload to PayMongo, then mark each one uploaded"
        done={allUploaded}
        active={recorded && !allUploaded}
      />

      <Step
        n={4}
        title="Check PayMongo's report, then confirm each one sent"
        done={allConfirmed}
        active={allUploaded && !allConfirmed}
      >
        {allConfirmed && (
          <p className="text-sm text-success">
            All venues in this batch have been paid and notified.
          </p>
        )}
      </Step>

      {/* Seeing the payslip without performing the payout.
          The only other way to see this email is to confirm a payment as
          sent — which settles the venue's earnings and asserts PayMongo
          reported a transfer that may not exist. Looking at an email is not
          worth a false row in the ledger, so this renders the same template
          and mails it to the admin, writing nothing. */}
      <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-dashed border-border bg-muted/30 px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-foreground">
            See the payslip first
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Emails a preview to you, exactly as the venue would receive it.
            Nothing is settled, nobody is notified, and no record is written.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={isPending}
          onClick={() =>
            startTransition(async () => {
              const result = await sendPayslipPreviewAction({ batchId });
              if (!result.success) {
                toast.error(result.error);
                return;
              }
              toast.success(
                `Preview sent to ${result.data.to}. Open it on your phone.`,
              );
            })
          }
        >
          Email me a preview
        </Button>
      </div>

      {recorded && (
        <div className="overflow-x-auto rounded-2xl border border-border bg-card">
          <table className="w-full min-w-[44rem] text-sm">
            <thead className="border-b border-border text-left text-xs text-muted-foreground">
              <tr>
                <th scope="col" className="px-4 py-3 font-medium">
                  Venue
                </th>
                <th scope="col" className="px-4 py-3 text-right font-medium">
                  Send
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  State
                </th>
                <th scope="col" className="px-4 py-3 font-medium">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {transfers.map((t) => {
                const state = STATE_LABEL[t.status ?? "none"];
                const net = t.amount - t.providerFee;
                return (
                  <tr key={t.venueId}>
                    <td className="px-4 py-3 text-foreground">
                      {t.venueName}
                      {t.providerTransferId && (
                        <span className="block font-mono text-xs text-muted-foreground">
                          {t.providerTransferId}
                        </span>
                      )}
                    </td>
                    {/* The fee only exists once a transfer row does, so before
                        step 1 this shows the gross alone. Showing "less ₱10
                        fee" against an unreduced figure would be a wrong
                        number on a money column. */}
                    <td className="px-4 py-3 text-right tabular-nums">
                      <span className="font-semibold text-foreground">
                        {formatSettlementMoney(
                          t.providerFee > 0 ? net : t.amount,
                          t.currency,
                        )}
                      </span>
                      {t.providerFee > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {formatSettlementMoney(t.amount, t.currency)} less{" "}
                          {formatSettlementMoney(t.providerFee, t.currency)} fee
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${state.className}`}
                      >
                        {state.text}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      {t.status === "pending" && t.transferId && (
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={isPending}
                            onClick={() =>
                              run(
                                () =>
                                  attestPayoutSentAction({
                                    transferId: t.transferId!,
                                    batchId,
                                  }),
                                "Marked as uploaded.",
                              )
                            }
                          >
                            Mark as uploaded to PayMongo
                          </Button>
                          <span className="text-xs text-muted-foreground">
                            The venue isn&apos;t notified yet.
                          </span>
                        </div>
                      )}
                      {t.status === "processing" && t.transferId && (
                        <div className="flex flex-wrap items-center gap-3">
                          <Button
                            size="sm"
                            disabled={isPending}
                            onClick={() => setConfirming(t)}
                          >
                            Confirm PayMongo sent this payment
                          </Button>
                          {/* Deliberately not an equal-weight neighbour of the
                              confirm button: opposite consequences, and one is
                              recoverable while the other is not. */}
                          <button
                            type="button"
                            className="text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
                            onClick={() => setCancelling(t)}
                          >
                            I marked this by mistake
                          </button>
                        </div>
                      )}
                      {t.status === "completed" && (
                        <span className="text-xs text-muted-foreground">
                          Paid
                          {t.attestedAt
                            ? ` ${new Date(t.attestedAt).toLocaleDateString("en-PH", { dateStyle: "medium" })}`
                            : ""}
                        </span>
                      )}
                      {!t.payable && !t.transferId && (
                        <span className="text-xs text-warning">
                          No bank details — cannot be paid
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Step 4's confirmation. Names the venue and both figures so a
          wrong-row click is visible before it fires, and puts the guidance
          ABOVE the amounts — someone who already believes they know what
          this button means would read the heading, agree, and skim to the
          numbers. */}
      {confirming && (
        <div className="rounded-2xl border border-primary bg-card p-6">
          <h3 className="text-base font-semibold text-foreground">
            Confirm PayMongo sent this payment?
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Check PayMongo&apos;s report first — this is for when{" "}
            <strong className="text-foreground">
              their report shows the transfer went out
            </strong>
            , not when the venue tells you they received it.
          </p>
          <p className="mt-4 text-sm text-foreground">
            <strong>{confirming.venueName}</strong> will be marked paid{" "}
            <strong>
              {formatSettlementMoney(confirming.amount, confirming.currency)}
            </strong>{" "}
            in earnings —{" "}
            <strong>
              {formatSettlementMoney(
                confirming.amount - confirming.providerFee,
                confirming.currency,
              )}{" "}
              transferred
            </strong>{" "}
            after the ₱10 fee.
          </p>
          <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground">
            <li>They&apos;ll be emailed a payslip for {weekLabel}</li>
            <li>Their earnings move from Available to Paid</li>
            <li className="font-medium text-foreground">
              This can&apos;t be undone
            </li>
          </ul>
          <label
            htmlFor="pm-ref"
            className="mt-4 block text-xs text-muted-foreground"
          >
            PayMongo&apos;s reference for this transfer
          </label>
          <input
            id="pm-ref"
            value={reference}
            onChange={(e) => setReference(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
            placeholder="From PayMongo's report"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => setConfirming(null)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              disabled={isPending || reference.trim().length === 0}
              onClick={() =>
                run(
                  () =>
                    attestPayoutSettledAction({
                      transferId: confirming.transferId!,
                      batchId,
                      providerReference: reference,
                    }),
                  `${confirming.venueName} marked paid and notified.`,
                )
              }
            >
              Yes, confirm payment sent
            </Button>
          </div>
        </div>
      )}

      {/* The mistake path. States what it MEANS rather than asking "are you
          sure" — cancelling after a real upload can produce two live
          transfers for the same venue and week, and the system cannot know
          which happened. */}
      {cancelling && (
        <div className="rounded-2xl border border-warning/50 bg-warning/5 p-6">
          <h3 className="text-base font-semibold text-foreground">
            Cancel this transfer?
          </h3>
          <p className="mt-2 text-sm text-muted-foreground">
            Use this if you marked it uploaded{" "}
            <strong className="text-foreground">
              by mistake — before actually uploading it to PayMongo.
            </strong>
          </p>
          <p className="mt-3 text-sm text-foreground">
            <strong>
              If you have already uploaded the file, do not cancel.
            </strong>{" "}
            Check PayMongo&apos;s report first: if the transfer went out,
            confirm it as sent instead. Cancelling now and creating a new
            transfer could send {cancelling.venueName} their{" "}
            {formatSettlementMoney(
              cancelling.amount - cancelling.providerFee,
              cancelling.currency,
            )}{" "}
            twice.
          </p>
          <label
            htmlFor="cancel-reason"
            className="mt-4 block text-xs text-muted-foreground"
          >
            Why are you cancelling?{" "}
            <span className="italic">
              (recorded — this is the only explanation anyone will have later)
            </span>
          </label>
          <input
            id="cancel-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <div className="mt-4 flex flex-wrap gap-3">
            <Button
              size="sm"
              disabled={isPending}
              onClick={() => setCancelling(null)}
            >
              Keep it
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={isPending || reason.trim().length === 0}
              onClick={() =>
                run(
                  () =>
                    cancelPayoutTransferAction({
                      transferId: cancelling.transferId!,
                      batchId,
                      reason,
                    }),
                  "Transfer cancelled.",
                )
              }
            >
              Cancel this transfer
            </Button>
          </div>
        </div>
      )}
    </section>
  );
}
