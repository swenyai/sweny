# Unified `Source` Type — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Tier 1 of the unified `Source` type — a single polymorphic type for every content-bearing field in the SWEny workflow spec (`node.instruction`, `workflow.input.rules[]`, `workflow.input.context[]`, `issueTemplate`, `prTemplate`). Replaces the current mix of "inline-only" and "heuristic string" fields with one consistent shape. Plain HTTPS fetch with env-sourced auth is the only URL resolver in v1; the resolver registry is wired as an extension point for later MCP dispatch.

**Architecture:** New `sources.ts` module owns `Source` type, heuristic classifier, Zod union, and three resolvers (`inline`, `file`, `fetch`). Sources resolve **eagerly**, once, at workflow load time — before any node executes. Results live in a `ResolvedSource` map keyed by field path and get recorded in the `ExecutionTrace` with content hashes for auditability. The CLI picks up `--offline` and reads per-host auth config from `.sweny.yml`. Templates and rules/context loaders delegate to the new module; the `prepare` node in `triage.yml` becomes a documentation-only remnant.

**Tech Stack:** TypeScript, Zod 4, Vitest 4, node:fs/promises, node:crypto (sha256), native `fetch` with `AbortSignal.timeout`.

**Reference:** Design spec at `docs/superpowers/specs/2026-04-12-unified-source-type-design.md`.

---

## File Structure

**New files:**
- `packages/core/src/sources.ts` — `Source` type, `sourceZ`, classifier, resolvers, cache, hashing, `resolveSources()`.
- `packages/core/src/sources.test.ts` — unit tests for classifier, Zod validation, each resolver, auth, cache, offline, hashing.
- `spec/src/content/docs/sources.mdx` — normative spec page.

**Modified files:**
- `packages/core/src/types.ts` — export `Source`, `ResolvedSource`, `SourceResolutionMap`. `Node.instruction` becomes `Source`. `ExecutionTrace` gains `sources` map.
- `packages/core/src/schema.ts` — add `sourceZ` union, reference from `nodeZ.instruction`. Update `workflowJsonSchema` (embed a `$defs.Source`).
- `packages/core/src/executor.ts` — call `resolveSources()` before node loop; inject resolved instructions; populate `trace.sources`; emit a new `sources:resolved` observer event.
- `packages/core/src/templates.ts` — `loadTemplate()` and `loadAdditionalContext()` delegate to `sources.ts` (keep as thin back-compat shims).
- `packages/core/src/cli/main.ts` — add `--offline` flag; pass offline + authConfig to the executor; `resolveRulesAndContext()` uses the new module.
- `packages/core/src/cli/config.ts` — add `fetch.auth` map + `offline` boolean to `CliConfig`; parse from options/file.
- `packages/core/src/cli/config-file.ts` — allow nested `fetch: { auth: { ... } }` in `.sweny.yml` parsing.
- `packages/core/src/workflows/triage.yml` — remove the `prepare` node; make `gather` the entry.
- `spec/src/content/docs/nodes.mdx` — `instruction` becomes `Source`; add "Externalizing Instructions" subsection.
- `spec/src/content/docs/execution.mdx` — add Source resolution phase to Node Execution Sequence; document `sources:resolved` event; add `sources` field to `ExecutionTrace` table.
- `spec/src/content/docs/workflow.mdx` — `rules[]` / `context[]` descriptions cross-reference Source.
- `spec/public/schemas/workflow.json` — regenerate from updated `workflowJsonSchema`.

---

### Task 1: Create `Source` type + classifier

**Files:**
- Create: `packages/core/src/sources.ts`
- Create: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/core/src/sources.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { classifySource } from "./sources.js";

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: FAIL with "Cannot find module './sources.js'".

- [ ] **Step 3: Write minimal implementation**

Create `packages/core/src/sources.ts`:

```typescript
/**
 * Source type — unified shape for every content-bearing field in a workflow
 * (instructions, rules, context, templates). Supports inline text, relative or
 * absolute file paths, and HTTP(S) URLs via a single ergonomic form.
 *
 * See docs/superpowers/specs/2026-04-12-unified-source-type-design.md.
 */

export type Source =
  | string
  | { inline: string }
  | { file: string }
  | { url: string; type?: string };

export type SourceKind = "inline" | "file" | "url";

/**
 * Classify a plain-string Source by prefix. Throws on empty strings.
 */
export function classifySource(raw: string): SourceKind {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("source error: empty string is not a valid Source");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return "url";
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/")) {
    return "file";
  }
  return "inline";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): add Source type + classifier skeleton"
```

---

### Task 2: Add `sourceZ` Zod discriminated union

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
import { sourceZ } from "./sources.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: FAIL — `sourceZ` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/core/src/sources.ts`:

```typescript
import { z } from "zod";

const inlineTagZ = z.object({ inline: z.string() }).strict();
const fileTagZ = z.object({ file: z.string().min(1) }).strict();
const urlTagZ = z
  .object({
    url: z.string().url(),
    type: z.string().optional(),
  })
  .strict();

/**
 * Zod schema for a Source. Accepts either a non-empty string (classified by
 * prefix) or one of three tagged object forms: {inline}, {file}, {url,type?}.
 * Runtime validation of `type` against the resolver registry happens later —
 * the schema stays permissive so new resolvers slot in without schema bumps.
 */
export const sourceZ = z.union([
  z.string().min(1),
  inlineTagZ,
  fileTagZ,
  urlTagZ,
]);
```

Import `z` at the top of the file if not already imported.

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS (all sourceZ tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): add sourceZ discriminated union"
```

---

### Task 3: Add `ResolvedSource` type + content hashing

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
import { hashContent } from "./sources.js";

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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t hashContent`
Expected: FAIL — `hashContent` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/core/src/sources.ts`:

```typescript
import { createHash } from "node:crypto";

/**
 * Record produced by resolving a Source. Content + provenance metadata.
 * Appears in the execution trace for auditability.
 */
export type ResolvedSource = {
  content: string;
  kind: SourceKind;
  /** The original YAML value (string or tagged object). */
  origin: Source;
  /** Name of the resolver that produced `content`. */
  resolver: "inline" | "file" | "fetch";
  /** sha256 hex, first 16 chars. */
  hash: string;
  /** ISO 8601, present only when kind === "url". */
  fetchedAt?: string;
  /** Absolute path, present only when kind === "file". */
  sourcePath?: string;
};

/** Map of field-path (e.g. "nodes.investigate.instruction") → ResolvedSource. */
export type SourceResolutionMap = Record<string, ResolvedSource>;

/** sha256 of a string, returning the first 16 hex chars for compact traces. */
export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t hashContent`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): add ResolvedSource type + content hashing"
```

---

### Task 4: Implement `inline` resolver

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
import { resolveSource } from "./sources.js";

