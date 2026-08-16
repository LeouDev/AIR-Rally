import type { Metadata } from "next";
import { requireSignedIn } from "@/lib/supabase/auth";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Owner Settings",
};

export default async function OwnerSettingsPage() {
  await requireSignedIn("/list-your-court/settings");

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6 px-4 py-12 sm:px-6 lg:px-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Settings</h1>
        <p className="mt-1 text-sm text-muted-foreground">Account-wide preferences for your venue business.</p>
      </div>
      <p className="rounded-xl border border-dashed border-border bg-muted/40 px-4 py-6 text-center text-sm text-muted-foreground">
        Owner-wide settings are coming soon. For now, manage each venue&apos;s details, hours, and photos from its own
        page.
      </p>
    </div>
  );
}
