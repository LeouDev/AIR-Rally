"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { CheckCircle2, ShieldAlert } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updatePassword } from "@/lib/actions/auth";
import { resetPasswordSchema, type ResetPasswordValues } from "@/lib/validations/auth";
import { createClient } from "@/lib/supabase/client";

type SessionState = "checking" | "valid" | "invalid" | "updated";

export default function ResetPasswordPage() {
  const router = useRouter();
  const [sessionState, setSessionState] = useState<SessionState>("checking");

  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm<ResetPasswordValues>({ resolver: zodResolver(resetPasswordSchema) });

  useEffect(() => {
    let cancelled = false;

    async function checkSession() {
      let user = null;
      try {
        const { data } = await createClient().auth.getUser();
        user = data.user;
      } catch {
        // Supabase isn't configured — there's no session to recover either way.
      }
      if (!cancelled) setSessionState(user ? "valid" : "invalid");
    }

    checkSession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(values: ResetPasswordValues) {
    const result = await updatePassword(values);
    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }
    setSessionState("updated");
    setTimeout(() => {
      router.push("/");
      router.refresh();
    }, 1500);
  }

  if (sessionState === "checking") {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <p className="text-sm text-muted-foreground">Checking your link…</p>
      </div>
    );
  }

  if (sessionState === "invalid") {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
          <ShieldAlert className="size-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Link expired</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          This password reset link is invalid or has expired. Request a new one to continue.
        </p>
        <Button asChild className="mt-6">
          <Link href="/forgot-password">Request a new link</Link>
        </Button>
      </div>
    );
  }

  if (sessionState === "updated") {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-success/15 text-success">
          <CheckCircle2 className="size-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Password updated</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">Taking you back to Air/Rally…</p>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">Set a new password</h1>
      <p className="mt-1 text-sm text-muted-foreground">Choose a new password for your account.</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">New password</Label>
          <Input
            id="password"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            aria-invalid={!!errors.password}
            aria-describedby={errors.password ? "password-error" : undefined}
            {...register("password")}
          />
          {errors.password && (
            <p id="password-error" role="alert" className="text-xs text-destructive">
              {errors.password.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="confirmPassword">Confirm new password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your new password"
            aria-invalid={!!errors.confirmPassword}
            aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
            {...register("confirmPassword")}
          />
          {errors.confirmPassword && (
            <p id="confirmPassword-error" role="alert" className="text-xs text-destructive">
              {errors.confirmPassword.message}
            </p>
          )}
        </div>

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" className="mt-2 h-11" disabled={isSubmitting}>
          {isSubmitting ? "Updating…" : "Update Password"}
        </Button>
      </form>
    </div>
  );
}
