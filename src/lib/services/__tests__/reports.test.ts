import { createReport, createSupportRequest, describeReportTarget, ReportError } from "../reports";
import { createReportSchema, createSupportRequestSchema, resolveReportSchema } from "../../validations/report";

/**
 * The behaviour that lives in TypeScript rather than in the database.
 * RLS, the partial unique index and the rate-limit trigger are all
 * verified for real against staging by
 * scripts/verify-staging-trust-safety.ts (18/18); these cover the pieces
 * that script cannot reach — how a Postgres rejection is turned into
 * something a user can read, and what the moderation queue shows when a
 * reported thing has been deleted.
 */

type QueryResult = { data: unknown; error: unknown };

/** Minimal supabase double: insert(...).select(...).single() resolves to `result`. */
function insertClient(result: QueryResult) {
  return {
    from: () => ({
      insert: () => ({
        select: () => ({ single: () => Promise.resolve(result) }),
      }),
    }),
  } as never;
}

/** Minimal supabase double for the single-row lookups describeReportTarget does. */
function lookupClient(row: unknown) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: () => Promise.resolve({ data: row, error: null }) }),
      }),
    }),
  } as never;
}

const VALUES = {
  targetType: "post" as const,
  targetId: "11111111-1111-4111-8111-111111111111",
  reason: "harassment" as const,
};

describe("createReport", () => {
  it("turns the partial-unique-index rejection into a message about the existing report", async () => {
    const client = insertClient({ data: null, error: { code: "23505", message: "duplicate key value" } });

    // The index only covers OPEN reports, so this really does mean "yours
    // is still being looked at", not "you may never report this again".
    await expect(createReport(client, "user-1", VALUES)).rejects.toThrow(ReportError);
    await expect(createReport(client, "user-1", VALUES)).rejects.toThrow(/already reported this/i);
  });

  it("turns a rate-limit rejection into a message about waiting, not a form error", async () => {
    const client = insertClient({
      data: null,
      error: { code: "23514", message: "rate limit reached: at most 20 per 1 day for report" },
    });

    await expect(createReport(client, "user-1", VALUES)).rejects.toThrow(/lot of reports today/i);
  });

  it("rethrows anything it cannot explain, rather than swallowing it as a ReportError", async () => {
    const client = insertClient({ data: null, error: { code: "42501", message: "permission denied" } });

    await expect(createReport(client, "user-1", VALUES)).rejects.not.toThrow(ReportError);
  });
});

describe("createSupportRequest", () => {
  it("maps a rate-limit rejection to its own message", async () => {
    const client = insertClient({
      data: null,
      error: { code: "23514", message: "rate limit reached: at most 5 per 1 day for support" },
    });

    await expect(
      createSupportRequest(client, "user-1", { category: "booking", subject: "s", message: "m".repeat(20) })
    ).rejects.toThrow(/several messages today/i);
  });
});

describe("describeReportTarget", () => {
  it("returns null when the reported thing has been deleted", async () => {
    // Not an error state: reports deliberately outlive their targets, so
    // the queue has to render this as "no longer available".
    const target = await describeReportTarget(lookupClient(null), "post", VALUES.targetId);
    expect(target).toBeNull();
  });

  it("links a reported post to its author's profile, since posts have no page of their own", async () => {
    const target = await describeReportTarget(
      lookupClient({ id: "p1", content: "hello", user_id: "author-1" }),
      "post",
      "p1"
    );
    expect(target).toEqual({ label: "hello", href: "/court-side/author-1" });
  });

  it("truncates a long post so one report cannot flood the queue view", async () => {
    const target = await describeReportTarget(
      lookupClient({ id: "p1", content: "x".repeat(500), user_id: "author-1" }),
      "post",
      "p1"
    );
    expect(target?.label).toHaveLength(140);
  });

  it("gives a comment no link, because there is no route that opens one", async () => {
    const target = await describeReportTarget(lookupClient({ id: "c1", content: "hi", post_id: "p1" }), "comment", "c1");
    expect(target).toEqual({ label: "hi", href: null });
  });
});

describe("validation schemas", () => {
  it("rejects a target id that isn't a uuid", () => {
    expect(createReportSchema.safeParse({ ...VALUES, targetId: "not-a-uuid" }).success).toBe(false);
  });

  it("accepts a report with no details — reporting must not require an explanation", () => {
    expect(createReportSchema.safeParse(VALUES).success).toBe(true);
  });

  it("does not let a report be resolved back to 'open' through this schema", () => {
    expect(resolveReportSchema.safeParse({ reportId: VALUES.targetId, status: "open" }).success).toBe(false);
  });

  it("requires enough of a support message to be actionable", () => {
    const tooShort = createSupportRequestSchema.safeParse({ category: "bug", subject: "Hi", message: "broken" });
    expect(tooShort.success).toBe(false);
  });
});