const baseCtx = () => ({
  cwd: "/tmp",
  env: {} as NodeJS.ProcessEnv,
  authConfig: {} as Record<string, string>,
  offline: false,
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "resolveSource \\(inline\\)"`
Expected: FAIL — `resolveSource` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/core/src/sources.ts`:

```typescript
import type { Logger } from "./types.js";

export type SourceResolutionContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  /** host → env-var-name, from .sweny.yml fetch.auth. */
  authConfig: Record<string, string>;
  offline: boolean;
  logger: Logger;
};

/**
 * Resolve a single Source into a ResolvedSource. Dispatches to the inline,
 * file, or fetch resolver based on the Source's shape. `fieldPath` is used
 * only for error messages (e.g. "nodes.investigate.instruction").
 */
export async function resolveSource(
  source: Source,
  fieldPath: string,
  ctx: SourceResolutionContext,
): Promise<ResolvedSource> {
  const [kind, value] = normalizeSource(source);

  if (kind === "inline") {
    return {
      content: value,
      kind: "inline",
      origin: source,
      resolver: "inline",
      hash: hashContent(value),
    };
  }

  // File + url resolvers land in later tasks.
  throw new Error(`source error: ${kind} resolver not yet implemented (field: ${fieldPath})`);
}

/**
 * Reduce a Source to (kind, primary-value) — strips the tagged wrapper.
 * For inline strings that happen to classify as file/url, returns that kind.
 */
function normalizeSource(source: Source): [SourceKind, string] {
  if (typeof source === "string") {
    const kind = classifySource(source);
    return [kind, source.trim()];
  }
  if ("inline" in source) return ["inline", source.inline];
  if ("file" in source) return ["file", source.file];
  if ("url" in source) return ["url", source.url];
  throw new Error("source error: unrecognised Source shape");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "resolveSource \\(inline\\)"`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): implement inline resolver + dispatcher skeleton"
```

---

### Task 5: Implement `file` resolver

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";

const fileTmp = path.join(tmpdir(), "sweny-sources-file-test");

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
```

Make sure `beforeEach` is imported from vitest at the top of the file.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "resolveSource \\(file\\)"`
Expected: FAIL — file resolver throws "not yet implemented".

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/sources.ts`:

```typescript
import * as fs from "node:fs/promises";
import * as path from "node:path";
```

Replace the body of `resolveSource` with:

```typescript
export async function resolveSource(
  source: Source,
  fieldPath: string,
  ctx: SourceResolutionContext,
): Promise<ResolvedSource> {
  const [kind, value] = normalizeSource(source);

  if (kind === "inline") {
    return {
      content: value,
      kind: "inline",
      origin: source,
      resolver: "inline",
      hash: hashContent(value),
    };
  }

  if (kind === "file") {
    const absolute = path.isAbsolute(value) ? value : path.resolve(ctx.cwd, value);
    let content: string;
    try {
      content = await fs.readFile(absolute, "utf-8");
    } catch (err) {
      const e = err as NodeJS.ErrnoException;
      if (e.code === "ENOENT") {
        throw new Error(
          `SOURCE_FILE_NOT_FOUND: file not found: ${absolute} (referenced by ${fieldPath})`,
        );
      }
      throw new Error(
        `SOURCE_FILE_READ_FAILED: could not read ${absolute} (referenced by ${fieldPath}): ${e.message}`,
      );
    }
    return {
      content,
      kind: "file",
      origin: source,
      resolver: "file",
      hash: hashContent(content),
      sourcePath: absolute,
    };
  }

  throw new Error(`source error: ${kind} resolver not yet implemented (field: ${fieldPath})`);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS (all tests so far).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): implement file resolver with field-path errors"
```

---

### Task 6: Implement `fetch` resolver (happy path)

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
import { vi } from "vitest";

describe("resolveSource (fetch)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("fetches URL content via plain string", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("# Shared rules\n\nBe careful.", {
        status: 200,
        headers: { "content-type": "text/markdown" },
      });
    });

    const resolved = await resolveSource(
      "https://example.com/rules.md",
      "rules[0]",
      baseCtx(),
    );

    expect(resolved.content).toBe("# Shared rules\n\nBe careful.");
    expect(resolved.kind).toBe("url");
    expect(resolved.resolver).toBe("fetch");
    expect(resolved.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://example.com/rules.md",
      expect.objectContaining({ signal: expect.anything() }),
    );
  });

  it("fetches via tagged {url} form", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("body", { status: 200 }),
    );
    const resolved = await resolveSource(
      { url: "https://x.test/y", type: "fetch" },
      "x",
      baseCtx(),
    );
    expect(resolved.content).toBe("body");
  });

  it("throws SOURCE_URL_HTTP_ERROR on 4xx", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("nope", { status: 404 }),
    );
    await expect(
      resolveSource("https://x.test/missing", "nodes.n.instruction", baseCtx()),
    ).rejects.toThrow(/SOURCE_URL_HTTP_ERROR.*404.*nodes\.n\.instruction/);
  });

  it("throws SOURCE_URL_AUTH_REQUIRED on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("denied", { status: 401 }),
    );
    await expect(
      resolveSource("https://x.test/auth", "x", baseCtx()),
    ).rejects.toThrow(/SOURCE_URL_AUTH_REQUIRED/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "resolveSource \\(fetch\\)"`
Expected: FAIL — url resolver throws "not yet implemented".

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/sources.ts`, replace the `"not yet implemented"` throw with:

```typescript
  if (kind === "url") {
    const url = value;
    const headers = buildFetchHeaders(url, ctx);
    let res: Response;
    try {
      res = await fetch(url, {
        headers,
        signal: AbortSignal.timeout(10_000),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(
        `SOURCE_URL_UNREACHABLE: ${url} (referenced by ${fieldPath}): ${msg}. Pass --offline to skip URL sources.`,
      );
    }
    if (res.status === 401 || res.status === 403) {
      throw new Error(
        `SOURCE_URL_AUTH_REQUIRED: ${url} returned HTTP ${res.status} (referenced by ${fieldPath}). Configure fetch.auth in .sweny.yml or set SWENY_FETCH_TOKEN.`,
      );
    }
    if (!res.ok) {
      throw new Error(
        `SOURCE_URL_HTTP_ERROR: ${url} returned HTTP ${res.status} (referenced by ${fieldPath}).`,
      );
    }
    const content = await res.text();
    return {
      content,
      kind: "url",
      origin: source,
      resolver: "fetch",
      hash: hashContent(content),
      fetchedAt: new Date().toISOString(),
    };
  }

  throw new Error(`source error: unreachable (kind: ${kind}, field: ${fieldPath})`);
```

Add `buildFetchHeaders` helper at the bottom of the file (auth support is deferred to Task 7 — stub for now):

```typescript
function buildFetchHeaders(_url: string, _ctx: SourceResolutionContext): Record<string, string> {
  return { Accept: "text/plain, text/markdown, */*" };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): implement fetch resolver happy path + HTTP errors"
```

---

### Task 7: Add auth-header resolution (per-host + global fallback)

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
describe("fetch auth headers", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("sets Authorization from per-host fetch.auth config", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("ok", { status: 200 }),
    );
    await resolveSource("https://raw.githubusercontent.com/x/y/main/z.md", "f", {
      ...baseCtx(),
      env: { GITHUB_TOKEN: "ghp_abc" } as NodeJS.ProcessEnv,
      authConfig: { "raw.githubusercontent.com": "GITHUB_TOKEN" },
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer ghp_abc",
    });
  });

  it("falls back to SWENY_FETCH_TOKEN when no per-host match", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("ok", { status: 200 }),
    );
    await resolveSource("https://other.example/x", "f", {
      ...baseCtx(),
      env: { SWENY_FETCH_TOKEN: "global_token" } as NodeJS.ProcessEnv,
      authConfig: { "raw.githubusercontent.com": "GITHUB_TOKEN" },
    });
    const [, init] = fetchMock.mock.calls[0];
    expect((init as RequestInit).headers).toMatchObject({
      Authorization: "Bearer global_token",
    });
  });

  it("omits Authorization when env var is unset", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("ok", { status: 200 }),
    );
    await resolveSource("https://raw.githubusercontent.com/x", "f", {
      ...baseCtx(),
      env: {} as NodeJS.ProcessEnv,
      authConfig: { "raw.githubusercontent.com": "GITHUB_TOKEN" },
    });
    const [, init] = fetchMock.mock.calls[0];
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "fetch auth headers"`
Expected: FAIL — no Authorization header set.

- [ ] **Step 3: Write minimal implementation**

Replace `buildFetchHeaders` in `packages/core/src/sources.ts` with:

```typescript
function buildFetchHeaders(url: string, ctx: SourceResolutionContext): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "text/plain, text/markdown, */*",
  };
  const token = resolveFetchToken(url, ctx);
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

