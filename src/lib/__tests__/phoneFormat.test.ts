import { formatPhilippinePhoneForDisplay } from "../phoneFormat";

describe("formatPhilippinePhoneForDisplay", () => {
  it("prepends the missing trunk 0 to a bare 10-digit PH mobile number", () => {
    // The exact live-site bug: this number, stored without its leading 0.
    expect(formatPhilippinePhoneForDisplay("9399029892")).toBe("09399029892");
  });

  it("leaves a correctly-formatted number with its leading 0 untouched", () => {
    expect(formatPhilippinePhoneForDisplay("09399029892")).toBe("09399029892");
  });

  it("leaves an international-format number untouched", () => {
    expect(formatPhilippinePhoneForDisplay("+639399029892")).toBe("+639399029892");
  });

  it("leaves a number that doesn't match the PH mobile shape untouched", () => {
    expect(formatPhilippinePhoneForDisplay("021234567")).toBe("021234567");
  });

  it("trims surrounding whitespace", () => {
    expect(formatPhilippinePhoneForDisplay("  9399029892  ")).toBe("09399029892");
  });

  it("tolerates dashes/spaces/parens when detecting the bare-mobile shape", () => {
    expect(formatPhilippinePhoneForDisplay("939-902-9892")).toBe("09399029892");
  });
});
