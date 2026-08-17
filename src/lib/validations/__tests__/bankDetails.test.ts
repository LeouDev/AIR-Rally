import { bankDetailsSchema } from "../bankDetails";
import { PESONET_BANKS, isPesonetBank } from "@/lib/payouts/pesonetBanks";
import { maskAccountNumber, hasBankDetails } from "@/lib/services/venuePaymentAccounts";

/**
 * The database enforces these rules too (migration 20260810000053) and is
 * verified against staging by scripts/verify-staging-venue-bank-details.ts.
 * These cover the reasons the rules exist — a rejected PESONet row costs a
 * failed transfer days later, not an error message now.
 */

const VALID = {
  bankName: "BANCO DE ORO UNIBANK, INC.",
  bankAccountName: "Journey Courts Inc",
  bankAccountNumber: "001234567890",
};

describe("PESONET_BANKS", () => {
  it("is populated and free of duplicates", () => {
    expect(PESONET_BANKS.length).toBeGreaterThan(100);
    expect(new Set(PESONET_BANKS).size).toBe(PESONET_BANKS.length);
  });

  it("recognises a name copied verbatim from PayMongo's list", () => {
    expect(isPesonetBank(PESONET_BANKS[0])).toBe(true);
  });

  it("rejects a plausible-looking name that is not on the list", () => {
    // PayMongo matches character for character, so "close enough" fails at
    // upload — which is why the form is a select, not a text field.
    expect(isPesonetBank("BDO Unibank, Inc.")).toBe(false);
    expect(isPesonetBank("BDO")).toBe(false);
  });
});

describe("bankDetailsSchema", () => {
  it("accepts a complete, valid destination", () => {
    expect(bankDetailsSchema.safeParse(VALID).success).toBe(true);
  });

  it("rejects a bank that is not on PayMongo's PESONet list", () => {
    const result = bankDetailsSchema.safeParse({ ...VALID, bankName: "My Local Bank" });
    expect(result.success).toBe(false);
  });

  it("rejects an account number containing spaces or dashes", () => {
    // People naturally type these; the file must carry digits only.
    expect(bankDetailsSchema.safeParse({ ...VALID, bankAccountNumber: "0012-3456 7890" }).success).toBe(false);
  });

  it("rejects an account number that is too short or too long", () => {
    expect(bankDetailsSchema.safeParse({ ...VALID, bankAccountNumber: "12345" }).success).toBe(false);
    expect(bankDetailsSchema.safeParse({ ...VALID, bankAccountNumber: "1".repeat(21) }).success).toBe(false);
  });

  it("rejects an account name with no letters in it", () => {
    expect(bankDetailsSchema.safeParse({ ...VALID, bankAccountName: "12345678" }).success).toBe(false);
  });

  it("trims surrounding whitespace rather than failing on it", () => {
    const result = bankDetailsSchema.safeParse({ ...VALID, bankAccountNumber: "  001234567890  " });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.bankAccountNumber).toBe("001234567890");
  });
});

describe("maskAccountNumber", () => {
  it("shows only the last four digits", () => {
    expect(maskAccountNumber("001234567890")).toBe("••••7890");
  });

  it("returns null rather than a partial mask for missing or too-short values", () => {
    expect(maskAccountNumber(null)).toBeNull();
    expect(maskAccountNumber("123")).toBeNull();
  });
});

describe("hasBankDetails", () => {
  it("is true only when a destination is actually usable", () => {
    expect(hasBankDetails({ bank_name: "BANCO DE ORO UNIBANK, INC.", bank_account_number: "001234567890" })).toBe(true);
    expect(hasBankDetails({ bank_name: null, bank_account_number: null })).toBe(false);
    // The database forbids this combination, so it should never appear —
    // but a payout run must not treat it as payable if it somehow does.
    expect(hasBankDetails({ bank_name: "BANCO DE ORO UNIBANK, INC.", bank_account_number: null })).toBe(false);
  });
});
