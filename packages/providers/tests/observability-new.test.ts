import { describe, it, expect, vi, afterEach } from "vitest";
import { splunk, splunkConfigSchema } from "../src/observability/splunk.js";
import { elastic, elasticConfigSchema } from "../src/observability/elastic.js";
import { loki, lokiConfigSchema } from "../src/observability/loki.js";
import { newrelic, newrelicConfigSchema } from "../src/observability/newrelic.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ===========================================================================
// Splunk
// ===========================================================================

describe("splunkConfigSchema", () => {
  it("validates a complete config", () => {
    const result = splunkConfigSchema.safeParse({
      baseUrl: "https://splunk.example.com:8089",
      token: "my-token",
    });
    expect(result.success).toBe(true);
  });

  it("applies default index", () => {
    const result = splunkConfigSchema.parse({
      baseUrl: "https://splunk.example.com:8089",
      token: "my-token",
    });
    expect(result.index).toBe("main");
  });

  it("rejects missing baseUrl", () => {
    const result = splunkConfigSchema.safeParse({ token: "tok" });
    expect(result.success).toBe(false);
  });

  it("rejects missing token", () => {
    const result = splunkConfigSchema.safeParse({ baseUrl: "https://splunk.example.com" });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = splunkConfigSchema.safeParse({ baseUrl: "", token: "tok" });
    expect(result.success).toBe(false);
  });

  it("rejects empty token", () => {
    const result = splunkConfigSchema.safeParse({ baseUrl: "https://splunk.example.com", token: "" });
    expect(result.success).toBe(false);
  });
});

describe("splunk factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = splunk({ baseUrl: "https://splunk.example.com", token: "tok" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns SPLUNK_ env vars", () => {
    const provider = splunk({ baseUrl: "https://splunk.example.com", token: "tok", index: "myindex" });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      SPLUNK_URL: "https://splunk.example.com",
      SPLUNK_TOKEN: "tok",
      SPLUNK_INDEX: "myindex",
    });
  });

  it("getPromptInstructions contains Splunk and curl examples", () => {
    const provider = splunk({ baseUrl: "https://splunk.example.com", token: "tok" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Splunk");
    expect(instructions).toContain("SPLUNK_TOKEN");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => splunk({ baseUrl: "", token: "tok" } as any)).toThrow();
  });
});

describe("SplunkProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeSplunk() {
    return splunk({
      baseUrl: "https://splunk.example.com:8089",
      token: "test-token",
      index: "main",
      logger: silentLogger,
    });
  }

  it("verifyAccess calls the server info endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    await makeSplunk().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/services/server/info");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
  });

  it("queryLogs returns mapped LogEntry array", async () => {
    // Splunk uses runSearch which makes 3 fetch calls: create job, poll status, get results
    const mockFetch = vi
      .fn()
      // 1. Create search job
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ sid: "job-123" }),
      })
      // 2. Poll for completion
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          entry: [{ content: { dispatchState: "DONE", isDone: true } }],
        }),
      })
      // 3. Fetch results
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            {
              _time: "2026-01-15T10:00:00Z",
              host: "api-server",
              log_level: "error",
              _raw: "Something went wrong",
              extra_field: "extra",
            },
          ],
        }),
      });
    globalThis.fetch = mockFetch;

    const logs = await makeSplunk().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-server",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2026-01-15T10:00:00Z");
    expect(logs[0].service).toBe("api-server");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("Something went wrong");
    expect(logs[0].attributes).toEqual({ extra_field: "extra" });
  });

  it("queryLogs handles empty results", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sid: "job-empty" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entry: [{ content: { isDone: true } }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    globalThis.fetch = mockFetch;

    const logs = await makeSplunk().queryLogs({
      timeRange: "1h",
      serviceFilter: "none",
      severity: "error",
    });

    expect(logs).toHaveLength(0);
  });

  it("aggregate returns AggregateResult array", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sid: "agg-job" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entry: [{ content: { isDone: true } }] }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          results: [
            { host: "api-server", count: "42" },
            { host: "web-server", count: "7" },
          ],
        }),
      });
    globalThis.fetch = mockFetch;

    const results = await makeSplunk().aggregate({
      timeRange: "24h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-server", count: 42 });
    expect(results[1]).toEqual({ service: "web-server", count: 7 });
  });

  it("aggregate handles empty results", async () => {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ sid: "agg-empty" }) })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ entry: [{ content: { isDone: true } }] }),
      })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ results: [] }) });
    globalThis.fetch = mockFetch;

    const results = await makeSplunk().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toHaveLength(0);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(makeSplunk().verifyAccess()).rejects.toThrow("Splunk API error: 401 Unauthorized");
  });
});

