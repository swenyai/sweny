import { describe, it, expect, vi, afterEach } from "vitest";
import { pagerduty, pagerdutyConfigSchema } from "../../src/observability/pagerduty.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return pagerduty({ apiKey: "test-api-key", logger: silentLogger });
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("pagerdutyConfigSchema", () => {
  it("validates a complete config", () => {
    const result = pagerdutyConfigSchema.safeParse({ apiKey: "key123" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = pagerdutyConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = pagerdutyConfigSchema.safeParse({ apiKey: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("pagerduty factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => pagerduty({ apiKey: "" } as any)).toThrow();
  });

  it("getAgentEnv returns PAGERDUTY_API_KEY", () => {
    const provider = pagerduty({ apiKey: "my-pd-key", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({ PAGERDUTY_API_KEY: "my-pd-key" });
  });

  it("getPromptInstructions returns a non-empty string containing 'PagerDuty'", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain("PagerDuty");
    expect(instructions).toContain("PAGERDUTY_API_KEY");
    expect(instructions).toContain("curl");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("PagerDutyProvider", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // verifyAccess
  it("verifyAccess resolves when fetch returns 200", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ user: { id: "U123", name: "Test User" } }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/users/me");
    expect(url).toContain("api.pagerduty.com");
  });

  it("verifyAccess throws ProviderApiError when fetch returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("PagerDuty API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs maps incidents to LogEntry array correctly", async () => {
    const incidents = [
      {
        id: "INC001",
        title: "Database is down",
        status: "triggered",
        urgency: "high",
        created_at: "2026-03-08T10:00:00Z",
        html_url: "https://example.pagerduty.com/incidents/INC001",
        service: { summary: "database-service" },
      },
      {
        id: "INC002",
        title: "Slow API responses",
        status: "acknowledged",
        urgency: "low",
        created_at: "2026-03-08T09:00:00Z",
        html_url: "https://example.pagerduty.com/incidents/INC002",
        service: { summary: "api-service" },
      },
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents }),
    }));

    const logs = await makeProvider().queryLogs({
      timeRange: "24h",
      serviceFilter: "*",
      severity: "warning",
    });

    expect(logs).toHaveLength(2);

    expect(logs[0]).toEqual({
      timestamp: "2026-03-08T10:00:00Z",
      service: "database-service",
      level: "error",
      message: "Database is down",
      attributes: {
        id: "INC001",
        status: "triggered",
        html_url: "https://example.pagerduty.com/incidents/INC001",
        urgency: "high",
      },
    });

    expect(logs[1]).toEqual({
      timestamp: "2026-03-08T09:00:00Z",
      service: "api-service",
      level: "warning",
      message: "Slow API responses",
      attributes: {
        id: "INC002",
        status: "acknowledged",
        html_url: "https://example.pagerduty.com/incidents/INC002",
        urgency: "low",
      },
    });
  });

  it("queryLogs filters by urgency=high when severity is 'error'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [url] = mockFetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain("urgency=high");
  });

  it("queryLogs filters by urgency=high when severity is 'critical'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "critical" });

    const [url] = mockFetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain("urgency=high");
  });

  it("queryLogs does not filter urgency when severity is 'warning'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warning" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain("urgency=high");
  });

  it("queryLogs adds service_names filter when serviceFilter is not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "my-service", severity: "warning" });

    const [url] = mockFetch.mock.calls[0];
    expect(decodeURIComponent(url)).toContain("service_names[]=my-service");
  });

  it("queryLogs does not add service_names when serviceFilter is '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warning" });

    const [url] = mockFetch.mock.calls[0];
    expect(url).not.toContain("service_names");
  });

  it("queryLogs uses 'unknown' service when incident has no service", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({
        incidents: [
          {
            id: "INC999",
            title: "Unknown service issue",
            status: "triggered",
            urgency: "high",
            created_at: "2026-03-08T10:00:00Z",
            html_url: "https://example.pagerduty.com/incidents/INC999",
          },
        ],
      }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs[0].service).toBe("unknown");
  });

  // aggregate
  it("aggregate groups incidents by service and returns counts", async () => {
    const incidents = [
      { id: "1", title: "A", status: "triggered", urgency: "high", created_at: "2026-03-08T10:00:00Z", html_url: "", service: { summary: "api" } },
      { id: "2", title: "B", status: "triggered", urgency: "low", created_at: "2026-03-08T09:00:00Z", html_url: "", service: { summary: "api" } },
      { id: "3", title: "C", status: "acknowledged", urgency: "high", created_at: "2026-03-08T08:00:00Z", html_url: "", service: { summary: "database" } },
    ];

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ incidents }),
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results).toHaveLength(2);
    const apiResult = results.find((r) => r.service === "api");
    const dbResult = results.find((r) => r.service === "database");
    expect(apiResult?.count).toBe(2);
    expect(dbResult?.count).toBe(1);
  });

  // Error handling
  it("queryLogs throws ProviderApiError on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(
      makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" }),
    ).rejects.toThrow("PagerDuty API error: 403 Forbidden");
  });
});
