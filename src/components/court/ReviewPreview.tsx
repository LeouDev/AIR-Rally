import { Rating } from "@/components/court/Rating";
import type { Review } from "@/types/court";

type ReviewPreviewProps = {
  review: Review;
};

export function ReviewPreview({ review }: ReviewPreviewProps) {
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
            {review.authorInitials}
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">{review.authorName}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(review.date).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <Rating value={review.rating} />
      </div>
      <p className="text-sm text-muted-foreground">{review.comment}</p>
    </div>
  );
}
