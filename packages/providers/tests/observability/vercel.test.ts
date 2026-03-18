import { describe, it, expect, vi, afterEach } from "vitest";
import { vercel, vercelConfigSchema } from "../../src/observability/vercel.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return vercel({ token: "test-token", projectId: "prj_test123", logger: silentLogger });
}

const fakeDeployments = {
  deployments: [
    { uid: "dpl_abc", name: "my-project", readyState: "READY" },
    { uid: "dpl_def", name: "my-project", readyState: "READY" },
  ],
};

const fakeEvents = [
  { type: "stdout", created: 1700000001000, payload: { text: "Server started" } },
  { type: "stderr", created: 1700000002000, payload: { text: "TypeError: Cannot read property" } },
  { type: "command", created: 1700000000000, payload: { text: "node server.js" } },
  { type: "exit", created: 1700000003000, payload: {} },
];

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("vercelConfigSchema", () => {
  it("validates a complete config", () => {
    const result = vercelConfigSchema.safeParse({ token: "tok", projectId: "prj_123" });
    expect(result.success).toBe(true);
  });

  it("accepts optional teamId", () => {
    const result = vercelConfigSchema.safeParse({ token: "tok", projectId: "prj_123", teamId: "team_abc" });
    expect(result.success).toBe(true);
  });

  it("rejects missing token", () => {
    const result = vercelConfigSchema.safeParse({ projectId: "prj_123" });
    expect(result.success).toBe(false);
  });

  it("rejects empty token", () => {
    const result = vercelConfigSchema.safeParse({ token: "", projectId: "prj_123" });
    expect(result.success).toBe(false);
  });

  it("rejects missing projectId", () => {
    const result = vercelConfigSchema.safeParse({ token: "tok" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("vercel factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => vercel({ token: "", projectId: "prj_123" } as any)).toThrow();
  });

  it("getAgentEnv returns VERCEL_TOKEN and VERCEL_PROJECT_ID", () => {
    const provider = vercel({ token: "my-token", projectId: "prj_abc", logger: silentLogger });
    const env = provider.getAgentEnv();
    expect(env.VERCEL_TOKEN).toBe("my-token");
    expect(env.VERCEL_PROJECT_ID).toBe("prj_abc");
    expect(env.VERCEL_TEAM_ID).toBeUndefined();
  });

  it("getAgentEnv includes VERCEL_TEAM_ID when set", () => {
    const provider = vercel({ token: "t", projectId: "p", teamId: "team_x", logger: silentLogger });
    expect(provider.getAgentEnv().VERCEL_TEAM_ID).toBe("team_x");
  });

  it("getPromptInstructions returns a non-empty string containing 'Vercel'", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(typeof instructions).toBe("string");
    expect(instructions.length).toBeGreaterThan(0);
    expect(instructions).toContain("Vercel");
    expect(instructions).toContain("VERCEL_TOKEN");
    expect(instructions).toContain("curl");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("VercelProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves when fetch returns 200", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "prj_test123", name: "my-project" }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v9/projects/prj_test123");
    expect(url).toContain("api.vercel.com");
  });

  it("verifyAccess throws ProviderApiError when fetch returns 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Vercel API error: 401 Unauthorized");
  });

  it("verifyAccess includes teamId in URL when set", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({}),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const provider = vercel({ token: "t", projectId: "prj_x", teamId: "team_y", logger: silentLogger });
    await provider.verifyAccess();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("teamId=team_y");
  });

  // queryLogs
  it("queryLogs maps stdout/stderr events to LogEntry array", async () => {
    let callCount = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      callCount++;
      const urlStr = url.toString();
      if (urlStr.includes("/v6/deployments")) {
        return { ok: true, json: async () => fakeDeployments };
      }
      // deployment events — return fakeEvents for first deployment, empty for second
      if (urlStr.includes("dpl_abc")) {
        return { ok: true, json: async () => fakeEvents };
      }
      return { ok: true, json: async () => [] };
    });

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "info" });

    // Should include stdout and stderr, exclude command/exit
    const types = logs.map((l) => l.level);
    expect(types).toContain("error");
    expect(types).toContain("info");

    const errorLog = logs.find((l) => l.level === "error");
    expect(errorLog?.message).toBe("TypeError: Cannot read property");
    expect(errorLog?.service).toBe("my-project");
    expect(errorLog?.attributes.eventType).toBe("stderr");
  });

  it("queryLogs filters to stderr only when severity is 'error'", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v6/deployments")) {
        return { ok: true, json: async () => ({ deployments: [{ uid: "dpl_1", name: "app", readyState: "READY" }] }) };
      }
      return { ok: true, json: async () => fakeEvents };
    });

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs.every((l) => l.level === "error")).toBe(true);
    expect(logs.some((l) => l.level === "info")).toBe(false);
  });

  it("queryLogs filters deployments by serviceFilter", async () => {
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v6/deployments")) {
        return {
          ok: true,
          json: async () => ({
            deployments: [
              { uid: "dpl_1", name: "matching-service", readyState: "READY" },
              { uid: "dpl_2", name: "other-service", readyState: "READY" },
            ],
          }),
        };
      }
      return { ok: true, json: async () => [{ type: "stdout", created: Date.now(), payload: { text: "ok" } }] };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "matching", severity: "info" });

    // Events should only be fetched for the matching deployment
    const eventCalls = mockFetch.mock.calls.filter(([url]) => url.includes("/v3/deployments/"));
    expect(eventCalls.length).toBe(1);
    expect(eventCalls[0][0]).toContain("dpl_1");
  });

  it("queryLogs returns empty array when no deployments", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => ({ deployments: [] }),
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });
    expect(logs).toEqual([]);
  });

  it("queryLogs throws ProviderApiError on non-ok deployments response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" })).rejects.toThrow(
      "Vercel API error: 403 Forbidden",
    );
  });

  // aggregate
  it("aggregate groups stderr events by project name", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v6/deployments")) {
        return {
          ok: true,
          json: async () => ({
            deployments: [
              { uid: "dpl_1", name: "api", readyState: "READY" },
              { uid: "dpl_2", name: "frontend", readyState: "READY" },
            ],
          }),
        };
      }
      if (urlStr.includes("dpl_1")) {
        return {
          ok: true,
          json: async () => [
            { type: "stderr", created: Date.now(), payload: { text: "error 1" } },
            { type: "stderr", created: Date.now(), payload: { text: "error 2" } },
            { type: "stdout", created: Date.now(), payload: { text: "info" } },
          ],
        };
      }
      // frontend has no errors
      return { ok: true, json: async () => [{ type: "stdout", created: Date.now(), payload: { text: "ok" } }] };
    });

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results).toHaveLength(1);
    expect(results[0].service).toBe("api");
    expect(results[0].count).toBe(2);
  });

  it("aggregate returns empty array when no errors", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/v6/deployments")) {
        return { ok: true, json: async () => ({ deployments: [{ uid: "dpl_1", name: "app", readyState: "READY" }] }) };
      }
      return { ok: true, json: async () => [{ type: "stdout", created: Date.now(), payload: { text: "all good" } }] };
    });

    const results = await makeProvider().aggregate({ timeRange: "1h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });
});
