export type CheckoutRequest = {
  courtId: string;
  date: string;
  slotIds: string[];
  amount: number;
  currency: "PHP";
};

export type CheckoutResult = {
  status: "unavailable";
  message: string;
};

export interface PaymentProvider {
  readonly name: string;
  createCheckout(request: CheckoutRequest): Promise<CheckoutResult>;
}

/**
 * Phase 1 ships no real payment integration. The booking UI already calls
 * this interface so Stripe (or another provider) can be dropped in later
 * without reshaping the components that use it.
 */
export const activePaymentProvider: PaymentProvider = {
  name: "none",
  async createCheckout() {
    return {
      status: "unavailable",
      message: "Payments aren't connected yet — this is a Phase 1 preview.",
    };
  },
};
