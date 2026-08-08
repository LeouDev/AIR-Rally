import { getFriendlyErrorMessage } from "@/lib/errors";

describe("getFriendlyErrorMessage", () => {
  it("maps invalid login credentials to a friendly message", () => {
    expect(getFriendlyErrorMessage({ message: "Invalid login credentials" })).toBe(
      "That email or password is incorrect."
    );
  });

  it("maps a duplicate signup to a friendly message", () => {
    expect(getFriendlyErrorMessage({ message: "User already registered" })).toBe(
      "An account with that email already exists."
    );
  });

  it("maps a Postgres unique_violation code regardless of message text", () => {
    expect(getFriendlyErrorMessage({ code: "23505", message: 'duplicate key value violates unique constraint "favorites_pkey"' })).toBe(
      "That already exists."
    );
  });

  it("maps a Postgres check/foreign-key/not-null violation to a generic save-failure message", () => {
    expect(getFriendlyErrorMessage({ code: "23514", message: "new row violates check constraint" })).toBe(
      "We couldn't save that — please check the form and try again."
    );
  });

  it("never leaks the raw database error message for unknown errors", () => {
    const raw = "relation \"public.sekrit_table\" does not exist";
    expect(getFriendlyErrorMessage({ message: raw })).not.toContain("sekrit_table");
  });

  it("falls back to the default message for completely unknown errors", () => {
    expect(getFriendlyErrorMessage(new Error("boom"))).toBe("Something went wrong. Please try again.");
  });

  it("accepts a custom fallback message", () => {
    expect(getFriendlyErrorMessage(new Error("boom"), "We couldn't update your profile.")).toBe(
      "We couldn't update your profile."
    );
  });

  it("handles non-object errors without throwing", () => {
    expect(getFriendlyErrorMessage("just a string")).toBe("Something went wrong. Please try again.");
    expect(getFriendlyErrorMessage(null)).toBe("Something went wrong. Please try again.");
    expect(getFriendlyErrorMessage(undefined)).toBe("Something went wrong. Please try again.");
  });
});