function resolveFetchToken(url: string, ctx: SourceResolutionContext): string | undefined {
  let host: string;
  try {
    host = new URL(url).host;
  } catch {
    return undefined;
  }
  const envVar = ctx.authConfig[host];
  if (envVar && ctx.env[envVar]) return ctx.env[envVar];
  const fallback = ctx.env.SWENY_FETCH_TOKEN;
  return fallback || undefined;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): resolve fetch auth from .sweny.yml and env fallback"
```

---

### Task 8: Add `--offline` enforcement + `SOURCE_OFFLINE_REQUIRES_FETCH`

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
describe("offline mode", () => {
  it("file resolution still works when offline", async () => {
    writeFileSync(path.join(fileTmp, "local.md"), "hi");
    const resolved = await resolveSource("./local.md", "f", {
      ...baseCtx(),
      cwd: fileTmp,
      offline: true,
    });
    expect(resolved.content).toBe("hi");
  });

  it("url resolution fails with SOURCE_OFFLINE_REQUIRES_FETCH when offline", async () => {
    await expect(
      resolveSource("https://example.com/x", "rules[0]", {
        ...baseCtx(),
        offline: true,
      }),
    ).rejects.toThrow(/SOURCE_OFFLINE_REQUIRES_FETCH.*https:\/\/example\.com\/x.*rules\[0\]/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "offline mode"`
Expected: FAIL — url fetch proceeds in offline mode.

- [ ] **Step 3: Write minimal implementation**

In `packages/core/src/sources.ts`, at the top of the `kind === "url"` branch (before the `fetch` call), add:

```typescript
    if (ctx.offline) {
      throw new Error(
        `SOURCE_OFFLINE_REQUIRES_FETCH: cannot fetch ${value} in --offline mode (referenced by ${fieldPath}).`,
      );
    }
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): honor --offline for url sources"
```

---

### Task 9: Implement `resolveSources()` orchestrator + in-run cache

**Files:**
- Modify: `packages/core/src/sources.ts`
- Modify: `packages/core/src/sources.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/sources.test.ts`:

```typescript
import { resolveSources } from "./sources.js";

describe("resolveSources (orchestrator)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    rmSync(fileTmp, { recursive: true, force: true });
    mkdirSync(fileTmp, { recursive: true });
  });

  it("resolves a map of Sources and returns a parallel ResolvedSource map", async () => {
    writeFileSync(path.join(fileTmp, "a.md"), "alpha");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("beta", { status: 200 }),
    );

    const out = await resolveSources(
      {
        "nodes.n.instruction": "Inline thing.",
        "rules[0]": "./a.md",
        "context[0]": "https://x.test/doc",
      },
      { ...baseCtx(), cwd: fileTmp },
    );

    expect(out["nodes.n.instruction"].content).toBe("Inline thing.");
    expect(out["rules[0]"].content).toBe("alpha");
    expect(out["context[0]"].content).toBe("beta");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("caches by canonical key: same URL referenced twice fetches once", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("shared", { status: 200 }),
    );
    const out = await resolveSources(
      {
        "rules[0]": "https://x.test/shared.md",
        "context[0]": "https://x.test/shared.md",
      },
      baseCtx(),
    );
    expect(out["rules[0]"].content).toBe("shared");
    expect(out["context[0]"].content).toBe("shared");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reports the first failure's field path", async () => {
    await expect(
      resolveSources(
        { "nodes.bad.instruction": "./does-not-exist.md" },
        { ...baseCtx(), cwd: fileTmp },
      ),
    ).rejects.toThrow(/SOURCE_FILE_NOT_FOUND.*nodes\.bad\.instruction/);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/sources.test.ts -t "resolveSources"`
Expected: FAIL — `resolveSources` not exported.

- [ ] **Step 3: Write minimal implementation**

Add to `packages/core/src/sources.ts`:

```typescript
/**
 * Resolve a map of field-path → Source into a parallel ResolvedSource map.
 * Files and URLs are cached for the lifetime of this call (canonical key =
 * absolute path or full URL). Inline sources are never cached — the content
 * IS the key.
 */
export async function resolveSources(
  sources: Record<string, Source>,
  ctx: SourceResolutionContext,
): Promise<SourceResolutionMap> {
  const cache = new Map<string, Promise<ResolvedSource>>();
  const out: SourceResolutionMap = {};
  const entries = Object.entries(sources);

  await Promise.all(
    entries.map(async ([fieldPath, source]) => {
      const key = canonicalKey(source, ctx);
      let promise = key ? cache.get(key) : undefined;
      if (!promise) {
        promise = resolveSource(source, fieldPath, ctx);
        if (key) cache.set(key, promise);
      }
      out[fieldPath] = await promise;
    }),
  );

  return out;
}

function canonicalKey(source: Source, ctx: SourceResolutionContext): string | null {
  const [kind, value] = normalizeSource(source);
  if (kind === "file") {
    return "file:" + (path.isAbsolute(value) ? value : path.resolve(ctx.cwd, value));
  }
  if (kind === "url") return "url:" + value;
  return null; // inline — do not cache
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/sources.test.ts`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/sources.ts packages/core/src/sources.test.ts
git commit -m "feat(core): add resolveSources orchestrator with in-run cache"
```

---

### Task 10: Update `types.ts` — Source on Node, ExecutionTrace.sources

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Update type exports**

In `packages/core/src/types.ts`, at the top of the "Workflow Graph" section (around line 46, just before `interface Node`):

```typescript
// Re-exports for downstream consumers that import Source types from "@sweny-ai/core".
export type { Source, ResolvedSource, SourceKind, SourceResolutionMap } from "./sources.js";

