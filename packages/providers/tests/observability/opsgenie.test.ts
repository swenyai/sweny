import { describe, it, expect, vi, afterEach } from "vitest";
import { opsgenie, opsgenieConfigSchema } from "../../src/observability/opsgenie.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return opsgenie({ apiKey: "test-api-key", logger: silentLogger });
}

function makeAlert(priority: string, message: string, teamName?: string, ts = new Date().toISOString()): object {
  return {
    id: `alert-${Math.random().toString(36).slice(2)}`,
    message,
    status: "open",
    acknowledged: false,
    source: "test",
    createdAt: ts,
    priority,
    teams: teamName ? [{ name: teamName, id: "team-id" }] : [],
    tags: [],
  };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("opsgenieConfigSchema", () => {
  it("validates a minimal config with just apiKey", () => {
    const result = opsgenieConfigSchema.safeParse({ apiKey: "key123" });
    expect(result.success).toBe(true);
  });

  it("validates a full config with region", () => {
    const result = opsgenieConfigSchema.safeParse({ apiKey: "key123", region: "eu" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = opsgenieConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = opsgenieConfigSchema.safeParse({ apiKey: "" });
    expect(result.success).toBe(false);
  });

  it("rejects invalid region", () => {
    const result = opsgenieConfigSchema.safeParse({ apiKey: "key", region: "ap" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("opsgenie factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => opsgenie({ apiKey: "" } as never)).toThrow();
  });

  it("getAgentEnv returns OPSGENIE_API_KEY", () => {
    const provider = opsgenie({ apiKey: "my-key", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({ OPSGENIE_API_KEY: "my-key" });
  });

  it("getPromptInstructions contains OpsGenie, OPSGENIE_API_KEY, and curl", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("OpsGenie");
    expect(instructions).toContain("OPSGENIE_API_KEY");
    expect(instructions).toContain("curl");
  });

  it("getPromptInstructions uses EU base URL when region is eu", () => {
    const provider = opsgenie({ apiKey: "key", region: "eu", logger: silentLogger });
    expect(provider.getPromptInstructions()).toContain("api.eu.opsgenie.com");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("OpsGenieProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves on 200 and hits /v2/users", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [], totalCount: 0 }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v2/users");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("OpsGenie API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs maps alerts to LogEntry with priority→level conversion", async () => {
    const alerts = [
      makeAlert("P1", "Critical: database down", "backend"),
      makeAlert("P2", "Error: payment failed", "payments"),
      makeAlert("P3", "Warning: slow response", "api"),
      makeAlert("P5", "Info: deployment started", "infra"),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: alerts }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs).toHaveLength(4);
    expect(logs.find((l) => l.message === "Critical: database down")?.level).toBe("fatal");
    expect(logs.find((l) => l.message === "Error: payment failed")?.level).toBe("error");
    expect(logs.find((l) => l.message === "Warning: slow response")?.level).toBe("warning");
    expect(logs.find((l) => l.message === "Info: deployment started")?.level).toBe("info");
  });

  it("queryLogs sets service to team name when available", async () => {
    const alert = makeAlert("P2", "Error: timeout", "backend-team");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [alert] }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("backend-team");
  });

  it("queryLogs sets service to source when no team", async () => {
    const alert = { ...makeAlert("P2", "Error: network"), teams: [] };

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [alert] }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("test"); // source = "test" in makeAlert
  });

  it("queryLogs filters by severity 'error' keeps only error-level entries", async () => {
    const alerts = [
      makeAlert("P1", "Critical outage"),
      makeAlert("P2", "Error occurred"),
      makeAlert("P3", "Slow query"),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: alerts }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs.every((l) => l.level === "error")).toBe(true);
    expect(logs.some((l) => l.message === "Error occurred")).toBe(true);
    expect(logs.some((l) => l.message === "Critical outage")).toBe(false);
  });

  it("queryLogs filters by severity 'warning' keeps only warning-level entries", async () => {
    const alerts = [
      makeAlert("P1", "Critical"),
      makeAlert("P3", "Warning: high CPU"),
      makeAlert("P4", "Warning: elevated errors"),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: alerts }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warning" });

    expect(logs.every((l) => l.level === "warning")).toBe(true);
    expect(logs.some((l) => l.message === "Warning: high CPU")).toBe(true);
    expect(logs.some((l) => l.message === "Critical")).toBe(false);
  });

  it("queryLogs includes serviceFilter in the query string when not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "backend", severity: "*" });

    const [url] = mockFetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain("backend");
  });

  it("queryLogs returns empty array when no alerts", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: [] }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs).toEqual([]);
  });

  // aggregate
  it("aggregate groups P1+P2 alerts by service and returns counts", async () => {
    const alerts = [
      makeAlert("P1", "Critical db", "backend"),
      makeAlert("P2", "Error in api", "backend"),
      makeAlert("P2", "Payment error", "payments"),
      makeAlert("P3", "Slow query", "backend"),
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: alerts }),
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "backend" && r.count === 2)).toBe(true);
    expect(results.some((r) => r.service === "payments" && r.count === 1)).toBe(true);
  });

  it("aggregate returns empty when no P1/P2 alerts", async () => {
    const alerts = [makeAlert("P3", "Slow query"), makeAlert("P4", "Elevated latency")];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ data: alerts }),
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  // error handling
  it("queryLogs throws ProviderApiError on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" })).rejects.toThrow(
      "OpsGenie API error: 403 Forbidden",
    );
  });
});