// ===========================================================================
// Elastic
// ===========================================================================

describe("elasticConfigSchema", () => {
  it("validates a config with apiKey", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com",
      apiKey: "my-api-key",
    });
    expect(result.success).toBe(true);
  });

  it("validates a config with username and password", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com",
      username: "admin",
      password: "secret",
    });
    expect(result.success).toBe(true);
  });

  it("applies default index", () => {
    const result = elasticConfigSchema.parse({
      baseUrl: "https://elastic.example.com",
      apiKey: "key",
    });
    expect(result.index).toBe("logs-*");
  });

  it("rejects config with neither apiKey nor username+password", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects config with only username (no password)", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com",
      username: "admin",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing baseUrl", () => {
    const result = elasticConfigSchema.safeParse({ apiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = elasticConfigSchema.safeParse({ baseUrl: "", apiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = elasticConfigSchema.safeParse({
      baseUrl: "https://elastic.example.com",
      apiKey: "",
    });
    expect(result.success).toBe(false);
  });
});

describe("elastic factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = elastic({ baseUrl: "https://elastic.example.com", apiKey: "key" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns ELASTIC_ env vars with apiKey", () => {
    const provider = elastic({
      baseUrl: "https://elastic.example.com",
      apiKey: "my-key",
      index: "app-logs",
    });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      ELASTIC_URL: "https://elastic.example.com",
      ELASTIC_API_KEY: "my-key",
      ELASTIC_INDEX: "app-logs",
    });
  });

  it("getAgentEnv returns ELASTIC_ env vars with basic auth", () => {
    const provider = elastic({
      baseUrl: "https://elastic.example.com",
      username: "admin",
      password: "secret",
    });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      ELASTIC_URL: "https://elastic.example.com",
      ELASTIC_USERNAME: "admin",
      ELASTIC_PASSWORD: "secret",
      ELASTIC_INDEX: "logs-*",
    });
  });

  it("getPromptInstructions contains Elasticsearch and curl examples", () => {
    const provider = elastic({ baseUrl: "https://elastic.example.com", apiKey: "key" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Elasticsearch");
    expect(instructions).toContain("ELASTIC_URL");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => elastic({ baseUrl: "", apiKey: "key" } as any)).toThrow();
  });
});

describe("ElasticProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeElastic() {
    return elastic({
      baseUrl: "https://elastic.example.com",
      apiKey: "test-api-key",
      index: "logs-*",
      logger: silentLogger,
    });
  }

  function makeElasticBasicAuth() {
    return elastic({
      baseUrl: "https://elastic.example.com",
      username: "admin",
      password: "secret",
      logger: silentLogger,
    });
  }

  it("verifyAccess calls the root endpoint with ApiKey auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cluster_name: "my-cluster", version: { number: "8.12.0" } }),
    });
    globalThis.fetch = mockFetch;

    await makeElastic().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://elastic.example.com/");
    expect(opts.headers.Authorization).toBe("ApiKey test-api-key");
  });

  it("verifyAccess uses Basic auth when username/password provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ cluster_name: "my-cluster" }),
    });
    globalThis.fetch = mockFetch;

    await makeElasticBasicAuth().verifyAccess();

    const [, opts] = mockFetch.mock.calls[0];
    const encoded = Buffer.from("admin:secret").toString("base64");
    expect(opts.headers.Authorization).toBe(`Basic ${encoded}`);
  });

  it("queryLogs returns mapped LogEntry array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        hits: {
          hits: [
            {
              _source: {
                "@timestamp": "2026-01-15T10:00:00Z",
                "service.name": "api-server",
                "log.level": "error",
                message: "Connection timeout",
                extra: "data",
              },
            },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeElastic().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-server",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2026-01-15T10:00:00Z");
    expect(logs[0].service).toBe("api-server");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("Connection timeout");
  });

  it("queryLogs handles empty results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ hits: { hits: [] } }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeElastic().queryLogs({
      timeRange: "1h",
      serviceFilter: "none",
      severity: "error",
    });

    expect(logs).toHaveLength(0);
  });

  it("aggregate returns AggregateResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        aggregations: {
          services: {
            buckets: [
              { key: "api-server", doc_count: 42 },
              { key: "web-server", doc_count: 7 },
            ],
          },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const results = await makeElastic().aggregate({
      timeRange: "24h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-server", count: 42 });
    expect(results[1]).toEqual({ service: "web-server", count: 7 });
  });

  it("aggregate handles empty results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ aggregations: { services: { buckets: [] } } }),
    });
    globalThis.fetch = mockFetch;

    const results = await makeElastic().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toHaveLength(0);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Unauthorized",
    });

    await expect(makeElastic().verifyAccess()).rejects.toThrow("Elasticsearch API error: 401 Unauthorized");
  });
});

