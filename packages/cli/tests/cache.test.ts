import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("node:fs");

const fs = await import("node:fs");
const { createFsCache, hashConfig } = await import("../src/cache.js");

describe("createFsCache", () => {
  const dir = "/tmp/sweny-test-cache";
  const ttlMs = 60_000;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("get", () => {
    it("returns undefined when file does not exist", async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      });

      const cache = createFsCache(dir, ttlMs);
      expect(await cache.get("investigate")).toBeUndefined();
    });

    it("returns the entry when it is within TTL", async () => {
      const now = 2_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);

      const entry = { createdAt: now - 1_000, data: { issuesFound: true } };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(entry) as unknown as Buffer);

      const cache = createFsCache(dir, ttlMs);
      expect(await cache.get("investigate")).toEqual(entry);
    });

    it("returns undefined when the entry has expired", async () => {
      const now = 2_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);

      const entry = { createdAt: now - ttlMs - 1, data: {} };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(entry) as unknown as Buffer);

      const cache = createFsCache(dir, ttlMs);
      expect(await cache.get("investigate")).toBeUndefined();
    });

    it("entry at exactly TTL boundary is still valid (strict > check)", async () => {
      const now = 2_000_000;
      vi.spyOn(Date, "now").mockReturnValue(now);

      // createdAt such that Date.now() - createdAt === ttlMs exactly → NOT expired (uses > not >=)
      const entry = { createdAt: now - ttlMs, data: {} };
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(entry) as unknown as Buffer);

      const cache = createFsCache(dir, ttlMs);
      expect(await cache.get("investigate")).toEqual(entry);
    });

    it("reads from <stepName>.json inside the cache dir", async () => {
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("ENOENT");
      });

      const cache = createFsCache(dir, ttlMs);
      await cache.get("build-context");

      expect(fs.readFileSync).toHaveBeenCalledWith(`${dir}/build-context.json`, "utf-8");
    });
  });

  describe("set", () => {
    it("creates the directory recursively and writes formatted JSON", async () => {
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const cache = createFsCache(dir, ttlMs);
      const entry = { createdAt: 1_000_000, data: { ok: true } };
      await cache.set("novelty-gate", entry);

      expect(fs.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
      expect(fs.writeFileSync).toHaveBeenCalledWith(
        `${dir}/novelty-gate.json`,
        JSON.stringify(entry, null, 2),
        "utf-8",
      );
    });

    it("writes to <stepName>.json in the cache dir", async () => {
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      const cache = createFsCache("/cache", ttlMs);
      await cache.set("create-pr", { createdAt: 0, data: {} });

      expect(fs.writeFileSync).toHaveBeenCalledWith("/cache/create-pr.json", expect.any(String), "utf-8");
    });
  });
});

describe("hashConfig", () => {
  const triageConfig = {
    timeRange: "24h",
    severityFocus: "errors",
    serviceFilter: "*",
    investigationDepth: "standard",
    maxInvestigateTurns: 50,
    maxImplementTurns: 30,
    serviceMapPath: ".github/service-map.yml",
    repository: "acme/api",
    baseBranch: "main",
    prLabels: ["agent", "triage"],
    dryRun: false,
    noveltyMode: true,
    issueOverride: "",
    additionalInstructions: "",
    projectId: undefined,
  };

  const cliConfig = {
    observabilityProvider: "datadog",
    issueTrackerProvider: "github-issues",
    codingAgentProvider: "claude",
    sourceControlProvider: "github",
  };

  it("returns a 12-character lowercase hex string", () => {
    // @ts-expect-error - partial types for testing
    const hash = hashConfig(triageConfig, cliConfig);
    expect(hash).toMatch(/^[0-9a-f]{12}$/);
  });

  it("is deterministic for identical inputs", () => {
    // @ts-expect-error - partial types for testing
    const a = hashConfig(triageConfig, cliConfig);
    // @ts-expect-error - partial types for testing
    const b = hashConfig(triageConfig, cliConfig);
    expect(a).toBe(b);
  });

  it("changes when triage config changes", () => {
    // @ts-expect-error - partial types for testing
    const a = hashConfig(triageConfig, cliConfig);
    // @ts-expect-error - partial types for testing
    const b = hashConfig({ ...triageConfig, timeRange: "48h" }, cliConfig);
    expect(a).not.toBe(b);
  });

  it("changes when provider selection changes", () => {
    // @ts-expect-error - partial types for testing
    const a = hashConfig(triageConfig, cliConfig);
    // @ts-expect-error - partial types for testing
    const b = hashConfig(triageConfig, { ...cliConfig, observabilityProvider: "sentry" });
    expect(a).not.toBe(b);
  });

  it("changes when dryRun flag changes", () => {
    // @ts-expect-error - partial types for testing
    const a = hashConfig(triageConfig, cliConfig);
    // @ts-expect-error - partial types for testing
    const b = hashConfig({ ...triageConfig, dryRun: true }, cliConfig);
    expect(a).not.toBe(b);
  });

  it("changes when repository changes", () => {
    // @ts-expect-error - partial types for testing
    const a = hashConfig(triageConfig, cliConfig);
    // @ts-expect-error - partial types for testing
    const b = hashConfig({ ...triageConfig, repository: "acme/frontend" }, cliConfig);
    expect(a).not.toBe(b);
  });
});
