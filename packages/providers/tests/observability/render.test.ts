import { describe, it, expect, vi, afterEach } from "vitest";
import { render, renderConfigSchema } from "../../src/observability/render.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return render({ apiKey: "render-api-key", serviceId: "srv-abc", logger: silentLogger });
}

function makeFakeLog(message: string, ts = "2026-03-18T10:00:00.000Z") {
  return {
    id: "log1",
    timestamp: ts,
    message,
    instance: { id: "inst1", serviceId: "srv-abc", instanceType: "standard" },
  };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("renderConfigSchema", () => {
  it("validates a complete config", () => {
    const result = renderConfigSchema.safeParse({ apiKey: "key", serviceId: "srv-abc" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = renderConfigSchema.safeParse({ serviceId: "srv-abc" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = renderConfigSchema.safeParse({ apiKey: "", serviceId: "srv-abc" });
    expect(result.success).toBe(false);
  });

  it("rejects missing serviceId", () => {
    const result = renderConfigSchema.safeParse({ apiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty serviceId", () => {
    const result = renderConfigSchema.safeParse({ apiKey: "key", serviceId: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("render factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => render({ apiKey: "", serviceId: "srv-abc" } as never)).toThrow();
  });

  it("getAgentEnv returns RENDER_API_KEY and RENDER_SERVICE_ID", () => {
    const provider = render({ apiKey: "my-key", serviceId: "srv-xyz", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      RENDER_API_KEY: "my-key",
      RENDER_SERVICE_ID: "srv-xyz",
    });
  });

  it("getPromptInstructions contains Render, RENDER_API_KEY, and curl", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("Render");
    expect(instructions).toContain("RENDER_API_KEY");
    expect(instructions).toContain("curl");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("RenderProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves on 200 and URL contains the service ID", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "srv-abc", name: "my-service" }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("srv-abc");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Render API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs maps log objects to LogEntry and infers level from message", async () => {
    const logs = [
      makeFakeLog("ERROR: database connection failed", "2026-03-18T10:00:01.000Z"),
      makeFakeLog("Listening on port 10000", "2026-03-18T10:00:00.000Z"),
    ];
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ logs }),
    }));

    const result = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(result).toHaveLength(2);
    expect(result[0]).toMatchObject({
      timestamp: "2026-03-18T10:00:01.000Z",
      service: "srv-abc",
      level: "error",
      message: "ERROR: database connection failed",
      attributes: { instanceId: "inst1" },
    });
    expect(result[1]).toMatchObject({
      level: "info",
      message: "Listening on port 10000",
    });
  });

  it("queryLogs post-filters by severity 'error' to keep only error-level entries", async () => {
    const logs = [
      makeFakeLog("ERROR: something broke", "2026-03-18T10:00:02.000Z"),
      makeFakeLog("WARNING: slow response", "2026-03-18T10:00:01.000Z"),
      makeFakeLog("All systems nominal", "2026-03-18T10:00:00.000Z"),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ logs }),
    }));

    const result = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(result.every((l) => l.level === "error")).toBe(true);
    expect(result.some((l) => l.message.includes("ERROR"))).toBe(true);
    expect(result.some((l) => l.message.includes("WARNING"))).toBe(false);
  });

  it("queryLogs includes startTime in the request URL", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ logs: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("startTime=");
  });

  it("queryLogs returns empty when logs array is empty", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ logs: [] }),
    }));

    const result = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(result).toEqual([]);
  });

  // aggregate
  it("aggregate returns count of error entries as a single AggregateResult", async () => {
    const logs = [makeFakeLog("ERROR: timeout"), makeFakeLog("ERROR: not found"), makeFakeLog("Starting service")];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ logs }),
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ service: "srv-abc", count: 2 });
  });

  it("aggregate returns empty when no errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ logs: [makeFakeLog("All good")] }),
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  it("queryLogs throws ProviderApiError on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" })).rejects.toThrow(
      "Render API error: 403 Forbidden",
    );
  });
});
