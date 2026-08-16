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
