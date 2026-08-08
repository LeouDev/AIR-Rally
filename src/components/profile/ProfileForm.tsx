"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/actions/profile";
import { updateProfileSchema, type UpdateProfileValues } from "@/lib/validations/profile";
import type { Profile, UserRole } from "@/lib/supabase/types";

const ROLE_LABELS: Record<UserRole, string> = {
  player: "Player",
  venue_owner: "Venue Owner",
  admin: "Admin",
};

function initialsFrom(name: string) {
  const parts = name.trim().split(/\s+/);
  return parts
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

type ProfileFormProps = {
  profile: Profile;
  email: string;
};

export function ProfileForm({ profile, email }: ProfileFormProps) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
    watch,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<UpdateProfileValues>({
    resolver: zodResolver(updateProfileSchema),
    defaultValues: {
      firstName: profile.first_name ?? "",
      lastName: profile.last_name ?? "",
      displayName: profile.display_name ?? "",
      phone: profile.phone ?? "",
      avatarUrl: profile.avatar_url ?? "",
    },
  });

  const currentDisplayName = watch("displayName") || profile.display_name || email;
  const currentAvatarUrl = watch("avatarUrl");

  async function onSubmit(values: UpdateProfileValues) {
    const result = await updateProfileAction(values);
    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }
    toast.success("Profile updated");
    router.refresh();
  }

  return (
    <div className="flex flex-col gap-8">
      <div className="flex items-center gap-4">
        <Avatar className="size-16">
          {currentAvatarUrl && <AvatarImage src={currentAvatarUrl} alt="" />}
          <AvatarFallback className="bg-secondary text-lg font-semibold text-secondary-foreground">
            {initialsFrom(currentDisplayName)}
          </AvatarFallback>
        </Avatar>
        <div>
          <p className="text-lg font-semibold text-foreground">{currentDisplayName}</p>
          <p className="text-sm text-muted-foreground">{email}</p>
          <Badge variant="secondary" className="mt-1.5">
            {ROLE_LABELS[profile.role]}
          </Badge>
        </div>
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input id="firstName" aria-invalid={!!errors.firstName} {...register("firstName")} />
            {errors.firstName && <p className="text-xs text-destructive">{errors.firstName.message}</p>}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input id="lastName" aria-invalid={!!errors.lastName} {...register("lastName")} />
            {errors.lastName && <p className="text-xs text-destructive">{errors.lastName.message}</p>}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" aria-invalid={!!errors.displayName} {...register("displayName")} />
          {errors.displayName && <p className="text-xs text-destructive">{errors.displayName.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="phone">Phone</Label>
          <Input
            id="phone"
            type="tel"
            placeholder="+63 900 000 0000"
            aria-invalid={!!errors.phone}
            {...register("phone")}
          />
          {errors.phone && <p className="text-xs text-destructive">{errors.phone.message}</p>}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="avatarUrl">Avatar URL</Label>
          <Input
            id="avatarUrl"
            type="url"
            placeholder="https://…"
            aria-invalid={!!errors.avatarUrl}
            {...register("avatarUrl")}
          />
          {errors.avatarUrl && <p className="text-xs text-destructive">{errors.avatarUrl.message}</p>}
          <p className="text-xs text-muted-foreground">
            Paste an image URL for now — direct upload arrives with Supabase Storage in a later phase.
          </p>
        </div>

        {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

        <Button type="submit" className="mt-2 self-start" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save Changes"}
        </Button>
      </form>
    </div>
  );
}
