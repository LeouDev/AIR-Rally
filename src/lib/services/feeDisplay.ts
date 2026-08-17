import { isPaymongoPassOnFeesEnabled } from "@/lib/paymongoLaunchGates";
import { PAYMENT_METHOD_TYPES, PASS_ON_FEES_VERIFIED_METHODS } from "@/lib/services/paymongo";

/**
 * SERVER ONLY. Imports paymongo.ts, which pulls in node:crypto — never import
 * this from a client component. Call it in a server component and hand the
 * boolean down as a prop, the same way the pass-on-fees kill switch is already
 * handled so the client never reads it directly.
 */

/**
 * Whether every method checkout will offer has a fee we can predict.
 *
 * Takes both lists as arguments rather than closing over the constants so the
 * widened case can actually be tested — with the real constants it is always
 * true today, and a condition that can never be false in a test is a condition
 * nobody has checked.
 */
export function methodsArePredictable(
  methods: readonly string[],
  verified: readonly string[]
): boolean {
  return methods.every((method) => verified.includes(method));
}

/**
 * Whether checkout will actually add a processing fee to this booking.
 *
 * TWO conditions, and the display must respect both. The kill switch alone is
 * not enough: assertPassOnFeesSupported() also throws at session-creation time
 * if any offered method has a fee we cannot predict, so a dialog gated only on
 * the switch would itemise an "Online payment fee" for a checkout that then
 * refuses to produce one. That is the price-mismatch bug inverted — the
 * customer is quoted a breakdown, and the request dies before a session
 * exists.
 *
 * Deliberately derived from the same exported lists the assertion uses, not
 * from a parallel notion of "is this predictable". Two independent judgements
 * of the same question eventually disagree, and the first sign of it would be
 * a booking that never confirms.
 *
 * assertPassOnFeesSupported() itself is not called here because it throws;
 * a render path needs a boolean, not an exception.
 */
export function willPassOnFeesAtCheckout(): boolean {
  return (
    isPaymongoPassOnFeesEnabled() &&
    methodsArePredictable(PAYMENT_METHOD_TYPES, PASS_ON_FEES_VERIFIED_METHODS)
  );
}
