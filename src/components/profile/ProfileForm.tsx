"use client";

import { useRouter } from "next/navigation";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateProfileAction } from "@/lib/actions/profile";
import { updateProfileSchema, type UpdateProfileValues } from "@/lib/validations/profile";
import { ChangePasswordForm } from "@/components/profile/ChangePasswordForm";
import { EmailNotificationToggle } from "@/components/profile/EmailNotificationToggle";
import type { Profile } from "@/lib/supabase/types";

type ProfileFormProps = {
  profile: Profile;
  email: string;
};

export function ProfileForm({ profile, email }: ProfileFormProps) {
  const router = useRouter();

  const {
    register,
    handleSubmit,
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
      <div>
        <h2 className="text-lg font-semibold text-foreground">Account details</h2>
        <p className="text-sm text-muted-foreground">{email}</p>
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

        {errors.root && <p className="text-sm text-destructive">{errors.root.message}</p>}

        <Button type="submit" className="mt-2 self-start" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? "Saving…" : "Save Changes"}
        </Button>
      </form>

      <div className="border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-foreground">Notifications</h2>
        <div className="mt-4">
          <EmailNotificationToggle initialEnabled={profile.email_notifications_enabled} />
        </div>
      </div>

      <div className="border-t border-border pt-8">
        <h2 className="text-lg font-semibold text-foreground">Password</h2>
        <p className="mt-1 text-sm text-muted-foreground">Change the password for this account.</p>
        <div className="mt-4">
          <ChangePasswordForm />
        </div>
      </div>
    </div>
  );
}