// ===========================================================================
// Loki
// ===========================================================================

describe("lokiConfigSchema", () => {
  it("validates a minimal config (baseUrl only)", () => {
    const result = lokiConfigSchema.safeParse({
      baseUrl: "https://loki.example.com",
    });
    expect(result.success).toBe(true);
  });

  it("validates a complete config with apiKey and orgId", () => {
    const result = lokiConfigSchema.safeParse({
      baseUrl: "https://loki.example.com",
      apiKey: "my-key",
      orgId: "tenant-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing baseUrl", () => {
    const result = lokiConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = lokiConfigSchema.safeParse({ baseUrl: "" });
    expect(result.success).toBe(false);
  });
});

describe("loki factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = loki({ baseUrl: "https://loki.example.com" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns LOKI_URL only when no apiKey/orgId", () => {
    const provider = loki({ baseUrl: "https://loki.example.com" });
    const env = provider.getAgentEnv();
    expect(env).toEqual({ LOKI_URL: "https://loki.example.com" });
  });

  it("getAgentEnv returns LOKI_API_KEY and LOKI_ORG_ID when set", () => {
    const provider = loki({
      baseUrl: "https://loki.example.com",
      apiKey: "my-key",
      orgId: "tenant-1",
    });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      LOKI_URL: "https://loki.example.com",
      LOKI_API_KEY: "my-key",
      LOKI_ORG_ID: "tenant-1",
    });
  });

  it("getPromptInstructions contains Loki and curl examples", () => {
    const provider = loki({ baseUrl: "https://loki.example.com" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Loki");
    expect(instructions).toContain("LOKI_URL");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => loki({ baseUrl: "" } as any)).toThrow();
  });
});

describe("LokiProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeLoki() {
    return loki({
      baseUrl: "https://loki.example.com",
      apiKey: "test-key",
      orgId: "tenant-1",
      logger: silentLogger,
    });
  }

  it("verifyAccess calls the /ready endpoint with correct headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    await makeLoki().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/ready");
    expect(opts.headers.Authorization).toBe("Bearer test-key");
    expect(opts.headers["X-Scope-OrgID"]).toBe("tenant-1");
  });

  it("queryLogs returns mapped LogEntry array", async () => {
    // First call is verifyAccess-style, but queryLogs calls request -> fetch once
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          result: [
            {
              stream: { job: "api-server", level: "error" },
              values: [["1705312800000000000", "Error: connection timeout"]],
            },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeLoki().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-server",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("api-server");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("Error: connection timeout");
    expect(logs[0].timestamp).toBeTruthy();
  });

  it("queryLogs handles empty results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeLoki().queryLogs({
      timeRange: "1h",
      serviceFilter: "none",
      severity: "error",
    });

    expect(logs).toHaveLength(0);
  });

  it("aggregate returns AggregateResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          result: [
            { metric: { job: "api-server" }, value: [1705312800, "42"] },
            { metric: { job: "web-server" }, value: [1705312800, "7"] },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const results = await makeLoki().aggregate({
      timeRange: "24h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-server", count: 42 });
    expect(results[1]).toEqual({ service: "web-server", count: 7 });
  });

  it("aggregate handles empty results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    });
    globalThis.fetch = mockFetch;

    const results = await makeLoki().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toHaveLength(0);
  });

  it("throws on non-ok response", async () => {
    // verifyAccess tries /ready first; if that fails with non-ok, it throws before the fallback
    // Actually, looking at the code: if /ready returns non-ok, it throws "Loki ready check failed: 401"
    // Let's test via queryLogs which goes through this.request directly
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "x", severity: "error" })).rejects.toThrow(
      "Loki API error: 401 Unauthorized",
    );
  });
});

// ===========================================================================
// New Relic
// ===========================================================================

