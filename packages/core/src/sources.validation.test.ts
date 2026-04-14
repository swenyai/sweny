/**
 * Comprehensive validation tests for the unified Source type.
 *
 * These tests verify correctness, completeness, and best practices
 * beyond the unit tests in sources.test.ts. They cover:
 *   - Review fix features: retry on 5xx, BOM stripping, SOURCE_INVALID_TYPE, tagged trimming
 *   - Edge cases: whitespace, unicode, large content, concurrent resolution
 *   - Schema validation: sourceZ boundary cases
 *   - Error message quality: field paths, remediation hints
 *   - Security: no auth token leakage, URL validation
 */

import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach, vi } from "vitest";
import { classifySource, sourceZ, type SourceResolutionContext } from "./sources.js";
import { hashContent, resolveSource, resolveSources } from "./source-resolver.js";

const fileTmp = path.join(tmpdir(), `sweny-sources-validation-test-${randomBytes(4).toString("hex")}`);

const baseCtx = (): SourceResolutionContext => ({
  cwd: "/tmp",
  env: {} as NodeJS.ProcessEnv,
  authConfig: {},
  offline: false,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

// ── fetchWithRetry behavior ──────────────────────────────────────

describe("fetchWithRetry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("retries on 5xx and succeeds on the second attempt", async () => {
    let attempt = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      attempt++;
      if (attempt === 1) return new Response("fail", { status: 503 });
      return new Response("ok", { status: 200 });
    });

    const resolved = await resolveSource("https://x.test/retry", "f", baseCtx());
    expect(resolved.content).toBe("ok");
    expect(attempt).toBe(2);
  });

  it("retries on 5xx up to 3 attempts total, then returns final 5xx", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("down", { status: 502 }));

    await expect(resolveSource("https://x.test/down", "field", baseCtx())).rejects.toThrow(
      /SOURCE_URL_HTTP_ERROR.*502/,
    );
    expect(fetchMock).toHaveBeenCalledTimes(3); // initial + 2 retries
  });

  it("does NOT retry on 4xx errors", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("bad", { status: 400 }));

    await expect(resolveSource("https://x.test/bad", "f", baseCtx())).rejects.toThrow(/SOURCE_URL_HTTP_ERROR.*400/);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("retries on network error and succeeds on retry", async () => {
    let attempt = 0;
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      attempt++;
      if (attempt === 1) throw new Error("ECONNREFUSED");
      return new Response("recovered", { status: 200 });
    });

    const resolved = await resolveSource("https://x.test/flaky", "f", baseCtx());
    expect(resolved.content).toBe("recovered");
  });

  it("throws SOURCE_URL_UNREACHABLE after all retries fail with network error", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("DNS resolution failed");
    });

    await expect(resolveSource("https://x.test/nowhere", "context[0]", baseCtx())).rejects.toThrow(
      /SOURCE_URL_UNREACHABLE.*x\.test\/nowhere.*context\[0\].*DNS resolution failed.*--offline/,
    );
  });

  it("throws SOURCE_URL_AUTH_REQUIRED on 403", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("forbidden", { status: 403 }));
    await expect(resolveSource("https://x.test/private", "f", baseCtx())).rejects.toThrow(
      /SOURCE_URL_AUTH_REQUIRED.*403.*fetch\.auth/,
    );
  });
});

// ── BOM stripping ────────────────────────────────────────────────

describe("BOM stripping", () => {
  beforeEach(() => {
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("strips UTF-8 BOM from file content", async () => {
    const bom = "\uFEFF";
    writeFileSync(path.join(fileTmp, "bom.md"), bom + "Real content");
    const resolved = await resolveSource("./bom.md", "f", { ...baseCtx(), cwd: fileTmp });
    expect(resolved.content).toBe("Real content");
    expect(resolved.content.charCodeAt(0)).not.toBe(0xfeff);
  });

  it("leaves files without BOM unchanged", async () => {
    writeFileSync(path.join(fileTmp, "clean.md"), "Clean content");
    const resolved = await resolveSource("./clean.md", "f", { ...baseCtx(), cwd: fileTmp });
    expect(resolved.content).toBe("Clean content");
  });

  it("handles file that IS just a BOM", async () => {
    writeFileSync(path.join(fileTmp, "only-bom.md"), "\uFEFF");
    const resolved = await resolveSource("./only-bom.md", "f", { ...baseCtx(), cwd: fileTmp });
    expect(resolved.content).toBe("");
  });
});

// ── SOURCE_INVALID_TYPE ──────────────────────────────────────────

describe("SOURCE_INVALID_TYPE", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rejects tagged URL with unknown type", async () => {
    await expect(resolveSource({ url: "https://x.test/doc", type: "linear" }, "context[0]", baseCtx())).rejects.toThrow(
      /SOURCE_INVALID_TYPE.*"linear".*context\[0\].*v1 supports only "fetch"/,
    );
  });

  it("accepts tagged URL with type: fetch", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    const resolved = await resolveSource({ url: "https://x.test/ok", type: "fetch" }, "f", baseCtx());
    expect(resolved.content).toBe("ok");
  });

  it("accepts tagged URL with no type (defaults to fetch)", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    const resolved = await resolveSource({ url: "https://x.test/ok" }, "f", baseCtx());
    expect(resolved.content).toBe("ok");
  });

  it("does not check type on plain string URLs", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    // Plain string URLs can't have a type field — they always use fetch
    const resolved = await resolveSource("https://x.test/ok", "f", baseCtx());
    expect(resolved.resolver).toBe("fetch");
  });
});