import type { Source as _Source, ResolvedSource as _ResolvedSource } from "./sources.js";
```

- [ ] **Step 2: Change `Node.instruction` to Source**

In `packages/core/src/types.ts`, update the `Node` interface:

```typescript
/** A node in the workflow DAG */
export interface Node {
  /** Human-readable name */
  name: string;
  /**
   * What Claude should accomplish at this step. May be inline text,
   * a relative/absolute file path, or an HTTP(S) URL — see Source.
   */
  instruction: _Source;
  /** Skill IDs available at this node */
  skills: string[];
  /** Optional structured output schema */
  output?: JSONSchema;
}
```

- [ ] **Step 3: Extend `ExecutionTrace` with `sources`**

In `packages/core/src/types.ts`, update `ExecutionTrace`:

```typescript
/** Full execution trace — ordered steps + edges taken + resolved sources */
export interface ExecutionTrace {
  /** Ordered list of node executions (includes repeats from retry loops) */
  steps: TraceStep[];
  /** Ordered list of routing decisions */
  edges: TraceEdge[];
  /**
   * Map of field-path → ResolvedSource for every Source consumed during this
   * run (node instructions, rules, context, templates). Keys look like
   * "nodes.investigate.instruction" or "input.rules[0]".
   */
  sources: Record<string, _ResolvedSource>;
}
```

- [ ] **Step 4: Add `sources:resolved` execution event**

In `packages/core/src/types.ts`, update the `ExecutionEvent` union:

```typescript
export type ExecutionEvent =
  | { type: "workflow:start"; workflow: string }
  | { type: "sources:resolved"; sources: Record<string, _ResolvedSource> }
  | { type: "node:enter"; node: string; instruction: string }
  | { type: "tool:call"; node: string; tool: string; input: unknown }
  | { type: "tool:result"; node: string; tool: string; output: unknown }
  | { type: "node:exit"; node: string; result: NodeResult }
  | { type: "node:progress"; node: string; message: string }
  | { type: "route"; from: string; to: string; reason: string }
  | { type: "workflow:end"; results: Record<string, NodeResult> };
```

- [ ] **Step 5: Run typecheck + related tests**

Run: `cd packages/core && npx tsc --noEmit && npx vitest run src/sources.test.ts`
Expected: typecheck passes; sources tests pass.

Note: any consumer that reads `node.instruction` directly and expects a string will now show typecheck errors. Those get fixed in Task 12 (executor) and Task 14 (templates). The test suite will show failures until those land — that's the intentional sequence.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): Node.instruction is Source; trace gains sources map"
```

---

### Task 11: Update `schema.ts` — `nodeZ.instruction = sourceZ`, JSON Schema

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/__tests__/schema.test.ts` (add tests)

- [ ] **Step 1: Write the failing tests**

Append to `packages/core/src/__tests__/schema.test.ts`:

```typescript
import { nodeZ, workflowJsonSchema } from "../schema.js";

describe("nodeZ instruction as Source", () => {
  it("accepts inline string instruction", () => {
    const parsed = nodeZ.parse({ name: "n", instruction: "Just do it." });
    expect(parsed.instruction).toBe("Just do it.");
  });

  it("accepts tagged file form", () => {
    const parsed = nodeZ.parse({ name: "n", instruction: { file: "./i.md" } });
    expect(parsed.instruction).toEqual({ file: "./i.md" });
  });

  it("accepts tagged url form", () => {
    const parsed = nodeZ.parse({
      name: "n",
      instruction: { url: "https://x/y.md" },
    });
    expect(parsed.instruction).toEqual({ url: "https://x/y.md" });
  });

  it("rejects empty inline string", () => {
    expect(() => nodeZ.parse({ name: "n", instruction: "" })).toThrow();
  });
});

