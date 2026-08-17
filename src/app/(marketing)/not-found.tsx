import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

/**
 * The 404 for the whole (marketing) group — not just courts. It reads on
 * a mistyped URL, a deleted club, and on any page a signed-in user isn't
 * allowed to see (notFound() is deliberately used instead of a 403 so we
 * never confirm that a restricted page exists). It used to say "We
 * couldn't find that court", which was wrong everywhere except a court
 * link — visiting /admin as a normal player answered with a missing
 * *court*.
 */
export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <EmptyState
        icon={SearchX}
        title="We couldn't find that page"
        description="It may have been removed, or the link might be incorrect."
        action={
          <div className="flex flex-wrap justify-center gap-2">
            <Button asChild>
              <Link href="/explore">Browse Courts</Link>
            </Button>
            <Button asChild variant="outline">
              <Link href="/">Go Home</Link>
            </Button>
          </div>
        }
      />
    </div>
  );
}
