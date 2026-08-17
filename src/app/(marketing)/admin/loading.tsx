import { PageSkeleton, CourtGridSkeleton } from "@/components/shared/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-12 sm:px-6 lg:px-8">
      <PageSkeleton><CourtGridSkeleton count={4} /></PageSkeleton>
    </div>
  );
}
