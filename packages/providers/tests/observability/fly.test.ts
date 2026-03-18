import { describe, it, expect, vi, afterEach } from "vitest";
import { fly, flyConfigSchema } from "../../src/observability/fly.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return fly({ token: "fly-token", appName: "test-app", logger: silentLogger });
}

function makeFlyLog(level: string, message: string, region = "iad", ts?: string) {
  return JSON.stringify({
    level,
    message,
    timestamp: ts ?? new Date().toISOString(),
    meta: { region, app: "test-app" },
  });
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("flyConfigSchema", () => {
  it("validates a complete config", () => {
    const result = flyConfigSchema.safeParse({ token: "tok", appName: "my-app" });
    expect(result.success).toBe(true);
  });

  it("rejects missing token", () => {
    const result = flyConfigSchema.safeParse({ appName: "my-app" });
    expect(result.success).toBe(false);
  });

  it("rejects empty token", () => {
    const result = flyConfigSchema.safeParse({ token: "", appName: "my-app" });
    expect(result.success).toBe(false);
  });

  it("rejects missing appName", () => {
    const result = flyConfigSchema.safeParse({ token: "tok" });
    expect(result.success).toBe(false);
  });

  it("rejects empty appName", () => {
    const result = flyConfigSchema.safeParse({ token: "tok", appName: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("fly factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => fly({ token: "", appName: "test" } as never)).toThrow();
  });

  it("getAgentEnv returns FLY_TOKEN and FLY_APP_NAME", () => {
    const provider = fly({ token: "my-token", appName: "my-app", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      FLY_TOKEN: "my-token",
      FLY_APP_NAME: "my-app",
    });
  });

  it("getPromptInstructions contains Fly, FLY_TOKEN, curl, and configured appName", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("Fly");
    expect(instructions).toContain("FLY_TOKEN");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("test-app"); // configured appName
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("FlyProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  // verifyAccess
  it("verifyAccess resolves on 200 and hits /v1/apps/{appName}", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "app1", name: "test-app", status: "running" }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/v1/apps/test-app");
  });

  it("verifyAccess throws ProviderApiError on 404", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 404,
      statusText: "Not Found",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Fly API error: 404 Not Found");
  });

  // queryLogs
  it("queryLogs correctly parses NDJSON and maps levels", async () => {
    const ndjson = [
      makeFlyLog("info", "App started"),
      makeFlyLog("error", "Connection failed"),
      "", // empty line — should be filtered
    ].join("\n");

    const mockFetch = vi.fn().mockImplementation(async (url) => {
      const urlStr = url.toString();
      if (urlStr.includes("/logs")) {
        return { ok: true, text: async () => ndjson };
      }
      return { ok: true, json: async () => ({ id: "app1" }) };
    });
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs.length).toBe(2);
    expect(logs.some((l) => l.level === "info" && l.message === "App started")).toBe(true);
    expect(logs.some((l) => l.level === "error" && l.message === "Connection failed")).toBe(true);
  });

  it("queryLogs filters by severity: 'error' keeps only error+fatal entries", async () => {
    const ndjson = [
      makeFlyLog("info", "App started"),
      makeFlyLog("error", "Connection failed"),
      makeFlyLog("fatal", "Out of memory"),
      makeFlyLog("warn", "Slow query"),
    ].join("\n");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs.every((l) => l.level === "error")).toBe(true);
    expect(logs.some((l) => l.message === "Connection failed")).toBe(true);
    expect(logs.some((l) => l.message === "Out of memory")).toBe(true);
    expect(logs.some((l) => l.message === "App started")).toBe(false);
  });

  it("queryLogs filters by region when serviceFilter is not '*'", async () => {
    const ndjson = [makeFlyLog("info", "iad log", "iad"), makeFlyLog("info", "lhr log", "lhr")].join("\n");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "lhr", severity: "*" });

    expect(logs.every((l) => l.service === "lhr")).toBe(true);
    expect(logs.some((l) => l.service === "iad")).toBe(false);
  });

  it("queryLogs filters by severity: 'warning' keeps only warn/warning entries", async () => {
    const ndjson = [
      makeFlyLog("info", "App started"),
      makeFlyLog("warn", "High memory usage"),
      makeFlyLog("warning", "Slow response time"),
      makeFlyLog("error", "Connection failed"),
    ].join("\n");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warning" });

    expect(logs.every((l) => l.level === "warning")).toBe(true);
    expect(logs.some((l) => l.message === "High memory usage")).toBe(true);
    expect(logs.some((l) => l.message === "Slow response time")).toBe(true);
    expect(logs.some((l) => l.message === "App started")).toBe(false);
    expect(logs.some((l) => l.message === "Connection failed")).toBe(false);
  });

  it("queryLogs returns empty on empty NDJSON response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => "",
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs).toEqual([]);
  });

  it("queryLogs gracefully skips malformed JSON lines", async () => {
    const ndjson = [makeFlyLog("info", "good line"), "not-valid-json", makeFlyLog("error", "another good line")].join(
      "\n",
    );

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs.length).toBe(2);
  });

  // aggregate
  it("aggregate groups error+fatal by region", async () => {
    const ndjson = [
      makeFlyLog("error", "err1", "iad"),
      makeFlyLog("fatal", "fatal1", "iad"),
      makeFlyLog("error", "err2", "lhr"),
      makeFlyLog("info", "info1", "iad"),
    ].join("\n");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "iad" && r.count === 2)).toBe(true);
    expect(results.some((r) => r.service === "lhr" && r.count === 1)).toBe(true);
  });

  it("aggregate respects serviceFilter and only includes matching region", async () => {
    const ndjson = [makeFlyLog("error", "iad error", "iad"), makeFlyLog("error", "lhr error", "lhr")].join("\n");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "iad" });

    expect(results.some((r) => r.service === "iad")).toBe(true);
    expect(results.some((r) => r.service === "lhr")).toBe(false);
  });

  it("aggregate returns empty when no error+fatal logs", async () => {
    const ndjson = [makeFlyLog("info", "all good"), makeFlyLog("debug", "details")].join("\n");

    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: true,
      text: async () => ndjson,
    }));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  // error handling
  it("queryLogs throws ProviderApiError on non-ok response", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" })).rejects.toThrow(
      "Fly API error: 401 Unauthorized",
    );
  });
});
