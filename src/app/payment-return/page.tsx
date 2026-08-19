import type { Metadata } from "next";
import { PaymentReturnRedirect } from "./PaymentReturnRedirect";

export const metadata: Metadata = {
  title: "Returning to the app — AIR/Rally",
  robots: { index: false },
};

/**
 * Where PayMongo sends a MOBILE checkout's browser after payment (see
 * app/api/mobile/checkout/route.ts) — never the web flow, which goes to
 * the booking's own confirmation page. Deliberately public and dataless:
 * the in-app browser has no web session, so this page must render signed
 * out, and it decides nothing — the app re-reads the booking row under
 * the user's own RLS once the deep link lands. Nothing here VERIFIES a
 * payment, so nothing here may claim one: `outcome` is an echoed URL
 * param, and copy that read "Payment received" would be asserting a fact
 * this page never checked. The app's own poll of the booking row is the
 * only thing allowed to say a booking is paid.
 *
 * The params are only echoed
 * into the airrally:// link after strict validation, so a tampered URL
 * can at worst bounce back to the app's own error state.
 */
export default async function PaymentReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const params = await searchParams;
  const rawBookingId = typeof params.bookingId === "string" ? params.bookingId : "";
  const rawOutcome = typeof params.outcome === "string" ? params.outcome : "";

  const bookingId = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawBookingId)
    ? rawBookingId
    : null;
  const outcome = rawOutcome === "cancelled" ? "cancelled" : "success";

  const query = new URLSearchParams({ outcome, ...(bookingId ? { bookingId } : {}) });
  const deepLink = `airrally://payment-return?${query.toString()}`;

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-6">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-2xl font-bold tracking-tight text-foreground">
          AIR<span className="text-primary">/</span>Rally
        </p>
        <h1 className="mt-6 text-lg font-semibold text-foreground">
          {outcome === "cancelled" ? "Checkout cancelled" : "Returning you to the app"}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {outcome === "cancelled"
            ? "You left checkout, so nothing was charged. Head back to the app to try again."
            : "The app will show your booking's real status once it lands \u2014 it checks with us directly."}
        </p>
        <PaymentReturnRedirect deepLink={deepLink} />
        <p className="mt-6 text-xs text-muted-foreground">
          Nothing happening? Open the AIR/Rally app yourself — your booking status is waiting on the
          Bookings tab.
        </p>
      </div>
    </main>
  );
}
