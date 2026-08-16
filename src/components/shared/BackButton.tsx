"use client";

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";

/**
 * `router.back()`, not a hardcoded destination link — visitors reach
 * Court Details from Explore, Favorites, or the landing page's Featured
 * Courts, and `back()` is correct regardless of entry point. Styled to
 * match the "Back to your venues" link on the owner's manage-venue page.
 */
export function BackButton({ label = "Back" }: { label?: string }) {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-3 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      {label}
    </button>
  );
}
