import { submitOwnerApplicationSchema, OWNER_APPLICATION_STEP_FIELDS } from "../ownerApplication";

/**
 * The payout-destination half of the owner application. Everything here
 * exists because an approved owner with no way to receive money is the gap
 * migration 20260810000090 closes — these fields are what make the
 * requirement real at the submit boundary.
 */

const VALID = {
  businessName: "Test Owner",
  businessPhone: "+639171234567",
  businessEmail: "owner@example.com",
  venueName: "Test Venue",
  venueAddress: "123 Test St",
  venueCity: "Cebu City",
  courtCount: 2,
  hasLiabilityInsurance: true,
  agreedToOwnerAgreement: true,
  bankName: "BANK OF THE PHILIPPINE ISLANDS",
  bankAccountName: "Test Owner",
  bankAccountNumber: "1234567890",
};

/** Asserts the schema rejected specifically `field`, not merely that it rejected. */
function rejectsField(values: Record<string, unknown>, field: string) {
  const result = submitOwnerApplicationSchema.safeParse(values);
  expect(result.success).toBe(false);
  if (result.success) return;
  expect(result.error.issues.some((i) => i.path[0] === field)).toBe(true);
}

describe("submitOwnerApplicationSchema — payout destination", () => {
  it("accepts a complete, valid application", () => {
    expect(submitOwnerApplicationSchema.safeParse(VALID).success).toBe(true);
  });

  it.each(["bankName", "bankAccountName", "bankAccountNumber"])("requires %s", (field) => {
    const { [field]: _omitted, ...rest } = VALID as Record<string, unknown>;
    void _omitted;
    rejectsField(rest, field);
  });

  // PayMongo matches this string character for character on upload, so a
  // near-miss is a transfer row rejected where nobody is watching.
  it("rejects a bank name that is not on PayMongo's PESONet list", () => {
    rejectsField({ ...VALID, bankName: "BPI" }, "bankName");
  });

  it("accepts a bank name spelled exactly as PayMongo spells it", () => {
    expect(submitOwnerApplicationSchema.safeParse({ ...VALID, bankName: "BDO NETWORK BANK" }).success).toBe(true);
  });

  it("rejects a non-numeric account number", () => {
    rejectsField({ ...VALID, bankAccountNumber: "12-34-56" }, "bankAccountNumber");
  });

  it.each(["12345", "123456789012345678901"])("rejects an out-of-range account number (%s)", (value) => {
    rejectsField({ ...VALID, bankAccountNumber: value }, "bankAccountNumber");
  });

  it("accepts the shortest and longest allowed account numbers", () => {
    expect(submitOwnerApplicationSchema.safeParse({ ...VALID, bankAccountNumber: "123456" }).success).toBe(true);
    expect(submitOwnerApplicationSchema.safeParse({ ...VALID, bankAccountNumber: "12345678901234567890" }).success).toBe(true);
  });
});

describe("OWNER_APPLICATION_STEP_FIELDS", () => {
  // The bank fields must gate their own step. Left out, an applicant would
  // only discover the requirement at final submit, after filling in
  // everything else.
  it("gates the payout step on all three bank fields", () => {
    const flattened = OWNER_APPLICATION_STEP_FIELDS.flat();
    expect(flattened).toContain("bankName");
    expect(flattened).toContain("bankAccountName");
    expect(flattened).toContain("bankAccountNumber");
  });

  it("names only fields the schema actually accepts", () => {
    // Includes the optional venueDescription, which VALID omits — checking
    // against VALID's keys would fail on a field that is legitimately
    // optional rather than on a real mismatch.
    const everyField = { ...VALID, venueDescription: "A venue." };
    expect(submitOwnerApplicationSchema.safeParse(everyField).success).toBe(true);
    for (const field of OWNER_APPLICATION_STEP_FIELDS.flat()) {
      expect(Object.keys(everyField)).toContain(field);
    }
  });
});
