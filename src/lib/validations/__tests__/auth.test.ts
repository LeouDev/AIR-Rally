import { loginSchema, signUpSchema, forgotPasswordSchema, resetPasswordSchema } from "@/lib/validations/auth";

describe("loginSchema", () => {
  it("accepts a valid email and non-empty password", () => {
    const result = loginSchema.safeParse({ email: "player@example.com", password: "hunter2" });
    expect(result.success).toBe(true);
  });

  it("rejects an invalid email", () => {
    const result = loginSchema.safeParse({ email: "not-an-email", password: "hunter2" });
    expect(result.success).toBe(false);
  });

  it("rejects an empty password", () => {
    const result = loginSchema.safeParse({ email: "player@example.com", password: "" });
    expect(result.success).toBe(false);
  });
});

describe("signUpSchema", () => {
  const base = {
    firstName: "Jamie",
    lastName: "Cruz",
    email: "jamie@example.com",
    password: "supersecret1",
    confirmPassword: "supersecret1",
    agreedToTerms: true,
  };

  it("accepts matching passwords of sufficient length, with the agreement accepted", () => {
    expect(signUpSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a password shorter than 8 characters", () => {
    const result = signUpSchema.safeParse({ ...base, password: "short1", confirmPassword: "short1" });
    expect(result.success).toBe(false);
  });

  it("rejects mismatched password confirmation", () => {
    const result = signUpSchema.safeParse({ ...base, confirmPassword: "somethingElse1" });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("confirmPassword"))).toBe(true);
    }
  });

  it("rejects a blank first or last name", () => {
    expect(signUpSchema.safeParse({ ...base, firstName: "  " }).success).toBe(false);
  });

  it("rejects signup when the User Agreement hasn't been accepted", () => {
    const result = signUpSchema.safeParse({ ...base, agreedToTerms: false });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.includes("agreedToTerms"))).toBe(true);
    }
  });
});

describe("forgotPasswordSchema", () => {
  it("requires a valid email", () => {
    expect(forgotPasswordSchema.safeParse({ email: "jamie@example.com" }).success).toBe(true);
    expect(forgotPasswordSchema.safeParse({ email: "nope" }).success).toBe(false);
  });
});

describe("resetPasswordSchema", () => {
  it("requires matching passwords", () => {
    const result = resetPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "different1" });
    expect(result.success).toBe(false);
  });

  it("accepts matching, sufficiently long passwords", () => {
    const result = resetPasswordSchema.safeParse({ password: "newpassword1", confirmPassword: "newpassword1" });
    expect(result.success).toBe(true);
  });
});
