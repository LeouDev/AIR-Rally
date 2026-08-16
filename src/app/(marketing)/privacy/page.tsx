import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = { title: "Privacy Policy" };

/**
 * Placeholder legal content, matching terms/page.tsx's honest-disclaimer
 * pattern — deliberately not fabricated binding legal language. A real
 * Privacy Policy needs review from AIR/Rally's own legal counsel before
 * launch; this page exists so the product has an honest privacy surface
 * to link to rather than none at all.
 */
export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold tracking-tight text-foreground">Privacy Policy</h1>

      <div className="mt-8 rounded-xl border border-dashed border-border bg-muted/40 p-4 text-sm text-muted-foreground">
        This page is a placeholder. A real Privacy Policy has not been drafted or reviewed by legal counsel yet — do not
        treat anything below as binding or complete. It describes what the product does today so the description is
        honest, not what a finished policy will say.
      </div>

      <div className="mt-8 flex flex-col gap-4 text-sm leading-relaxed text-foreground">
        <h2 className="text-base font-semibold">What we collect</h2>
        <p>
          Account details you provide (name, email, and optionally a phone number and profile photo), the bookings you
          make, reviews you write, and posts you share on COURT/Side.
        </p>

        <h2 className="text-base font-semibold">Payment information</h2>
        <p>
          Booking payments are processed by a third-party payment provider. AIR/Rally does not store your card or bank
          details.
        </p>

        <h2 className="text-base font-semibold">What other people can see</h2>
        <p>
          Your display name and profile photo are visible to other players alongside your reviews, COURT/Side posts, and
          to the owner of any venue you book. Your email address and phone number are not shown to other users.
        </p>

        <h2 className="text-base font-semibold">Location</h2>
        <p>
          If you allow it, your browser shares your approximate location so we can sort venues by distance. It is used
          for that search and not stored on our servers.
        </p>

        <h2 className="text-base font-semibold">Contact</h2>
        <p>
          A published contact route for privacy requests, along with data export and account deletion, is still to be
          built. See the{" "}
          <Link href="/terms" className="text-primary hover:underline">
            User Agreement
          </Link>{" "}
          for the equally-provisional terms placeholder.
        </p>
      </div>
    </div>
  );
}
