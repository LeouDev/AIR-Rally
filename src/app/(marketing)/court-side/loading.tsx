import { PageSkeleton, FeedSkeleton } from "@/components/shared/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <PageSkeleton><FeedSkeleton /></PageSkeleton>
    </div>
  );
}
