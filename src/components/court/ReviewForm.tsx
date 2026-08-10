"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Star } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { submitReviewAction } from "@/lib/actions/review";
import { createReviewSchema, type CreateReviewValues } from "@/lib/validations/review";
import { cn } from "@/lib/utils";

type ReviewFormProps = {
  venueId: string;
  bookingId: string;
};

/**
 * Rendered only when the server page has already determined the signed-in
 * user is eligible (a confirmed, past booking at this venue) — see
 * lib/services/reviews.ts#getReviewEligibility(). An ineligible visitor
 * never sees this form at all, matching this codebase's existing
 * preference for not showing a control a user categorically can't use
 * (same posture as BookingWidget for an unauthenticated visitor).
 */
export function ReviewForm({ venueId, bookingId }: ReviewFormProps) {
  const [submitted, setSubmitted] = useState(false);
  const router = useRouter();

  const {
    register,
    handleSubmit,
    setValue,
    watch,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<CreateReviewValues>({
    resolver: zodResolver(createReviewSchema),
    defaultValues: { venueId, bookingId, rating: 0 },
  });

  const rating = watch("rating");

  async function onSubmit(values: CreateReviewValues) {
    const result = await submitReviewAction(values);
    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }
    toast.success("Review submitted — thanks for sharing!");
    setSubmitted(true);
    router.refresh();
  }

  if (submitted) {
    return (
      <div className="rounded-2xl border border-border bg-card p-4 text-sm text-muted-foreground">
        Thanks for your review — it&apos;s now visible on this venue&apos;s page.
      </div>
    );
  }

  return (
    <form className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-4" onSubmit={handleSubmit(onSubmit)} noValidate>
      <div>
        <h3 className="text-sm font-semibold text-foreground">Write a review</h3>
        <p className="text-xs text-muted-foreground">You played here — share how it went.</p>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>Rating</Label>
        <div className="flex items-center gap-1" role="radiogroup" aria-label="Rating out of 5 stars">
          {[1, 2, 3, 4, 5].map((star) => (
            <button
              key={star}
              type="button"
              role="radio"
              aria-checked={rating === star}
              aria-label={`${star} star${star === 1 ? "" : "s"}`}
              onClick={() => setValue("rating", star, { shouldValidate: true })}
              className="p-0.5"
            >
              <Star className={cn("size-6 transition-colors", star <= rating ? "fill-primary text-primary" : "text-muted-foreground")} />
            </button>
          ))}
        </div>
        {errors.rating && <p className="text-xs text-destructive">Please select a rating.</p>}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-title">Title (optional)</Label>
        <Input id="review-title" placeholder="Great courts, friendly staff" {...register("title")} />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="review-comment">Comment (optional)</Label>
        <textarea
          id="review-comment"
          rows={3}
          placeholder="What was your experience like?"
          className="w-full rounded-lg border border-input bg-transparent px-2.5 py-2 text-sm outline-none placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 dark:bg-input/30"
          {...register("comment")}
        />
      </div>

      {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

      <Button type="submit" disabled={isSubmitting} className="self-start">
        {isSubmitting ? "Submitting…" : "Submit review"}
      </Button>
    </form>
  );
}
