import { CalendarCheck, RadioTower, ShieldCheck, Volleyball } from "lucide-react";
import { SectionHeader } from "@/components/shared/SectionHeader";

const BENEFITS = [
  {
    icon: CalendarCheck,
    title: "Easy Booking",
    description: "Reserve a court in a few taps — no phone calls, no waiting on a reply.",
  },
  {
    icon: RadioTower,
    title: "Real Availability",
    description: "See open time slots as they actually are, not a schedule someone forgot to update.",
  },
  {
    icon: ShieldCheck,
    title: "Trusted Courts",
    description: "Every venue is verified, so you always know what you're booking.",
  },
  {
    icon: Volleyball,
    title: "Built for Pickleball",
    description: "Not a generic sports app — every detail is built around the game you love.",
  },
];

export function WhyAirRally() {
  return (
    <section className="bg-muted/40">
      <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="Why Air/Rally"
          title="Everything you need to play more"
          align="center"
        />

        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {BENEFITS.map(({ icon: Icon, title, description }) => (
            <div
              key={title}
              className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6"
            >
              <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Icon className="size-5" aria-hidden="true" />
              </div>
              <h3 className="text-base font-semibold text-foreground">{title}</h3>
              <p className="text-sm text-muted-foreground">{description}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
