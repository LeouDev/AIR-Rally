import { Rating } from "@/components/court/Rating";
import type { ReviewWithAuthor } from "@/lib/supabase/types";

type ReviewPreviewProps = {
  review: ReviewWithAuthor;
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/);
  return (
    parts
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase())
      .join("") || "?"
  );
}

export function ReviewPreview({ review }: ReviewPreviewProps) {
  const authorName = review.author?.display_name || "Air/Rally player";

  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-secondary text-sm font-semibold text-secondary-foreground">
            {initialsFrom(authorName)}
          </span>
          <div>
            <p className="text-sm font-medium text-foreground">{authorName}</p>
            <p className="text-xs text-muted-foreground">
              {new Date(review.created_at).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
            </p>
          </div>
        </div>
        <Rating value={review.rating} />
      </div>
      {review.title && <p className="text-sm font-medium text-foreground">{review.title}</p>}
      {review.comment && <p className="text-sm text-muted-foreground">{review.comment}</p>}
    </div>
  );
}
