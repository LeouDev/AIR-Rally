import { Resend } from "resend";
import { logServerError } from "@/lib/errors";

/**
 * Thin wrapper over Resend — the one place its SDK is touched, same
 * convention as paymongo.ts owning every PayMongo call.
 *
 * Lazy-constructed so importing this module never throws in a context
 * (tests, scripts) that hasn't set RESEND_API_KEY.
 */
let client: Resend | null = null;
function getClient(): Resend {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    throw new Error("RESEND_API_KEY isn't set — required to send email. Add it from your Resend dashboard's API Keys page.");
  }
  client ??= new Resend(apiKey);
  return client;
}

export type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Sends one email. Never throws — a failed send must not take down
 * whatever triggered it (a notification already exists in-app regardless
 * of whether the email copy of it goes out). Callers that need to know
 * whether it actually sent should check the return value; callers that
 * don't (fire-and-forget) can ignore it entirely.
 */
export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    logServerError("email.send", new Error("RESEND_FROM_EMAIL isn't set"));
    return false;
  }

  try {
    const { error } = await getClient().emails.send({ from, to: input.to, subject: input.subject, html: input.html });
    if (error) {
      logServerError("email.send", error);
      return false;
    }
    return true;
  } catch (error) {
    logServerError("email.send", error);
    return false;
  }
}