describe("newrelicConfigSchema", () => {
  it("validates a complete config", () => {
    const result = newrelicConfigSchema.safeParse({
      apiKey: "NRAK-123456",
      accountId: "12345",
    });
    expect(result.success).toBe(true);
  });

  it("applies default region (us)", () => {
    const result = newrelicConfigSchema.parse({
      apiKey: "NRAK-123456",
      accountId: "12345",
    });
    expect(result.region).toBe("us");
  });

  it("accepts eu region", () => {
    const result = newrelicConfigSchema.parse({
      apiKey: "NRAK-123456",
      accountId: "12345",
      region: "eu",
    });
    expect(result.region).toBe("eu");
  });

  it("rejects missing apiKey", () => {
    const result = newrelicConfigSchema.safeParse({ accountId: "12345" });
    expect(result.success).toBe(false);
  });

  it("rejects missing accountId", () => {
    const result = newrelicConfigSchema.safeParse({ apiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = newrelicConfigSchema.safeParse({ apiKey: "", accountId: "12345" });
    expect(result.success).toBe(false);
  });

  it("rejects empty accountId", () => {
    const result = newrelicConfigSchema.safeParse({ apiKey: "key", accountId: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid region", () => {
    const result = newrelicConfigSchema.safeParse({
      apiKey: "key",
      accountId: "12345",
      region: "ap",
    });
    expect(result.success).toBe(false);
  });
});

describe("newrelic factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = newrelic({ apiKey: "key", accountId: "12345" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns NR_ env vars", () => {
    const provider = newrelic({ apiKey: "my-key", accountId: "12345", region: "eu" });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      NR_API_KEY: "my-key",
      NR_ACCOUNT_ID: "12345",
      NR_REGION: "eu",
    });
  });

  it("getPromptInstructions contains New Relic and curl examples", () => {
    const provider = newrelic({ apiKey: "key", accountId: "12345" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("New Relic");
    expect(instructions).toContain("NR_API_KEY");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => newrelic({ apiKey: "", accountId: "12345" } as any)).toThrow();
  });
});

describe("NewRelicProvider", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeNewRelic() {
    return newrelic({
      apiKey: "test-api-key",
      accountId: "12345",
      region: "us",
      logger: silentLogger,
    });
  }

  it("verifyAccess calls the NerdGraph endpoint with correct headers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { actor: { account: { name: "My Account" } } },
      }),
    });
    globalThis.fetch = mockFetch;

    await makeNewRelic().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.newrelic.com/graphql");
    expect(opts.headers["API-Key"]).toBe("test-api-key");
    expect(opts.method).toBe("POST");
  });

  it("verifyAccess uses EU endpoint when region is eu", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { actor: { account: { name: "EU Account" } } },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = newrelic({
      apiKey: "key",
      accountId: "12345",
      region: "eu",
      logger: silentLogger,
    });
    await provider.verifyAccess();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.eu.newrelic.com/graphql");
  });

  it("queryLogs returns mapped LogEntry array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          actor: {
            account: {
              nrql: {
                results: [
                  {
                    timestamp: 1705312800000,
                    service: "api-server",
                    level: "error",
                    message: "Connection failed",
                    extra: "value",
                  },
                ],
              },
            },
          },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeNewRelic().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-server",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("api-server");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("Connection failed");
    expect(logs[0].timestamp).toBeTruthy();
    expect(logs[0].attributes).toEqual({ extra: "value" });
  });

  it("queryLogs handles empty results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { actor: { account: { nrql: { results: [] } } } },
      }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeNewRelic().queryLogs({
      timeRange: "1h",
      serviceFilter: "none",
      severity: "error",
    });

    expect(logs).toHaveLength(0);
  });

  it("aggregate returns AggregateResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          actor: {
            account: {
              nrql: {
                results: [
                  { service: "api-server", count: 42 },
                  { service: "web-server", count: 7 },
                ],
              },
            },
          },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const results = await makeNewRelic().aggregate({
      timeRange: "24h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-server", count: 42 });
    expect(results[1]).toEqual({ service: "web-server", count: 7 });
  });

  it("aggregate handles empty results", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { actor: { account: { nrql: { results: [] } } } },
      }),
    });
    globalThis.fetch = mockFetch;

    const results = await makeNewRelic().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toHaveLength(0);
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
    });

    await expect(makeNewRelic().verifyAccess()).rejects.toThrow("New Relic NerdGraph API error: 401 Unauthorized");
  });

  it("throws on GraphQL errors in response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        errors: [{ message: "Invalid API key" }],
      }),
    });

    await expect(makeNewRelic().verifyAccess()).rejects.toThrow("Invalid API key");
  });
});
