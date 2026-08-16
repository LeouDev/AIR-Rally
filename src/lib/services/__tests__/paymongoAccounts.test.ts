/**
 * @jest-environment node
 */
const originalSecretKey = process.env.PAYMONGO_SECRET_KEY;
const originalFetch = global.fetch;

const mockFetch = jest.fn();

beforeEach(() => {
  process.env.PAYMONGO_SECRET_KEY = "sk_test_x";
  mockFetch.mockReset();
  global.fetch = mockFetch as unknown as typeof fetch;
});

afterAll(() => {
  if (originalSecretKey !== undefined) process.env.PAYMONGO_SECRET_KEY = originalSecretKey;
  global.fetch = originalFetch;
});

function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe("createPayMongoMerchantAccount", () => {
  it("POSTs a flat {type:'merchant'} body to /v2/accounts — confirmed live shape, not nested under data.attributes", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: "org_test_merchant", type: "merchant", activation_status: "pending" } }));

    const { createPayMongoMerchantAccount } = await import("../paymongoAccounts");
    const result = await createPayMongoMerchantAccount();

    expect(result).toEqual({ id: "org_test_merchant", type: "merchant", activation_status: "pending" });
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.paymongo.com/v2/accounts");
    expect(JSON.parse(options.body)).toEqual({ type: "merchant" });
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from("sk_test_x:").toString("base64")}`);
  });

  it("wraps an API failure in a typed PayMongoError", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ errors: [{ code: "internal", detail: "boom" }] }, false, 500));

    const { createPayMongoMerchantAccount } = await import("../paymongoAccounts");
    await expect(createPayMongoMerchantAccount()).rejects.toMatchObject({ reason: "account_onboarding_failed" });
  });
});

describe("createIdentityVerificationSession", () => {
  it("POSTs to /v2/accounts/{id}/identity_verification with an empty body and returns the real 'url' field", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        data: { id: "verif_test_mock", account_id: "org_test_merchant", url: "https://example.com/test-verification", status: "pending" },
      })
    );

    const { createIdentityVerificationSession } = await import("../paymongoAccounts");
    const result = await createIdentityVerificationSession("org_test_merchant");

    expect(result.url).toBe("https://example.com/test-verification");
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.paymongo.com/v2/accounts/org_test_merchant/identity_verification");
    expect(options.method).toBe("POST");
  });
});

describe("activatePayMongoAccount", () => {
  it("POSTs to /v2/accounts/{id}/activate and resolves without returning/trusting the response's activation_status", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ data: { id: "org_test_merchant", activation_status: "activated" } }));

    const { activatePayMongoAccount } = await import("../paymongoAccounts");
    await expect(activatePayMongoAccount("org_test_merchant")).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.paymongo.com/v2/accounts/org_test_merchant/activate");
  });

  it("wraps an API failure in a typed PayMongoError", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ errors: [{ code: "not_found", detail: "no such account" }] }, false, 404));

    const { activatePayMongoAccount } = await import("../paymongoAccounts");
    await expect(activatePayMongoAccount("org_bogus")).rejects.toMatchObject({ reason: "account_onboarding_failed" });
  });
});
