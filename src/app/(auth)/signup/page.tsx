"use client";

import { Suspense, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { MailCheck } from "lucide-react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CourtSurface } from "@/components/court/CourtSurface";
import { cn } from "@/lib/utils";
import { signUp, completeOAuthSignup } from "@/lib/actions/auth";
import { requestOwnerAccessAction } from "@/lib/actions/ownerApplications";
import { signUpSchema, completeOAuthSignupSchema, type SignUpValues, type CompleteOAuthSignupValues } from "@/lib/validations/auth";
import { OAuthButtons } from "@/components/auth/OAuthButtons";

const ROLE_OPTIONS = [
  {
    value: "player" as const,
    title: "I want to play",
    description: "Find courts, book games, and discover new places to play.",
  },
  {
    value: "venue_owner" as const,
    title: "I own a court",
    description: "List your court, manage bookings, and grow your facility.",
  },
];

/** Shared by the full signup form and the trimmed OAuth-completion form — identical choice, identical UI either way. */
function RolePicker({ value, onChange }: { value: "player" | "venue_owner"; onChange: (role: "player" | "venue_owner") => void }) {
  return (
    <div className="flex flex-col gap-1.5">
      <Label>How will you use AIR/Rally?</Label>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {ROLE_OPTIONS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={value === option.value}
            className={cn(
              "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
              value === option.value ? "border-primary bg-primary/5" : "border-border hover:border-primary/40"
            )}
          >
            {option.value === "player" ? (
              <Image src="/brand/mark-transparent.png" alt="" width={28} height={28} className="size-7" />
            ) : (
              <span className="size-7 overflow-hidden rounded-md">
                <CourtSurface surfaceColor="blue" indoor={false} />
              </span>
            )}
            <span className="text-sm font-medium text-foreground">{option.title}</span>
            <span className="text-xs text-muted-foreground">{option.description}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** After venue_owner picks are made, both forms do the same thing on success. */
async function routeAfterSignup(router: ReturnType<typeof useRouter>, intendedRole: "player" | "venue_owner", redirectTo: string) {
  if (intendedRole === "venue_owner") {
    await requestOwnerAccessAction();
    router.push("/owner/onboarding");
  } else {
    router.push(redirectTo);
  }
  router.refresh();
}

function SignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirect") || "/";
  const requestedRole = searchParams.get("intendedRole") === "venue_owner" ? "venue_owner" : "player";

  const [needsConfirmation, setNeedsConfirmation] = useState<{ intendedOwner: boolean } | null>(null);

  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<SignUpValues>({ resolver: zodResolver(signUpSchema), defaultValues: { intendedRole: requestedRole } });

  const intendedRole = watch("intendedRole");

  async function onSubmit(values: SignUpValues) {
    const result = await signUp(values);
    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }
    if (result.data.requiresEmailConfirmation) {
      setNeedsConfirmation({ intendedOwner: values.intendedRole === "venue_owner" });
      return;
    }

    await routeAfterSignup(router, values.intendedRole, redirectTo);
  }

  if (needsConfirmation) {
    return (
      <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-accent text-accent-foreground">
          <MailCheck className="size-6" aria-hidden="true" />
        </div>
        <h1 className="mt-4 text-xl font-semibold text-foreground">Check your email</h1>
        <p className="mt-1.5 text-sm text-muted-foreground">
          We sent you a confirmation link. Click it to activate your account, then sign in.
        </p>
        {needsConfirmation.intendedOwner && (
          <p className="mt-3 text-sm text-muted-foreground">
            Once confirmed, visit your profile to start your owner application.
          </p>
        )}
        <Button asChild variant="outline" className="mt-6">
          <Link href="/login">Back to Sign In</Link>
        </Button>
      </div>
    );
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">Create your account</h1>
      <p className="mt-1 text-sm text-muted-foreground">Play More. Rally More.</p>

      <div className="mt-6">
        <OAuthButtons redirectTo={redirectTo} intendedRole={intendedRole} />
      </div>

      <form className="flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RolePicker value={intendedRole} onChange={(role) => setValue("intendedRole", role, { shouldDirty: true })} />

        <div className="grid grid-cols-2 gap-3">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              autoComplete="given-name"
              placeholder="Jamie"
              aria-invalid={!!errors.firstName}
              aria-describedby={errors.firstName ? "firstName-error" : undefined}
              {...register("firstName")}
            />
            {errors.firstName && (
              <p id="firstName-error" role="alert" className="text-xs text-destructive">
                {errors.firstName.message}
              </p>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="lastName">Last name</Label>
            <Input
              id="lastName"
              autoComplete="family-name"
              placeholder="Cruz"
              aria-invalid={!!errors.lastName}
              aria-describedby={errors.lastName ? "lastName-error" : undefined}
              {...register("lastName")}
            />
            {errors.lastName && (
              <p id="lastName-error" role="alert" className="text-xs text-destructive">
                {errors.lastName.message}
              </p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            placeholder="you@example.com"
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? "email-error" : undefined}
            {...register("email")}
          />
          {errors.email && (
            <p id="email-error" role="alert" className="text-xs text-destructive">
              {errors.email.message}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-1.5">
          <Label htmlFor="password">Password</Label>
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
          <Label htmlFor="confirmPassword">Confirm password</Label>
          <Input
            id="confirmPassword"
            type="password"
            autoComplete="new-password"
            placeholder="Re-enter your password"
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

        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <input
              id="agreedToTerms"
              type="checkbox"
              aria-invalid={!!errors.agreedToTerms}
              className="mt-0.5 size-4 shrink-0 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
              aria-describedby={errors.agreedToTerms ? "agreedToTerms-error" : undefined}
              {...register("agreedToTerms")}
            />
            <Label htmlFor="agreedToTerms" className="text-sm font-normal text-muted-foreground">
              I agree to the{" "}
              <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
                User Agreement
              </Link>
            </Label>
          </div>
          {errors.agreedToTerms && (
            <p id="agreedToTerms-error" role="alert" className="text-xs text-destructive">
              {errors.agreedToTerms.message}
            </p>
          )}
        </div>

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" className="mt-2 h-11" disabled={isSubmitting}>
          {isSubmitting ? "Creating account…" : "Create Account"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-primary hover:underline">
          Sign in
        </Link>
      </p>
    </div>
  );
}

/**
 * Landed on by src/app/auth/callback/route.ts when a Google/Facebook
 * sign-in turns out to be a first-time arrival — the auth.users and
 * profiles rows already exist (Supabase + handle_new_user() created them
 * the instant the OAuth code was exchanged), so this only collects the
 * two things OAuth has no way to: role intent and agreeing to the User
 * Agreement. No email/password/name fields — there's nothing to collect
 * that OAuth didn't already provide.
 */
function CompleteOAuthSignupForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("next") || "/";
  const requestedRole = searchParams.get("intendedRole") === "venue_owner" ? "venue_owner" : "player";

  const {
    register,
    handleSubmit,
    setError,
    watch,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<CompleteOAuthSignupValues>({
    resolver: zodResolver(completeOAuthSignupSchema),
    defaultValues: { intendedRole: requestedRole, agreedToTerms: false },
  });

  const intendedRole = watch("intendedRole");

  async function onSubmit(values: CompleteOAuthSignupValues) {
    const result = await completeOAuthSignup(values);
    if (!result.success) {
      setError("root", { message: result.error });
      return;
    }
    await routeAfterSignup(router, values.intendedRole, redirectTo);
  }

  return (
    <div className="w-full max-w-sm rounded-2xl border border-border bg-card p-8 shadow-sm">
      <h1 className="text-xl font-semibold text-foreground">One more step</h1>
      <p className="mt-1 text-sm text-muted-foreground">You&apos;re signed in — just tell us how you&apos;ll use AIR/Rally.</p>

      <form className="mt-6 flex flex-col gap-4" onSubmit={handleSubmit(onSubmit)} noValidate>
        <RolePicker value={intendedRole} onChange={(role) => setValue("intendedRole", role, { shouldDirty: true })} />

        <div className="flex flex-col gap-1.5">
          <div className="flex items-start gap-2">
            <input
              id="agreedToTerms"
              type="checkbox"
              aria-invalid={!!errors.agreedToTerms}
              className="mt-0.5 size-4 shrink-0 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
              aria-describedby={errors.agreedToTerms ? "agreedToTerms-error" : undefined}
              {...register("agreedToTerms")}
            />
            <Label htmlFor="agreedToTerms" className="text-sm font-normal text-muted-foreground">
              I agree to the{" "}
              <Link href="/terms" target="_blank" className="font-medium text-primary hover:underline">
                User Agreement
              </Link>
            </Label>
          </div>
          {errors.agreedToTerms && (
            <p id="agreedToTerms-error" role="alert" className="text-xs text-destructive">
              {errors.agreedToTerms.message}
            </p>
          )}
        </div>

        {errors.root && (
          <p role="alert" className="text-sm text-destructive">
            {errors.root.message}
          </p>
        )}

        <Button type="submit" className="mt-2 h-11" disabled={isSubmitting}>
          {isSubmitting ? "Finishing up…" : "Continue"}
        </Button>
      </form>
    </div>
  );
}

function SignupPageContent() {
  const searchParams = useSearchParams();
  const isCompletingOAuth = searchParams.get("complete") === "1";
  return isCompletingOAuth ? <CompleteOAuthSignupForm /> : <SignupForm />;
}

export default function SignupPage() {
  return (
    <Suspense>
      <SignupPageContent />
    </Suspense>
  );
}
