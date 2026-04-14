import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  shouldSkip,
  readCache,
  writeCache,
  isCacheFresh,
  formatNudge,
  defaultCachePath,
  maybeNudge,
  CACHE_TTL_MS,
  type VersionCheckDeps,
} from "../version-check.js";

function captureStream() {
  const chunks: string[] = [];
  const stream = {
    write: (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    get text() {
      return chunks.join("");
    },
  };
}

describe("shouldSkip", () => {
  it("skips in CI", () => {
    expect(shouldSkip({ CI: "1" } as NodeJS.ProcessEnv, true, "run")).toBe(true);
  });

  it("skips when SWENY_NO_UPDATE_CHECK is set", () => {
    expect(shouldSkip({ SWENY_NO_UPDATE_CHECK: "1" } as NodeJS.ProcessEnv, true, "run")).toBe(true);
  });

  it("skips when SWENY_OFFLINE is set", () => {
    expect(shouldSkip({ SWENY_OFFLINE: "1" } as NodeJS.ProcessEnv, true, "run")).toBe(true);
  });

  it("skips non-TTY invocations (pipes, scripts)", () => {
    expect(shouldSkip({} as NodeJS.ProcessEnv, false, "run")).toBe(true);
  });

  it("skips the upgrade command itself to avoid double-printing", () => {
    expect(shouldSkip({} as NodeJS.ProcessEnv, true, "upgrade")).toBe(true);
    expect(shouldSkip({} as NodeJS.ProcessEnv, true, "update")).toBe(true);
  });

  it("allows the nudge in an interactive TTY with no opt-out", () => {
    expect(shouldSkip({} as NodeJS.ProcessEnv, true, "run")).toBe(false);
  });
});

describe("cache I/O", () => {
  let tmpdir: string;
  let cachePath: string;

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-version-check-"));
    cachePath = path.join(tmpdir, "sub", "version-check.json");
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  it("round-trips a valid cache entry", () => {
    writeCache(cachePath, { latest: "0.1.66", checkedAt: 12345 });
    expect(readCache(cachePath)).toEqual({ latest: "0.1.66", checkedAt: 12345 });
  });

  it("creates parent directories as needed", () => {
    writeCache(cachePath, { latest: "0.1.66", checkedAt: 12345 });
    expect(fs.existsSync(cachePath)).toBe(true);
  });

  it("returns null for a missing cache file", () => {
    expect(readCache(cachePath)).toBeNull();
  });

  it("returns null when the cache is malformed JSON", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, "{{{not json");
    expect(readCache(cachePath)).toBeNull();
  });

  it("returns null when required fields are missing or wrong type", () => {
    fs.mkdirSync(path.dirname(cachePath), { recursive: true });
    fs.writeFileSync(cachePath, JSON.stringify({ latest: "0.1.66" }));
    expect(readCache(cachePath)).toBeNull();
    fs.writeFileSync(cachePath, JSON.stringify({ checkedAt: 1 }));
    expect(readCache(cachePath)).toBeNull();
    fs.writeFileSync(cachePath, JSON.stringify({ latest: "", checkedAt: 1 }));
    expect(readCache(cachePath)).toBeNull();
  });

  it("never throws on unwritable cache directories (degrades silently)", () => {
    // Point at a path where the parent is a file — mkdirSync will throw,
    // and writeCache must swallow it.
    const blocker = path.join(tmpdir, "blocker");
    fs.writeFileSync(blocker, "im-a-file");
    expect(() => writeCache(path.join(blocker, "cache.json"), { latest: "0.1.66", checkedAt: 1 })).not.toThrow();
  });
});

describe("isCacheFresh", () => {
  it("returns true within TTL", () => {
    expect(isCacheFresh({ latest: "x", checkedAt: 1000 }, 1000 + CACHE_TTL_MS - 1)).toBe(true);
  });

  it("returns false at or past TTL", () => {
    expect(isCacheFresh({ latest: "x", checkedAt: 1000 }, 1000 + CACHE_TTL_MS)).toBe(false);
    expect(isCacheFresh({ latest: "x", checkedAt: 1000 }, 1000 + CACHE_TTL_MS + 1)).toBe(false);
  });
});

describe("formatNudge", () => {
  it("includes both versions and the upgrade command", () => {
    const out = formatNudge("0.1.65", "0.1.66");
    expect(out).toContain("0.1.65");
    expect(out).toContain("0.1.66");
    expect(out).toContain("sweny upgrade");
  });
});

