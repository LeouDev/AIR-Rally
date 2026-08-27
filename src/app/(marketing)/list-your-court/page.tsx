import Link from "next/link";
import type { Metadata } from "next";
import { Wallet, CalendarClock, Settings2, ShieldCheck, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { SectionHeader } from "@/components/shared/SectionHeader";
import { OwnerVenueGrid } from "@/components/owner/OwnerVenueGrid";
import { CreateVenueDialog } from "@/components/owner/CreateVenueDialog";
import { getCurrentUser } from "@/lib/supabase/auth";
import { createClient } from "@/lib/supabase/server";
import { listVenuesByOwnerWithSummary } from "@/lib/services/venues";

// Reads the current user's own venues via a cookie-scoped Supabase session
// — must never be cached/shared across visitors like a static page would be.
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "List Your Court",
  description: "List your pickleball venue on Air/Rally — free to join, 95% of every booking, paid out weekly.",
};

/**
 * The four questions a venue owner actually decides on, answered in the
 * order they'd ask them — money first. This is the page a cold-outreach
 * email links to instead of a PDF, so every figure here has to be one an
 * owner can hold the founder to: 5%/95% split verified against migration
 * 20260810000092's worked example (gross 40000 / platform_fee 2000 /
 * venue_amount 38000), the Wednesday cadence against the
 * create_weekly_payout_batch() cron, the ₱10/₱80 figures against
 * 20260810000101's floor constant and the payslip email's own copy.
 */
const OWNER_FAQ = [
  {
    icon: Wallet,
    title: "What does it cost?",
    description:
      "Free to list. No signup fee, no monthly fee, no contract, and nothing exclusive. You keep 95% of every booking — AIR/Rally takes a 5% commission, and that's the only cost.",
  },
  {
    icon: CalendarClock,
    title: "When do I get paid?",
    description:
      "Payouts go out every Wednesday, straight to your bank account, for whatever's been booked and played since your last payout. A ₱10 bank transfer fee is deducted once per payout — not per booking. If your total is under ₱80 that week, it rolls into the next one. You get an email the moment each payout is sent, with the amount, and every booking behind it is itemized in your earnings dashboard.",
  },
  {
    icon: Settings2,
    title: "How much work is it?",
    description:
      "Players pay through the app when they book — you never chase a payment or handle cash. You set your own courts, hours, and prices. Applying is one form; we ask for your bank details up front so a payout has somewhere to go.",
  },
  {
    icon: ShieldCheck,
    title: "What if it doesn't work out?",
    description:
      "Nothing lost. Keep every booking channel you already have — this adds to what you're doing, it doesn't replace it.",
  },
];

export default async function ListYourCourtPage() {
  const user = await getCurrentUser();
  const venues = user ? await listVenuesByOwnerWithSummary(await createClient(), user.id) : [];

  /**
   * An owner who already has venues is here to manage them, not to be sold
   * the product again. They previously had to scroll past a full-height
   * hero and a three-card benefits grid to reach their own venues, which
   * is the wrong order for the person who already said yes.
   *
   * Prospects — signed out, or signed in with nothing listed yet — still
   * get the pitch, because for them it is the point of the page.
   */
  if (user && venues.length > 0) {
    return (
      <div>
        <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight text-foreground">Your venues</h1>
              <p className="mt-1 text-sm text-muted-foreground">
                {venues.length} {venues.length === 1 ? "venue" : "venues"} on your account.
              </p>
            </div>
            <CreateVenueDialog />
          </div>
          <OwnerVenueGrid venues={venues} />
        </div>

        {/* The pitch still runs, just underneath. No "Get Started" button
            down here — it scrolled to a venue list this owner has already
            walked past, and the action they'd actually want (add another
            venue) is the button at the top. */}
        <section className="bg-secondary text-secondary-foreground">
          <div className="mx-auto flex max-w-5xl flex-col items-center gap-4 px-4 py-14 text-center sm:px-6 lg:px-8">
            <h2 className="text-2xl font-semibold tracking-tight sm:text-3xl">Listing another court</h2>
            <p className="max-w-xl text-secondary-foreground/80">
              Free to list, 95% of every booking, paid out every Wednesday — same terms as your first venue.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-14 sm:px-6 lg:px-8">
          <SectionHeader eyebrow="For venue owners" title="What you need to know" align="center" />
          <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
            {OWNER_FAQ.map(({ icon: Icon, title, description }) => (
              <div key={title} className="flex flex-col items-start gap-3 rounded-2xl border border-border bg-card p-6">
                <div className="flex size-11 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                  <Icon className="size-5" aria-hidden="true" />
                </div>
                <h3 className="text-base font-semibold text-foreground">{title}</h3>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
            ))}
          </div>
        </section>
      </div>
    );
  }

  return (
    <div>
      <section className="bg-secondary text-secondary-foreground">
        <div className="mx-auto flex max-w-5xl flex-col items-center gap-5 px-4 py-20 text-center sm:px-6 lg:px-8">
          <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl lg:text-5xl">
            List your court on Air/Rally
          </h1>
          <p className="max-w-xl text-lg text-secondary-foreground/80">
            Free to list. You keep 95% of every booking, paid out to your bank every week.
          </p>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:px-8">
        <SectionHeader eyebrow="For venue owners" title="What you need to know" align="center" />
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-2">
          {OWNER_FAQ.map(({ icon: Icon, title, description }) => (
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

        {/* Stated honestly rather than left implied: the founder's own
            call, after the money answers and before the ask. Reads as a
            reason to act now on an already-attractive offer, not a
            confession — and never implies scale that isn't there
            (no "join the venues already on AIR/Rally", no player counts). */}
        <p className="mx-auto mt-10 max-w-2xl text-center text-sm font-medium text-foreground">
          We launched this week. Early venues get listed before anyone else in their city.
        </p>

        <div className="mx-auto mt-6 flex max-w-4xl flex-col items-center gap-2">
          {user ? (
            <Button asChild size="lg" className="h-12 gap-2 rounded-full px-7 text-base">
              <a href="#your-venues">
                Get Started
                <ArrowRight className="size-4" />
              </a>
            </Button>
          ) : (
            <>
              <Button asChild size="lg" className="h-12 gap-2 rounded-full px-7 text-base">
                <Link href="/signup">
                  Get Started
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <p className="text-sm text-muted-foreground">
                Already have an account?{" "}
                <Link href="/login?redirect=/list-your-court" className="font-medium underline underline-offset-2">
                  Sign in
                </Link>
              </p>
            </>
          )}
        </div>

        {user ? (
          <div id="your-venues" className="mx-auto mt-12 flex max-w-4xl scroll-mt-20 flex-col gap-4">
            <div className="flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-foreground">Your venues</h2>
              <CreateVenueDialog />
            </div>
            <OwnerVenueGrid venues={venues} />
          </div>
        ) : (
          <div className="mt-12 rounded-2xl border border-dashed border-border bg-muted/40 p-6 text-center">
            <p className="text-sm text-muted-foreground">
              Create an account to save your venue as a draft. Full venue management — schedules,
              staff, and revenue reporting — arrives in a later phase.
            </p>
          </div>
        )}
      </section>
    </div>
  );
}
