"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { CalendarCheck, Heart, LogOut, User as UserIcon } from "lucide-react";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { createClient } from "@/lib/supabase/client";

type UserMenuProps = {
  displayName: string;
  email: string;
  avatarUrl: string | null;
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function UserMenu({ displayName, email, avatarUrl }: UserMenuProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleLogout() {
    startTransition(async () => {
      // Signing out through the *browser* client (rather than the
      // signOut server action) matters here: it's what fires this
      // client's own onAuthStateChange listeners — including the one in
      // AuthNavSection — so the nav updates immediately instead of
      // waiting on a server round-trip. It clears the same cookies the
      // server reads (createBrowserClient falls back to document.cookie
      // when no custom cookie adapter is given), so proxy.ts and Server
      // Components see the signed-out state too.
      let error: { message: string } | null = null;
      try {
        ({ error } = await createClient().auth.signOut());
      } catch {
        error = { message: "Sign-in isn't set up yet." };
      }
      if (error) {
        toast.error(error.message || "We couldn't sign you out. Please try again.");
        return;
      }
      router.push("/");
      router.refresh();
    });
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="flex items-center gap-2 rounded-full border border-transparent p-0.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label={`Account menu for ${displayName}`}
      >
        <Avatar className="size-8">
          {avatarUrl && <AvatarImage src={avatarUrl} alt="" />}
          <AvatarFallback className="bg-secondary text-xs font-semibold text-secondary-foreground">
            {initialsFrom(displayName) || <UserIcon className="size-4" />}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel className="flex flex-col">
          <span className="text-sm font-medium text-foreground">{displayName}</span>
          <span className="text-xs font-normal text-muted-foreground">{email}</span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/profile">
            <UserIcon />
            Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/bookings">
            <CalendarCheck />
            Bookings
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/favorites">
            <Heart />
            Favorites
          </Link>
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" disabled={isPending} onSelect={handleLogout}>
          <LogOut />
          {isPending ? "Signing out…" : "Log out"}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
