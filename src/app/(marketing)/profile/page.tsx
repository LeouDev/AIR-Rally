import Link from "next/link";
import { UserCircle } from "lucide-react";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";

export const metadata = { title: "Profile" };

export default function ProfilePage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-12 sm:px-6 lg:px-8">
      <h1 className="text-2xl font-semibold text-foreground">Profile</h1>
      <p className="mt-1 text-muted-foreground">Manage your account and preferences.</p>

      <div className="mt-8">
        <EmptyState
          icon={UserCircle}
          title="You're not signed in"
          description="Sign in to manage your bookings, favorites, and account details."
          action={
            <div className="flex gap-3">
              <Button asChild>
                <Link href="/login">Sign In</Link>
              </Button>
              <Button asChild variant="outline">
                <Link href="/signup">Create Account</Link>
              </Button>
            </div>
          }
        />
      </div>
    </div>
  );
}
