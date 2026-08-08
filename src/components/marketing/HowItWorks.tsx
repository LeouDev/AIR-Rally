import { Search, CalendarClock, Volleyball } from "lucide-react";
import { SectionHeader } from "@/components/shared/SectionHeader";

const STEPS = [
  {
    icon: Search,
    title: "Find a court",
    description: "Search by location and see courts with real ratings, pricing, and amenities.",
  },
  {
    icon: CalendarClock,
    title: "Pick a time",
    description: "Browse live availability and choose the slot that fits your schedule.",
  },
  {
    icon: Volleyball,
    title: "Book and play",
    description: "Confirm your reservation and show up ready to rally.",
  },
];

export function HowItWorks() {
  return (
    <section id="how-it-works" className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8 scroll-mt-20">
      <SectionHeader eyebrow="How It Works" title="Booking a court takes minutes" align="center" />

      <div className="relative mt-12 grid grid-cols-1 gap-10 sm:grid-cols-3">
        <div
          className="absolute top-6 right-0 left-0 hidden h-px bg-border sm:block"
          aria-hidden="true"
        />
        {STEPS.map(({ icon: Icon, title, description }, index) => (
          <div key={title} className="relative flex flex-col items-center gap-3 text-center">
            <div className="relative z-10 flex size-12 items-center justify-center rounded-full border-2 border-primary bg-background text-primary">
              <Icon className="size-5" aria-hidden="true" />
            </div>
            <h3 className="text-base font-semibold text-foreground">
              {index + 1}. {title}
            </h3>
            <p className="max-w-xs text-sm text-muted-foreground">{description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
