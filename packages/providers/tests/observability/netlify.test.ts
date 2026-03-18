import { describe, it, expect, vi, afterEach } from "vitest";
import { netlify, netlifyConfigSchema } from "../../src/observability/netlify.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return netlify({ token: "test-token", siteId: "abc123de", logger: silentLogger });
}

function makeDeploy(id: string, context = "production", createdAt = new Date().toISOString()) {
  return { id, state: "ready", created_at: createdAt, context, error_message: null, deploy_time: 30 };
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("netlifyConfigSchema", () => {
  it("validates a complete config", () => {
    const result = netlifyConfigSchema.safeParse({ token: "tok", siteId: "site123" });
    expect(result.success).toBe(true);
  });

  it("rejects missing token", () => {
    const result = netlifyConfigSchema.safeParse({ siteId: "site123" });
    expect(result.success).toBe(false);
  });

  it("rejects empty token", () => {
    const result = netlifyConfigSchema.safeParse({ token: "", siteId: "site123" });
    expect(result.success).toBe(false);
  });

  it("rejects missing siteId", () => {
    const result = netlifyConfigSchema.safeParse({ token: "tok" });
    expect(result.success).toBe(false);
  });

  it("rejects empty siteId", () => {
    const result = netlifyConfigSchema.safeParse({ token: "tok", siteId: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("netlify factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => netlify({ token: "", siteId: "site" } as never)).toThrow();
  });

  it("getAgentEnv returns NETLIFY_TOKEN and NETLIFY_SITE_ID", () => {
    const provider = netlify({ token: "my-token", siteId: "my-site", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      NETLIFY_TOKEN: "my-token",
      NETLIFY_SITE_ID: "my-site",
    });
  });

  it("getPromptInstructions contains Netlify, NETLIFY_TOKEN, curl, and configured siteId", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("Netlify");
    expect(instructions).toContain("NETLIFY_TOKEN");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("abc123de"); // configured siteId
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("NetlifyProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves on 200 and hits the /user endpoint", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "user1", email: "test@example.com" }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/v1/user");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Netlify API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs maps deploy log lines to LogEntry with correct timestamp and service", async () => {
    const deploy = makeDeploy("dep1");
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => [deploy] };
      }
      if (urlStr.includes("/deploys/dep1/log")) {
        return { ok: true, json: async () => ({ log: "Build started\nError: build failed\nDone" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs.length).toBe(3);
    expect(logs.some((l) => l.message === "Build started")).toBe(true);
    expect(logs.some((l) => l.message === "Error: build failed" && l.level === "error")).toBe(true);
    expect(logs[0].service).toBe("production");
    expect(logs[0].attributes).toMatchObject({ deployId: "dep1", state: "ready" });
  });

  it("queryLogs filters out non-matching severity lines when severity is 'error'", async () => {
    const deploy = makeDeploy("dep2");
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => [deploy] };
      }
      if (urlStr.includes("/log")) {
        return {
          ok: true,
          json: async () => ({ log: "Starting build\nError: missing file\nWarning: deprecated\nBuild complete" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs.every((l) => l.level === "error")).toBe(true);
    expect(logs.some((l) => l.message.includes("Error: missing file"))).toBe(true);
    expect(logs.some((l) => l.message.includes("Starting build"))).toBe(false);
  });

  it("queryLogs respects serviceFilter by deploy.context", async () => {
    const deploys = [makeDeploy("dep1", "production"), makeDeploy("dep2", "staging")];
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => deploys };
      }
      if (urlStr.includes("/dep1/log")) {
        return { ok: true, json: async () => ({ log: "prod log" }) };
      }
      if (urlStr.includes("/dep2/log")) {
        return { ok: true, json: async () => ({ log: "staging log" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "staging", severity: "*" });

    expect(logs.every((l) => l.service === "staging")).toBe(true);
    expect(logs.some((l) => l.service === "production")).toBe(false);
  });

  it("queryLogs filters to warning-level lines when severity is 'warning'", async () => {
    const deploy = makeDeploy("dep3");
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => [deploy] };
      }
      if (urlStr.includes("/log")) {
        return {
          ok: true,
          json: async () => ({ log: "Warning: high memory usage\nError: disk full\nBuild started" }),
        };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warning" });

    expect(logs.every((l) => l.level === "warning")).toBe(true);
    expect(logs.some((l) => l.message.includes("Warning: high memory usage"))).toBe(true);
    expect(logs.some((l) => l.message.includes("Error: disk full"))).toBe(false);
  });

  it("queryLogs returns empty when no deploys in time range", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      json: async () => [],
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });
    expect(logs).toEqual([]);
  });

  // aggregate
  it("aggregate groups error line counts by context", async () => {
    const deploys = [makeDeploy("dep1", "production"), makeDeploy("dep2", "preview")];
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => deploys };
      }
      if (urlStr.includes("/dep1/log")) {
        return { ok: true, json: async () => ({ log: "Error: one\nError: two\nInfo message" }) };
      }
      if (urlStr.includes("/dep2/log")) {
        return { ok: true, json: async () => ({ log: "Error: three\nAll good" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "production" && r.count === 2)).toBe(true);
    expect(results.some((r) => r.service === "preview" && r.count === 1)).toBe(true);
  });

  it("aggregate respects serviceFilter and only includes matching contexts", async () => {
    const deploys = [makeDeploy("dep1", "production"), makeDeploy("dep2", "staging")];
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => deploys };
      }
      if (urlStr.includes("/dep1/log")) {
        return { ok: true, json: async () => ({ log: "Error: prod error" }) };
      }
      if (urlStr.includes("/dep2/log")) {
        return { ok: true, json: async () => ({ log: "Error: staging error" }) };
      }
      return { ok: true, json: async () => ({}) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "staging" });

    expect(results.some((r) => r.service === "staging")).toBe(true);
    expect(results.some((r) => r.service === "production")).toBe(false);
  });

  it("aggregate returns empty when no errors in any deploy", async () => {
    const deploy = makeDeploy("dep1");
    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/deploys?")) {
        return { ok: true, json: async () => [deploy] };
      }
      return { ok: true, json: async () => ({ log: "Build successful\nDone" }) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

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

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" })).rejects.toThrow(
      "Netlify API error: 403 Forbidden",
    );
  });
});
