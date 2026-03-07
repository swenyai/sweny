import { describe, it, expect, vi, afterEach } from "vitest";
import { splunk, splunkConfigSchema } from "../src/observability/splunk.js";
import type { ObservabilityProvider } from "../src/observability/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("splunkConfigSchema", () => {
  it("validates a complete config", () => {
    const result = splunkConfigSchema.safeParse({
      baseUrl: "https://splunk.example.com:8089",
      token: "my-token",
      index: "prod",
    });
    expect(result.success).toBe(true);
  });

  it("applies default index 'main'", () => {
    const result = splunkConfigSchema.parse({
      baseUrl: "https://splunk.example.com:8089",
      token: "my-token",
    });
    expect(result.index).toBe("main");
  });

  it("rejects missing baseUrl", () => {
    const result = splunkConfigSchema.safeParse({ token: "my-token" });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = splunkConfigSchema.safeParse({ baseUrl: "", token: "my-token" });
    expect(result.success).toBe(false);
  });

  it("rejects missing token", () => {
    const result = splunkConfigSchema.safeParse({ baseUrl: "https://splunk.example.com:8089" });
    expect(result.success).toBe(false);
  });

  it("rejects empty token", () => {
    const result = splunkConfigSchema.safeParse({ baseUrl: "https://splunk.example.com:8089", token: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("splunk factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider: ObservabilityProvider = splunk({
      baseUrl: "https://splunk.example.com:8089",
      token: "tok",
      logger: silentLogger,
    });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("getAgentEnv returns SPLUNK_ env vars", () => {
    const provider = splunk({
      baseUrl: "https://splunk.example.com:8089",
      token: "my-token",
      index: "prod",
      logger: silentLogger,
    });
    expect(provider.getAgentEnv()).toEqual({
      SPLUNK_URL: "https://splunk.example.com:8089",
      SPLUNK_TOKEN: "my-token",
      SPLUNK_INDEX: "prod",
    });
  });

  it("getAgentEnv uses default index 'main'", () => {
    const provider = splunk({
      baseUrl: "https://splunk.example.com:8089",
      token: "my-token",
      logger: silentLogger,
    });
    expect(provider.getAgentEnv().SPLUNK_INDEX).toBe("main");
  });

  it("getPromptInstructions contains Splunk API references", () => {
    const provider = splunk({
      baseUrl: "https://splunk.example.com:8089",
      token: "tok",
      logger: silentLogger,
    });
    const instructions = provider.getPromptInstructions();
    expect(instructions).toContain("Splunk");
    expect(instructions).toContain("SPLUNK_URL");
    expect(instructions).toContain("SPLUNK_TOKEN");
    expect(instructions).toContain("curl");
  });

  it("throws on invalid config", () => {
    expect(() => splunk({ baseUrl: "", token: "tok" } as any)).toThrow();
    expect(() => splunk({ baseUrl: "https://splunk.example.com:8089", token: "" } as any)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// SplunkProvider API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("SplunkProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function makeSplunk(extra?: { index?: string }) {
    return splunk({
      baseUrl: "https://splunk.example.com:8089",
      token: "test-token",
      logger: silentLogger,
      ...extra,
    });
  }

  // -------------------------------------------------------------------------
  // verifyAccess
  // -------------------------------------------------------------------------

  it("verifyAccess calls /services/server/info with correct auth header", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response(JSON.stringify({ generator: { build: "1" } }), { status: 200 })),
    );

    await makeSplunk().verifyAccess();

    expect(fetch).toHaveBeenCalledOnce();
    const [url, opts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toContain("/services/server/info");
    expect(url).toContain("output_mode=json");
    expect((opts as RequestInit).headers as Record<string, string>).toMatchObject({
      Authorization: "Bearer test-token",
    });
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(() =>
      Promise.resolve(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })),
    );

    await expect(makeSplunk().verifyAccess()).rejects.toThrow("Splunk API error: 401 Unauthorized");
  });

  // -------------------------------------------------------------------------
  // queryLogs
  // -------------------------------------------------------------------------

  it("queryLogs performs 3-step job workflow and returns mapped LogEntry[]", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "job123" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                {
                  _time: "2026-01-01T00:00:00.000Z",
                  host: "api-service",
                  log_level: "error",
                  _raw: "connection refused",
                  extra_field: "val",
                },
              ],
            }),
            { status: 200 },
          ),
        ),
      );

    const logs = await makeSplunk().queryLogs({
      timeRange: "1h",
      serviceFilter: "api-service",
      severity: "error",
    });

    expect(logs).toHaveLength(1);
    expect(logs[0].timestamp).toBe("2026-01-01T00:00:00.000Z");
    expect(logs[0].service).toBe("api-service");
    expect(logs[0].level).toBe("error");
    expect(logs[0].message).toBe("connection refused");
    expect(logs[0].attributes).toMatchObject({ extra_field: "val" });
  });

  it("queryLogs creates job with POST to /services/search/jobs", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "job456" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    await makeSplunk().queryLogs({
      timeRange: "24h",
      serviceFilter: "my-svc",
      severity: "error",
    });

    const [createUrl, createOpts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(createUrl).toContain("/services/search/jobs");
    expect((createOpts as RequestInit).method).toBe("POST");
    expect((createOpts as RequestInit).headers as Record<string, string>).toMatchObject({
      Authorization: "Bearer test-token",
    });
    const body = (createOpts as RequestInit).body as string;
    expect(body).toContain("search=");
    expect(decodeURIComponent(body)).toContain("my-svc");
    expect(decodeURIComponent(body)).toContain("error");
  });

  it("queryLogs handles empty results", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "job789" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    const logs = await makeSplunk().queryLogs({
      timeRange: "1h",
      serviceFilter: "*",
      severity: "warn",
    });

    expect(logs).toEqual([]);
  });

  it("queryLogs polls job status via GET /services/search/jobs/{sid}", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "pollJob" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    await makeSplunk().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [statusUrl, statusOpts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[1];
    expect(statusUrl).toContain("/services/search/jobs/pollJob");
    expect((statusOpts as RequestInit).method).toBe("GET");
  });

  // -------------------------------------------------------------------------
  // aggregate
  // -------------------------------------------------------------------------

  it("aggregate returns mapped AggregateResult[] with host as service", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "aggJob" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() =>
        Promise.resolve(
          new Response(
            JSON.stringify({
              results: [
                { host: "api-service", count: "42" },
                { host: "worker", count: "7" },
              ],
            }),
            { status: 200 },
          ),
        ),
      );

    const results = await makeSplunk().aggregate({
      timeRange: "24h",
      serviceFilter: "*",
    });

    expect(results).toHaveLength(2);
    expect(results[0]).toEqual({ service: "api-service", count: 42 });
    expect(results[1]).toEqual({ service: "worker", count: 7 });
  });

  it("aggregate SPL query contains 'stats count by host'", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "aggJob2" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    await makeSplunk().aggregate({ timeRange: "1h", serviceFilter: "*" });

    const [, createOpts] = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    // URL-encoded form body uses + for spaces — replace before decoding %XX sequences
    const body = decodeURIComponent(((createOpts as RequestInit).body as string).replace(/\+/g, " "));
    expect(body).toContain("stats count by host");
  });

  it("aggregate handles empty results", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ sid: "emptyAgg" }), { status: 200 })))
      .mockImplementationOnce(() =>
        Promise.resolve(new Response(JSON.stringify({ entry: [{ content: { isDone: true } }] }), { status: 200 })),
      )
      .mockImplementationOnce(() => Promise.resolve(new Response(JSON.stringify({ results: [] }), { status: 200 })));

    const results = await makeSplunk().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });
});
