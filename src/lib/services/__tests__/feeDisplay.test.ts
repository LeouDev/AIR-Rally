import { methodsArePredictable } from "@/lib/services/feeDisplay";
import { PAYMENT_METHOD_TYPES, PASS_ON_FEES_VERIFIED_METHODS } from "@/lib/services/paymongo";

/**
 * The dialog's fee line and checkout's willingness to produce a fee must agree.
 * With today's constants the answer is always true, so the widened case — the
 * only one that can break — is exercised with explicit lists rather than left
 * to a config nobody has changed yet.
 */
describe("methodsArePredictable", () => {
  it("is true for the methods actually configured today", () => {
    expect(methodsArePredictable(PAYMENT_METHOD_TYPES, PASS_ON_FEES_VERIFIED_METHODS)).toBe(true);
  });

  it("is false as soon as an unverified method is offered", () => {
    // Adding GCash (2.23%) or cards (3.125% + ₱13.39) to the offered list
    // invalidates the stored fee, which is what assertPassOnFeesSupported()
    // throws over. The dialog has to stop itemising at the same moment.
    expect(methodsArePredictable(["qrph", "gcash"], ["qrph"])).toBe(false);
    expect(methodsArePredictable(["card"], ["qrph"])).toBe(false);
  });

  it("is true when every offered method is verified, even if more are verified than offered", () => {
    expect(methodsArePredictable(["qrph"], ["qrph", "gcash"])).toBe(true);
  });

  it("treats an empty offered list as predictable — there is nothing unpredictable in it", () => {
    expect(methodsArePredictable([], ["qrph"])).toBe(true);
  });
});
