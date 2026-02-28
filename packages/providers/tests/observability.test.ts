import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { datadog, datadogConfigSchema } from "../src/observability/datadog.js";
import { sentry, sentryConfigSchema } from "../src/observability/sentry.js";
import type { ObservabilityProvider } from "../src/observability/types.js";

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("datadogConfigSchema", () => {
  it("validates a complete config", () => {
    const result = datadogConfigSchema.safeParse({
      apiKey: "abc",
      appKey: "def",
      site: "datadoghq.eu",
    });
    expect(result.success).toBe(true);
  });

  it("applies default site", () => {
    const result = datadogConfigSchema.parse({ apiKey: "abc", appKey: "def" });
    expect(result.site).toBe("datadoghq.com");
  });

  it("rejects missing apiKey", () => {
    const result = datadogConfigSchema.safeParse({ appKey: "def" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = datadogConfigSchema.safeParse({ apiKey: "", appKey: "def" });
    expect(result.success).toBe(false);
  });
});

describe("sentryConfigSchema", () => {
  it("validates a complete config", () => {
    const result = sentryConfigSchema.safeParse({
      authToken: "tok",
      organization: "my-org",
      project: "my-proj",
    });
    expect(result.success).toBe(true);
  });

  it("applies default baseUrl", () => {
    const result = sentryConfigSchema.parse({
      authToken: "tok",
      organization: "org",
      project: "proj",
    });
    expect(result.baseUrl).toBe("https://sentry.io");
  });

  it("rejects missing fields", () => {
    expect(sentryConfigSchema.safeParse({ authToken: "tok" }).success).toBe(false);
    expect(sentryConfigSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory functions
// ---------------------------------------------------------------------------

describe("datadog factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = datadog({ apiKey: "k", appKey: "a", site: "datadoghq.com" });
    expect(provider).toBeDefined();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns DD_ env vars", () => {
    const provider = datadog({ apiKey: "my-key", appKey: "my-app", site: "datadoghq.eu" });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      DD_API_KEY: "my-key",
      DD_APP_KEY: "my-app",
      DD_SITE: "datadoghq.eu",
    });
  });

  it("getPromptInstructions contains Datadog API docs", () => {
    const provider = datadog({ apiKey: "k", appKey: "a", site: "datadoghq.com" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Datadog");
    expect(instructions).toContain("DD_API_KEY");
    expect(instructions).toContain("DD-API-KEY");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => datadog({ apiKey: "", appKey: "a" } as any)).toThrow();
  });
});

describe("sentry factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = sentry({ authToken: "t", organization: "o", project: "p" });
    expect(provider).toBeDefined();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns SENTRY_ env vars", () => {
    const provider = sentry({ authToken: "tok", organization: "my-org", project: "my-proj" });
    const env = provider.getAgentEnv();
    expect(env).toEqual({
      SENTRY_AUTH_TOKEN: "tok",
      SENTRY_ORG: "my-org",
      SENTRY_PROJECT: "my-proj",
      SENTRY_BASE_URL: "https://sentry.io",
    });
  });

  it("getPromptInstructions contains Sentry API docs", () => {
    const provider = sentry({ authToken: "t", organization: "o", project: "p" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Sentry");
    expect(instructions).toContain("SENTRY_AUTH_TOKEN");
    expect(instructions).toContain("curl");
  });
});

// ---------------------------------------------------------------------------
// Datadog API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("DatadogProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("verifyAccess calls the aggregate endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
    globalThis.fetch = mockFetch;

    const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
    const provider = datadog({
      apiKey: "test-key",
      appKey: "test-app",
      site: "datadoghq.com",
      logger: silentLogger,
    });

    await provider.verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.datadoghq.com/api/v2/logs/analytics/aggregate");
    expect(opts.headers["DD-API-KEY"]).toBe("test-key");
    expect(opts.headers["DD-APPLICATION-KEY"]).toBe("test-app");
  });

  it("queryLogs returns mapped LogEntry array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: [
          {
            attributes: {
              timestamp: "2025-01-01T00:00:00Z",
              service: "api",
              status: "error",
              message: "boom",
              attributes: { key: "val" },
            },
          },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
    const provider = datadog({
      apiKey: "k",
      appKey: "a",
      site: "datadoghq.com",
      logger: silentLogger,
    });

    const logs = await provider.queryLogs({
      timeRange: "24h",
      serviceFilter: "api",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("api");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("boom");
    expect(logs[0].attributes).toEqual({ key: "val" });
  });

  it("aggregate returns grouped AggregateResult array", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          buckets: [
            { by: { service: "api" }, computes: { c0: 42 } },
            { by: { service: "web" }, computes: { c0: 7 } },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
    const provider = datadog({
      apiKey: "k",
      appKey: "a",
      site: "datadoghq.com",
      logger: silentLogger,
    });

    const results = await provider.aggregate({
      timeRange: "1h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api", count: 42 });
    expect(results[1]).toEqual({ service: "web", count: 7 });
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      statusText: "Forbidden",
    });

    const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
    const provider = datadog({
      apiKey: "k",
      appKey: "a",
      site: "datadoghq.com",
      logger: silentLogger,
    });

    await expect(provider.verifyAccess()).rejects.toThrow("Datadog API error: 403 Forbidden");
  });
});
