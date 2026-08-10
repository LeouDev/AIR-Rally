import Link from "next/link";
import { SearchX } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
      <EmptyState
        icon={SearchX}
        title="We couldn't find that court"
        description="It may have been removed, or the link might be incorrect. Try exploring courts near you instead."
        action={
          <Button asChild>
            <Link href="/explore">Browse Courts</Link>
          </Button>
        }
      />
    </div>
  );
}
