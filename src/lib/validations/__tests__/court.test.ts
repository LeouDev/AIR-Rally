import { createCourtSchema, updateCourtSchema } from "@/lib/validations/court";

const base = {
  name: "Court 1",
  indoorOutdoor: "outdoor" as const,
  hourlyPrice: 500,
};

describe("createCourtSchema", () => {
  it("accepts a minimal valid court (only the required fields)", () => {
    expect(createCourtSchema.safeParse(base).success).toBe(true);
  });

  it("rejects an empty name", () => {
    expect(createCourtSchema.safeParse({ ...base, name: "" }).success).toBe(false);
  });

  it("rejects a negative hourly price", () => {
    expect(createCourtSchema.safeParse({ ...base, hourlyPrice: -1 }).success).toBe(false);
  });

  it("rejects an invalid indoorOutdoor value (courts, unlike venues, have no 'both')", () => {
    expect(createCourtSchema.safeParse({ ...base, indoorOutdoor: "both" }).success).toBe(false);
  });

  it("treats capacity as optional", () => {
    const result = createCourtSchema.safeParse(base);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.capacity).toBeUndefined();
  });

  it("accepts capacity within 1-20 and rejects outside it", () => {
    expect(createCourtSchema.safeParse({ ...base, capacity: 4 }).success).toBe(true);
    expect(createCourtSchema.safeParse({ ...base, capacity: 0 }).success).toBe(false);
    expect(createCourtSchema.safeParse({ ...base, capacity: 21 }).success).toBe(false);
  });

  // The form registers capacity with `setValueAs: (v) => (v === "" ? undefined : Number(v))`
  // specifically so the schema never receives NaN for an empty optional
  // field — this documents that the schema itself is not responsible for
  // normalizing NaN (unlike an earlier draft that used z.preprocess for
  // this, which broke zodResolver's type inference).
  it("rejects NaN outright rather than silently treating it as empty", () => {
    expect(createCourtSchema.safeParse({ ...base, capacity: NaN }).success).toBe(false);
  });
});

describe("updateCourtSchema", () => {
  it("requires a status in addition to the create fields", () => {
    expect(updateCourtSchema.safeParse(base).success).toBe(false);
    expect(updateCourtSchema.safeParse({ ...base, status: "active" }).success).toBe(true);
  });

  it("rejects a status outside the known set", () => {
    expect(updateCourtSchema.safeParse({ ...base, status: "deleted" }).success).toBe(false);
  });

  it("accepts all three real statuses", () => {
    for (const status of ["active", "inactive", "maintenance"]) {
      expect(updateCourtSchema.safeParse({ ...base, status }).success).toBe(true);
    }
  });
});
