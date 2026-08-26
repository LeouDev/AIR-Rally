"use client";

import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import Link from "next/link";
import { Camera, Clock, PartyPopper } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { submitOwnerApplicationAction } from "@/lib/actions/ownerApplications";
import { PESONET_BANKS } from "@/lib/payouts/pesonetBanks";
import {
  submitOwnerApplicationSchema,
  OWNER_APPLICATION_STEP_FIELDS,
  type SubmitOwnerApplicationValues,
} from "@/lib/validations/ownerApplication";

const TOTAL_STEPS = 8;
// sessionStorage only (not localStorage) — a draft that outlives the tab
// is a bigger surprise than one that doesn't; this only guards against an
// accidental reload mid-application, not a return visit days later.
const STORAGE_KEY = "air-rally-owner-application-draft";

type OwnerApplicationWizardProps = {
  onSubmitted: () => void;
};

export function OwnerApplicationWizard({ onSubmitted }: OwnerApplicationWizardProps) {
  const [step, setStep] = useState(1);
  const [direction, setDirection] = useState(1);

  const {
    register,
    handleSubmit,
    trigger,
    watch,
    reset,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SubmitOwnerApplicationValues>({
    resolver: zodResolver(submitOwnerApplicationSchema),
    defaultValues: { courtCount: 1 },
  });

  // Loaded post-mount, not as useForm's initial defaultValues — reading
  // sessionStorage during the initial render would differ between the
  // server-rendered pass and the client's first paint (no sessionStorage
  // on the server), which is exactly the shape of a hydration mismatch.
  // Resetting once mounted avoids that entirely.
  useEffect(() => {
    try {
      const saved = sessionStorage.getItem(STORAGE_KEY);
      if (saved) reset(JSON.parse(saved));
    } catch {
      // Corrupt/unavailable storage — just start fresh.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const subscription = watch((values) => {
      try {
        // Bank details are deliberately NOT persisted. Everything else in
        // this draft is business contact info an applicant would happily
        // re-type; an account number is not, and sessionStorage holds it in
        // plaintext — readable by any script on the origin — for the life
        // of the tab. A reload safeguard is not worth keeping a payout
        // destination in the browser, and re-entering three fields is the
        // smaller cost.
        const { bankName, bankAccountName, bankAccountNumber, ...persistable } = values;
        void bankName;
        void bankAccountName;
        void bankAccountNumber;
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(persistable));
      } catch {
        // Storage full/unavailable — the form still works, just without the reload safeguard.
      }
    });
    return () => subscription.unsubscribe();
  }, [watch]);

  const values = watch();

  async function goNext() {
    const fieldGroup = OWNER_APPLICATION_STEP_FIELDS[step - 1];
    if (fieldGroup) {
      const valid = await trigger(fieldGroup as unknown as (keyof SubmitOwnerApplicationValues)[]);
      if (!valid) return;
    }
    setDirection(1);
    setStep((s) => Math.min(s + 1, TOTAL_STEPS));
  }

  function goBack() {
    setDirection(-1);
    setStep((s) => Math.max(s - 1, 1));
  }

  async function onSubmit(submitValues: SubmitOwnerApplicationValues) {
    const result = await submitOwnerApplicationAction(submitValues);
    if (!result.success) {
      toast.error(result.error);
      return;
    }
    try {
      sessionStorage.removeItem(STORAGE_KEY);
    } catch {
      // Non-fatal.
    }
    onSubmitted();
  }

  return (
    <div className="mx-auto w-full max-w-lg">
      <div className="flex items-center gap-1.5">
        {Array.from({ length: TOTAL_STEPS }, (_, i) => (
          <div key={i} className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.div
              className="h-full rounded-full bg-primary"
              initial={false}
              animate={{ width: i < step ? "100%" : "0%" }}
              transition={{ duration: 0.25 }}
            />
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs font-medium text-muted-foreground">Step {step} of {TOTAL_STEPS}</p>

      <form onSubmit={handleSubmit(onSubmit)} noValidate className="mt-6">
        <AnimatePresence mode="wait" custom={direction} initial={false}>
          <motion.div
            key={step}
            custom={direction}
            initial={{ opacity: 0, x: direction > 0 ? 24 : -24 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: direction > 0 ? -24 : 24 }}
            transition={{ duration: 0.2 }}
          >
            {step === 1 && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-foreground">Tell us about you</h2>
                <p className="text-sm text-muted-foreground">How should players and our team reach you?</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="businessName">Your name or business name</Label>
                  <Input id="businessName" placeholder="Jamie Cruz / Banilad Pickle Club" aria-invalid={!!errors.businessName} {...register("businessName")} />
                  {errors.businessName && <p className="text-xs text-destructive">{errors.businessName.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="businessPhone">Phone number</Label>
                  <Input id="businessPhone" type="tel" placeholder="+63 900 000 0000" aria-invalid={!!errors.businessPhone} {...register("businessPhone")} />
                  {errors.businessPhone && <p className="text-xs text-destructive">{errors.businessPhone.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="businessEmail">Email</Label>
                  <Input id="businessEmail" type="email" placeholder="you@example.com" aria-invalid={!!errors.businessEmail} {...register("businessEmail")} />
                  {errors.businessEmail && <p className="text-xs text-destructive">{errors.businessEmail.message}</p>}
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-foreground">About your venue</h2>
                <p className="text-sm text-muted-foreground">Where will players find you?</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="venueName">Venue name</Label>
                  <Input id="venueName" placeholder="Banilad Pickle Club" aria-invalid={!!errors.venueName} {...register("venueName")} />
                  {errors.venueName && <p className="text-xs text-destructive">{errors.venueName.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="venueAddress">Street address</Label>
                  <Input id="venueAddress" placeholder="123 Test St" aria-invalid={!!errors.venueAddress} {...register("venueAddress")} />
                  {errors.venueAddress && <p className="text-xs text-destructive">{errors.venueAddress.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="venueCity">City</Label>
                  <Input id="venueCity" placeholder="Cebu City" aria-invalid={!!errors.venueCity} {...register("venueCity")} />
                  {errors.venueCity && <p className="text-xs text-destructive">{errors.venueCity.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="venueDescription">Tell us a bit more (optional)</Label>
                  <textarea
                    id="venueDescription"
                    rows={3}
                    placeholder="What makes your courts special?"
                    className="flex w-full rounded-lg border border-border bg-background px-3 py-2 text-sm shadow-xs outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                    {...register("venueDescription")}
                  />
                </div>
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-foreground">Court information</h2>
                <p className="text-sm text-muted-foreground">How many courts do you have?</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="courtCount">Number of courts</Label>
                  <Input
                    id="courtCount"
                    type="number"
                    min={1}
                    max={100}
                    aria-invalid={!!errors.courtCount}
                    {...register("courtCount", { valueAsNumber: true })}
                  />
                  {errors.courtCount && <p className="text-xs text-destructive">{errors.courtCount.message}</p>}
                </div>
              </div>
            )}

            {step === 4 && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-foreground">Payout details</h2>
                <p className="text-sm text-muted-foreground">
                  Where AIR/Rally sends your earnings. We need these before your application can be approved — an
                  approved venue with no payout destination is one we can&apos;t actually pay.
                </p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bankName">Bank</Label>
                  <select
                    id="bankName"
                    aria-invalid={!!errors.bankName}
                    className="rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    {...register("bankName")}
                  >
                    <option value="">Select your bank…</option>
                    {PESONET_BANKS.map((bank) => (
                      <option key={bank} value={bank}>
                        {bank}
                      </option>
                    ))}
                  </select>
                  {/* A dropdown, never a text field: PayMongo matches this
                      string character for character on upload, so a typed
                      bank name becomes a transfer row rejected at the one
                      moment nobody is watching. */}
                  {errors.bankName && <p className="text-xs text-destructive">{errors.bankName.message}</p>}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bankAccountName">Account holder name</Label>
                  <Input id="bankAccountName" aria-invalid={!!errors.bankAccountName} {...register("bankAccountName")} />
                  {errors.bankAccountName && (
                    <p className="text-xs text-destructive">{errors.bankAccountName.message}</p>
                  )}
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="bankAccountNumber">Account number</Label>
                  <Input
                    id="bankAccountNumber"
                    inputMode="numeric"
                    autoComplete="off"
                    aria-invalid={!!errors.bankAccountNumber}
                    {...register("bankAccountNumber")}
                  />
                  {errors.bankAccountNumber && (
                    <p className="text-xs text-destructive">{errors.bankAccountNumber.message}</p>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Double-check the account number. PayMongo is not liable for transfers sent to incorrect details.
                </p>
              </div>
            )}

            {step === 5 && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-8 text-center">
                <Camera className="size-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-foreground">Showcase your facility</h2>
                <p className="text-sm text-muted-foreground">
                  Once your application is approved, you&apos;ll be able to upload court and venue photos, list
                  amenities, and pin your exact location — right from your new owner dashboard.
                </p>
              </div>
            )}

            {step === 6 && (
              <div className="flex flex-col items-center gap-3 rounded-2xl border border-dashed border-border p-8 text-center">
                <Clock className="size-8 text-muted-foreground" aria-hidden="true" />
                <h2 className="text-lg font-semibold text-foreground">Set your hours</h2>
                <p className="text-sm text-muted-foreground">
                  You&apos;ll set your operating hours, block off maintenance time, and manage your live
                  availability calendar after your venue is approved.
                </p>
              </div>
            )}

            {step === 7 && (
              <div className="flex flex-col gap-4">
                <h2 className="text-lg font-semibold text-foreground">Review and submit</h2>
                <dl className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Contact</dt>
                    <dd className="text-right text-foreground">{values.businessName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Venue</dt>
                    <dd className="text-right text-foreground">{values.venueName}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Address</dt>
                    <dd className="text-right text-foreground">
                      {values.venueAddress}, {values.venueCity}
                    </dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Courts</dt>
                    <dd className="text-right text-foreground">{values.courtCount}</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Payout to</dt>
                    {/* Last 4 only. The applicant typed it moments ago and
                        knows what it is; rendering it in full here just puts
                        an account number on screen for anyone behind them. */}
                    <dd className="text-right text-foreground">
                      {values.bankName ? `${values.bankName} ••••${(values.bankAccountNumber ?? "").slice(-4)}` : "—"}
                    </dd>
                  </div>
                </dl>
                <p className="text-sm text-muted-foreground">
                  Our team reviews your facility before it becomes available to players.
                </p>
              </div>
            )}

            {step === 8 && (
              <div className="flex flex-col gap-5">
                <h2 className="text-lg font-semibold text-foreground">The Venue Owner Agreement</h2>
                <dl className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4 text-sm">
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Commission</dt>
                    <dd className="text-right text-foreground">AIR/Rally keeps 5% · you receive 95%</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Payouts</dt>
                    <dd className="text-right text-foreground">Bank transfer, weekly on Wednesdays</dd>
                  </div>
                  <div className="flex justify-between gap-4">
                    <dt className="text-muted-foreground">Bookings</dt>
                    <dd className="text-right text-foreground">A confirmed booking is a commitment</dd>
                  </div>
                </dl>
                <p className="text-sm text-muted-foreground">
                  Read the full{" "}
                  <Link href="/owner-agreement" target="_blank" className="font-medium text-primary hover:underline">
                    Venue Owner Agreement
                  </Link>{" "}
                  before you accept it.
                </p>

                <div className="flex flex-col gap-1.5">
                  <Label>Does your venue carry public liability insurance?</Label>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { value: true, label: "Yes, we carry it" },
                        { value: false, label: "No, we don't" },
                      ] as const
                    ).map((option) => (
                      <button
                        key={String(option.value)}
                        type="button"
                        onClick={() => setValue("hasLiabilityInsurance", option.value, { shouldDirty: true, shouldValidate: true })}
                        aria-pressed={watch("hasLiabilityInsurance") === option.value}
                        className={cn(
                          "rounded-xl border p-3 text-left text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
                          watch("hasLiabilityInsurance") === option.value
                            ? "border-primary bg-primary/5 text-foreground"
                            : "border-border text-muted-foreground hover:border-primary/40"
                        )}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  {errors.hasLiabilityInsurance && (
                    <p id="hasLiabilityInsurance-error" role="alert" className="text-xs text-destructive">
                      {errors.hasLiabilityInsurance.message}
                    </p>
                  )}
                  {watch("hasLiabilityInsurance") === false && (
                    <p className="text-xs text-muted-foreground">
                      You confirm you accept responsibility for incidents at your venue — Owner Agreement clause 5.3.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <div className="flex items-start gap-2">
                    <input
                      id="agreedToOwnerAgreement"
                      type="checkbox"
                      aria-invalid={!!errors.agreedToOwnerAgreement}
                      aria-describedby={errors.agreedToOwnerAgreement ? "agreedToOwnerAgreement-error" : undefined}
                      className="mt-0.5 size-4 shrink-0 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
                      {...register("agreedToOwnerAgreement")}
                    />
                    <Label htmlFor="agreedToOwnerAgreement" className="text-sm font-normal text-muted-foreground">
                      I have read and agree to the Venue Owner Agreement, and I am authorised to list this venue on AIR/Rally.
                    </Label>
                  </div>
                  {errors.agreedToOwnerAgreement && (
                    <p id="agreedToOwnerAgreement-error" role="alert" className="text-xs text-destructive">
                      {errors.agreedToOwnerAgreement.message}
                    </p>
                  )}
                </div>
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className={cn("mt-8 flex gap-3", step === 1 ? "justify-end" : "justify-between")}>
          {step > 1 && (
            <Button type="button" variant="outline" onClick={goBack} disabled={isSubmitting}>
              Back
            </Button>
          )}
          {step < TOTAL_STEPS ? (
            <Button type="button" onClick={goNext}>
              Next
            </Button>
          ) : (
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? "Submitting…" : "Submit for Review"}
            </Button>
          )}
        </div>
      </form>
    </div>
  );
}

export function OwnerApplicationSubmittedState() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-col items-center gap-3 rounded-2xl border border-border bg-card p-8 text-center">
      <div className="flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
        <PartyPopper className="size-6" aria-hidden="true" />
      </div>
      <h2 className="text-lg font-semibold text-foreground">Application submitted</h2>
      <p className="text-sm text-muted-foreground">
        Our team reviews your facility before it becomes available to players. We&apos;ll let you know as soon as
        you&apos;re approved.
      </p>
    </div>
  );
}
