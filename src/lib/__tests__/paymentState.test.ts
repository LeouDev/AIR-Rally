import { derivePaymentState, isCreditOnly } from "@/lib/paymentState";

describe("derivePaymentState", () => {
  it("reads a confirmed booking as confirmed regardless of paid_at", () => {
    expect(derivePaymentState({ status: "confirmed", paid_at: "2026-08-19T10:00:00Z" })).toBe("confirmed");
    // Credit-only bookings confirm without a PayMongo payment timestamp.
    expect(derivePaymentState({ status: "confirmed", paid_at: null })).toBe("confirmed");
  });

  it("reads a cancelled booking as cancelled", () => {
    expect(derivePaymentState({ status: "cancelled", paid_at: null })).toBe("cancelled");
  });

  it("separates a settling payment from an abandoned checkout", () => {
    // Money left the customer; the webhook has not landed. Waiting is correct.
    expect(derivePaymentState({ status: "pending", paid_at: "2026-08-19T10:00:00Z" })).toBe("settling");

    // Nothing was ever charged. This is the case every pending booking in
    // production is actually in, and the one that must not be told its
    // payment is being confirmed.
    expect(derivePaymentState({ status: "pending", paid_at: null })).toBe("awaiting_payment");
  });

  it("treats an in-flight PayMongo attempt as settling even though paid_at is still null", () => {
    // paid_at only ever gets set in the same update that confirms a
    // booking, so it alone could never distinguish "just paid, webhook
    // hasn't landed" from "abandoned" — this is the actual fix for that.
    expect(derivePaymentState({ status: "pending", paid_at: null }, { paymentInFlight: true })).toBe("settling");
  });

  it("still reads as awaiting_payment when paymentInFlight is explicitly false", () => {
    expect(derivePaymentState({ status: "pending", paid_at: null }, { paymentInFlight: false })).toBe("awaiting_payment");
  });
});

describe("isCreditOnly", () => {
  it("identifies bookings settled entirely from credits", () => {
    expect(isCreditOnly({ payment_provider: "air_rally_credit" })).toBe(true);
  });

  it("does not mistake a card or e-wallet booking for a credit one", () => {
    expect(isCreditOnly({ payment_provider: "paymongo" })).toBe(false);
    expect(isCreditOnly({ payment_provider: "stripe" })).toBe(false);
  });
});
