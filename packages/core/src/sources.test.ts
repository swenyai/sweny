import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

import { describe, it, expect, beforeEach } from "vitest";
import { classifySource, sourceZ, hashContent, resolveSource } from "./sources.js";

const fileTmp = path.join(tmpdir(), "sweny-sources-file-test");

const baseCtx = () => ({
  cwd: "/tmp",
  env: {} as NodeJS.ProcessEnv,
  authConfig: {} as Record<string, string>,
  offline: false,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
});

describe("classifySource", () => {
  it("classifies http(s) URLs as url", () => {
    expect(classifySource("http://example.com/x.md")).toBe("url");
    expect(classifySource("https://example.com/x.md")).toBe("url");
  });

  it("classifies ./ ../ and / paths as file", () => {
    expect(classifySource("./local.md")).toBe("file");
    expect(classifySource("../sibling.md")).toBe("file");
    expect(classifySource("/abs/path.md")).toBe("file");
  });

  it("classifies anything else as inline", () => {
    expect(classifySource("Just be helpful.")).toBe("inline");
    expect(classifySource("foo bar baz")).toBe("inline");
  });

  it("rejects empty strings", () => {
    expect(() => classifySource("")).toThrow(/empty/i);
    expect(() => classifySource("   ")).toThrow(/empty/i);
  });
});

describe("sourceZ", () => {
  it("accepts non-empty string", () => {
    expect(sourceZ.parse("hello")).toBe("hello");
    expect(sourceZ.parse("./x.md")).toBe("./x.md");
    expect(sourceZ.parse("https://x/y")).toBe("https://x/y");
  });

  it("rejects empty string", () => {
    expect(() => sourceZ.parse("")).toThrow();
  });

  it("accepts tagged inline form", () => {
    expect(sourceZ.parse({ inline: "text" })).toEqual({ inline: "text" });
  });

  it("accepts tagged file form", () => {
    expect(sourceZ.parse({ file: "./x.md" })).toEqual({ file: "./x.md" });
  });

  it("accepts tagged url form with and without type", () => {
    expect(sourceZ.parse({ url: "https://x" })).toEqual({ url: "https://x" });
    expect(sourceZ.parse({ url: "https://x", type: "fetch" })).toEqual({
      url: "https://x",
      type: "fetch",
    });
  });

  it("rejects objects with multiple tag keys", () => {
    expect(() => sourceZ.parse({ inline: "x", file: "./y" })).toThrow();
    expect(() => sourceZ.parse({ file: "./x", url: "https://y" })).toThrow();
  });

  it("rejects objects with no tag keys", () => {
    expect(() => sourceZ.parse({})).toThrow();
    expect(() => sourceZ.parse({ foo: "bar" })).toThrow();
  });

  it("rejects extra keys on tagged forms", () => {
    expect(() => sourceZ.parse({ inline: "x", extra: true })).toThrow();
  });
});

describe("hashContent", () => {
  it("produces stable 16-char hex for same content", () => {
    const a = hashContent("hello world");
    const b = hashContent("hello world");
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
  });

  it("produces different hashes for different content", () => {
    expect(hashContent("a")).not.toBe(hashContent("b"));
  });
});

describe("resolveSource (inline)", () => {
  it("returns the plain string for inline-classified strings", async () => {
    const resolved = await resolveSource("Just do it.", "test.field", baseCtx());
    expect(resolved.content).toBe("Just do it.");
    expect(resolved.kind).toBe("inline");
    expect(resolved.resolver).toBe("inline");
    expect(resolved.origin).toBe("Just do it.");
    expect(resolved.hash).toMatch(/^[0-9a-f]{16}$/);
    expect(resolved.fetchedAt).toBeUndefined();
    expect(resolved.sourcePath).toBeUndefined();
  });

  it("returns the inline text from tagged {inline} form", async () => {
    const resolved = await resolveSource({ inline: "Tagged body" }, "test.field", baseCtx());
    expect(resolved.content).toBe("Tagged body");
    expect(resolved.kind).toBe("inline");
    expect(resolved.resolver).toBe("inline");
  });
});

describe("resolveSource (file)", () => {
  beforeEach(() => {
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("reads a file by relative path (cwd-based)", async () => {
    writeFileSync(path.join(fileTmp, "rules.md"), "# Rules\n\nBe kind.");
    const resolved = await resolveSource("./rules.md", "rules[0]", {
      ...baseCtx(),
      cwd: fileTmp,
    });
    expect(resolved.content).toBe("# Rules\n\nBe kind.");
    expect(resolved.kind).toBe("file");
    expect(resolved.resolver).toBe("file");
    expect(resolved.sourcePath).toBe(path.resolve(fileTmp, "rules.md"));
  });

  it("reads a file via tagged {file} form", async () => {
    writeFileSync(path.join(fileTmp, "a.txt"), "alpha");
    const resolved = await resolveSource({ file: "./a.txt" }, "x", {
      ...baseCtx(),
      cwd: fileTmp,
    });
    expect(resolved.content).toBe("alpha");
    expect(resolved.origin).toEqual({ file: "./a.txt" });
  });

  it("reads an absolute path", async () => {
    const abs = path.join(fileTmp, "abs.md");
    writeFileSync(abs, "absolute body");
    const resolved = await resolveSource(abs, "x", baseCtx());
    expect(resolved.content).toBe("absolute body");
  });

  it("throws SOURCE_FILE_NOT_FOUND with field path on missing file", async () => {
    await expect(
      resolveSource("./missing.md", "nodes.investigate.instruction", {
        ...baseCtx(),
        cwd: fileTmp,
      }),
    ).rejects.toThrow(/SOURCE_FILE_NOT_FOUND.*nodes\.investigate\.instruction/);
  });
});
