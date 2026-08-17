import { Skeleton } from "@/components/ui/skeleton";

/**
 * These back the route-level `loading.tsx` files.
 *
 * Without a loading boundary, App Router paints NOTHING on navigation
 * until the server component tree has finished every query — the old page
 * just sits there, which is what made the app feel like it was hanging for
 * a second or two on every click. With one, the new screen appears on the
 * next frame and fills in as data arrives.
 *
 * Each skeleton deliberately mirrors the real page's container widths and
 * spacing, so the transition from skeleton to content doesn't shift the
 * layout.
 */

/** A stack of post/feed cards — COURT/Side. */
export function FeedSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="rounded-2xl border border-border bg-card p-4">
          <div className="flex items-center gap-2.5">
            <Skeleton className="size-10 shrink-0 rounded-full" />
            <div className="flex flex-1 flex-col gap-1.5">
              <Skeleton className="h-3.5 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <div className="mt-3 flex flex-col gap-2">
            <Skeleton className="h-3.5 w-full" />
            <Skeleton className="h-3.5 w-4/5" />
          </div>
          <div className="mt-3 flex gap-5 border-t border-border pt-3">
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5 w-10" />
            <Skeleton className="h-3.5 w-10" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** A list of rows with a title and two lines — bookings, events, clubs. */
export function ListSkeleton({ count = 5 }: { count?: number }) {
  return (
    <div className="flex flex-col gap-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-4">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3.5 w-2/3" />
          <Skeleton className="h-3 w-1/4" />
        </div>
      ))}
    </div>
  );
}

/** Avatar, name, and a row of stats — profile and My/Rally. */
export function ProfileSkeleton() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-4">
        <Skeleton className="size-16 shrink-0 rounded-full" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-3.5 w-24" />
        </div>
      </div>
      <div className="grid grid-cols-4 gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
      <div className="flex flex-col gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>
    </div>
  );
}

/** A page heading plus a body region — the generic fallback. */
export function PageSkeleton({ children }: { children?: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Skeleton className="h-7 w-56" />
        <Skeleton className="h-4 w-80 max-w-full" />
      </div>
      {children ?? <ListSkeleton />}
    </div>
  );
}

export function CourtCardSkeleton() {
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-card">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="flex flex-col gap-2 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3.5 w-1/2" />
        <div className="mt-2 flex items-center justify-between">
          <Skeleton className="h-3.5 w-16" />
          <Skeleton className="h-3.5 w-20" />
        </div>
      </div>
    </div>
  );
}

export function CourtGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
      {Array.from({ length: count }).map((_, i) => (
        <CourtCardSkeleton key={i} />
      ))}
    </div>
  );
}

export function CourtDetailSkeleton() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-8 px-4 py-10">
      <Skeleton className="aspect-[16/9] w-full rounded-2xl" />
      <div className="flex flex-col gap-3">
        <Skeleton className="h-8 w-2/3" />
        <Skeleton className="h-4 w-1/3" />
      </div>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <div className="flex flex-col gap-3 md:col-span-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
        </div>
        <Skeleton className="h-48 w-full rounded-2xl" />
      </div>
    </div>
  );
}
