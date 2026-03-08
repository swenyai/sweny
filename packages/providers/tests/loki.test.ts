import { describe, it, expect, vi, afterEach } from "vitest";
import { loki, lokiConfigSchema } from "../src/observability/loki.js";
import type { ObservabilityProvider } from "../src/observability/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("lokiConfigSchema", () => {
  it("validates a minimal config with only baseUrl", () => {
    const result = lokiConfigSchema.safeParse({ baseUrl: "http://loki:3100" });
    expect(result.success).toBe(true);
  });

  it("validates a full config with apiKey and orgId", () => {
    const result = lokiConfigSchema.safeParse({
      baseUrl: "https://loki.example.com",
      apiKey: "my-api-key",
      orgId: "my-org",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing baseUrl", () => {
    const result = lokiConfigSchema.safeParse({ apiKey: "my-api-key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = lokiConfigSchema.safeParse({ baseUrl: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("loki factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider: ObservabilityProvider = loki({
      baseUrl: "http://loki:3100",
      logger: silentLogger,
    });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns LOKI_URL without optional fields", () => {
    const provider = loki({ baseUrl: "http://loki:3100", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({ LOKI_URL: "http://loki:3100" });
  });

  it("getAgentEnv includes LOKI_API_KEY when apiKey set", () => {
    const provider = loki({ baseUrl: "http://loki:3100", apiKey: "tok", logger: silentLogger });
    expect(provider.getAgentEnv()).toMatchObject({ LOKI_API_KEY: "tok" });
  });

  it("getAgentEnv includes LOKI_ORG_ID when orgId set", () => {
    const provider = loki({ baseUrl: "http://loki:3100", orgId: "tenant-1", logger: silentLogger });
    expect(provider.getAgentEnv()).toMatchObject({ LOKI_ORG_ID: "tenant-1" });
  });

  it("getPromptInstructions contains Loki API references", () => {
    const provider = loki({ baseUrl: "http://loki:3100", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Loki");
    expect(instructions).toContain("LOKI_URL");
    expect(instructions).toContain("curl");
  });

  it("getPromptInstructions includes auth header examples when apiKey set", () => {
    const provider = loki({ baseUrl: "http://loki:3100", apiKey: "tok", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("LOKI_API_KEY");
    expect(instructions).toContain("Authorization");
  });

  it("getPromptInstructions includes org header examples when orgId set", () => {
    const provider = loki({ baseUrl: "http://loki:3100", orgId: "tenant-1", logger: silentLogger });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("LOKI_ORG_ID");
    expect(instructions).toContain("X-Scope-OrgID");
  });

  it("strips trailing slash from baseUrl", () => {
    const provider = loki({ baseUrl: "http://loki:3100/", logger: silentLogger });
    const env = provider.getAgentEnv();
    // The env should use original baseUrl but internal requests should work
    expect(env.LOKI_URL).toBe("http://loki:3100");
  });

  it("throws on invalid config", () => {
    expect(() => loki({ baseUrl: "" } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// LokiProvider API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("LokiProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeLoki(extra?: { apiKey?: string; orgId?: string }) {
    return loki({ baseUrl: "http://loki:3100", logger: silentLogger, ...extra });
  }

  // -------------------------------------------------------------------------
  // verifyAccess
  // -------------------------------------------------------------------------

  it("verifyAccess calls GET /ready", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      if (String(url).includes("/ready")) {
        return new Response("ready", { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    await makeLoki().verifyAccess();

    expect(fetch).toHaveBeenCalledWith("http://loki:3100/ready", expect.anything());
  });

  it("verifyAccess sets Bearer auth header when apiKey configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("ready", { status: 200 });
    });

    await makeLoki({ apiKey: "my-api-key" }).verifyAccess();

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({
      Authorization: "Bearer my-api-key",
    });
  });

  it("verifyAccess sets X-Scope-OrgID header when orgId configured", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("ready", { status: 200 });
    });

    await makeLoki({ orgId: "tenant-1" }).verifyAccess();

    const [, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect((opts as RequestInit).headers).toMatchObject({
      "X-Scope-OrgID": "tenant-1",
    });
  });

  it("verifyAccess falls back to /loki/api/v1/labels on /ready failure", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      callCount++;
      if (String(url).includes("/ready")) {
        return new Response("Service Unavailable", { status: 503, statusText: "Service Unavailable" });
      }
      if (String(url).includes("/loki/api/v1/labels")) {
        return new Response(JSON.stringify({ status: "success", data: [] }), { status: 200 });
      }
      return new Response("Not Found", { status: 404 });
    });

    await makeLoki().verifyAccess();

    expect(callCount).toBe(2);
    const urls = (fetch as ReturnType<typeof vi.fn>).mock.calls.map(([url]: [string]) => url);
    expect(urls.some((u) => String(u).includes("/loki/api/v1/labels"))).toBe(true);
  });

  // -------------------------------------------------------------------------
  // queryLogs
  // -------------------------------------------------------------------------

  it("queryLogs GETs /loki/api/v1/query_range with LogQL query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { result: [] } }), { status: 200 });
    });

    await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/loki/api/v1/query_range");
    expect(String(url)).toContain("query=");
    expect(String(url)).toContain("error");
  });

  it("queryLogs returns mapped LogEntry[] from streams", async () => {
    const tsNano = "1700000000000000000"; // some nanosecond timestamp
    const tsMs = Math.floor(parseInt(tsNano, 10) / 1_000_000);

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            result: [
              {
                stream: { job: "api-service", level: "error" },
                values: [[tsNano, "Something went wrong"]],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const logs = await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "api-service", severity: "error" });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe(new Date(tsMs).toISOString());
    expect(logs[0].service).toBe("api-service");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("Something went wrong");
    expect(logs[0].attributes).toMatchObject({ job: "api-service", level: "error" });
  });

  it("queryLogs handles multiple streams with multiple values", async () => {
    const ts1 = "1700000000000000000";
    const ts2 = "1700000060000000000";
    const ts3 = "1700000120000000000";

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            result: [
              {
                stream: { job: "api-service", level: "error" },
                values: [
                  [ts1, "Error one"],
                  [ts2, "Error two"],
                ],
              },
              {
                stream: { service: "worker", level: "warn" },
                values: [[ts3, "Worker warning"]],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const logs = await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs).toHaveLength(3);
    expect(logs[0].service).toBe("api-service");
    expect(logs[1].service).toBe("api-service");
    expect(logs[2].service).toBe("worker");
  });

  it("queryLogs falls back to 'unknown' service when no job/service in stream", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            result: [
              {
                stream: {},
                values: [["1700000000000000000", "Some log line"]],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const logs = await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs[0].service).toBe("unknown");
  });

  it("queryLogs handles empty results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { result: [] } }), { status: 200 });
    });

    const logs = await makeLoki().queryLogs({ timeRange: "30m", serviceFilter: "*", severity: "warn" });
    expect(logs).toEqual([]);
  });

  it("queryLogs uses severity as level fallback when stream has no level", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            result: [
              {
                stream: { job: "myapp" },
                values: [["1700000000000000000", "A log"]],
              },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const logs = await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warn" });
    expect(logs[0].level).toBe("warn");
  });

  it("queryLogs throws ProviderApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Unauthorized", { status: 401, statusText: "Unauthorized" });
    });

    await expect(makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" })).rejects.toThrow(
      "Loki API error: 401 Unauthorized",
    );
  });

  it("queryLogs encodes serviceFilter in LogQL when not '*'", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { result: [] } }), { status: 200 });
    });

    await makeLoki().queryLogs({ timeRange: "1h", serviceFilter: "my-service", severity: "error" });

    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(decodeURIComponent(String(url))).toContain("my-service");
  });

  // -------------------------------------------------------------------------
  // aggregate
  // -------------------------------------------------------------------------

  it("aggregate GETs /loki/api/v1/query with sum by(job) query", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { result: [] } }), { status: 200 });
    });

    await makeLoki().aggregate({ timeRange: "1h", serviceFilter: "*" });

    expect(fetch).toHaveBeenCalledOnce();
    const [url] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(String(url)).toContain("/loki/api/v1/query");
    // URLSearchParams encodes spaces as '+', so replace before asserting
    const decoded = decodeURIComponent(String(url).replace(/\+/g, " "));
    expect(decoded).toContain("sum by (job)");
    expect(decoded).toContain("count_over_time");
    expect(decoded).toContain("error");
  });

  it("aggregate returns mapped AggregateResult[] from metric results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            result: [
              { metric: { job: "api-service" }, value: [1700000000, "42"] },
              { metric: { job: "worker" }, value: [1700000000, "7"] },
            ],
          },
        }),
        { status: 200 },
      );
    });

    const results = await makeLoki().aggregate({ timeRange: "1h", serviceFilter: "*" });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-service", count: 42 });
    expect(results[1]).toEqual({ service: "worker", count: 7 });
  });

  it("aggregate handles empty results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(JSON.stringify({ data: { result: [] } }), { status: 200 });
    });

    const results = await makeLoki().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  it("aggregate falls back to 'unknown' service when metric has no job", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response(
        JSON.stringify({
          data: {
            result: [{ metric: {}, value: [1700000000, "5"] }],
          },
        }),
        { status: 200 },
      );
    });

    const results = await makeLoki().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results[0].service).toBe("unknown");
  });

  it("aggregate throws ProviderApiError on non-2xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("Forbidden", { status: 403, statusText: "Forbidden" });
    });

    await expect(makeLoki().aggregate({ timeRange: "1h", serviceFilter: "*" })).rejects.toThrow(
      "Loki API error: 403 Forbidden",
    );
  });
});
