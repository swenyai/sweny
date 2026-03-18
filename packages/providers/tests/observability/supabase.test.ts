import { describe, it, expect, vi, afterEach } from "vitest";
import { supabase, supabaseConfigSchema } from "../../src/observability/supabase.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return supabase({ managementApiKey: "test-key", projectRef: "abcdefgh", logger: silentLogger });
}

function makeLogRow(msg: string, ts = "2026-03-18T10:00:00.000Z") {
  return { timestamp: ts, event_message: msg, metadata: { extra: "data" } };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("supabaseConfigSchema", () => {
  it("validates a complete config", () => {
    const result = supabaseConfigSchema.safeParse({ managementApiKey: "key", projectRef: "ref123" });
    expect(result.success).toBe(true);
  });

  it("rejects missing managementApiKey", () => {
    const result = supabaseConfigSchema.safeParse({ projectRef: "ref" });
    expect(result.success).toBe(false);
  });

  it("rejects empty managementApiKey", () => {
    const result = supabaseConfigSchema.safeParse({ managementApiKey: "", projectRef: "ref" });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectRef", () => {
    const result = supabaseConfigSchema.safeParse({ managementApiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty projectRef", () => {
    const result = supabaseConfigSchema.safeParse({ managementApiKey: "key", projectRef: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("supabase factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => supabase({ managementApiKey: "", projectRef: "ref" } as any)).toThrow();
  });

  it("getAgentEnv returns SUPABASE_MANAGEMENT_KEY and SUPABASE_PROJECT_REF", () => {
    const provider = supabase({ managementApiKey: "my-key", projectRef: "my-ref", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      SUPABASE_MANAGEMENT_KEY: "my-key",
      SUPABASE_PROJECT_REF: "my-ref",
    });
  });

  it("getPromptInstructions returns a non-empty string containing 'Supabase'", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain("Supabase");
    expect(instructions).toContain("SUPABASE_MANAGEMENT_KEY");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("postgres_logs");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("SupabaseProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves when fetch returns 200", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "abcdefgh", name: "my-project" }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/projects/abcdefgh");
    expect(url).toContain("api.supabase.com");
  });

  it("verifyAccess throws ProviderApiError when fetch returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Supabase API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs queries all 4 tables when serviceFilter is '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v1/projects/abcdefgh") && !urlStr.includes("analytics")) {
        return { ok: true, json: async () => ({}) };
      }
      return { ok: true, json: async () => ({ result: [] }) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "info" });

    const logCalls = mockFetch.mock.calls.filter(([url]) => url.includes("analytics"));
    expect(logCalls.length).toBe(4);

    const bodies = logCalls.map(([, opts]) => JSON.parse(opts.body).sql as string);
    expect(bodies.some((s) => s.includes("postgres_logs"))).toBe(true);
    expect(bodies.some((s) => s.includes("edge_logs"))).toBe(true);
    expect(bodies.some((s) => s.includes("api_logs"))).toBe(true);
    expect(bodies.some((s) => s.includes("auth_logs"))).toBe(true);
  });

  it("queryLogs queries only the mapped table when serviceFilter is specific", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ result: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "edge", severity: "info" });

    const logCalls = mockFetch.mock.calls.filter(([url]) => url.includes("analytics"));
    expect(logCalls.length).toBe(1);
    expect(JSON.parse(logCalls[0][1].body).sql).toContain("edge_logs");
  });

  it("queryLogs adds error clause when severity is 'error'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ result: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "postgres", severity: "error" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.sql).toContain("error");
  });

  it("queryLogs maps rows to LogEntry correctly", async () => {
    const rows = [
      makeLogRow("ERROR: connection timeout", "2026-03-18T10:00:01Z"),
      makeLogRow("connection established", "2026-03-18T10:00:00Z"),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ result: rows }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "postgres", severity: "error" });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({
      timestamp: "2026-03-18T10:00:01Z",
      service: "postgres",
      level: "error",
      message: "ERROR: connection timeout",
      attributes: { extra: "data" },
    });
    expect(logs[1]).toMatchObject({
      timestamp: "2026-03-18T10:00:00Z",
      service: "postgres",
      level: "info",
      message: "connection established",
    });
  });

  it("queryLogs infers level from event_message content, not query severity", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        result: [
          makeLogRow("FATAL: too many connections", "2026-03-18T10:00:03Z"),
          makeLogRow("WARNING: slow query detected", "2026-03-18T10:00:02Z"),
          makeLogRow("connection established", "2026-03-18T10:00:01Z"),
        ],
      }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "postgres", severity: "info" });

    expect(logs[0].level).toBe("error");
    expect(logs[1].level).toBe("warning");
    expect(logs[2].level).toBe("info");
  });

  it("queryLogs returns empty array when all tables return no results", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ result: [] }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });
    expect(logs).toEqual([]);
  });

  it("queryLogs throws ProviderApiError on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(
      makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "postgres", severity: "error" }),
    ).rejects.toThrow("Supabase API error: 403 Forbidden");
  });

  // aggregate
  it("aggregate queries all tables with error severity and returns counts", async () => {
    const mockFetch = vi.fn().mockImplementation(async (_url, opts) => {
      const urlStr = _url.toString();
      if (!urlStr.includes("analytics")) return { ok: true, json: async () => ({}) };
      const body = JSON.parse(opts?.body ?? "{}");
      if (body.sql?.includes("postgres_logs")) {
        return { ok: true, json: async () => ({ result: [makeLogRow("err1"), makeLogRow("err2")] }) };
      }
      if (body.sql?.includes("edge_logs")) {
        return { ok: true, json: async () => ({ result: [makeLogRow("err3")] }) };
      }
      return { ok: true, json: async () => ({ result: [] }) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "postgres" && r.count === 2)).toBe(true);
    expect(results.some((r) => r.service === "edge" && r.count === 1)).toBe(true);
    // tables with no errors should not appear
    expect(results.some((r) => r.service === "api")).toBe(false);
    expect(results.some((r) => r.service === "auth")).toBe(false);
  });

  it("aggregate returns empty array when no errors in any table", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ result: [] }),
    }));

    const results = await makeProvider().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });
});
