import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { HowItWorks } from "@/components/marketing/HowItWorks";

/**
 * A real route for the explainer, rather than an anchor on one variant of
 * the home page.
 *
 * THE REGRESSION THIS CLOSES
 *
 * HowItWorks carries id="how-it-works" and, since the home split, renders
 * only in the SIGNED-OUT branch of (marketing)/page.tsx. Navbar and Footer
 * still link to "/#how-it-works". Signed in, `/` renders AppHome, the
 * anchor does not exist, and both links land on the app home and do
 * nothing — a silent no-op, which is why it survived review.
 *
 * WHY A ROUTE AND NOT A RESTORED ANCHOR
 *
 * Putting the section back on the signed-in home would undo the point of
 * the split. This is genuine explainer content: it deserves its own URL,
 * it works signed in or out, and it becomes linkable and indexable.
 *
 * The component is deliberately NOT modified. It carries its own
 * max-w-7xl/py-16 wrapper sized to sit inside the landing page's rhythm,
 * so this route supplies only the page shell around it. That keeps the
 * signed-out landing byte-identical and keeps two sessions out of one
 * file.
 */
export const metadata: Metadata = {
  title: "How It Works",
  description: "Find a court, pick a time, book and play — how booking a pickleball court on AIR/Rally works.",
};

export default function HowItWorksPage() {
  return (
    <div className="flex flex-col">
      <HowItWorks />

      <div className="mx-auto w-full max-w-7xl px-4 pb-16 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-4 rounded-2xl border border-border bg-card p-8 text-center">
          <div>
            <h2 className="text-lg font-semibold text-foreground">Ready to play?</h2>
            <p className="mt-1 text-sm text-muted-foreground">Browse courts near you and book in a couple of minutes.</p>
          </div>
          {/* Explaining the product and then offering no way into it is a
              dead end. /explore works signed in or out, so this needs no
              auth-dependent branch. */}
          <Button asChild>
            <Link href="/explore">Find a Court</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
