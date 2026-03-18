import { describe, it, expect, vi, afterEach } from "vitest";
import { heroku, herokuConfigSchema } from "../../src/observability/heroku.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function makeProvider() {
  return heroku({ apiKey: "heroku-api-key", appName: "my-app", logger: silentLogger });
}

function makeLogLine(level: "info" | "error" | "warning", dyno = "web.1", ts?: string): string {
  const timestamp = ts ?? new Date().toISOString().replace("Z", "+00:00");
  const messages = {
    info: "Listening on port 3000",
    error: "Error: database connection failed",
    warning: "Warning: high memory usage",
  };
  return `${timestamp} app[${dyno}]: ${messages[level]}`;
}

// ---------------------------------------------------------------------------
// Config schema
// ---------------------------------------------------------------------------

describe("herokuConfigSchema", () => {
  it("validates a complete config", () => {
    const result = herokuConfigSchema.safeParse({ apiKey: "key", appName: "my-app" });
    expect(result.success).toBe(true);
  });

  it("rejects missing apiKey", () => {
    const result = herokuConfigSchema.safeParse({ appName: "my-app" });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiKey", () => {
    const result = herokuConfigSchema.safeParse({ apiKey: "", appName: "my-app" });
    expect(result.success).toBe(false);
  });

  it("rejects missing appName", () => {
    const result = herokuConfigSchema.safeParse({ apiKey: "key" });
    expect(result.success).toBe(false);
  });

  it("rejects empty appName", () => {
    const result = herokuConfigSchema.safeParse({ apiKey: "key", appName: "" });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

describe("heroku factory", () => {
  it("returns an ObservabilityProvider with all required methods", () => {
    const provider = makeProvider();
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });

  it("throws on invalid config", () => {
    expect(() => heroku({ apiKey: "", appName: "app" } as never)).toThrow();
  });

  it("getAgentEnv returns HEROKU_API_KEY and HEROKU_APP_NAME", () => {
    const provider = heroku({ apiKey: "my-key", appName: "my-app", logger: silentLogger });
    expect(provider.getAgentEnv()).toEqual({
      HEROKU_API_KEY: "my-key",
      HEROKU_APP_NAME: "my-app",
    });
  });

  it("getPromptInstructions contains Heroku, HEROKU_API_KEY, curl, and configured appName", () => {
    const instructions = makeProvider().getPromptInstructions();
    expect(instructions).toContain("Heroku");
    expect(instructions).toContain("HEROKU_API_KEY");
    expect(instructions).toContain("curl");
    expect(instructions).toContain("my-app");
  });
});

// ---------------------------------------------------------------------------
// API calls (mocked fetch)
// ---------------------------------------------------------------------------

describe("HerokuProvider", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockHeroku(logText: string) {
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
      const urlStr = String(url);
      if (urlStr.includes("/log-sessions")) {
        return { ok: true, json: async () => ({ logplex_url: "https://logplex.heroku.com/sessions/abc" }) } as never;
      }
      if (urlStr.includes("logplex.heroku.com")) {
        return { ok: true, text: async () => logText } as never;
      }
      return { ok: true, json: async () => ({ id: "app-id", name: "my-app" }) } as never;
    });
  }

  // verifyAccess
  it("verifyAccess resolves on 200 and hits /apps/{appName}", async () => {
    const mockFetch = vi.fn().mockImplementation(async () => ({
      ok: true,
      json: async () => ({ id: "app-id", name: "my-app" }),
    }));
    vi.spyOn(globalThis, "fetch").mockImplementation(mockFetch);

    await expect(makeProvider().verifyAccess()).resolves.toBeUndefined();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toContain("/apps/my-app");
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    }));

    await expect(makeProvider().verifyAccess()).rejects.toThrow("Heroku API error: 401 Unauthorized");
  });

  // queryLogs
  it("queryLogs parses log lines and infers level", async () => {
    mockHeroku([makeLogLine("info"), makeLogLine("error"), makeLogLine("warning"), ""].join("\n"));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs.length).toBe(3);
    expect(logs.some((l) => l.level === "error" && l.message.includes("Error: database"))).toBe(true);
    expect(logs.some((l) => l.level === "info" && l.message.includes("Listening"))).toBe(true);
    expect(logs.some((l) => l.level === "warning" && l.message.includes("Warning:"))).toBe(true);
  });

  it("queryLogs sets service to dyno type (before first dot)", async () => {
    mockHeroku([makeLogLine("info", "web.1"), makeLogLine("info", "worker.2")].join("\n"));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });

    expect(logs.every((l) => l.service === "web" || l.service === "worker")).toBe(true);
    expect(logs[0].attributes).toMatchObject({ dyno: expect.stringContaining(".") });
  });

  it("queryLogs filters by severity 'error' keeps only error entries", async () => {
    mockHeroku([makeLogLine("info"), makeLogLine("error"), makeLogLine("warning")].join("\n"));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "error" });

    expect(logs.every((l) => l.level === "error")).toBe(true);
    expect(logs.some((l) => l.level === "info")).toBe(false);
  });

  it("queryLogs filters by severity 'warning' keeps only warning entries", async () => {
    mockHeroku([makeLogLine("info"), makeLogLine("error"), makeLogLine("warning")].join("\n"));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "warning" });

    expect(logs.every((l) => l.level === "warning")).toBe(true);
    expect(logs.some((l) => l.level === "error")).toBe(false);
  });

  it("queryLogs filters by serviceFilter (dyno type)", async () => {
    mockHeroku([makeLogLine("info", "web.1"), makeLogLine("error", "worker.1")].join("\n"));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "worker", severity: "*" });

    expect(logs.every((l) => l.service === "worker")).toBe(true);
    expect(logs.some((l) => l.service === "web")).toBe(false);
  });

  it("queryLogs returns empty when no lines match", async () => {
    mockHeroku("");

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs).toEqual([]);
  });

  it("queryLogs skips malformed lines", async () => {
    mockHeroku([makeLogLine("info"), "not-a-log-line", makeLogLine("error")].join("\n"));

    const logs = await makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" });
    expect(logs.length).toBe(2);
  });

  // aggregate
  it("aggregate groups error lines by dyno type", async () => {
    mockHeroku(
      [
        makeLogLine("error", "web.1"),
        makeLogLine("error", "web.2"),
        makeLogLine("error", "worker.1"),
        makeLogLine("info", "web.1"),
      ].join("\n"),
    );

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });

    expect(results.some((r) => r.service === "web" && r.count === 2)).toBe(true);
    expect(results.some((r) => r.service === "worker" && r.count === 1)).toBe(true);
  });

  it("aggregate filters by serviceFilter", async () => {
    mockHeroku([makeLogLine("error", "web.1"), makeLogLine("error", "worker.1")].join("\n"));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "web" });

    expect(results.some((r) => r.service === "web")).toBe(true);
    expect(results.some((r) => r.service === "worker")).toBe(false);
  });

  it("aggregate returns empty when no error lines", async () => {
    mockHeroku([makeLogLine("info"), makeLogLine("warning")].join("\n"));

    const results = await makeProvider().aggregate({ timeRange: "24h", serviceFilter: "*" });
    expect(results).toEqual([]);
  });

  // error handling
  it("queryLogs throws ProviderApiError when log-sessions returns non-ok", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => ({
      ok: false,
      status: 403,
      statusText: "Forbidden",
      text: async () => "",
    }));

    await expect(makeProvider().queryLogs({ timeRange: "1h", serviceFilter: "*", severity: "*" })).rejects.toThrow(
      "Heroku API error: 403 Forbidden",
    );
  });
});
