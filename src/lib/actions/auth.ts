"use server";

import { createClient } from "@/lib/supabase/server";
import { getSiteUrl } from "@/lib/site";
import { CURRENT_AGREEMENT_VERSION } from "@/lib/legal";
import { getFriendlyErrorMessage, logServerError } from "@/lib/errors";
import {
  loginSchema,
  signUpSchema,
  forgotPasswordSchema,
  resetPasswordSchema,
  type LoginValues,
  type SignUpValues,
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

  return { success: true, data: { requiresEmailConfirmation: data.session === null } };
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
