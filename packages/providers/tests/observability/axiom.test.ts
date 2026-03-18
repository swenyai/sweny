import { describe, it, expect, vi, afterEach } from "vitest";
import { axiom, axiomConfigSchema } from "../../src/observability/axiom.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider(orgId?: string) {
  return axiom({ apiToken: "axiom-test-token", dataset: "production", logger: silentLogger, orgId });
}

function makeMatch(
  level: string,
  message: string,
  service = "api",
  extra?: Record<string, unknown>,
): { _time: string; data: Record<string, unknown> } {
  return {
    _time: new Date().toISOString(),
    data: { level, message, service, ...extra },
  };
}

/** Mock fetch: POST to /_apl returns matches; GET to /v1/datasets returns dataset list. */
function mockAxiom(matches: object[]) {
  vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("/_apl")) {
      return { ok: true, json: async () => ({ matches }) } as never;
    }
    // verifyAccess → GET /v1/datasets
    return { ok: true, json: async () => [{ name: "production" }] } as never;
  });
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("axiomConfigSchema", () => {
  it("validates a complete config", () => {
    const result = axiomConfigSchema.safeParse({ apiToken: "axiom-tok", dataset: "production" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiToken", () => {
    const result = axiomConfigSchema.safeParse({ dataset: "production" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiToken", () => {
    const result = axiomConfigSchema.safeParse({ apiToken: "", dataset: "production" });
    expect(result.success).toBe(false);
  });

  it("rejects missing dataset", () => {
    const result = axiomConfigSchema.safeParse({ apiToken: "axiom-tok" });
    expect(result.success).toBe(false);
  });

  it("rejects empty dataset", () => {
    const result = axiomConfigSchema.safeParse({ apiToken: "axiom-tok", dataset: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("axiom factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => axiom({ apiToken: "", dataset: "prod" } as never)).toThrow();
  });

  it("getAgentEnv returns AXIOM_TOKEN and AXIOM_DATASET", () => {
    const provider = axiom({ apiToken: "my-token", dataset: "my-dataset", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      AXIOM_TOKEN: "my-token",
      AXIOM_DATASET: "my-dataset",
    });
  });

  it("getAgentEnv includes AXIOM_ORG_ID when orgId provided", () => {
    const provider = axiom({ apiToken: "my-token", dataset: "my-dataset", orgId: "my-org", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      AXIOM_TOKEN: "my-token",
      AXIOM_DATASET: "my-dataset",
      AXIOM_ORG_ID: "my-org",
    });
  });

  it("getPromptInstructions contains Axiom, AXIOM_TOKEN, curl, and configured dataset", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("Axiom");
    expect(instructions).toContain("AXIOM_TOKEN");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("production");
  });

  it("getPromptInstructions includes AXIOM_ORG_ID note when orgId is set", () => {
    const instructions = makeProvider("my-org").getPromptInstructions();
    expect(instructions).toContain("AXIOM_ORG_ID");
    expect(instructions).toContain("my-org");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("AxiomProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves on 200 and hits /v1/datasets", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => [{ name: "production" }],
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(String(url)).toContain("/v1/datasets");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Axiom API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs maps matches to LogEntry array", async () => {
    mockAxiom([makeMatch("error", "DB timeout", "api"), makeMatch("info", "Request handled", "api")]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ level: "error", message: "DB timeout", service: "api" });
    expect(logs[1]).toMatchObject({ level: "info", message: "Request handled", service: "api" });
  });

  it("queryLogs uses service field for service name", async () => {
    mockAxiom([makeMatch("info", "Hello", "payments-service")]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("payments-service");
  });

  it("queryLogs falls back to service.name when service field absent", async () => {
    mockAxiom([
      { _time: new Date().toISOString(), data: { level: "info", message: "test", "service.name": "my-svc" } },
    ]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("my-svc");
  });

  it("queryLogs falls back to 'unknown' when no service fields present", async () => {
    mockAxiom([{ _time: new Date().toISOString(), data: { level: "info", message: "test" } }]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs[0].service).toBe("unknown");
  });

  it("queryLogs sends severity filter in APL when severity is not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ matches: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.apl).toContain('| where level == "error"');
  });

  it("queryLogs sends serviceFilter in APL when serviceFilter is not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ matches: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "backend", severity: "*" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.apl).toContain('| where service == "backend"');
  });

  it("queryLogs returns empty array when no matches", async () => {
    mockAxiom([]);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs).toEqual([]);
  });

  it("queryLogs sends correct startTime and endTime for 1h range", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ matches: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const before = Date.now();
    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    const after = Date.now();

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);

    const startMs = new Date(body.startTime).getTime();
    const endMs = new Date(body.endTime).getTime();
    expect(endMs - startMs).toBeCloseTo(3600 * 1000, -3); // within 1s
    expect(endMs).toBeGreaterThanOrEqual(before);
    expect(endMs).toBeLessThanOrEqual(after + 100);
  });

  it("queryLogs sends X-Axiom-Org-Id header when orgId is configured", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ matches: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider("my-org").queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    const [, opts] = mockFetch.mock.calls[0];
    expect((opts as RequestInit).headers as Record<string, string>).toMatchObject({
      "X-Axiom-Org-Id": "my-org",
    });
  });

  // aggregate
  it("aggregate sends summarize APL and returns AggregateResult[]", async () => {
    mockAxiom([
      { _time: new Date().toISOString(), data: { service: "api", _count: 5 } },
      { _time: new Date().toISOString(), data: { service: "worker", _count: 2 } },
    ]);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "api" && r.count === 5)).toBe(true);
    expect(results.some((r) => r.service === "worker" && r.count === 2)).toBe(true);
  });

  it("aggregate filters out rows with count 0", async () => {
    mockAxiom([
      { _time: new Date().toISOString(), data: { service: "api", _count: 0 } },
      { _time: new Date().toISOString(), data: { service: "worker", _count: 3 } },
    ]);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "api")).toBe(false);
    expect(results.some((r) => r.service === "worker" && r.count === 3)).toBe(true);
  });

  it("aggregate sends serviceFilter in APL when not '*'", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ matches: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "api" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.apl).toContain('| where service == "api"');
  });

  it("aggregate APL includes summarize count() by service", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ matches: [] }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    const [, opts] = mockFetch.mock.calls[0];
    const body = JSON.parse((opts as RequestInit).body as string);
    expect(body.apl).toContain("summarize count() by service");
  });

  it("aggregate returns empty when no matches", async () => {
    mockAxiom([]);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  // error handling
  it("queryLogs throws ProviderApiError when APL query returns non-ok", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" })).rejects.toThrow(
      "Axiom API error: 403 Forbidden",
    );
  });
});
