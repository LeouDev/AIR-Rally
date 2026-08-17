import { z } from "zod";

// Shared between client-side form validation (React Hook Form) and the
// server actions that actually perform the auth calls — client validation
// is a UX nicety, the server action re-validates independently and is the
// one that's actually trusted.
export const emailSchema = z.email("Enter a valid email address");
export const passwordSchema = z.string().min(8, "Password must be at least 8 characters");

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, "Enter your password"),
});
export type LoginValues = z.infer<typeof loginSchema>;

export const signUpSchema = z
  .object({
    firstName: z.string().trim().min(1, "Enter your first name"),
    lastName: z.string().trim().min(1, "Enter your last name"),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
    // Shape validation only (a client can always send `true`) — the
    // server action is what actually matters here, since it re-validates
    // this same schema and then records acceptance server-side via
    // record_agreement_acceptance() rather than trusting this boolean as
    // proof of anything by itself. See lib/actions/auth.ts.
    agreedToTerms: z.boolean(),
    // Client-only routing hint, never sent to auth.signUp() — the signUp()
    // action ignores it entirely. A "venue_owner" pick never grants
    // anything by itself; it only decides whether the signup page redirects
    // to /owner/onboarding and calls requestOwnerAccessAction() afterward
    // (see Phase 6, Part 2/3). `role` in `profiles` still always starts as
    // 'player' regardless of this value. No `.default()` here deliberately
    // — that would make Zod's inferred output type required while the
    // input type stays optional, breaking react-hook-form's resolver
    // generic; the signup page supplies the default via useForm's own
    // `defaultValues` instead.
    intendedRole: z.enum(["player", "venue_owner"]),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  })
  .refine((data) => data.agreedToTerms === true, {
    message: "You must accept the User Agreement to create an account",
    path: ["agreedToTerms"],
  });
export type SignUpValues = z.infer<typeof signUpSchema>;

/**
 * What an OAuth (Google/Facebook) signup still needs after the provider
 * has already authenticated them — Supabase creates the auth.users row
 * automatically, so there's no email/password/name to collect here, only
 * the two things the OAuth redirect skips entirely: role intent and
 * agreeing to the User Agreement. See completeOAuthSignup() in
 * lib/actions/auth.ts.
 */
export const completeOAuthSignupSchema = z
  .object({
    agreedToTerms: z.boolean(),
    intendedRole: z.enum(["player", "venue_owner"]),
  })
  .refine((data) => data.agreedToTerms === true, {
    message: "You must accept the User Agreement to create an account",
    path: ["agreedToTerms"],
  });
export type CompleteOAuthSignupValues = z.infer<typeof completeOAuthSignupSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordValues = z.infer<typeof forgotPasswordSchema>;

export const resetPasswordSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string().min(1, "Confirm your password"),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: "Passwords don't match",
    path: ["confirmPassword"],
  });
export type ResetPasswordValues = z.infer<typeof resetPasswordSchema>;
