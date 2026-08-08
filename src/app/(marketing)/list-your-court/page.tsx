import Link from "next/link";
import type { Metadata } from "next";
import { CalendarClock, LineChart, Users2, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/shared/SectionHeader";

export const metadata: Metadata = {
  title: "List Your Court",
  description: "Bring your pickleball venue onto Air/Rally and reach players actively booking courts.",
};

const BENEFITS = [
  {
    icon: Users2,
    title: "Reach active players",
    description: "Get discovered by players already searching for courts to book in your area.",
  },
  {
    icon: CalendarClock,
    title: "Manage your schedule",
    description: "Set your own hours, pricing, and court availability — you stay in control.",
  },
  {
    icon: LineChart,
    title: "Track your performance",
    description: "See bookings and occupancy at a glance once your venue is live.",
  },
];

export default function ListYourCourtPage() {
  return (
    <div>
      <section className="bg-secondary text-secondary-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            List your court on Air/Rally
          </h1>
          <p className="max-w-xl text-lg text-secondary-foreground/80">
            Join the marketplace built specifically for pickleball venues — reach more players and
            simplify how you manage bookings.
          </p>
          <Button asChild size="lg" className="h-12 gap-2 rounded-full px-7 text-base">
            <Link href="/signup">
              Get Started
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader
          eyebrow="For venue owners"
          title="Everything you need to grow your venue"
          align="center"
        />
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
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

        <div className="mt-12 rounded-2xl border border-dashed border-border bg-muted/40 p-6 text-center">
          <p className="text-sm text-muted-foreground">
            Full venue management — listings, schedules, staff, and revenue reporting — arrives in a
            later phase. Creating an account today reserves your spot for early access.
          </p>
        </div>
      </section>
    </div>
  );
}
