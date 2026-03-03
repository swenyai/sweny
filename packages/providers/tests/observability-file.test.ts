import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { file, fileConfigSchema } from "../src/observability/file.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function writeTmp(content: string): string {
  const p = path.join(os.tmpdir(), `sweny-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

const entries = [
  { timestamp: "2024-01-01T00:00:00Z", service: "api", level: "error", message: "boom" },
  { timestamp: "2024-01-01T00:01:00Z", service: "worker", level: "warn", message: "slow" },
  { timestamp: "2024-01-01T00:02:00Z", service: "api", level: "error", message: "crash" },
];

// ===========================================================================
// Config schema
// ===========================================================================

describe("fileConfigSchema", () => {
  it("validates a valid config", () => {
    const result = fileConfigSchema.safeParse({ path: "/tmp/logs.json" });
    expect(result.success).toBe(true);
  });

  it("rejects missing path", () => {
    const result = fileConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });

  it("rejects empty path", () => {
    const result = fileConfigSchema.safeParse({ path: "" });
    expect(result.success).toBe(false);
  });
});

// ===========================================================================
// Factory
// ===========================================================================

describe("file factory", () => {
  it("returns an ObservabilityProvider with all methods", () => {
    const provider = file({ path: "/tmp/logs.json" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });
});

// ===========================================================================
// FileProvider
// ===========================================================================

describe("FileProvider", () => {
  const tmpFiles: string[] = [];

  afterEach(() => {
    for (const p of tmpFiles) {
      try {
        fs.unlinkSync(p);
      } catch {
        // best-effort cleanup
      }
    }
    tmpFiles.length = 0;
  });

  function tmp(content: string): string {
    const p = writeTmp(content);
    tmpFiles.push(p);
    return p;
  }

  it("verifyAccess loads the file without throwing", async () => {
    const p = tmp(JSON.stringify(entries));
    await file({ path: p, logger: silentLogger }).verifyAccess();
  });

  it("verifyAccess throws if file does not exist", async () => {
    await expect(
      file({ path: "/nonexistent/file-that-does-not-exist.json", logger: silentLogger }).verifyAccess(),
    ).rejects.toThrow();
  });

  it("queryLogs returns all entries when serviceFilter is '*' and severity is empty", async () => {
    const p = tmp(JSON.stringify(entries));
    const results = await file({ path: p, logger: silentLogger }).queryLogs({
      serviceFilter: "*",
      timeRange: "24h",
      severity: "",
    });
    expect(results).toHaveLength(3);
  });

  it("queryLogs filters by service", async () => {
    const p = tmp(JSON.stringify(entries));
    const results = await file({ path: p, logger: silentLogger }).queryLogs({
      serviceFilter: "api",
      timeRange: "24h",
      severity: "error",
    });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.service === "api")).toBe(true);
  });

  it("queryLogs filters by severity", async () => {
    const p = tmp(JSON.stringify(entries));
    const results = await file({ path: p, logger: silentLogger }).queryLogs({
      serviceFilter: "*",
      timeRange: "24h",
      severity: "error",
    });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.level === "error")).toBe(true);
  });

  it("aggregate counts entries per service sorted by count desc", async () => {
    const p = tmp(JSON.stringify(entries));
    const results = await file({ path: p, logger: silentLogger }).aggregate({
      serviceFilter: "*",
      timeRange: "24h",
    });
    expect(results[0]).toEqual({ service: "api", count: 2 });
    expect(results[1]).toEqual({ service: "worker", count: 1 });
  });

  it("supports { logs: [...] } wrapper format", async () => {
    const p = tmp(JSON.stringify({ logs: entries }));
    const results = await file({ path: p, logger: silentLogger }).queryLogs({
      serviceFilter: "*",
      timeRange: "24h",
      severity: "",
    });
    expect(results).toHaveLength(3);
  });

  it("throws on invalid JSON", async () => {
    const p = tmp("not json at all");
    await expect(file({ path: p, logger: silentLogger }).verifyAccess()).rejects.toThrow();
  });

  it("throws on valid JSON that is not an array or { logs: [] }", async () => {
    const p = tmp(JSON.stringify({ invalid: "shape" }));
    await expect(file({ path: p, logger: silentLogger }).verifyAccess()).rejects.toThrow("Invalid log file format");
  });

  it("getAgentEnv returns SWENY_LOG_FILE with the path", () => {
    const provider = file({ path: "/tmp/logs.json" });
    expect(provider.getAgentEnv()).toEqual({ SWENY_LOG_FILE: "/tmp/logs.json" });
  });

  it("getPromptInstructions mentions the file path", () => {
    const provider = file({ path: "/tmp/logs.json" });
    expect(provider.getPromptInstructions()).toContain("/tmp/logs.json");
  });
});
