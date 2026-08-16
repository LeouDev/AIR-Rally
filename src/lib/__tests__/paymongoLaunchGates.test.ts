import { isPaymongoMarketplaceSplitEnabled, isPaymongoRefundExecutionEnabled } from "../paymongoLaunchGates";

const originalSplit = process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED;
const originalRefund = process.env.PAYMONGO_REFUND_EXECUTION_ENABLED;

afterEach(() => {
  if (originalSplit === undefined) delete process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED;
  else process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED = originalSplit;
  if (originalRefund === undefined) delete process.env.PAYMONGO_REFUND_EXECUTION_ENABLED;
  else process.env.PAYMONGO_REFUND_EXECUTION_ENABLED = originalRefund;
});

describe("isPaymongoMarketplaceSplitEnabled", () => {
  it("defaults to false (safe) when unset", () => {
    delete process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED;
    expect(isPaymongoMarketplaceSplitEnabled()).toBe(false);
  });

  it("is false for any value other than the exact string 'true' — no accidental truthy env value can enable it", () => {
    process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED = "1";
    expect(isPaymongoMarketplaceSplitEnabled()).toBe(false);
    process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED = "TRUE";
    expect(isPaymongoMarketplaceSplitEnabled()).toBe(false);
  });

  it("is true only when explicitly set to 'true'", () => {
    process.env.PAYMONGO_MARKETPLACE_SPLIT_ENABLED = "true";
    expect(isPaymongoMarketplaceSplitEnabled()).toBe(true);
  });
});

describe("isPaymongoRefundExecutionEnabled", () => {
  it("defaults to false (safe) when unset", () => {
    delete process.env.PAYMONGO_REFUND_EXECUTION_ENABLED;
    expect(isPaymongoRefundExecutionEnabled()).toBe(false);
  });

  it("is true only when explicitly set to 'true'", () => {
    process.env.PAYMONGO_REFUND_EXECUTION_ENABLED = "true";
    expect(isPaymongoRefundExecutionEnabled()).toBe(true);
  });
});
