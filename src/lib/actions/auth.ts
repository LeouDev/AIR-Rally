"use server";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/legal";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import { sendEmail } from "@/lib/services/email";
import { renderSignupWelcomeEmail } from "@/lib/emails/signupWelcomeEmail";
import {
  loginSchema,
  signUpSchema,
  completeOAuthSignupSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type LoginValues,
  type SignUpValues,
  type CompleteOAuthSignupValues,
  type ForgotPasswordValues,
  type ResetPasswordValues,
} from "@/lib/validations/auth";

export type ActionResult<T = undefined> =
  | { success: true; data: T }
  | { success: false; error: string };

const NOT_CONFIGURED_MESSAGE =
  "Sign-in isn't set up yet — add your Supabase credentials to .env.local (see .env.example).";

/**
 * createClient() throws when Supabase env vars are missing (see
 * .env.example). Every action below needs that to become a normal
 * ActionResult error instead of a rejected promise, so the client-side
 * `await signIn(values)` call sites never need their own try/catch.
 */
type ServerClient = Awaited<ReturnType<typeof createClient>>;

export async function getServerClient(): Promise<
  { ok: true; client: ServerClient } | { ok: false; error: string }
> {
  try {
    return { ok: true, client: await createClient() };
  } catch (error) {
    logServerError("supabase.createClient", error);
    return { ok: false, error: NOT_CONFIGURED_MESSAGE };
  }
}

export async function signUp(
  values: SignUpValues
): Promise<ActionResult<{ requiresEmailConfirmation: boolean }>> {
  const parsed = signUpSchema.safeParse(values);
  if (!parsed.success) {
    // Re-validated here, not just client-side — includes the
    // agreedToTerms === true check, so a request that skips/tampers with
    // the checkbox never reaches auth.signUp() at all.
    return { success: false, error: "Please fix the errors below and try again." };
  }
  const { firstName, lastName, email, password } = parsed.data;

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const siteUrl = await getSiteUrl();

  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: {
        first_name: firstName,
        last_name: lastName,
        display_name: `${firstName} ${lastName}`.trim(),
      },
      emailRedirectTo: `${siteUrl}/auth/callback`,
    },
  });

  if (error) {
    logServerError("auth.signUp", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }

  // Recorded server-side via a SECURITY DEFINER RPC, not a plain insert —
  // `data.user.id` exists immediately regardless of whether email
  // confirmation is pending (no active session yet in that case, so an
  // RLS-gated self-insert wouldn't work here). Never trusts the client's
  // agreedToTerms boolean as the record itself — that boolean only
  // gated whether we got this far.
  if (data.user) {
    const { error: agreementError } = await supabase.rpc("record_agreement_acceptance", {
      p_user_id: data.user.id,
      p_agreement_version: CURRENT_AGREEMENT_VERSION,
    });
    if (agreementError) {
      // The auth account already exists at this point — failing the
      // whole signup over a logging-table write would strand the user
      // with an account they can't recreate (duplicate email) and can't
      // finish creating. Log it for follow-up instead of blocking them.
      logServerError("auth.signUp.recordAgreement", agreementError);
    }
  }

  const requiresEmailConfirmation = data.session === null;

  // Only when there's no confirmation link to wait for. Otherwise this
  // fires later, off the actual email_confirmed_at transition (see
  // supabase/migrations/20260810000075_email_confirmed_notification.sql)
  // — this function runs before that link even exists, so it has no way
  // to know whether, or when, anyone clicks it.
  if (!requiresEmailConfirmation) {
    // Fire-and-forget, same posture as the agreement RPC above — the
    // account already exists, so a mail-provider hiccup must not turn
    // into a failed signup. sendEmail() itself never throws.
    await sendEmail({
      to: email,
      subject: "You're ready to play on AIR/Rally",
      html: renderSignupWelcomeEmail(siteUrl),
    });
  }

  return { success: true, data: { requiresEmailConfirmation } };
}

/**
 * Finishes signup for a user who just authenticated via Google/Facebook —
 * the auth.users row (and, via handle_new_user(), the profiles row) were
 * already created by Supabase the instant the OAuth callback exchanged its
 * code; this only records what OAuth has no way to collect: agreement
 * acceptance. `intendedRole` never touches `profiles.role` directly, same
 * as the email/password signup form — it only decides whether the caller
 * (the trimmed signup page) goes on to call requestOwnerAccessAction().
 *
 * Requires an active session — this is a continuation of the OAuth flow,
 * not a way to backdate acceptance for an arbitrary user id.
 */
export async function completeOAuthSignup(values: CompleteOAuthSignupValues): Promise<ActionResult> {
  const parsed = completeOAuthSignupSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { success: false, error: "Your session has expired. Please sign in again." };
  }

  const { error } = await supabase.rpc("record_agreement_acceptance", {
    p_user_id: user.id,
    p_agreement_version: CURRENT_AGREEMENT_VERSION,
  });
  if (error) {
    logServerError("auth.completeOAuthSignup", error);
    return { success: false, error: getFriendlyErrorMessage(error, "We couldn't finish setting up your account.") };
  }

  // Same welcome email as the email/password path — OAuth just reaches
  // this point by a different route (see this function's own doc
  // comment). Best-effort: no address on the OAuth profile is rare but
  // possible, and not worth failing an otherwise-complete signup over.
  if (user.email) {
    const siteUrl = await getSiteUrl();
    await sendEmail({
      to: user.email,
      subject: "You're ready to play on AIR/Rally",
      html: renderSignupWelcomeEmail(siteUrl),
    });
  }

  return { success: true, data: undefined };
}

export async function signIn(values: LoginValues): Promise<ActionResult> {
  const parsed = loginSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Enter a valid email and password." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    logServerError("auth.signInWithPassword", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }

  return { success: true, data: undefined };
}

export async function requestPasswordReset(values: ForgotPasswordValues): Promise<ActionResult> {
  const parsed = forgotPasswordSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Enter a valid email address." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const siteUrl = await getSiteUrl();

  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    // Supabase itself avoids confirming whether an email exists; we only
    // reach a genuine error here for things like rate limiting.
    logServerError("auth.resetPasswordForEmail", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }

  return { success: true, data: undefined };
}

export async function updatePassword(values: ResetPasswordValues): Promise<ActionResult> {
  const parsed = resetPasswordSchema.safeParse(values);
  if (!parsed.success) {
    return { success: false, error: "Please fix the errors below and try again." };
  }

  const clientResult = await getServerClient();
  if (!clientResult.ok) return { success: false, error: clientResult.error };
  const supabase = clientResult.client;

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

  if (error) {
    logServerError("auth.updateUser", error);
    return { success: false, error: getFriendlyErrorMessage(error) };
  }

  return { success: true, data: undefined };
}
