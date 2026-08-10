"use client";

import { useEffect } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

/**
 * Catches errors thrown while rendering any (marketing) page — e.g. a
 * genuine Supabase/network failure fetching a venue, as opposed to a
 * venue that simply doesn't exist (that's not-found.tsx). Never shows the
 * raw error to the user; it's only logged.
 */
export default function MarketingError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[marketing route error]", error);
  }, [error]);

  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <EmptyState
        icon={TriangleAlert}
        title="Something went wrong"
        description="We couldn't load this page. Please try again, or head back to Explore."
        action={
          <div className="flex gap-3">
            <Button onClick={reset}>Try Again</Button>
            <Button asChild variant="outline">
              <Link href="/explore">Browse Courts</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
