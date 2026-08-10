import { createVenueDraftSchema } from "@/lib/validations/venue";

const base = {
  name: "Banilad Pickle Club",
  description: "Six championship-grade indoor courts with cushioned acrylic surfacing.",
  address: "88 Banilad Rd",
  city: "Cebu City",
  country: "Philippines",
  phone: "+63 917 123 4567",
  email: "hello@example.com",
  website: "",
  indoorOutdoor: "indoor" as const,
  numberOfCourts: 6,
};

describe("createVenueDraftSchema", () => {
  it("accepts a complete, valid draft", () => {
    expect(createVenueDraftSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a description that's too short to be useful", () => {
    expect(createVenueDraftSchema.safeParse({ ...base, description: "Nice." }).success).toBe(false);
  });

  it("rejects zero or negative court counts", () => {
    expect(createVenueDraftSchema.safeParse({ ...base, numberOfCourts: 0 }).success).toBe(false);
    expect(createVenueDraftSchema.safeParse({ ...base, numberOfCourts: -3 }).success).toBe(false);
  });

  it("rejects an invalid indoorOutdoor value", () => {
    const result = createVenueDraftSchema.safeParse({ ...base, indoorOutdoor: "sometimes" });
    expect(result.success).toBe(false);
  });

  it("rejects an invalid contact email", () => {
    expect(createVenueDraftSchema.safeParse({ ...base, email: "not-an-email" }).success).toBe(false);
  });

  it("allows stateProvince to be omitted", () => {
    // `base` above never sets stateProvince — this documents that as
    // intentional (optional) rather than an oversight.
    expect(createVenueDraftSchema.safeParse(base).success).toBe(true);
  });

  it("accepts an empty website (the form's default) without requiring a URL", () => {
    expect(createVenueDraftSchema.safeParse({ ...base, website: "" }).success).toBe(true);
  });

  it("accepts a valid website URL and rejects a malformed one", () => {
    expect(createVenueDraftSchema.safeParse({ ...base, website: "https://example.com" }).success).toBe(true);
    expect(createVenueDraftSchema.safeParse({ ...base, website: "not a url" }).success).toBe(false);
  });
});