describe("defaultCachePath", () => {
  it("honors XDG_CACHE_HOME when set", () => {
    const p = defaultCachePath({ XDG_CACHE_HOME: "/custom/cache" } as NodeJS.ProcessEnv, "/home/x");
    expect(p).toBe(path.join("/custom/cache", "sweny", "version-check.json"));
  });

  it("falls back to ~/.cache when XDG_CACHE_HOME is unset", () => {
    expect(defaultCachePath({} as NodeJS.ProcessEnv, "/home/x")).toBe(
      path.join("/home/x/.cache", "sweny", "version-check.json"),
    );
  });

  it("treats empty XDG_CACHE_HOME as unset (defensive)", () => {
    expect(defaultCachePath({ XDG_CACHE_HOME: "" } as NodeJS.ProcessEnv, "/home/x")).toBe(
      path.join("/home/x/.cache", "sweny", "version-check.json"),
    );
  });
});

describe("maybeNudge", () => {
  let tmpdir: string;
  let cachePath: string;
  let stderr: ReturnType<typeof captureStream>;
  const fetchOk = vi.fn(async () => "9.9.9");

  beforeEach(() => {
    tmpdir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-nudge-"));
    cachePath = path.join(tmpdir, "version-check.json");
    stderr = captureStream();
    fetchOk.mockClear();
  });

  afterEach(() => {
    fs.rmSync(tmpdir, { recursive: true, force: true });
  });

  function baseDeps(over: Partial<VersionCheckDeps> = {}): VersionCheckDeps {
    return {
      currentVersion: "0.1.65",
      cachePath,
      now: 1_000_000,
      env: {} as NodeJS.ProcessEnv,
      isTty: true,
      commandName: "run",
      stderr: stderr.stream,
      fetchLatestVersion: fetchOk,
      ...over,
    };
  }

  it("prints nudge when cache shows a newer release", async () => {
    writeCache(cachePath, { latest: "0.1.66", checkedAt: 1_000_000 });
    await maybeNudge(baseDeps());
    expect(stderr.text).toMatch(/0\.1\.66 is available/);
    expect(stderr.text).toMatch(/sweny upgrade/);
  });

  it("stays silent when cache is equal or lower than current", async () => {
    writeCache(cachePath, { latest: "0.1.65", checkedAt: 1_000_000 });
    await maybeNudge(baseDeps());
    expect(stderr.text).toBe("");
  });

  it("refreshes the cache when stale and writes the fetched version", async () => {
    writeCache(cachePath, { latest: "0.1.64", checkedAt: 0 });
    await maybeNudge(baseDeps({ now: CACHE_TTL_MS + 10 }));
    expect(fetchOk).toHaveBeenCalledWith("latest");
    const after = readCache(cachePath);
    expect(after?.latest).toBe("9.9.9");
    expect(after?.checkedAt).toBe(CACHE_TTL_MS + 10);
  });

  it("refreshes when cache is missing and does not crash when fetch fails", async () => {
    const fetchFail = vi.fn(async () => {
      throw new Error("ENETDOWN");
    });
    await maybeNudge(baseDeps({ fetchLatestVersion: fetchFail }));
    expect(fetchFail).toHaveBeenCalled();
    expect(readCache(cachePath)).toBeNull(); // fetch failed, nothing written
    expect(stderr.text).toBe(""); // silent on error
  });

  it("does not refresh when cache is fresh (saves bandwidth)", async () => {
    writeCache(cachePath, { latest: "0.1.65", checkedAt: 1_000_000 });
    await maybeNudge(baseDeps({ now: 1_000_000 + 1 }));
    expect(fetchOk).not.toHaveBeenCalled();
  });

  it("skips entirely in CI — no nudge, no fetch", async () => {
    writeCache(cachePath, { latest: "0.1.66", checkedAt: 1_000_000 });
    await maybeNudge(baseDeps({ env: { CI: "1" } as NodeJS.ProcessEnv }));
    expect(stderr.text).toBe("");
    expect(fetchOk).not.toHaveBeenCalled();
  });

  it("skips entirely on non-TTY stderr", async () => {
    writeCache(cachePath, { latest: "0.1.66", checkedAt: 1_000_000 });
    await maybeNudge(baseDeps({ isTty: false }));
    expect(stderr.text).toBe("");
    expect(fetchOk).not.toHaveBeenCalled();
  });

  it("suppresses the nudge from within `sweny upgrade` itself", async () => {
    writeCache(cachePath, { latest: "0.1.66", checkedAt: 1_000_000 });
    await maybeNudge(baseDeps({ commandName: "upgrade" }));
    expect(stderr.text).toBe("");
    expect(fetchOk).not.toHaveBeenCalled();
  });
});
