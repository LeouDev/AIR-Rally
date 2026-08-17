import Link from "next/link";
import { ArrowRight, Sparkles, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SearchBar } from "@/components/search/SearchBar";
import { QuickFilters } from "@/components/search/QuickFilters";
import { CourtSurface } from "@/components/court/CourtSurface";
import { HeroSecondaryCTA } from "@/components/marketing/HeroSecondaryCTA";

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-accent/60 via-background to-background">
      <div className="mx-auto max-w-7xl px-4 pt-14 pb-28 sm:px-6 sm:pt-20 lg:px-8">
        <div className="grid grid-cols-1 items-center gap-12 lg:grid-cols-2 lg:gap-8">
          <div className="flex flex-col items-start gap-6">
            <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground">
              <Sparkles className="size-3.5 text-primary" aria-hidden="true" />
              Now booking courts in the Philippines
            </span>

            <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight text-foreground sm:text-5xl lg:text-6xl">
              Your next rally starts here.
            </h1>

            <p className="max-w-md text-lg text-muted-foreground">
              Discover and book pickleball courts near you.
            </p>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg" className="h-12 gap-2 rounded-full px-6 text-base">
                <Link href="/explore">
                  Find a Court
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <HeroSecondaryCTA />
            </div>
          </div>

          <div className="relative mx-auto w-full max-w-md lg:max-w-none">
            <div className="overflow-hidden rounded-3xl border border-border shadow-xl rotate-2 transition-transform hover:rotate-0">
              <div className="aspect-[4/3] w-full">
                <CourtSurface surfaceColor="blue" indoor={false} />
              </div>
            </div>

            <div className="absolute -bottom-6 -left-4 flex items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-lg sm:-left-8">
              <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-foreground">
                <Star className="size-5 fill-primary text-primary" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">4.9 average rating</p>
                <p className="text-xs text-muted-foreground">2,400+ verified reviews</p>
              </div>
            </div>

            <div className="absolute -top-5 -right-2 rounded-2xl border border-border bg-card px-4 py-2.5 shadow-lg sm:-right-6">
              <p className="text-xs font-medium text-muted-foreground">Live availability</p>
              <p className="text-sm font-semibold text-success">Open now</p>
            </div>
          </div>
        </div>
      </div>

      <div className="relative z-10 mx-auto -mt-16 flex max-w-4xl flex-col gap-4 px-4 sm:px-6 lg:px-8">
        <SearchBar />

        <QuickFilters />
      </div>
    </section>
  );
}
