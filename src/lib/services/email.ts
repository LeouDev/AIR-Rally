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
/**
 * Production's Supabase project ref. Used ONLY to decide whether this
 * deployment is allowed to email real people.
 *
 * Hardcoding a project ref is ugly, and it is deliberate: the alternative is
 * an env var that says "I am production", which fails OPEN — forget it on a
 * new environment and that environment starts emailing real users. This fails
 * CLOSED. A deployment that is not production and has not been told where to
 * redirect sends nothing at all.
 */
const PRODUCTION_SUPABASE_REF = "hrpbjudsrqcgyrkkodop";

function isProductionDeployment(): boolean {
  return (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").includes(PRODUCTION_SUPABASE_REF);
}

/**
 * Where a non-production deployment's email actually goes.
 *
 * WHY THIS EXISTS. Staging carries 11 accounts with real-looking addresses.
 * Without this, testing an email change on staging can send a real person
 * something that looks like a genuine AIR/Rally notification — which is worse
 * than not being able to test email at all, and is why the payslip ended up
 * being verified against production data instead.
 *
 * Every recipient is replaced by this one address and the intended recipient
 * is carried in the subject, so a real send lands in a real inbox and renders
 * in a real client, while nobody else can be reached BY CONSTRUCTION rather
 * than by anyone remembering to be careful.
 */
function redirectTarget(): string | null {
  const to = process.env.EMAIL_REDIRECT_TO?.trim();
  return to && to.length > 0 ? to : null;
}

export async function sendEmail(input: SendEmailInput): Promise<boolean> {
  const from = process.env.RESEND_FROM_EMAIL;
  if (!from) {
    logServerError("email.send", new Error("RESEND_FROM_EMAIL isn't set"));
    return false;
  }

  let to = input.to;
  let subject = input.subject;

  if (!isProductionDeployment()) {
    const target = redirectTarget();
    if (!target) {
      // FAIL CLOSED. A non-production deployment with no redirect configured
      // does not fall back to sending normally — that is exactly the mistake
      // this guard exists to make impossible.
      logServerError(
        "email.send",
        new Error(
          "Refusing to send: this is not the production deployment and EMAIL_REDIRECT_TO is not set. " +
            "Set EMAIL_REDIRECT_TO to route all mail to one address, or nothing will be sent.",
        ),
      );
      return false;
    }
    // The original recipient is preserved in the subject rather than dropped,
    // so a redirected inbox can still tell who each message was for.
    subject = `[staging → ${input.to}] ${input.subject}`;
    to = target;
  }

  try {
    const { error } = await getClient().emails.send({ from, to, subject, html: input.html });
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
