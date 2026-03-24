import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { datadog, datadogConfigSchema } from "../src/observability/datadog.js";
import { sentry, sentryConfigSchema } from "../src/observability/sentry.js";
import { loki, lokiConfigSchema } from "../src/observability/loki.js";
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
    expect(typeof provider.getMcpServers).toBe("function");
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

  it("getMcpServers returns stdio config for @sentry/mcp-server", () => {
    const provider = sentry({ authToken: "tok", organization: "o", project: "p" });
    const servers = provider.getMcpServers!();
    expect(servers).toHaveProperty("sentry");
    expect(servers.sentry.type).toBe("stdio");
    expect(servers.sentry.command).toBe("npx");
    expect(servers.sentry.args).toContain("@sentry/mcp-server@latest");
    expect(servers.sentry.env?.SENTRY_ACCESS_TOKEN).toBe("tok");
  });

  it("getMcpServers does not set SENTRY_HOST for default sentry.io", () => {
    // SaaS users: SENTRY_HOST must be absent — the MCP server defaults to sentry.io
    const provider = sentry({ authToken: "tok", organization: "o", project: "p" });
    const servers = provider.getMcpServers!();
    expect(servers.sentry.env).not.toHaveProperty("SENTRY_HOST");
  });

  it("getMcpServers sets SENTRY_HOST as hostname-only for self-hosted instances", () => {
    // @sentry/mcp-server expects just the hostname, not the full URL with protocol
    const provider = sentry({
      authToken: "tok",
      organization: "o",
      project: "p",
      baseUrl: "https://sentry.example.com",
    });
    const servers = provider.getMcpServers!();
    expect(servers.sentry.env?.SENTRY_HOST).toBe("sentry.example.com");
  });

  it("getMcpServers does not set SENTRY_HOST when baseUrl is malformed", () => {
    const provider = sentry({
      authToken: "tok",
      organization: "o",
      project: "p",
      baseUrl: "not-a-valid-url",
    });
    // Should not throw, and should not set SENTRY_HOST
    expect(() => provider.getMcpServers!()).not.toThrow();
    const servers = provider.getMcpServers!();
    expect(servers.sentry.env).not.toHaveProperty("SENTRY_HOST");
  });
});