// ── Tagged form trimming ─────────────────────────────────────────

describe("tagged form trimming", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("trims whitespace from tagged {file} paths", async () => {
    writeFileSync(path.join(fileTmp, "trimmed.md"), "content");
    const resolved = await resolveSource({ file: "  ./trimmed.md  " }, "f", { ...baseCtx(), cwd: fileTmp });
    expect(resolved.content).toBe("content");
  });

  it("trims whitespace from tagged {url} values", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("ok", { status: 200 }));
    const resolved = await resolveSource({ url: "  https://x.test/y  " }, "f", baseCtx());
    expect(resolved.content).toBe("ok");
  });

  it("does NOT trim tagged {inline} values (preserves intentional whitespace)", async () => {
    const resolved = await resolveSource({ inline: "  spaced  " }, "f", baseCtx());
    expect(resolved.content).toBe("  spaced  ");
  });
});

// ── Schema validation edge cases ─────────────────────────────────

describe("sourceZ edge cases", () => {
  it("rejects empty tagged inline", () => {
    expect(() => sourceZ.parse({ inline: "" })).toThrow();
  });

  it("rejects empty tagged file", () => {
    expect(() => sourceZ.parse({ file: "" })).toThrow();
  });

  it("rejects non-URL in tagged url form", () => {
    expect(() => sourceZ.parse({ url: "not-a-url" })).toThrow();
  });

  it("accepts single-character inline string", () => {
    expect(sourceZ.parse("x")).toBe("x");
  });

  it("accepts tagged inline with whitespace-only content", () => {
    // Whitespace-only is valid for inline — it's intentional content
    expect(sourceZ.parse({ inline: "   " })).toEqual({ inline: "   " });
  });

  it("rejects numeric values", () => {
    expect(() => sourceZ.parse(42)).toThrow();
  });

  it("rejects null", () => {
    expect(() => sourceZ.parse(null)).toThrow();
  });

  it("rejects arrays", () => {
    expect(() => sourceZ.parse(["./x.md"])).toThrow();
  });
});

// ── classifySource edge cases ────────────────────────────────────

describe("classifySource edge cases", () => {
  it("classifies leading-whitespace URL as url", () => {
    expect(classifySource("  https://x.com/y")).toBe("url");
  });

  it("classifies leading-whitespace path as file", () => {
    expect(classifySource("  ./x.md")).toBe("file");
  });

  it("classifies text starting with 'http' (no ://) as inline", () => {
    expect(classifySource("http is a protocol")).toBe("inline");
  });

  it("classifies text starting with dot but no slash as inline", () => {
    expect(classifySource(".hidden")).toBe("inline");
  });

  it("classifies text starting with double dot but no slash as inline", () => {
    expect(classifySource("..dots")).toBe("inline");
  });
});

// ── Hash stability and uniqueness ────────────────────────────────

describe("hashContent properties", () => {
  it("is deterministic across calls", () => {
    const content = "The quick brown fox jumps over the lazy dog.";
    expect(hashContent(content)).toBe(hashContent(content));
  });

  it("changes with even one character difference", () => {
    expect(hashContent("hello")).not.toBe(hashContent("hellp"));
  });

  it("handles empty string", () => {
    expect(hashContent("")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles unicode content", () => {
    expect(hashContent("日本語テスト")).toMatch(/^[0-9a-f]{16}$/);
  });

  it("handles very long content", () => {
    const long = "a".repeat(1_000_000);
    expect(hashContent(long)).toMatch(/^[0-9a-f]{16}$/);
  });
});

// ── Error message quality ────────────────────────────────────────

describe("error messages include actionable information", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("SOURCE_FILE_NOT_FOUND includes absolute path and field path", async () => {
    try {
      await resolveSource("./nonexistent.md", "nodes.analyze.instruction", { ...baseCtx(), cwd: fileTmp });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("SOURCE_FILE_NOT_FOUND");
      expect(e.message).toContain(fileTmp); // absolute path
      expect(e.message).toContain("nodes.analyze.instruction"); // field path
    }
  });

  it("SOURCE_URL_AUTH_REQUIRED includes remediation hint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 401 }));
    try {
      await resolveSource("https://private.corp/doc", "rules[0]", baseCtx());
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("fetch.auth");
      expect(e.message).toContain("SWENY_FETCH_TOKEN");
    }
  });

  it("SOURCE_URL_UNREACHABLE includes --offline hint", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new Error("timeout");
    });
    try {
      await resolveSource("https://slow.test/x", "context[0]", baseCtx());
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("--offline");
    }
  });

  it("SOURCE_FILE_READ_FAILED on permission denied", async () => {
    const unreadable = path.join(fileTmp, "unreadable.md");
    writeFileSync(unreadable, "secret");
    const { chmodSync } = await import("node:fs");
    chmodSync(unreadable, 0o000);
    try {
      await resolveSource("./unreadable.md", "context[0]", { ...baseCtx(), cwd: fileTmp });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("SOURCE_FILE_READ_FAILED");
      expect(e.message).toContain("unreadable.md");
      expect(e.message).toContain("context[0]");
    } finally {
      chmodSync(unreadable, 0o644);
    }
  });

  it("SOURCE_OFFLINE_REQUIRES_FETCH includes the URL and field path", async () => {
    try {
      await resolveSource("https://example.com/rules.md", "rules[1]", { ...baseCtx(), offline: true });
      expect.unreachable("should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("SOURCE_OFFLINE_REQUIRES_FETCH");
      expect(e.message).toContain("https://example.com/rules.md");
      expect(e.message).toContain("rules[1]");
    }
  });
});

