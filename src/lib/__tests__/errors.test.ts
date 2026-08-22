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

  it("maps invalid credentials by code, not message text", () => {
    expect(getFriendlyErrorMessage({ code: "invalid_credentials", message: "Invalid login credentials" })).toBe(
      "That email or password is incorrect."
    );
  });

  it("maps a duplicate signup by code", () => {
    expect(getFriendlyErrorMessage({ code: "user_already_exists" })).toBe(
      "An account with that email already exists."
    );
  });

  it("maps an unconfirmed email by code", () => {
    expect(getFriendlyErrorMessage({ code: "email_not_confirmed" })).toBe(
      "Please confirm your email before signing in — check your inbox for the confirmation link."
    );
  });

  it("maps a rate limit by code", () => {
    expect(getFriendlyErrorMessage({ code: "over_request_rate_limit" })).toBe(
      "Too many attempts. Please wait a moment and try again."
    );
  });

  it("maps an expired session by code", () => {
    expect(getFriendlyErrorMessage({ code: "refresh_token_not_found" })).toBe(
      "Your session has expired. Please sign in again."
    );
  });

  it("prefers the auth error code over message text when they'd disagree", () => {
    // A message that reads like something else entirely — the code must win,
    // since the code is the SDK's stable contract and the message is prose
    // Supabase can reword without notice.
    expect(
      getFriendlyErrorMessage({ code: "invalid_credentials", message: 'relation "auth.users" does not exist' })
    ).toBe("That email or password is incorrect.");
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