// ---------------------------------------------------------------------------
// Sentry API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("SentryProvider", () => {
  const originalFetch = globalThis.fetch;
  const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeSentry() {
    return sentry({
      authToken: "test-token",
      organization: "my-org",
      project: "my-proj",
      logger: silentLogger,
    });
  }

  it("verifyAccess calls the organization endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "org-id", name: "My Org" }),
    });
    globalThis.fetch = mockFetch;

    await makeSentry().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/0/organizations/my-org/");
    expect(opts.headers.Authorization).toBe("Bearer test-token");
  });

  it("queryLogs returns mapped LogEntry array from Sentry issues", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        {
          id: "123",
          title: "TypeError: Cannot read null",
          culprit: "auth.service",
          level: "error",
          firstSeen: "2026-01-01T00:00:00Z",
          lastSeen: "2026-02-01T12:00:00Z",
          count: "42",
          metadata: { function: "handleLogin" },
        },
      ],
    });
    globalThis.fetch = mockFetch;

    const logs = await makeSentry().queryLogs({
      timeRange: "24h",
      serviceFilter: "auth",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("auth.service");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("TypeError: Cannot read null");
    expect(logs[0].timestamp).toBe("2026-02-01T12:00:00Z");
    expect(logs[0].attributes).toMatchObject({ issueId: "123", count: 42 });
  });

  it("queryLogs passes service filter as transaction query param", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    globalThis.fetch = mockFetch;

    await makeSentry().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-*",
      severity: "warning",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("transaction%3Aapi-*");
    expect(url).toContain("level%3Awarning");
  });

  it("queryLogs omits transaction filter when serviceFilter is *", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [],
    });
    globalThis.fetch = mockFetch;

    await makeSentry().queryLogs({
      timeRange: "1h",
      serviceFilter: "*",
      severity: "error",
    });

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain("transaction");
  });

  it("aggregate groups issues by culprit and sums counts", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => [
        { culprit: "auth.service", count: "10" },
        { culprit: "auth.service", count: "5" },
        { culprit: "billing.service", count: "3" },
      ],
    });
    globalThis.fetch = mockFetch;

    const results = await makeSentry().aggregate({
      timeRange: "24h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "auth.service", count: 15 });
    expect(results[1]).toEqual({ service: "billing.service", count: 3 });
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    await expect(makeSentry().verifyAccess()).rejects.toThrow("Sentry API error: 401 Unauthorized");
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
      text: async () => "",
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

// ---------------------------------------------------------------------------
// Loki config schema
// ---------------------------------------------------------------------------

describe("lokiConfigSchema", () => {
  it("validates a complete config", () => {
    const result = lokiConfigSchema.safeParse({
      baseUrl: "https://loki.example.com",
      apiKey: "tok",
      orgId: "tenant1",
    });
    expect(result.success).toBe(true);
  });

  it("validates minimal config (baseUrl only)", () => {
    const result = lokiConfigSchema.safeParse({ baseUrl: "https://loki.example.com" });
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

// ---------------------------------------------------------------------------
// Loki factory
// ---------------------------------------------------------------------------

describe("loki factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = loki({ baseUrl: "https://loki.example.com" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns LOKI_URL", () => {
    const provider = loki({ baseUrl: "https://loki.example.com" });
    const env = provider.getAgentEnv();
    expect(env).toEqual({ LOKI_URL: "https://loki.example.com" });
  });

  it("getAgentEnv includes LOKI_API_KEY and LOKI_ORG_ID when configured", () => {
    const provider = loki({ baseUrl: "https://loki.example.com", apiKey: "tok", orgId: "tenant1" });
    const env = provider.getAgentEnv();
    expect(env.LOKI_API_KEY).toBe("tok");
    expect(env.LOKI_ORG_ID).toBe("tenant1");
  });

  it("getPromptInstructions contains Loki and curl examples", () => {
    const provider = loki({ baseUrl: "https://loki.example.com" });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Loki");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("LOKI_URL");
  });

  it("throws on invalid config (empty baseUrl)", () => {
    expect(() => loki({ baseUrl: "" } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// Loki API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("LokiProvider", () => {
  const originalFetch = globalThis.fetch;
  const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function makeLoki(extra?: { apiKey?: string; orgId?: string }) {
    return loki({
      baseUrl: "https://loki.example.com",
      logger: silentLogger,
      ...extra,
    });
  }

  it("verifyAccess calls /ready endpoint and returns true on 200", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = mockFetch;

    await makeLoki().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/ready");
    expect(url).toContain("loki.example.com");
  });

  it("verifyAccess throws ProviderAuthError on non-2xx from /ready (falls through to labels)", async () => {
    // First call (/ready) returns 401, second call (/loki/api/v1/labels) also returns 401
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "",
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
        text: async () => "",
      });
    globalThis.fetch = mockFetch;

    await expect(makeLoki().verifyAccess()).rejects.toThrow("Loki API error: 401 Unauthorized");
  });

  it("queryLogs sends request to /loki/api/v1/query_range", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    });
    globalThis.fetch = mockFetch;

    await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/loki/api/v1/query_range");
  });

  it("queryLogs includes LogQL query parameter", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    });
    globalThis.fetch = mockFetch;

    await makeLoki().queryLogs({ timeRange: "24h", serviceFilter: "api", severity: "error" });

    const [url] = mockFetch.mock.calls[0];
    // URL should contain the query param
    expect(url).toContain("query=");
    expect(decodeURIComponent(url)).toContain("error");
  });

  it("queryLogs returns mapped LogEntry array from Loki stream results", async () => {
    const tsNano = "1704067200000000000"; // 2024-01-01T00:00:00Z in nanoseconds
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          result: [
            {
              stream: { job: "api-service", level: "error" },
              values: [[tsNano, "connection refused"]],
            },
          ],
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const logs = await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "api", severity: "error" });

    expect(logs).toHaveLength(1);
    expect(logs[0].service).toBe("api-service");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("connection refused");
    expect(logs[0].timestamp).toBe(new Date(Math.floor(parseInt(tsNano, 10) / 1_000_000)).toISOString());
  });

  it("queryLogs includes X-Scope-OrgID header when orgId is configured", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    });
    globalThis.fetch = mockFetch;

    await makeLoki({ orgId: "tenant1" }).queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["X-Scope-OrgID"]).toBe("tenant1");
  });

  it("queryLogs does not include X-Scope-OrgID when orgId is not set", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { result: [] } }),
    });
    globalThis.fetch = mockFetch;

    await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["X-Scope-OrgID"]).toBeUndefined();
  });

  it("queryLogs throws ProviderApiError on non-2xx", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });

    await expect(makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "api", severity: "error" })).rejects.toThrow(
      "Loki API error: 401 Unauthorized",
    );
  });
});
