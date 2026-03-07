import { describe, it, expect, vi, afterEach } from "vitest";
import { newrelic, newrelicConfigSchema } from "../src/observability/newrelic.js";
import type { ObservabilityProvider } from "../src/observability/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("newrelicConfigSchema", () => {
  it("validates a complete config", () => {
    const result = newrelicConfigSchema.safeParse({
      apiKey: "NRAK-abc",
      accountId: "123456",
      region: "eu",
    });
    expect(result.success).toBe(true);
  });

  it("applies default region 'us'", () => {
    const result = newrelicConfigSchema.parse({ apiKey: "NRAK-abc", accountId: "123456" });
    expect(result.region).toBe("us");
  });

  it("rejects missing apiKey", () => {
    const result = newrelicConfigSchema.safeParse({ accountId: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = newrelicConfigSchema.safeParse({ apiKey: "", accountId: "123456" });
    expect(result.success).toBe(false);
  });

  it("rejects missing accountId", () => {
    const result = newrelicConfigSchema.safeParse({ apiKey: "NRAK-abc" });
    expect(result.success).toBe(false);
  });

  it("rejects empty accountId", () => {
    const result = newrelicConfigSchema.safeParse({ apiKey: "NRAK-abc", accountId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid region", () => {
    const result = newrelicConfigSchema.safeParse({
      apiKey: "NRAK-abc",
      accountId: "123456",
      region: "ap",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("newrelic factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider: ObservabilityProvider = newrelic({
      apiKey: "NRAK-abc",
      accountId: "123456",
      logger: silentLogger,
    });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns NR_ env vars for us region", () => {
    const provider = newrelic({
      apiKey: "NRAK-abc",
      accountId: "123456",
      region: "us",
      logger: silentLogger,
    });
    expect(provider.getAgentEnv()).toEqual({
      NR_API_KEY: "NRAK-abc",
      NR_ACCOUNT_ID: "123456",
      NR_REGION: "us",
    });
  });

  it("getAgentEnv returns NR_ env vars for eu region", () => {
    const provider = newrelic({
      apiKey: "NRAK-eu",
      accountId: "999",
      region: "eu",
      logger: silentLogger,
    });
    expect(provider.getAgentEnv()).toEqual({
      NR_API_KEY: "NRAK-eu",
      NR_ACCOUNT_ID: "999",
      NR_REGION: "eu",
    });
  });

  it("getPromptInstructions contains New Relic API references", () => {
    const provider = newrelic({ apiKey: "NRAK-abc", accountId: "123456", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("New Relic");
    expect(instructions).toContain("NR_API_KEY");
    expect(instructions).toContain("API-Key");
    expect(instructions).toContain("curl");
  });

  it("getPromptInstructions uses US endpoint for us region", () => {
    const provider = newrelic({ apiKey: "NRAK-abc", accountId: "123456", region: "us", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("api.newrelic.com/graphql");
    expect(instructions).not.toContain("api.eu.newrelic.com");
  });

  it("getPromptInstructions uses EU endpoint for eu region", () => {
    const provider = newrelic({ apiKey: "NRAK-abc", accountId: "123456", region: "eu", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("api.eu.newrelic.com/graphql");
  });

  it("throws on invalid config", () => {
    expect(() => newrelic({ apiKey: "", accountId: "123456" } as any)).toThrow();
    expect(() => newrelic({ apiKey: "NRAK-abc", accountId: "" } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// NewRelicProvider API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("NewRelicProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeNewRelic(extra?: { region?: "us" | "eu" }) {
    return newrelic({
      apiKey: "test-api-key",
      accountId: "123456",
      logger: silentLogger,
      ...extra,
    });
  }

  // -------------------------------------------------------------------------
  // verifyAccess
  // -------------------------------------------------------------------------

  it("verifyAccess POSTs to US GraphQL endpoint with correct API-Key header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { name: "My Account" } } } }), { status: 200 }),
      ),
    );

    await makeNewRelic().verifyAccess();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.newrelic.com/graphql");
    expect((opts as RequestInit).method).toBe("POST");
    expect((opts as RequestInit).headers as Record<string, string>).toMatchObject({
      "API-Key": "test-api-key",
      "Content-Type": "application/json",
    });
  });

  it("verifyAccess POSTs to EU GraphQL endpoint for eu region", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { name: "EU Account" } } } }), { status: 200 }),
      ),
    );

    await makeNewRelic({ region: "eu" }).verifyAccess();

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.eu.newrelic.com/graphql");
  });

  it("verifyAccess GraphQL body queries for account name", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { name: "My Account" } } } }), { status: 200 }),
      ),
    );

    await makeNewRelic().verifyAccess();

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.query).toContain("account");
    expect(body.query).toContain("name");
    expect(body.query).toContain("123456");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })),
    );

    await expect(makeNewRelic().verifyAccess()).rejects.toThrow("NewRelic API error: 401 Unauthorized");
  });

  it("verifyAccess throws when account name is missing from response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ data: { actor: { account: {} } } }), { status: 200 })),
    );

    await expect(makeNewRelic().verifyAccess()).rejects.toThrow("New Relic access verification failed");
  });

  // -------------------------------------------------------------------------
  // queryLogs
  // -------------------------------------------------------------------------

  it("queryLogs POSTs NerdGraph NRQL to graphql endpoint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: { actor: { account: { nrql: { results: [] } } } },
          }),
          { status: 200 },
        ),
      ),
    );

    await makeNewRelic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.newrelic.com/graphql");
    expect((opts as RequestInit).method).toBe("POST");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.query).toContain("nrql");
    expect(body.query).toContain("FROM Log");
    expect(body.query).toContain("error");
    expect(body.query).toContain("1h");
  });

  it("queryLogs returns mapped LogEntry[] with numeric timestamp converted to ISO string", async () => {
    const tsMs = 1735689600000; // 2026-01-01T00:00:00.000Z
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              actor: {
                account: {
                  nrql: {
                    results: [
                      {
                        timestamp: tsMs,
                        service: "api-service",
                        level: "error",
                        message: "connection refused",
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const logs = await makeNewRelic().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-service",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe(new Date(tsMs).toISOString());
    expect(logs[0].service).toBe("api-service");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("connection refused");
  });

  it("queryLogs handles string timestamp without conversion", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              actor: {
                account: {
                  nrql: {
                    results: [
                      {
                        timestamp: "2026-01-01T00:00:00.000Z",
                        service: "worker",
                        level: "warn",
                        message: "disk full",
                      },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const logs = await makeNewRelic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warn" });

    expect(logs[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
  });

  it("queryLogs handles empty results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { nrql: { results: [] } } } } }), { status: 200 }),
      ),
    );

    const logs = await makeNewRelic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });
    expect(logs).toEqual([]);
  });

  it("queryLogs throws ProviderApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Forbidden", { status: 403, statusText: "Forbidden" })),
    );

    await expect(makeNewRelic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" })).rejects.toThrow(
      "NewRelic API error: 403 Forbidden",
    );
  });

  it("queryLogs includes serviceFilter in NRQL query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { nrql: { results: [] } } } } }), { status: 200 }),
      ),
    );

    await makeNewRelic().queryLogs({ timeRange: "24h", serviceFilter: "my-service", severity: "error" });

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.query).toContain("my-service");
  });

  // -------------------------------------------------------------------------
  // aggregate
  // -------------------------------------------------------------------------

  it("aggregate POSTs NerdGraph NRQL with FACET service", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { nrql: { results: [] } } } } }), { status: 200 }),
      ),
    );

    await makeNewRelic().aggregate({ timeRange: "24h", serviceFilter: "*" });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://api.newrelic.com/graphql");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.query).toContain("FACET service");
    expect(body.query).toContain("count");
    expect(body.query).toContain("FROM Log");
  });

  it("aggregate returns mapped AggregateResult[] from results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            data: {
              actor: {
                account: {
                  nrql: {
                    results: [
                      { service: "api-service", count: 42 },
                      { service: "worker", count: 7 },
                    ],
                  },
                },
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const results = await makeNewRelic().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-service", count: 42 });
    expect(results[1]).toEqual({ service: "worker", count: 7 });
  });

  it("aggregate handles empty results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: { actor: { account: { nrql: { results: [] } } } } }), { status: 200 }),
      ),
    );

    const results = await makeNewRelic().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  it("aggregate throws ProviderApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })),
    );

    await expect(makeNewRelic().aggregate({ timeRange: "1h", serviceFilter: "*" })).rejects.toThrow(
      "NewRelic API error: 401 Unauthorized",
    );
  });
});