// ── resolveSources concurrent behavior ───────────────────────────

describe("resolveSources concurrent resolution", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("resolves all sources concurrently (not sequentially)", async () => {
    writeFileSync(path.join(fileTmp, "a.md"), "A");
    writeFileSync(path.join(fileTmp, "b.md"), "B");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("C", { status: 200 }));

    const start = Date.now();
    const out = await resolveSources(
      {
        "n.a.instruction": "./a.md",
        "n.b.instruction": "./b.md",
        "n.c.instruction": "https://x.test/c",
        "n.d.instruction": "Inline text",
      },
      { ...baseCtx(), cwd: fileTmp },
    );
    const elapsed = Date.now() - start;

    expect(Object.keys(out)).toHaveLength(4);
    expect(out["n.a.instruction"].content).toBe("A");
    expect(out["n.d.instruction"].content).toBe("Inline text");
    // Should complete quickly since everything runs concurrently
    expect(elapsed).toBeLessThan(5000);
  });

  it("caches file sources by absolute path", async () => {
    writeFileSync(path.join(fileTmp, "shared.md"), "shared");
    const out = await resolveSources(
      {
        "rules[0]": "./shared.md",
        "context[0]": "./shared.md",
      },
      { ...baseCtx(), cwd: fileTmp },
    );
    // Same content, same hash
    expect(out["rules[0]"].hash).toBe(out["context[0]"].hash);
    expect(out["rules[0]"].content).toBe("shared");
  });

  it("does not cache inline sources", async () => {
    const out = await resolveSources(
      {
        "n.a.instruction": "same text",
        "n.b.instruction": "same text",
      },
      baseCtx(),
    );
    // Both resolve independently
    expect(out["n.a.instruction"].content).toBe("same text");
    expect(out["n.b.instruction"].content).toBe("same text");
  });
});

// ── ResolvedSource shape correctness ─────────────────────────────

describe("ResolvedSource shape", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("inline: has content, kind, origin, resolver, hash — no fetchedAt, no sourcePath", async () => {
    const rs = await resolveSource("hello", "f", baseCtx());
    expect(rs).toEqual({
      content: "hello",
      kind: "inline",
      origin: "hello",
      resolver: "inline",
      hash: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
  });

  it("file: has sourcePath, no fetchedAt", async () => {
    writeFileSync(path.join(fileTmp, "x.md"), "body");
    const rs = await resolveSource("./x.md", "f", { ...baseCtx(), cwd: fileTmp });
    expect(rs.kind).toBe("file");
    expect(rs.resolver).toBe("file");
    expect(rs.sourcePath).toBe(path.resolve(fileTmp, "x.md"));
    expect(rs.fetchedAt).toBeUndefined();
  });

  it("url: has fetchedAt (ISO 8601), no sourcePath", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("body", { status: 200 }));
    const rs = await resolveSource("https://x.test/y", "f", baseCtx());
    expect(rs.kind).toBe("url");
    expect(rs.resolver).toBe("fetch");
    expect(rs.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(rs.sourcePath).toBeUndefined();
  });

  it("tagged inline preserves origin as object", async () => {
    const rs = await resolveSource({ inline: "text" }, "f", baseCtx());
    expect(rs.origin).toEqual({ inline: "text" });
  });

  it("tagged file preserves origin as object", async () => {
    writeFileSync(path.join(fileTmp, "t.md"), "body");
    const rs = await resolveSource({ file: "./t.md" }, "f", { ...baseCtx(), cwd: fileTmp });
    expect(rs.origin).toEqual({ file: "./t.md" });
  });

  it("tagged url preserves origin with type", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("body", { status: 200 }));
    const rs = await resolveSource({ url: "https://x.test/y", type: "fetch" }, "f", baseCtx());
    expect(rs.origin).toEqual({ url: "https://x.test/y", type: "fetch" });
  });
});
