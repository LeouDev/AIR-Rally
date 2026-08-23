import { createReport, createSupportRequest, setSupportRequestStatus, describeReportTarget, ReportError } from "../reports";
import { createReportSchema, createSupportRequestSchema, resolveReportSchema, setSupportStatusSchema } from "../../validations/report";

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

describe("setSupportStatusSchema", () => {
  const requestId = VALUES.targetId;

  it("rejects moving to 'resolved' with no note — the exact gap this migration closes", () => {
    const result = setSupportStatusSchema.safeParse({ requestId, status: "resolved" });
    expect(result.success).toBe(false);
  });

  it("rejects moving to 'closed' with an empty note", () => {
    const result = setSupportStatusSchema.safeParse({ requestId, status: "closed", resolutionNote: "   " });
    expect(result.success).toBe(false);
  });

  it("accepts moving to 'resolved' with a real note", () => {
    const result = setSupportStatusSchema.safeParse({ requestId, status: "resolved", resolutionNote: "Refunded your credit." });
    expect(result.success).toBe(true);
  });

  it("does not require a note for 'open' or 'in_progress' — moving a request along isn't a reply", () => {
    expect(setSupportStatusSchema.safeParse({ requestId, status: "open" }).success).toBe(true);
    expect(setSupportStatusSchema.safeParse({ requestId, status: "in_progress" }).success).toBe(true);
  });

  it("rejects a note over 1000 characters, matching support_resolution_complete's own bound", () => {
    const result = setSupportStatusSchema.safeParse({ requestId, status: "resolved", resolutionNote: "x".repeat(1001) });
    expect(result.success).toBe(false);
  });
});

describe("setSupportRequestStatus", () => {
  /** Minimal supabase double: update(...).eq(...).select(...).single() resolves to `result`, capturing the update payload. */
  function updateClient(result: QueryResult) {
    let captured: unknown;
    return {
      client: {
        from: () => ({
          update: (payload: unknown) => {
            captured = payload;
            return { eq: () => ({ select: () => ({ single: () => Promise.resolve(result) }) }) };
          },
        }),
      } as never,
      captured: () => captured,
    };
  }

  it("writes the resolution note when resolving, alongside resolved_by/resolved_at", async () => {
    const { client, captured } = updateClient({ data: { id: "r1", status: "resolved" }, error: null });
    await setSupportRequestStatus(client, "r1", "admin-1", "resolved", "Refunded your credit.");
    expect(captured()).toMatchObject({
      status: "resolved",
      resolved_by: "admin-1",
      resolution_note: "Refunded your credit.",
    });
  });

  it("clears resolved_by/resolved_at/resolution_note on reopen — the row must not claim a resolver or a reply it no longer has", async () => {
    const { client, captured } = updateClient({ data: { id: "r1", status: "open" }, error: null });
    await setSupportRequestStatus(client, "r1", "admin-1", "open");
    expect(captured()).toMatchObject({
      status: "open",
      resolved_by: null,
      resolved_at: null,
      resolution_note: null,
    });
  });
});
