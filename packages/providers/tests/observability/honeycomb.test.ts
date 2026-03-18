import { describe, it, expect, vi, afterEach } from "vitest";
import { honeycomb, honeycombConfigSchema } from "../../src/observability/honeycomb.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return honeycomb({ apiKey: "hcaik_test", dataset: "production", logger: silentLogger });
}

function makeRow(level: string, message: string, service = "api", extra?: Record<string, unknown>) {
  return {
    data: {
      timestamp: new Date().toISOString(),
      level,
      message,
      "service.name": service,
      ...extra,
    },
  };
}

// Honeycomb requires 2-step query: POST /1/queries/:dataset → GET /1/query_results/:dataset/:id
function mockHoneycomb(rows: object[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/1/queries/")) {
      return { ok: true, json: async () => ({ id: "q-test-123" }) } as never;
    }
    if (urlStr.includes("/1/query_results/")) {
      return { ok: true, json: async () => ({ complete: true, data: { results: rows } }) } as never;
    }
    // verifyAccess
    return { ok: true, json: async () => ({ team: { slug: "my-team" } }) } as never;
  });
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("honeycombConfigSchema", () => {
  it("validates a complete config", () => {
    const result = honeycombConfigSchema.safeParse({ apiKey: "hcaik_test", dataset: "production" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = honeycombConfigSchema.safeParse({ dataset: "production" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = honeycombConfigSchema.safeParse({ apiKey: "", dataset: "production" });
    expect(result.success).toBe(false);
  });

  it("rejects missing dataset", () => {
    const result = honeycombConfigSchema.safeParse({ apiKey: "hcaik_test" });
    expect(result.success).toBe(false);
  });

  it("rejects empty dataset", () => {
    const result = honeycombConfigSchema.safeParse({ apiKey: "hcaik_test", dataset: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("honeycomb factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => honeycomb({ apiKey: "", dataset: "prod" } as never)).toThrow();
  });

  it("getAgentEnv returns HONEYCOMB_API_KEY and HONEYCOMB_DATASET", () => {
    const provider = honeycomb({ apiKey: "my-key", dataset: "my-dataset", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      HONEYCOMB_API_KEY: "my-key",
      HONEYCOMB_DATASET: "my-dataset",
    });
  });

  it("getPromptInstructions contains Honeycomb, HONEYCOMB_API_KEY, curl, and configured dataset", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("Honeycomb");
    expect(instructions).toContain("HONEYCOMB_API_KEY");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("production");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("HoneycombProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves on 200 and hits /1/auth", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ team: { slug: "my-team" } }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/1/auth");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Honeycomb API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs maps rows to LogEntry array", async () => {
    mockHoneycomb([makeRow("error", "DB timeout", "api"), makeRow("info", "Request handled", "api")]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ level: "error", message: "DB timeout", service: "api" });
    expect(logs[1]).toMatchObject({ level: "info", message: "Request handled", service: "api" });
  });

  it("queryLogs uses service.name field for service", async () => {
    mockHoneycomb([makeRow("info", "Hello", "payments-service")]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("payments-service");
  });

  it("queryLogs falls back to 'unknown' when no service fields present", async () => {
    mockHoneycomb([{ data: { timestamp: new Date().toISOString(), level: "info", message: "test" } }]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("unknown");
  });

  it("queryLogs sends filters when severity is not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/1/queries/")) {
        return { ok: true, json: async () => ({ id: "q-abc" }) } as never;
      }
      return {
        ok: true,
        json: async () => ({ complete: true, data: { results: [] } }),
      } as never;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.filters).toEqual(expect.arrayContaining([{ column: "level", op: "=", value: "error" }]));
  });

  it("queryLogs sends serviceFilter as filter when not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/1/queries/")) {
        return { ok: true, json: async () => ({ id: "q-abc" }) } as never;
      }
      return {
        ok: true,
        json: async () => ({ complete: true, data: { results: [] } }),
      } as never;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "backend", severity: "*" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.filters).toEqual(expect.arrayContaining([{ column: "service.name", op: "=", value: "backend" }]));
  });

  it("queryLogs returns empty array when no results", async () => {
    mockHoneycomb([]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs).toEqual([]);
  });

  it("queryLogs converts time_range correctly (1h = 3600s)", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/1/queries/")) {
        return { ok: true, json: async () => ({ id: "q-abc" }) } as never;
      }
      return {
        ok: true,
        json: async () => ({ complete: true, data: { results: [] } }),
      } as never;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.time_range).toBe(3600);
  });

  // aggregate
  it("aggregate sends COUNT+breakdown query and returns AggregateResult[]", async () => {
    const rows = [{ data: { "service.name": "api", COUNT: 5 } }, { data: { "service.name": "worker", COUNT: 2 } }];
    mockHoneycomb(rows);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "api" && r.count === 5)).toBe(true);
    expect(results.some((r) => r.service === "worker" && r.count === 2)).toBe(true);
  });

  it("aggregate filters out rows with count 0", async () => {
    const rows = [{ data: { "service.name": "api", COUNT: 0 } }, { data: { "service.name": "worker", COUNT: 3 } }];
    mockHoneycomb(rows);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "api")).toBe(false);
    expect(results.some((r) => r.service === "worker" && r.count === 3)).toBe(true);
  });

  it("aggregate sends serviceFilter as filter when not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/1/queries/")) {
        return { ok: true, json: async () => ({ id: "q-abc" }) } as never;
      }
      return {
        ok: true,
        json: async () => ({ complete: true, data: { results: [] } }),
      } as never;
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "api" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.filters).toEqual(expect.arrayContaining([{ column: "service.name", op: "=", value: "api" }]));
  });

  it("aggregate returns empty when no rows", async () => {
    mockHoneycomb([]);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  // error handling
  it("queryLogs throws ProviderApiError when POST query returns non-ok", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" })).rejects.toThrow(
      "Honeycomb API error: 403 Forbidden",
    );
  });
});
