import { describe, it, expect, vi, afterEach } from "vitest";
import { elastic, elasticConfigSchema } from "../src/observability/elastic.js";
import type { ObservabilityProvider } from "../src/observability/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("elasticConfigSchema", () => {
  it("validates config with apiKey", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com:9200",
      apiKey: "my-api-key",
    });
    expect(result.success).toBe(true);
  });

  it("validates config with username and password", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com:9200",
      username: "elastic",
      password: "changeme",
    });
    expect(result.success).toBe(true);
  });

  it("validates a complete config with all fields", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com:9200",
      apiKey: "my-api-key",
      index: "my-logs-*",
    });
    expect(result.success).toBe(true);
  });

  it("applies default index 'logs-*'", () => {
    const result = elasticConfigSchema.parse({
      baseUrl: "https://elastic.example.com:9200",
      apiKey: "my-api-key",
    });
    expect(result.index).toBe("logs-*");
  });

  it("rejects missing baseUrl", () => {
    const result = elasticConfigSchema.safeParse({ apiKey: "my-api-key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = elasticConfigSchema.safeParse({ baseUrl: "", apiKey: "my-api-key" });
    expect(result.success).toBe(false);
  });

  it("rejects config with neither apiKey nor username+password", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com:9200",
    });
    expect(result.success).toBe(false);
  });

  it("rejects config with username but no password", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com:9200",
      username: "elastic",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("elastic factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider: ObservabilityProvider = elastic({
      baseUrl: "https://elastic.example.com:9200",
      apiKey: "tok",
      logger: silentLogger,
    });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns ELASTIC_ env vars with apiKey", () => {
    const provider = elastic({
      baseUrl: "https://elastic.example.com:9200",
      apiKey: "my-api-key",
      index: "prod-logs-*",
      logger: silentLogger,
    });
    expect(provider.getAgentEnv()).toEqual({
      ELASTIC_URL: "https://elastic.example.com:9200",
      ELASTIC_INDEX: "prod-logs-*",
      ELASTIC_API_KEY: "my-api-key",
    });
  });

  it("getAgentEnv returns ELASTIC_ env vars with basic auth", () => {
    const provider = elastic({
      baseUrl: "https://elastic.example.com:9200",
      username: "elastic",
      password: "changeme",
      logger: silentLogger,
    });
    expect(provider.getAgentEnv()).toEqual({
      ELASTIC_URL: "https://elastic.example.com:9200",
      ELASTIC_INDEX: "logs-*",
      ELASTIC_USERNAME: "elastic",
      ELASTIC_PASSWORD: "changeme",
    });
  });

  it("getPromptInstructions contains Elasticsearch API references", () => {
    const provider = elastic({
      baseUrl: "https://elastic.example.com:9200",
      apiKey: "tok",
      logger: silentLogger,
    });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Elasticsearch");
    expect(instructions).toContain("ELASTIC_URL");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => elastic({ baseUrl: "", apiKey: "tok" } as any)).toThrow();
    expect(() => elastic({ baseUrl: "https://elastic.example.com:9200" } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// ElasticProvider API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("ElasticProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeElastic(extra?: { index?: string; username?: string; password?: string; apiKey?: string }) {
    const { username, password, apiKey = "test-api-key", ...rest } = extra ?? {};
    if (username && password) {
      return elastic({
        baseUrl: "https://elastic.example.com:9200",
        username,
        password,
        logger: silentLogger,
        ...rest,
      });
    }
    return elastic({
      baseUrl: "https://elastic.example.com:9200",
      apiKey,
      logger: silentLogger,
      ...rest,
    });
  }

  // -------------------------------------------------------------------------
  // verifyAccess
  // -------------------------------------------------------------------------

  it("verifyAccess calls GET / with correct ApiKey auth header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ cluster_name: "my-cluster", version: { number: "8.0.0" } }), { status: 200 }),
      ),
    );

    await makeElastic().verifyAccess();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://elastic.example.com:9200/");
    expect((opts as RequestInit).method).toBe("GET");
    expect((opts as RequestInit).headers as Record<string, string>).toMatchObject({
      Authorization: "ApiKey test-api-key",
    });
  });

  it("verifyAccess uses Basic auth header when username+password configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ cluster_name: "my-cluster" }), { status: 200 })),
    );

    await makeElastic({ username: "elastic", password: "changeme" }).verifyAccess();

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const authHeader = ((opts as RequestInit).headers as Record<string, string>).Authorization;
    expect(authHeader).toMatch(/^Basic /);
    // Verify it's base64 of elastic:changeme
    expect(Buffer.from(authHeader.slice(6), "base64").toString()).toBe("elastic:changeme");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })),
    );

    await expect(makeElastic().verifyAccess()).rejects.toThrow("Elasticsearch API error: 401 Unauthorized");
  });

  // -------------------------------------------------------------------------
  // queryLogs
  // -------------------------------------------------------------------------

  it("queryLogs POSTs to /{index}/_search with bool query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })),
    );

    await makeElastic({ index: "prod-logs-*" }).queryLogs({
      timeRange: "1h",
      serviceFilter: "*",
      severity: "error",
    });

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://elastic.example.com:9200/prod-logs-*/_search");
    expect((opts as RequestInit).method).toBe("POST");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.query.bool.must).toBeDefined();
  });

  it("queryLogs returns mapped LogEntry[] from hits", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            hits: {
              hits: [
                {
                  _source: {
                    "@timestamp": "2026-01-01T00:00:00.000Z",
                    service: { name: "api-service" },
                    log: { level: "error" },
                    message: "connection refused",
                    extra: "data",
                  },
                },
              ],
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const logs = await makeElastic().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-service",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(logs[0].service).toBe("api-service");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("connection refused");
  });

  it("queryLogs includes time range filter in query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })),
    );

    await makeElastic().queryLogs({ timeRange: "24h", serviceFilter: "*", severity: "error" });

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    const rangeFilter = body.query.bool.must.find((c: any) => c.range);
    expect(rangeFilter).toBeDefined();
    expect(rangeFilter.range["@timestamp"].gte).toContain("24h");
  });

  it("queryLogs includes severity filter when not '*'", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })),
    );

    await makeElastic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    const matchFilter = body.query.bool.must.find((c: any) => c.match?.["log.level"]);
    expect(matchFilter).toBeDefined();
    expect(matchFilter.match["log.level"]).toBe("error");
  });

  it("queryLogs includes service filter when not '*'", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })),
    );

    await makeElastic().queryLogs({ timeRange: "1h", serviceFilter: "my-svc", severity: "error" });

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    const boolFilter = body.query.bool.must.find((c: any) => c.bool?.should);
    expect(boolFilter).toBeDefined();
    const shouldTerms = boolFilter.bool.should.map((s: any) => s.match?.["service.name"] ?? s.match?.["host.name"]);
    expect(shouldTerms).toContain("my-svc");
  });

  it("queryLogs handles empty hits", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ hits: { hits: [] } }), { status: 200 })),
    );

    const logs = await makeElastic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warn" });
    expect(logs).toEqual([]);
  });

  it("queryLogs throws ProviderApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Forbidden", { status: 403, statusText: "Forbidden" })),
    );

    await expect(makeElastic().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" })).rejects.toThrow(
      "Elasticsearch API error: 403 Forbidden",
    );
  });

  // -------------------------------------------------------------------------
  // aggregate
  // -------------------------------------------------------------------------

  it("aggregate POSTs to /{index}/_search with services terms agg", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ aggregations: { services: { buckets: [] } } }), { status: 200 })),
    );

    await makeElastic({ index: "my-logs-*" }).aggregate({ timeRange: "24h", serviceFilter: "*" });

    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe("https://elastic.example.com:9200/my-logs-*/_search");
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.aggs.services.terms).toBeDefined();
    expect(body.aggs.services.terms.field).toBe("service.keyword");
  });

  it("aggregate returns mapped AggregateResult[] from buckets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            aggregations: {
              services: {
                buckets: [
                  { key: "api-service", doc_count: 42 },
                  { key: "worker", doc_count: 7 },
                ],
              },
            },
          }),
          { status: 200 },
        ),
      ),
    );

    const results = await makeElastic().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-service", count: 42 });
    expect(results[1]).toEqual({ service: "worker", count: 7 });
  });

  it("aggregate handles empty buckets", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ aggregations: { services: { buckets: [] } } }), { status: 200 })),
    );

    const results = await makeElastic().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  it("aggregate throws ProviderApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })),
    );

    await expect(makeElastic().aggregate({ timeRange: "1h", serviceFilter: "*" })).rejects.toThrow(
      "Elasticsearch API error: 401 Unauthorized",
    );
  });
});
