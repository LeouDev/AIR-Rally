import { PageSkeleton } from "@/components/shared/LoadingSkeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <PageSkeleton />
    </div>
  );
}