describe("workflowJsonSchema", () => {
  it("exposes a $defs.Source definition", () => {
    expect(workflowJsonSchema.$defs?.Source).toBeDefined();
  });

  it("references Source from node.instruction", () => {
    const nodeSchema = workflowJsonSchema.properties.nodes.additionalProperties;
    expect(nodeSchema.properties.instruction).toEqual({ $ref: "#/$defs/Source" });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/__tests__/schema.test.ts -t "nodeZ instruction as Source"`
Expected: FAIL — instruction still `z.string().min(1)`.

- [ ] **Step 3: Update `schema.ts`**

In `packages/core/src/schema.ts`, add the import at the top:

```typescript
import { sourceZ } from "./sources.js";
```

Update `nodeZ`:

```typescript
export const nodeZ = z.object({
  name: z.string().min(1),
  instruction: sourceZ,
  skills: z.array(z.string()).default([]),
  output: jsonSchemaZ.optional(),
});
```

Replace the `workflowJsonSchema` export with:

```typescript
const sourceJsonSchema = {
  oneOf: [
    { type: "string", minLength: 1 },
    {
      type: "object",
      properties: { inline: { type: "string" } },
      required: ["inline"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: { file: { type: "string", minLength: 1 } },
      required: ["file"],
      additionalProperties: false,
    },
    {
      type: "object",
      properties: {
        url: { type: "string", format: "uri" },
        type: { type: "string" },
      },
      required: ["url"],
      additionalProperties: false,
    },
  ],
} as const;

export const workflowJsonSchema = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  $id: "https://sweny.ai/schemas/workflow.json",
  title: "SWEny Workflow",
  description: "A workflow definition for skill-based orchestration (supports controlled cycles via max_iterations)",
  type: "object",
  required: ["id", "name", "nodes", "edges", "entry"],
  additionalProperties: false,
  $defs: {
    Source: sourceJsonSchema,
  },
  properties: {
    id: { type: "string", minLength: 1 },
    name: { type: "string", minLength: 1 },
    description: { type: "string" },
    entry: { type: "string", minLength: 1, description: "ID of the entry node" },
    nodes: {
      type: "object",
      additionalProperties: {
        type: "object",
        required: ["name", "instruction"],
        additionalProperties: false,
        properties: {
          name: { type: "string", minLength: 1 },
          instruction: { $ref: "#/$defs/Source" },
          skills: {
            type: "array",
            items: { type: "string" },
            description: "Skill IDs available at this node",
          },
          output: {
            type: "object",
            description: "Optional JSON Schema for structured output",
          },
        },
      },
    },
    edges: {
      type: "array",
      items: {
        type: "object",
        required: ["from", "to"],
        additionalProperties: false,
        properties: {
          from: { type: "string", minLength: 1 },
          to: { type: "string", minLength: 1 },
          when: { type: "string", description: "Natural language condition — Claude evaluates at runtime" },
          max_iterations: {
            type: "integer",
            minimum: 1,
            description: "Max times this edge can be followed — enables controlled retry loops",
          },
        },
      },
    },
  },
} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/__tests__/schema.test.ts`
Expected: PASS for new tests. Any pre-existing schema tests that asserted `instruction: { type: "string", ... }` must be updated to assert `{ $ref: "#/$defs/Source" }` — edit those in the same commit.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): nodeZ.instruction uses sourceZ; JSON Schema adds \$defs.Source"
```

---

### Task 12: Wire resolution into the executor

**Files:**
- Modify: `packages/core/src/executor.ts`
- Modify: `packages/core/src/executor.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/executor.test.ts`:

```typescript
import { resolveSources as _touchImport } from "./sources.js"; // ensure module loads

describe("executor: Source resolution phase", () => {
  it("populates trace.sources with node instructions keyed by field path", async () => {
    const workflow: Workflow = {
      id: "src-test",
      name: "Source test",
      description: "",
      entry: "only",
      nodes: {
        only: {
          name: "Only",
          instruction: "Say hi",
          skills: [],
        },
      },
      edges: [],
    };
    const skills = createSkillMap([]);
    const claude = new MockClaude();
    const result = await execute(workflow, {}, { skills, claude });
    expect(result.trace.sources["nodes.only.instruction"]).toBeDefined();
    expect(result.trace.sources["nodes.only.instruction"].content).toBe("Say hi");
    expect(result.trace.sources["nodes.only.instruction"].kind).toBe("inline");
    expect(result.trace.sources["nodes.only.instruction"].hash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("resolves file instructions before node execution", async () => {
    const dir = freshDir("file-instr");
    writeFileSync(path.join(dir, "instr.md"), "Read this file.");

    const workflow: Workflow = {
      id: "file-instr",
      name: "file instruction",
      description: "",
      entry: "only",
      nodes: {
        only: {
          name: "Only",
          instruction: { file: path.join(dir, "instr.md") },
          skills: [],
        },
      },
      edges: [],
    };
    const skills = createSkillMap([]);
    const claude = new MockClaude();
    const result = await execute(workflow, {}, { skills, claude });
    expect(result.trace.sources["nodes.only.instruction"].content).toBe("Read this file.");
    expect(result.trace.sources["nodes.only.instruction"].kind).toBe("file");
    expect(result.trace.sources["nodes.only.instruction"].resolver).toBe("file");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/executor.test.ts -t "Source resolution phase"`
Expected: FAIL — `trace.sources` does not exist.

- [ ] **Step 3: Update `ExecuteOptions` + `execute()`**

In `packages/core/src/executor.ts`, update imports:

```typescript
import type { Source, ResolvedSource } from "./sources.js";
import { resolveSources } from "./sources.js";
```

Extend `ExecuteOptions`:

```typescript
export interface ExecuteOptions {
  skills: Map<string, Skill>;
  config?: Record<string, string>;
  claude: Claude;
  observer?: Observer;
  logger?: Logger;
  /** Working directory for resolving relative file paths. Default: process.cwd(). */
  cwd?: string;
  /** Environment for auth + fallback token lookup. Default: process.env. */
  env?: NodeJS.ProcessEnv;
  /** Per-host auth config from .sweny.yml (host → env-var-name). */
  fetchAuth?: Record<string, string>;
  /** Skip URL Sources and fail with SOURCE_OFFLINE_REQUIRES_FETCH. */
  offline?: boolean;
}
```

Initialise the trace with `sources: {}`:

```typescript
const trace: ExecutionTrace = { steps: [], edges: [], sources: {} };
```

Immediately after `validate(workflow, skills)` and before `safeObserve(observer, { type: "workflow:start", ... })`, add:

```typescript
  // ── Source resolution phase ────────────────────────────────
  // Resolve every content-bearing Source (node instructions, and later
  // rules/context/templates) once, before any node executes. Fails fast on
  // broken files/URLs. Results land in trace.sources for auditability.
  const sourceMap: Record<string, Source> = {};
  for (const [nodeId, node] of Object.entries(workflow.nodes)) {
    sourceMap[`nodes.${nodeId}.instruction`] = node.instruction;
  }
  const resolvedSources: Record<string, ResolvedSource> = await resolveSources(sourceMap, {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    authConfig: options.fetchAuth ?? {},
    offline: options.offline ?? false,
    logger,
  });
  trace.sources = resolvedSources;
  safeObserve(observer, { type: "sources:resolved", sources: resolvedSources }, logger);
```

Then in the node loop, replace the line that reads `node.instruction` directly. Currently:

```typescript
    safeObserve(observer, { type: "node:enter", node: currentId, instruction: node.instruction }, logger);
```

Becomes:

```typescript
    const resolvedInstruction = resolvedSources[`nodes.${currentId}.instruction`].content;
    safeObserve(observer, { type: "node:enter", node: currentId, instruction: resolvedInstruction }, logger);
```

And replace the `buildNodeInstruction(node.instruction, ...)` call with:

```typescript
    const instruction = buildNodeInstruction(resolvedInstruction, input, skillInstructions);
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/executor.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/executor.ts packages/core/src/executor.test.ts
git commit -m "feat(core): resolve sources eagerly in executor, record in trace"
```

---

### Task 13: CLI `--offline` flag + `.sweny.yml` fetch.auth

**Files:**
- Modify: `packages/core/src/cli/config.ts`
- Modify: `packages/core/src/cli/config-file.ts`
- Modify: `packages/core/src/cli/main.ts`
- Modify: `packages/core/src/cli/config.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `packages/core/src/cli/config.test.ts`:

```typescript
describe("fetch.auth + offline parsing", () => {
  it("parses nested fetch.auth from .sweny.yml fileConfig", () => {
    const config = parseCliInputs(
      { offline: true },
      { "fetch.auth": { "raw.githubusercontent.com": "GITHUB_TOKEN" } } as any,
    );
    expect(config.offline).toBe(true);
    expect(config.fetchAuth).toEqual({
      "raw.githubusercontent.com": "GITHUB_TOKEN",
    });
  });

  it("defaults fetchAuth to {} and offline to false", () => {
    const config = parseCliInputs({}, {});
    expect(config.offline).toBe(false);
    expect(config.fetchAuth).toEqual({});
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/cli/config.test.ts -t "fetch.auth"`
Expected: FAIL — `offline` and `fetchAuth` not on `CliConfig`.

- [ ] **Step 3: Add fields to `CliConfig`**

In `packages/core/src/cli/config.ts`, add to the `CliConfig` interface (near the bottom, next to other behavioural flags):

```typescript
  // Source resolution
  /** Skip URL Sources, fail with SOURCE_OFFLINE_REQUIRES_FETCH. */
  offline: boolean;
  /** Per-host auth config from .sweny.yml: host → env-var-name. */
  fetchAuth: Record<string, string>;
```

In `registerTriageCommand` (and `registerImplementCommand` if present — grep for it), add:

```typescript
    .option("--offline", "Skip URL Sources and fail fast if any are referenced", false)
```

In `parseCliInputs`, after the existing scalar assignments, add:

```typescript
    offline: Boolean(options.offline) || fileConfig["offline"] === "true",
    fetchAuth: parseFetchAuth(fileConfig),
```

Add this helper at the bottom of the file:

```typescript
function parseFetchAuth(fileConfig: FileConfig): Record<string, string> {
  const raw = (fileConfig as any)["fetch.auth"];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, string> = {};
  for (const [host, envVar] of Object.entries(raw)) {
    if (typeof envVar === "string" && envVar) out[host] = envVar;
  }
  return out;
}
```

- [ ] **Step 4: Allow nested objects in `.sweny.yml`**

In `packages/core/src/cli/config-file.ts`, the `loadConfigFile` loop currently only keeps scalar strings and arrays. Update the `FileConfig` type and loop:

```typescript
export type FileConfig = Record<string, string | string[] | Record<string, unknown>>;
```

In the loop body (replacing the existing `for` loop over entries):

```typescript
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (Array.isArray(value)) {
      config[key] = value.map(String);
    } else if (value && typeof value === "object") {
      // Flatten one level: fetch.auth becomes "fetch.auth"
      for (const [subKey, subVal] of Object.entries(value as Record<string, unknown>)) {
        if (subVal && typeof subVal === "object" && !Array.isArray(subVal)) {
          config[`${key}.${subKey}`] = subVal as Record<string, unknown>;
        } else if (Array.isArray(subVal)) {
          config[`${key}.${subKey}`] = subVal.map(String);
        } else if (subVal != null && subVal !== "") {
          config[`${key}.${subKey}`] = String(subVal);
        }
      }
    } else if (value != null && value !== "") {
      config[key] = String(value);
    }
  }
```

- [ ] **Step 5: Pass offline + authConfig to executor**

In `packages/core/src/cli/main.ts`, find each `execute(...)` call (or the equivalent — likely goes through a wrapper). Pass the new options:

```typescript
    cwd: process.cwd(),
    env: process.env,
    fetchAuth: config.fetchAuth,
    offline: config.offline,
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `cd packages/core && npx vitest run src/cli/config.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/cli/config.ts packages/core/src/cli/config-file.ts packages/core/src/cli/main.ts packages/core/src/cli/config.test.ts
git commit -m "feat(cli): add --offline flag and .sweny.yml fetch.auth config"
```

---

### Task 14: Refactor `templates.ts` to delegate to sources.ts

**Files:**
- Modify: `packages/core/src/templates.ts`

- [ ] **Step 1: Replace `loadTemplate` body**

Keep the exported function signature (existing callers use it). Swap the body to delegate to `resolveSource`:

```typescript
import { resolveSource, type SourceResolutionContext } from "./sources.js";
import { consoleLogger } from "./types.js";

export async function loadTemplate(
  source: string | undefined,
  fallback: string,
  cwd: string = process.cwd(),
): Promise<string> {
  if (!source || source.trim() === "") return fallback;
  const ctx: SourceResolutionContext = {
    cwd,
    env: process.env,
    authConfig: {},
    offline: false,
    logger: consoleLogger,
  };
  try {
    const resolved = await resolveSource(source, "template", ctx);
    return resolved.content;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[templates] ${msg}, using default`);
    return fallback;
  }
}
```

- [ ] **Step 2: Replace `loadAdditionalContext` body**

```typescript
export async function loadAdditionalContext(
  sources: string[],
  cwd: string = process.cwd(),
): Promise<{ resolved: string; urls: string[] }> {
  if (sources.length === 0) return { resolved: "", urls: [] };

  const parts: string[] = [];
  const urls: string[] = [];
  const ctx: SourceResolutionContext = {
    cwd,
    env: process.env,
    authConfig: {},
    offline: false,
    logger: consoleLogger,
  };

  for (const raw of sources) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    // URLs are passed to the legacy prepare-node pattern for backwards-compat
    // with workflows that still have that node; v1 callers using the executor
    // will receive eagerly-resolved content via trace.sources instead.
    if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
      urls.push(trimmed);
      continue;
    }
    try {
      const resolved = await resolveSource(trimmed, "context", ctx);
      if (resolved.kind === "file") {
        const basename = resolved.sourcePath?.split("/").pop() ?? "source";
        parts.push(`### ${basename}\n\n${resolved.content}`);
      } else {
        parts.push(resolved.content);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[templates] ${msg}`);
    }
  }

  return {
    resolved: parts.length > 0 ? parts.join("\n\n---\n\n") : "",
    urls,
  };
}
```

Remove the local `classifySource` helper (now exported from sources.ts) and the now-unused `fs`/`path` imports if unused.

- [ ] **Step 3: Run the full core test suite**

Run: `cd packages/core && npx vitest run`
Expected: all tests pass. Any failure in `templates.*.test.ts` is legitimate and needs triage against this refactor (most likely a shape change in the warning message — update the test to match).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/templates.ts
git commit -m "refactor(core): templates.ts delegates to sources.ts"
```

---

### Task 15: Deprecate the `prepare` node in `triage.yml`

**Files:**
- Modify: `packages/core/src/workflows/triage.yml`

- [ ] **Step 1: Update the workflow**

In `packages/core/src/workflows/triage.yml`:

Change the entry:

```yaml
entry: gather
```

Remove the `prepare` node block (lines 6–25) entirely.

Remove the edge `- from: prepare → to: gather` from the `edges:` list.

Keep every other node and edge as-is.

- [ ] **Step 2: Run the workflow YAML test suite**

Run: `cd packages/core && npx vitest run src/__tests__/workflow-yaml.test.ts`
Expected: PASS. If the test asserts `entry: prepare` or the presence of a prepare node, update the test to match the new shape.

- [ ] **Step 3: Run the full e2e suite**

Run: `cd packages/core && npx vitest run`
Expected: PASS (URLs in rules/context now resolve eagerly via the executor, so the prepare node is obsolete — any test that was exercising prepare specifically should be updated or removed).

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/workflows/triage.yml
git commit -m "chore(core): remove prepare node (urls resolve eagerly now)"
```

---

### Task 16: Write `sources.mdx` spec page

**Files:**
- Create: `spec/src/content/docs/sources.mdx`

- [ ] **Step 1: Write the spec page**

Create `spec/src/content/docs/sources.mdx`:

```mdx
---
title: Sources
description: The Source type — a unified shape for every content-bearing field in a workflow.
---

A **Source** is the polymorphic type used by every content-bearing field in a [Workflow](/workflow): [Node instructions](/nodes), workflow `input.rules[]` and `input.context[]`, and issue/PR templates. A Source can be inline text, a local file path, or an HTTP(S) URL.

## Forms

A Source takes one of four shapes:

```yaml
# 1. Inline text (ergonomic default)
instruction: "Investigate the alert and classify each issue."

# 2. Relative or absolute file path
instruction: "./prompts/investigate.md"
instruction: "/opt/prompts/investigate.md"

# 3. HTTP(S) URL
instruction: "https://raw.githubusercontent.com/acme/playbook/main/investigate.md"

# 4. Tagged object form (escape hatch for ambiguous strings)
instruction: { inline: "./literal/slash/is-not-a-file" }
instruction: { file: "./prompts/investigate.md" }
instruction: { url: "https://x.test/playbook.md", type: "fetch" }
```

The **string form** classifies by prefix:

| Prefix | Kind | Example |
|---|---|---|
| `./`, `../`, `/` | file | `./rules.md` |
| `http://`, `https://` | url | `https://x/y.md` |
| anything else | inline | `Just be helpful.` |

## Resolution Semantics

A conforming executor MUST resolve every Source in a workflow **before any node executes**. Resolution happens once per run. Results are available to the executor and recorded in the [Execution Trace](/execution#execution-trace) for auditability.

- **Inline** — identity; the string is used as-is.
- **File** — read via UTF-8 `readFile`. Relative paths resolve against the workflow file's directory or the CLI's cwd.
- **URL** — `fetch()` with 10s timeout. Authorization header picked from `.sweny.yml` `fetch.auth` (per-host env-var-name mapping) or `SWENY_FETCH_TOKEN` (global fallback).

### In-run cache

Files and URLs are cached by canonical key (absolute path / full URL) for the lifetime of a single workflow run. The same URL referenced from multiple fields is fetched once.

### `--offline` flag

When the CLI is invoked with `--offline`:
- File and inline Sources resolve normally.
- URL Sources MUST fail the run at load time with `SOURCE_OFFLINE_REQUIRES_FETCH`.

## ResolvedSource

Each resolved Source produces a record:

| Field | Type | Description |
|---|---|---|
| `content` | string | The resolved body. |
| `kind` | `"inline" \| "file" \| "url"` | Classification. |
| `origin` | Source | Original YAML value. |
| `resolver` | `"inline" \| "file" \| "fetch"` | Name of the resolver that produced `content`. |
| `hash` | string | sha256 hex, first 16 chars. |
| `fetchedAt` | string? | ISO 8601; present when `kind === "url"`. |
| `sourcePath` | string? | Absolute path; present when `kind === "file"`. |

Traces record these under `trace.sources`, keyed by field path (e.g. `nodes.investigate.instruction`).

## Error Codes

| Code | When |
|---|---|
| `SOURCE_FILE_NOT_FOUND` | File path does not exist. |
| `SOURCE_FILE_READ_FAILED` | Any other filesystem error. |
| `SOURCE_URL_UNREACHABLE` | Network error, DNS failure, or timeout. |
| `SOURCE_URL_HTTP_ERROR` | Non-2xx response. |
| `SOURCE_URL_AUTH_REQUIRED` | HTTP 401 or 403. |
| `SOURCE_OFFLINE_REQUIRES_FETCH` | URL Source encountered with `--offline`. |
| `SOURCE_INVALID_TYPE` | Tagged URL with an unknown `type` (v1 accepts only `"fetch"`). |
| `SOURCE_INVALID_SHAPE` | Tagged object with zero or multiple tag keys, or extra keys. |

## Fields That Use Source

- `node.instruction` — [Nodes](/nodes)
- `workflow.input.rules[]` — [Workflow](/workflow)
- `workflow.input.context[]` — [Workflow](/workflow)
- `issueTemplate`, `prTemplate` (executor-specific)

## Fields That Stay Plain Strings

Identifiers, display names, and routing logic (`workflow.id`, `node.name`, `edge.when`, `skill.id`, `node.skills[]`) remain plain strings. Routing conditions are workflow-local and tightly coupled to the DAG; they do not benefit from externalization.
```

- [ ] **Step 2: Commit**

```bash
git add spec/src/content/docs/sources.mdx
git commit -m "docs(spec): add Sources page — normative Source type"
```

---

### Task 17: Update `nodes.mdx` + `execution.mdx` + `workflow.mdx`

**Files:**
- Modify: `spec/src/content/docs/nodes.mdx`
- Modify: `spec/src/content/docs/execution.mdx`
- Modify: `spec/src/content/docs/workflow.mdx`

- [ ] **Step 1: Update `nodes.mdx`**

In the Fields table, change the `instruction` row:

```markdown
| `instruction` | [Source](/sources) | REQUIRED | — | What the AI model should do at this step. Accepts inline text, a file path, or an HTTP(S) URL. |
```

Add this subsection after "Instruction Semantics":

```markdown
### Externalizing Instructions

Because `instruction` is a [Source](/sources), you can keep long or shared prompts in a file or URL and reference them by path:

```yaml
investigate:
  name: Root Cause Analysis
  instruction: ./prompts/investigate.md
  skills:
    - github
    - linear
```

Or pin to a shared playbook repo:

```yaml
gather:
  name: Gather Context
  instruction: https://raw.githubusercontent.com/acme/playbook/main/gather.md
```

Files and URLs resolve **once**, eagerly, before any node runs. Resolved content is recorded in `trace.sources` with a content hash for audit.
```

- [ ] **Step 2: Update `execution.mdx`**

In "Node Execution Sequence", insert a new step 0:

```markdown
0. **Resolve Sources** (once, before any node executes). Every [Source](/sources) in the workflow — node instructions, input rules/context, templates — is resolved. Files are read; URLs are fetched. Results are recorded in `trace.sources`.
```

In the Execution Events table, add a row:

```markdown
| `sources:resolved` | `{ sources: Record<string, ResolvedSource> }` | Once, after the Source resolution phase completes, before `workflow:start`. |
```

In "Event Ordering":

```markdown
The first event of any execution is `sources:resolved`, followed by `workflow:start`. The last is `workflow:end`.
```

Extend the Execution Trace section with a new subsection:

```markdown
### trace.sources

Every resolved Source is recorded under `trace.sources`, keyed by field path (e.g. `nodes.investigate.instruction`, `input.rules[0]`). The value is a [ResolvedSource](/sources#resolvedsource) containing content, kind, hash, and provenance.

This enables diffing runs to detect drift in externally-hosted content. A reviewer can compare the hash for a given rules URL across two runs to confirm the shared playbook hasn't changed.
```

- [ ] **Step 3: Update `workflow.mdx`**

In the Fields table, when `rules` and `context` are discussed (or in the Full Example prose), add a note:

```markdown
`rules[]` and `context[]` entries are each a [Source](/sources) — inline text, a file path, or a URL. They resolve eagerly before the workflow runs.
```

- [ ] **Step 4: Commit**

```bash
git add spec/src/content/docs/nodes.mdx spec/src/content/docs/execution.mdx spec/src/content/docs/workflow.mdx
git commit -m "docs(spec): document Source in nodes/execution/workflow pages"
```

---

### Task 18: Regenerate `public/schemas/workflow.json`

**Files:**
- Modify: `spec/public/schemas/workflow.json`

- [ ] **Step 1: Inspect the regeneration script**

Run: `cd spec && cat package.json | grep -A 2 schemas`
Expected: there is a script that writes `public/schemas/workflow.json` from `packages/core` (likely `build:schemas` or similar). If not, find where the file is produced — it may be committed by hand.

- [ ] **Step 2: Regenerate**

Run the schema regeneration script, or hand-update `spec/public/schemas/workflow.json` to match the new `workflowJsonSchema` from Task 11. Contents should exactly match the exported `workflowJsonSchema` object (including the new `$defs.Source`).

- [ ] **Step 3: Verify**

```bash
node -e "const s=require('./spec/public/schemas/workflow.json'); console.log(Object.keys(s.\$defs || {}))"
```
Expected: `[ 'Source' ]`.

- [ ] **Step 4: Commit**

```bash
git add spec/public/schemas/workflow.json
git commit -m "docs(spec): regenerate workflow.json with Source definition"
```

---

### Task 19: Integration test — workflow with inline, file, and URL sources

**Files:**
- Create: `packages/core/src/__tests__/integration/sources.integration.test.ts`

- [ ] **Step 1: Write the integration test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { execute } from "../../executor.js";
import { MockClaude } from "../../testing.js";
import { createSkillMap } from "../../skills/index.js";
import type { Workflow } from "../../types.js";

function freshDir(name: string): string {
  const dir = path.join(tmpdir(), `sweny-sources-int-${name}-${Date.now()}-${randomBytes(4).toString("hex")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("integration: Source resolution across a workflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves inline, file, and url instructions across three nodes", async () => {
    const dir = freshDir("three-kinds");
    writeFileSync(path.join(dir, "b.md"), "Step B instruction from file.");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Step C instruction from URL.", { status: 200 }),
    );

    const workflow: Workflow = {
      id: "three-kinds",
      name: "Three Kinds",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Step A inline", skills: [] },
        b: { name: "B", instruction: { file: path.join(dir, "b.md") }, skills: [] },
        c: { name: "C", instruction: { url: "https://example.com/c.md" }, skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const skills = createSkillMap([]);
    const result = await execute(workflow, {}, {
      skills,
      claude: new MockClaude(),
      cwd: dir,
    });

    expect(result.trace.sources["nodes.a.instruction"].kind).toBe("inline");
    expect(result.trace.sources["nodes.a.instruction"].content).toBe("Step A inline");
    expect(result.trace.sources["nodes.b.instruction"].kind).toBe("file");
    expect(result.trace.sources["nodes.b.instruction"].content).toBe("Step B instruction from file.");
    expect(result.trace.sources["nodes.c.instruction"].kind).toBe("url");
    expect(result.trace.sources["nodes.c.instruction"].content).toBe("Step C instruction from URL.");
    expect(result.trace.sources["nodes.c.instruction"].fetchedAt).toBeDefined();
  });

  it("fails fast with SOURCE_OFFLINE_REQUIRES_FETCH when offline and URL present", async () => {
    const workflow: Workflow = {
      id: "offline-fail",
      name: "Offline fail",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: { url: "https://example.com/x" }, skills: [] },
      },
      edges: [],
    };
    await expect(
      execute(workflow, {}, {
        skills: createSkillMap([]),
        claude: new MockClaude(),
        offline: true,
      }),
    ).rejects.toThrow(/SOURCE_OFFLINE_REQUIRES_FETCH/);
  });

  it("fails fast with SOURCE_FILE_NOT_FOUND and includes field path", async () => {
    const dir = freshDir("missing");
    const workflow: Workflow = {
      id: "file-missing",
      name: "File missing",
      description: "",
      entry: "bad",
      nodes: {
        bad: { name: "Bad", instruction: { file: "./does-not-exist.md" }, skills: [] },
      },
      edges: [],
    };
    await expect(
      execute(workflow, {}, {
        skills: createSkillMap([]),
        claude: new MockClaude(),
        cwd: dir,
      }),
    ).rejects.toThrow(/SOURCE_FILE_NOT_FOUND.*nodes\.bad\.instruction/);
  });
});
```

- [ ] **Step 2: Run the integration test**

Run: `cd packages/core && npx vitest run src/__tests__/integration/sources.integration.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 3: Run the entire core test suite**

Run: `cd packages/core && npm test`
Expected: all tests pass, including pre-existing suites.

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/__tests__/integration/sources.integration.test.ts
git commit -m "test(core): integration test for Source resolution across workflow"
```

---

## Self-Review

**Spec coverage:**
- §1 File Layout → Tasks 1–15 touch every file listed.
- §2 Source type (shape + fields that use it) → Tasks 1, 2, 10, 11.
- §3 Resolution semantics (eager, file, url, inline, cache, --offline) → Tasks 4, 5, 6, 8, 9, 12, 13.
- §4 Auditability (ResolvedSource + trace.sources) → Tasks 3, 10, 12.
- §5 Error handling (error codes + shape validation) → Tasks 2, 5, 6, 8.
- §6 Resolver registry (extension point) → **deferred to internal structure** — built-in `inline`/`file`/`fetch` land in Tasks 4–6; no public registry API in v1 (matches §12 Non-Goals).
- §7 .sweny.yml `fetch.auth` → Task 13.
- §8 Backwards compat (prepare-node deprecation) → Task 15. Back-compat of existing inline/file/url strings → covered by Tasks 4, 5, 6 heuristics preserving old behavior.
- §9 Spec updates → Tasks 16, 17, 18.
- §10 Testing → Tasks 1–9 (unit), 19 (integration).
- §11–§13 open questions / non-goals / success criteria → nothing to build; enforced by what the plan omits.

**Placeholder scan:** No "TBD" / "add appropriate error handling" / "similar to Task N" / unreferenced types. Each code step includes complete code.

**Type consistency:** `Source`, `SourceKind`, `ResolvedSource`, `SourceResolutionMap`, `SourceResolutionContext`, `resolveSource`, `resolveSources`, `classifySource`, `hashContent`, `sourceZ` — used consistently across tasks. `fetchAuth` (camelCase on `CliConfig` / `ExecuteOptions`) maps to `"fetch.auth"` (dotted key in `.sweny.yml`) — intentional and called out in Task 13.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-04-12-unified-source-type.md`.** Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
