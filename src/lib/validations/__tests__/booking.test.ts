import { createBookingSchema, cancelBookingSchema } from "@/lib/validations/booking";

const base = {
  courtId: "3fabfd53-6792-4b28-b9b4-8d31e0df5298",
  startTime: "2026-08-12T00:00:00Z",
  endTime: "2026-08-12T01:00:00Z",
};

describe("createBookingSchema", () => {
  it("accepts a well-formed request", () => {
    expect(createBookingSchema.safeParse(base).success).toBe(true);
  });

  it("rejects a non-UUID courtId", () => {
    expect(createBookingSchema.safeParse({ ...base, courtId: "not-a-uuid" }).success).toBe(false);
  });

  it("rejects a non-ISO-8601 time string", () => {
    expect(createBookingSchema.safeParse({ ...base, startTime: "tomorrow at 8am" }).success).toBe(false);
  });

  it("rejects an ISO datetime without a timezone offset", () => {
    expect(createBookingSchema.safeParse({ ...base, startTime: "2026-08-12T00:00:00" }).success).toBe(false);
  });

  it("rejects startTime at or after endTime — shape-level sanity check, business rules still live server-side", () => {
    expect(createBookingSchema.safeParse({ ...base, startTime: base.endTime, endTime: base.startTime }).success).toBe(false);
    expect(createBookingSchema.safeParse({ ...base, startTime: base.startTime, endTime: base.startTime }).success).toBe(false);
  });
});

describe("cancelBookingSchema", () => {
  it("accepts a UUID booking id", () => {
    expect(cancelBookingSchema.safeParse({ bookingId: base.courtId }).success).toBe(true);
  });

  it("rejects a non-UUID booking id", () => {
    expect(cancelBookingSchema.safeParse({ bookingId: "123" }).success).toBe(false);
  });
});
