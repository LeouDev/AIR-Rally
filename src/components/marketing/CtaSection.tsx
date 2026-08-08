import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

export function CtaSection() {
  return (
    <section className="mx-auto max-w-7xl px-4 pb-20 sm:px-6 lg:px-8">
      <div className="flex flex-col items-center gap-6 rounded-3xl bg-secondary px-6 py-16 text-center text-secondary-foreground">
        <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">
          Ready to rally?
          <br className="hidden sm:block" /> Find your next court.
        </h2>
        <Button
          asChild
          size="lg"
          className="h-12 gap-2 rounded-full bg-primary px-7 text-base text-primary-foreground hover:bg-primary/90"
        >
          <Link href="/explore">
            Explore Courts
            <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
    </section>
  );
}
