# `sweny new <id>` Marketplace Install — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `sweny new <id>` — fetches a workflow from `swenyai/workflows` (raw GitHub), adapts it to the user's `.sweny.yml` providers via the existing `refineWorkflow()` when skills mismatch, and installs it using the existing idempotent file-write primitives.

**Architecture:** A new `marketplace.ts` module holds fetch + mismatch + adapt + install orchestration as pure-ish functions. `runNew()` gains an optional `marketplaceId` branch that delegates to the install function. The inline file-write logic in `runNew` is extracted into reusable helpers so both the wizard and marketplace paths share it. No changes to `refineWorkflow`, `buildWorkflow`, credential collection, or skill metadata.

**Tech Stack:** TypeScript (ESM), Vitest 4, `@clack/prompts`, `yaml`, `node:fs`. Reuses `ClaudeClient`, `refineWorkflow`, `DagRenderer`, existing skill registry.

**Spec:** `docs/superpowers/specs/2026-04-14-sweny-new-marketplace-install-design.md`

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `packages/core/src/cli/marketplace.ts` | new | fetch, mismatch detection, adapt loop, install orchestrator |
| `packages/core/src/cli/marketplace.test.ts` | new | unit tests for all above |
| `packages/core/src/cli/new.ts` | modify | extract write helpers; accept `marketplaceId` option; add "Browse marketplace" picker option |
| `packages/core/src/cli/new.test.ts` | modify | add tests for new branches and exported helpers |
| `packages/core/src/cli/main.ts` | modify | accept optional positional `<id>` arg on `sweny new` |

---

## Task 1: Scaffold `marketplace.ts` module

**Files:**
- Create: `packages/core/src/cli/marketplace.ts`

- [ ] **Step 1: Create the module skeleton**

```ts
// packages/core/src/cli/marketplace.ts
/**
 * Marketplace install — fetch workflows from swenyai/workflows and
 * adapt them to the user's .sweny.yml providers.
 *
 * Pure functions for fetch/mismatch/adapt; file writes delegate to
 * helpers in ./new.ts.
 */

export const MARKETPLACE_REPO = "swenyai/workflows";
export const MARKETPLACE_RAW_BASE = `https://raw.githubusercontent.com/${MARKETPLACE_REPO}/main`;

export interface MarketplaceEntry {
  id: string;
  name: string;
  description: string;
  skills: string[];
}

export interface FetchError extends Error {
  kind: "not-found" | "rate-limit" | "network" | "bad-yaml" | "unknown";
  retryAfter?: number; // unix seconds, for rate-limit
}
```

- [ ] **Step 2: Commit scaffold**

```bash
git add packages/core/src/cli/marketplace.ts
git commit -m "feat(core): scaffold marketplace.ts module"
```

---

## Task 2: `fetchMarketplaceWorkflow(id)` — happy path

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts`
- Create: `packages/core/src/cli/marketplace.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// packages/core/src/cli/marketplace.test.ts
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { fetchMarketplaceWorkflow, MARKETPLACE_RAW_BASE } from "./marketplace.js";

describe("fetchMarketplaceWorkflow", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      return new Response("id: pr-review\nname: PR Review\n", { status: 200 });
    });
  });
  afterEach(() => fetchSpy.mockRestore());

  it("fetches workflow YAML from raw GitHub", async () => {
    const result = await fetchMarketplaceWorkflow("pr-review");
    expect(result.id).toBe("pr-review");
    expect(result.yaml).toContain("id: pr-review");
    expect(fetchSpy).toHaveBeenCalledWith(`${MARKETPLACE_RAW_BASE}/workflows/pr-review.yml`);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: FAIL — `fetchMarketplaceWorkflow is not defined`

- [ ] **Step 3: Implement minimal happy path**

Add to `packages/core/src/cli/marketplace.ts`:

```ts
export interface FetchedWorkflow {
  id: string;
  yaml: string;
}

export async function fetchMarketplaceWorkflow(id: string): Promise<FetchedWorkflow> {
  const url = `${MARKETPLACE_RAW_BASE}/workflows/${id}.yml`;
  const res = await fetch(url);
  if (!res.ok) {
    throw makeFetchError(res, id);
  }
  const yaml = await res.text();
  return { id, yaml };
}

function makeFetchError(res: Response, id: string): FetchError {
  const err = new Error(`Fetch failed: ${res.status}`) as FetchError;
  err.kind = "unknown";
  return err;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS (1 test)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): fetchMarketplaceWorkflow happy path"
```

---

## Task 3: `fetchMarketplaceWorkflow` — error cases

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts`
- Modify: `packages/core/src/cli/marketplace.test.ts`

- [ ] **Step 1: Write failing tests for 404, rate-limit, network, bad-yaml**

Append to `marketplace.test.ts`:

```ts
describe("fetchMarketplaceWorkflow errors", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  afterEach(() => fetchSpy?.mockRestore());

  it("throws not-found on 404", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("", { status: 404 })
    );
    await expect(fetchMarketplaceWorkflow("missing")).rejects.toMatchObject({
      kind: "not-found",
      message: expect.stringContaining("missing"),
    });
  });

  it("throws rate-limit on 403 with X-RateLimit-Remaining: 0", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("", {
        status: 403,
        headers: { "X-RateLimit-Remaining": "0", "X-RateLimit-Reset": "1234567890" },
      })
    );
    await expect(fetchMarketplaceWorkflow("pr-review")).rejects.toMatchObject({
      kind: "rate-limit",
      retryAfter: 1234567890,
    });
  });

  it("throws network error when fetch rejects", async () => {
    fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      throw new TypeError("fetch failed");
    });
    await expect(fetchMarketplaceWorkflow("pr-review")).rejects.toMatchObject({
      kind: "network",
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: 3 FAIL (wrong error kinds), 1 PASS

- [ ] **Step 3: Implement error handling**

Replace the `fetchMarketplaceWorkflow` + `makeFetchError` in `marketplace.ts`:

```ts
export async function fetchMarketplaceWorkflow(id: string): Promise<FetchedWorkflow> {
  const url = `${MARKETPLACE_RAW_BASE}/workflows/${id}.yml`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch (e) {
    const err = new Error(`Could not reach github.com — check your connection`) as FetchError;
    err.kind = "network";
    throw err;
  }

  if (res.status === 404) {
    const err = new Error(
      `Workflow "${id}" not found in ${MARKETPLACE_REPO}. See https://marketplace.sweny.ai for available workflows.`,
    ) as FetchError;
    err.kind = "not-found";
    throw err;
  }

  if (res.status === 403 && res.headers.get("X-RateLimit-Remaining") === "0") {
    const reset = res.headers.get("X-RateLimit-Reset");
    const err = new Error(
      `GitHub rate limit hit. Set GITHUB_TOKEN to raise the limit, or retry later.`,
    ) as FetchError;
    err.kind = "rate-limit";
    if (reset) err.retryAfter = parseInt(reset, 10);
    throw err;
  }

  if (!res.ok) {
    const err = new Error(`Fetch failed with status ${res.status}`) as FetchError;
    err.kind = "unknown";
    throw err;
  }

  return { id, yaml: await res.text() };
}
```

- [ ] **Step 4: Run tests to verify all pass**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): fetchMarketplaceWorkflow error handling"
```

---

## Task 4: `fetchMarketplaceIndex()`

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts`
- Modify: `packages/core/src/cli/marketplace.test.ts`

- [ ] **Step 1: Write failing test**

Append to `marketplace.test.ts`:

```ts
import { fetchMarketplaceIndex } from "./marketplace.js";

describe("fetchMarketplaceIndex", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches and parses index.json", async () => {
    const body = JSON.stringify([
      { id: "pr-review", name: "PR Review", description: "Reviews PRs", skills: ["github"] },
      { id: "issue-triage", name: "Issue Triage", description: "Triages issues", skills: ["github"] },
    ]);
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(body, { status: 200 }));

    const entries = await fetchMarketplaceIndex();
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ id: "pr-review", name: "PR Review" });
  });

  it("throws not-found when index.json is missing", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));
    await expect(fetchMarketplaceIndex()).rejects.toMatchObject({ kind: "not-found" });
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: 2 FAIL — not defined

- [ ] **Step 3: Implement**

Append to `marketplace.ts`:

```ts
export async function fetchMarketplaceIndex(): Promise<MarketplaceEntry[]> {
  const url = `${MARKETPLACE_RAW_BASE}/index.json`;
  let res: Response;
  try {
    res = await fetch(url);
  } catch {
    const err = new Error(`Could not reach github.com`) as FetchError;
    err.kind = "network";
    throw err;
  }

  if (res.status === 404) {
    const err = new Error(`Marketplace index not found`) as FetchError;
    err.kind = "not-found";
    throw err;
  }
  if (!res.ok) {
    const err = new Error(`Fetch failed with status ${res.status}`) as FetchError;
    err.kind = "unknown";
    throw err;
  }

  const raw = (await res.json()) as unknown;
  if (!Array.isArray(raw)) {
    const err = new Error(`Marketplace index is not an array`) as FetchError;
    err.kind = "bad-yaml";
    throw err;
  }

  return raw as MarketplaceEntry[];
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): fetchMarketplaceIndex"
```

---

## Task 5: `computeProviderMismatch` — pure function

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts`
- Modify: `packages/core/src/cli/marketplace.test.ts`

**Why:** Compare workflow skills' categories against the user's `.sweny.yml` provider choices; surface mismatches so the adapt step knows what to rewrite.

- [ ] **Step 1: Write failing test**

Append to `marketplace.test.ts`:

```ts
import { computeProviderMismatch } from "./marketplace.js";
import type { Skill } from "../types.js";

const testSkills: Skill[] = [
  { id: "linear",        name: "Linear",        description: "", category: "tasks",         config: {}, tools: [] },
  { id: "github-issues", name: "GitHub Issues", description: "", category: "tasks",         config: {}, tools: [] },
  { id: "github",        name: "GitHub",        description: "", category: "git",           config: {}, tools: [] },
  { id: "datadog",       name: "Datadog",       description: "", category: "observability", config: {}, tools: [] },
  { id: "sentry",        name: "Sentry",        description: "", category: "observability", config: {}, tools: [] },
];

describe("computeProviderMismatch", () => {
  it("returns empty array when all workflow skills match config", () => {
    const mismatches = computeProviderMismatch(
      ["github", "github-issues"],
      { "source-control-provider": "github", "issue-tracker-provider": "github-issues" },
      testSkills,
    );
    expect(mismatches).toEqual([]);
  });

  it("detects tasks mismatch (workflow=linear, config=github-issues)", () => {
    const mismatches = computeProviderMismatch(
      ["linear"],
      { "issue-tracker-provider": "github-issues" },
      testSkills,
    );
    expect(mismatches).toEqual([
      { category: "tasks", configKey: "issue-tracker-provider", workflowSkill: "linear", userProvider: "github-issues" },
    ]);
  });

  it("detects observability mismatch and ignores general-category skills", () => {
    const mismatches = computeProviderMismatch(
      ["datadog"],
      { "observability-provider": "sentry" },
      testSkills,
    );
    expect(mismatches).toEqual([
      { category: "observability", configKey: "observability-provider", workflowSkill: "datadog", userProvider: "sentry" },
    ]);
  });

  it("skips mismatch when the user has no provider set for that role", () => {
    // If user hasn't picked an issue-tracker yet, the workflow just chooses for them — not a mismatch.
    const mismatches = computeProviderMismatch(["linear"], {}, testSkills);
    expect(mismatches).toEqual([]);
  });

  it("ignores workflow skills not in the available skill registry", () => {
    const mismatches = computeProviderMismatch(
      ["unknown-skill"],
      { "issue-tracker-provider": "github-issues" },
      testSkills,
    );
    expect(mismatches).toEqual([]);
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: 5 FAIL — not defined

- [ ] **Step 3: Implement**

Append to `marketplace.ts`:

```ts
import type { Skill, SkillCategory } from "../types.js";
import type { FileConfig } from "./config-file.js";

export interface ProviderMismatch {
  category: SkillCategory;
  configKey: string; // e.g. "issue-tracker-provider"
  workflowSkill: string; // skill the workflow uses
  userProvider: string; // provider set in .sweny.yml
}

// Map skill category → .sweny.yml key
const CATEGORY_TO_CONFIG_KEY: Partial<Record<SkillCategory, string>> = {
  git: "source-control-provider",
  tasks: "issue-tracker-provider",
  observability: "observability-provider",
  notification: "notification-provider",
};

export function computeProviderMismatch(
  workflowSkills: string[],
  fileConfig: FileConfig,
  availableSkills: Skill[],
): ProviderMismatch[] {
  const skillMap = new Map(availableSkills.map((s) => [s.id, s]));
  const out: ProviderMismatch[] = [];

  for (const skillId of workflowSkills) {
    const skill = skillMap.get(skillId);
    if (!skill) continue; // unknown skill — nothing to compare against

    const configKey = CATEGORY_TO_CONFIG_KEY[skill.category];
    if (!configKey) continue; // "general" and other non-provider categories

    const userProvider = fileConfig[configKey];
    if (typeof userProvider !== "string") continue; // no config set → no mismatch
    if (userProvider === skillId) continue; // exact match → no mismatch

    out.push({
      category: skill.category,
      configKey,
      workflowSkill: skillId,
      userProvider,
    });
  }

  return out;
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS (all tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): computeProviderMismatch"
```

---

## Task 6: `buildAdaptPrompt` — pure function

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts`
- Modify: `packages/core/src/cli/marketplace.test.ts`

- [ ] **Step 1: Write failing test**

Append to `marketplace.test.ts`:

```ts
import { buildAdaptPrompt } from "./marketplace.js";

describe("buildAdaptPrompt", () => {
  it("describes single mismatch", () => {
    const prompt = buildAdaptPrompt([
      { category: "tasks", configKey: "issue-tracker-provider", workflowSkill: "linear", userProvider: "github-issues" },
    ]);
    expect(prompt).toContain("linear");
    expect(prompt).toContain("github-issues");
    expect(prompt).toContain("issue-tracker");
    expect(prompt.toLowerCase()).toContain("rewrite");
  });

  it("describes multiple mismatches", () => {
    const prompt = buildAdaptPrompt([
      { category: "tasks", configKey: "issue-tracker-provider", workflowSkill: "linear", userProvider: "github-issues" },
      { category: "observability", configKey: "observability-provider", workflowSkill: "datadog", userProvider: "sentry" },
    ]);
    expect(prompt).toContain("linear");
    expect(prompt).toContain("datadog");
    expect(prompt).toContain("sentry");
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: 2 FAIL — not defined

- [ ] **Step 3: Implement**

Append to `marketplace.ts`:

```ts
export function buildAdaptPrompt(mismatches: ProviderMismatch[]): string {
  const swaps = mismatches
    .map(
      (m) =>
        `- Replace the \`${m.workflowSkill}\` skill (${m.category}) with \`${m.userProvider}\`, preserving the intent of each node.`,
    )
    .join("\n");
  return [
    `The target project's .sweny.yml declares different providers than this workflow uses.`,
    `Rewrite the workflow so every node uses the target project's providers:`,
    "",
    swaps,
    "",
    `Keep node IDs, edge structure, and instruction intent. Only change skill references and any node instructions that name the old provider by name.`,
  ].join("\n");
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): buildAdaptPrompt"
```

---

## Task 7: Extract file-write helpers from `runNew` into exported functions

**Why:** The marketplace install needs the same idempotent `.sweny.yml` / `.env` / workflow-file writing the wizard does. Extract into testable helpers so both paths call the same code.

**Files:**
- Modify: `packages/core/src/cli/new.ts` — extract helpers, have `runNew` call them
- Modify: `packages/core/src/cli/new.test.ts` — direct tests on extracted helpers

- [ ] **Step 1: Write failing tests for extracted helpers**

Append to `new.test.ts` (after existing tests):

```ts
import {
  writeSwenyYmlIfMissing,
  appendMissingEnvKeys,
  writeWorkflowFile,
  type Credential,
} from "./new.js";

describe("writeSwenyYmlIfMissing", () => {
  const tmpDirs: string[] = [];
  afterEach(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); tmpDirs.length = 0; });

  it("creates .sweny.yml when missing", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    const created = writeSwenyYmlIfMissing(dir, "github", "datadog", "github-issues");
    expect(created).toBe(true);
    expect(fs.existsSync(path.join(dir, ".sweny.yml"))).toBe(true);
  });

  it("does not overwrite existing .sweny.yml", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, ".sweny.yml"), "custom: value\n");
    const created = writeSwenyYmlIfMissing(dir, "github", null, "github-issues");
    expect(created).toBe(false);
    expect(fs.readFileSync(path.join(dir, ".sweny.yml"), "utf-8")).toBe("custom: value\n");
  });
});

describe("appendMissingEnvKeys", () => {
  const tmpDirs: string[] = [];
  afterEach(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); tmpDirs.length = 0; });

  it("creates .env from scratch", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    const creds: Credential[] = [{ key: "FOO", hint: "set FOO" }];
    const added = appendMissingEnvKeys(dir, creds);
    expect(added).toBe(1);
    expect(fs.readFileSync(path.join(dir, ".env"), "utf-8")).toContain("FOO=");
  });

  it("skips already-present keys (including commented placeholders)", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    fs.writeFileSync(path.join(dir, ".env"), "# FOO=set-me\nBAR=baz\n");
    const creds: Credential[] = [{ key: "FOO" }, { key: "BAR" }, { key: "QUUX" }];
    const added = appendMissingEnvKeys(dir, creds);
    expect(added).toBe(1); // only QUUX
    const final = fs.readFileSync(path.join(dir, ".env"), "utf-8");
    expect(final).toContain("QUUX=");
  });
});

describe("writeWorkflowFile", () => {
  const tmpDirs: string[] = [];
  afterEach(() => { for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true }); tmpDirs.length = 0; });

  it("writes a new workflow file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    const result = writeWorkflowFile(dir, "pr-review", "id: pr-review\n");
    expect(result).toEqual({ written: true, path: path.join(dir, ".sweny", "workflows", "pr-review.yml") });
    expect(fs.existsSync(result.path)).toBe(true);
  });

  it("returns exists=true when file already present and overwrite=false", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, ".sweny", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sweny", "workflows", "pr-review.yml"), "old\n");
    const result = writeWorkflowFile(dir, "pr-review", "new\n", { overwrite: false });
    expect(result).toEqual({ written: false, exists: true, path: expect.any(String) });
    expect(fs.readFileSync(result.path, "utf-8")).toBe("old\n");
  });

  it("overwrites when overwrite=true", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-writer-"));
    tmpDirs.push(dir);
    fs.mkdirSync(path.join(dir, ".sweny", "workflows"), { recursive: true });
    fs.writeFileSync(path.join(dir, ".sweny", "workflows", "pr-review.yml"), "old\n");
    const result = writeWorkflowFile(dir, "pr-review", "new\n", { overwrite: true });
    expect(result).toEqual({ written: true, path: expect.any(String) });
    expect(fs.readFileSync(result.path, "utf-8")).toBe("new\n");
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd packages/core && npx vitest run src/cli/new.test.ts`
Expected: 7 FAIL — helpers not exported

- [ ] **Step 3: Extract helpers in `new.ts`**

Add to `new.ts` (near the top-level functions, above `runNew`):

```ts
/** Write .sweny.yml if missing. Returns true if created, false if file existed. */
export function writeSwenyYmlIfMissing(
  cwd: string,
  sourceControl: string,
  observability: string | null,
  issueTracker: string,
): boolean {
  const configPath = path.join(cwd, ".sweny.yml");
  if (fs.existsSync(configPath)) return false;
  fs.writeFileSync(configPath, buildSwenyYml(sourceControl, observability, issueTracker), "utf-8");
  return true;
}

/** Append credential keys to .env that aren't already present. Returns count appended. */
export function appendMissingEnvKeys(cwd: string, credentials: Credential[]): number {
  const envPath = path.join(cwd, ".env");
  if (!fs.existsSync(envPath)) {
    fs.writeFileSync(envPath, buildEnvTemplate(credentials), "utf-8");
    return credentials.length;
  }
  const existing = fs.readFileSync(envPath, "utf-8");
  const definedKeys = new Set<string>();
  for (const rawLine of existing.split("\n")) {
    const line = rawLine.trimStart().replace(/^#\s*/, "");
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (/^[A-Z_][A-Z0-9_]*$/i.test(key)) definedKeys.add(key);
  }
  const newKeys = credentials.filter((c) => !definedKeys.has(c.key));
  if (newKeys.length === 0) return 0;
  fs.appendFileSync(envPath, "\n" + buildEnvTemplate(newKeys), "utf-8");
  return newKeys.length;
}

/** Write workflow YAML into .sweny/workflows/<id>.yml. Returns info about what happened. */
export function writeWorkflowFile(
  cwd: string,
  id: string,
  yaml: string,
  options?: { overwrite?: boolean },
): { written: boolean; exists?: boolean; path: string } {
  const dir = path.join(cwd, ".sweny", "workflows");
  fs.mkdirSync(dir, { recursive: true });
  const target = path.join(dir, `${id}.yml`);
  const overwrite = options?.overwrite ?? false;
  if (fs.existsSync(target) && !overwrite) {
    return { written: false, exists: true, path: target };
  }
  fs.writeFileSync(target, yaml, "utf-8");
  return { written: true, path: target };
}
```

- [ ] **Step 4: Refactor `runNew` to call the new helpers**

In `new.ts`, replace lines 587–655 (the write-files section) with calls to the new helpers:

```ts
  // ── Step 4: Write files ─────────────────────────────────────────────

  // 1. Write .sweny.yml (only if fresh)
  if (writeSwenyYmlIfMissing(cwd, sourceControl, observability, issueTracker)) {
    p.log.success("Created .sweny.yml");
  } else {
    p.log.info(".sweny.yml already exists — keeping existing config");
  }

  // 2. Append missing .env keys
  const addedCount = appendMissingEnvKeys(cwd, credentials);
  const addedNewKeys = addedCount > 0;
  if (!fs.existsSync(path.join(cwd, ".env"))) {
    // unreachable: appendMissingEnvKeys creates it
  } else if (addedCount > 0) {
    p.log.success(`Appended ${addedCount} new key(s) to .env`);
  } else {
    p.log.info(".env already contains all required keys — skipped");
  }

  // 3. Workflow template
  if (template) {
    const firstAttempt = writeWorkflowFile(cwd, template.id, template.yaml, { overwrite: false });
    if (firstAttempt.exists) {
      const overwrite = await p.confirm({
        message: `.sweny/workflows/${template.id}.yml already exists. Overwrite?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite)) cancel();
      if (!overwrite) {
        p.log.info("Workflow file preserved — no changes");
        p.outro("Done.");
        return;
      }
      writeWorkflowFile(cwd, template.id, template.yaml, { overwrite: true });
    }
    p.log.success(`Created .sweny/workflows/${template.id}.yml`);
  }
```

- [ ] **Step 5: Run full test suite**

Run: `cd packages/core && npm test`
Expected: all existing tests PASS + new helper tests PASS

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/cli/new.ts packages/core/src/cli/new.test.ts
git commit -m "refactor(core): extract write helpers from runNew"
```

---

## Task 8: `adaptWorkflowInteractive` — extract accept/refine/cancel loop

**Why:** `runCustomWorkflowBuilder` (new.ts:735–779) has the accept/refine/cancel loop hard-coded for the "custom" branch. Extract it into a function both paths can call.

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts` — add `adaptWorkflowInteractive`
- Modify: `packages/core/src/cli/marketplace.test.ts` — test with mocked prompts + mocked `refineWorkflow`

- [ ] **Step 1: Write failing test**

Append to `marketplace.test.ts`:

```ts
import { adaptWorkflowInteractive } from "./marketplace.js";
import type { Workflow } from "../types.js";

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  text: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { message: vi.fn(), error: vi.fn() },
  isCancel: (v: unknown) => v === Symbol.for("cancel"),
}));
vi.mock("../workflow-builder.js", () => ({
  refineWorkflow: vi.fn(),
}));

describe("adaptWorkflowInteractive", () => {
  beforeEach(() => vi.clearAllMocks());

  const sampleWorkflow: Workflow = {
    id: "pr-review",
    name: "PR Review",
    description: "",
    entry: "start",
    nodes: { start: { name: "Start", instruction: "x", skills: [] } },
    edges: [],
  };

  it("returns the workflow when user accepts on first render", async () => {
    const p = await import("@clack/prompts");
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("accept");

    const claudeStub = { run: vi.fn() } as any;
    const result = await adaptWorkflowInteractive(sampleWorkflow, {
      claude: claudeStub,
      skills: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result).toEqual(sampleWorkflow);
  });

  it("returns null when user cancels", async () => {
    const p = await import("@clack/prompts");
    (p.select as ReturnType<typeof vi.fn>).mockResolvedValueOnce("cancel");

    const claudeStub = { run: vi.fn() } as any;
    const result = await adaptWorkflowInteractive(sampleWorkflow, {
      claude: claudeStub,
      skills: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result).toBeNull();
  });

  it("calls refineWorkflow when user picks 'refine'", async () => {
    const p = await import("@clack/prompts");
    const wb = await import("../workflow-builder.js");
    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("refine")
      .mockResolvedValueOnce("accept");
    (p.text as ReturnType<typeof vi.fn>).mockResolvedValueOnce("make it better");
    (wb.refineWorkflow as ReturnType<typeof vi.fn>).mockResolvedValueOnce(sampleWorkflow);

    const claudeStub = { run: vi.fn() } as any;
    const result = await adaptWorkflowInteractive(sampleWorkflow, {
      claude: claudeStub,
      skills: [],
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(wb.refineWorkflow).toHaveBeenCalledWith(sampleWorkflow, "make it better", expect.any(Object));
    expect(result).toEqual(sampleWorkflow);
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: 3 FAIL — not defined

- [ ] **Step 3: Implement**

Append to `marketplace.ts`:

```ts
import * as p from "@clack/prompts";
import type { Workflow, Claude, Logger } from "../types.js";
import type { Skill as SkillType } from "../types.js";
import { refineWorkflow } from "../workflow-builder.js";
import { DagRenderer } from "./renderer.js";

export interface AdaptOptions {
  claude: Claude;
  skills: SkillType[];
  logger: Logger;
  /** Optional pre-filled first refinement (e.g. buildAdaptPrompt output). */
  initialRefinement?: string;
}

/**
 * Render the workflow DAG and run an accept/refine/cancel loop.
 * Returns the accepted workflow or null on cancel.
 *
 * Applies `initialRefinement` (if provided) before the first render.
 */
export async function adaptWorkflowInteractive(
  workflow: Workflow,
  options: AdaptOptions,
): Promise<Workflow | null> {
  const { claude, skills, logger, initialRefinement } = options;
  let current = workflow;

  if (initialRefinement) {
    const spinner = p.spinner();
    spinner.start("Adapting workflow to your project…");
    try {
      current = await refineWorkflow(current, initialRefinement, { claude, skills, logger });
      spinner.stop("Adapted");
    } catch (err) {
      spinner.stop("Adaptation failed");
      p.log.error(`  ${err instanceof Error ? err.message : String(err)}`);
      // fall through — user sees the un-adapted workflow
    }
  }

  while (true) {
    console.log("");
    console.log(new DagRenderer(current, { animate: false }).renderToString());
    console.log("");

    const action = await p.select({
      message: "Looks good?",
      options: [
        { value: "accept", label: "Yes — use this workflow" },
        { value: "refine", label: "Refine — describe what to change" },
        { value: "cancel", label: "Cancel" },
      ],
    });
    if (p.isCancel(action) || action === "cancel") return null;

    if (action === "accept") return current;

    if (action === "refine") {
      const refinement = await p.text({
        message: "What would you like to change?",
        validate: (v) => (v && v.trim().length > 0 ? undefined : "Refinement is required"),
      });
      if (p.isCancel(refinement)) return null;

      const rspin = p.spinner();
      rspin.start("Refining…");
      try {
        current = await refineWorkflow(current, refinement as string, { claude, skills, logger });
        rspin.stop("Refined");
      } catch (err) {
        rspin.stop("Failed");
        p.log.error(`  ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): adaptWorkflowInteractive — extract accept/refine/cancel loop"
```

---

## Task 9: `installMarketplaceWorkflow` — orchestrator

**Files:**
- Modify: `packages/core/src/cli/marketplace.ts`
- Modify: `packages/core/src/cli/marketplace.test.ts`

**Why:** Top-level function that composes fetch + mismatch + adapt + writes. Called from `runNew` when a marketplace id is passed.

- [ ] **Step 1: Write failing tests**

Append to `marketplace.test.ts`:

```ts
import { installMarketplaceWorkflow } from "./marketplace.js";

// Reuse test skills from earlier
// (testSkills is already defined above in the same file)

describe("installMarketplaceWorkflow", () => {
  const tmpDirs: string[] = [];
  afterEach(() => {
    for (const d of tmpDirs) fs.rmSync(d, { recursive: true, force: true });
    tmpDirs.length = 0;
    vi.restoreAllMocks();
  });

  function tmp(): string {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-install-"));
    tmpDirs.push(dir);
    return dir;
  }

  const sampleYaml =
    "id: pr-review\nname: PR Review\ndescription: Review PRs\nentry: start\n" +
    "nodes:\n  start:\n    name: Start\n    instruction: hi\n    skills: [github]\nedges: []\n";

  it("installs workflow as-is when no mismatch and no .sweny.yml", async () => {
    const cwd = tmp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(sampleYaml, { status: 200 }),
    );

    const result = await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    });

    expect(result.installed).toBe(true);
    expect(result.adapted).toBe(false);
    expect(fs.existsSync(path.join(cwd, ".sweny.yml"))).toBe(true);
    expect(fs.existsSync(path.join(cwd, ".sweny", "workflows", "pr-review.yml"))).toBe(true);
  });

  it("warns and installs as-is when mismatch detected but no agent", async () => {
    const cwd = tmp();
    fs.writeFileSync(path.join(cwd, ".sweny.yml"), "issue-tracker-provider: github-issues\n");
    const yamlWithLinear = sampleYaml.replace("[github]", "[linear]");
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(yamlWithLinear, { status: 200 }),
    );

    const warnings: string[] = [];
    const result = await installMarketplaceWorkflow("pr-review", {
      cwd,
      availableSkills: testSkills,
      claude: null,
      logger: {
        debug: () => {},
        info: () => {},
        warn: (m: string) => warnings.push(m),
        error: () => {},
      },
    });

    expect(result.installed).toBe(true);
    expect(result.adapted).toBe(false);
    expect(result.mismatches).toHaveLength(1);
    expect(warnings.some((w) => w.includes("linear"))).toBe(true);
  });

  it("throws with not-found kind when workflow missing", async () => {
    const cwd = tmp();
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response("", { status: 404 }));

    await expect(
      installMarketplaceWorkflow("nope", {
        cwd,
        availableSkills: testSkills,
        claude: null,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
      }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });
});
```

- [ ] **Step 2: Run to verify fails**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: 3 FAIL — not defined

- [ ] **Step 3: Implement**

Append to `marketplace.ts`:

```ts
import * as fs from "node:fs";
import * as path from "node:path";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { workflowZ, validateWorkflow } from "../schema.js";
import { loadConfigFile } from "./config-file.js";
import {
  extractSkillsFromYaml,
  collectCredentialsForSkills,
  writeSwenyYmlIfMissing,
  appendMissingEnvKeys,
  writeWorkflowFile,
  type Credential,
} from "./new.js";

export interface InstallOptions {
  cwd: string;
  availableSkills: SkillType[];
  /** Claude client for optional LLM adaptation. If null, we install as-is with a warning on mismatch. */
  claude: Claude | null;
  logger: Logger;
}

export interface InstallResult {
  installed: boolean;
  adapted: boolean;
  workflowPath: string;
  mismatches: ProviderMismatch[];
  addedEnvKeys: number;
}

/**
 * Fetch a workflow from swenyai/workflows, adapt if provider mismatch is detected
 * AND an agent is available, then write files idempotently.
 */
export async function installMarketplaceWorkflow(
  id: string,
  options: InstallOptions,
): Promise<InstallResult> {
  const { cwd, availableSkills, claude, logger } = options;

  // 1. Fetch
  const fetched = await fetchMarketplaceWorkflow(id);

  // 2. Load existing config to detect mismatches
  const fileConfig = loadConfigFile(cwd);
  const workflowSkills = extractSkillsFromYaml(fetched.yaml);
  const mismatches = computeProviderMismatch(workflowSkills, fileConfig, availableSkills);

  // 3. Adapt if needed + possible
  let finalYaml = fetched.yaml;
  let adapted = false;
  if (mismatches.length > 0 && claude) {
    try {
      const parsed = workflowZ.parse(parseYaml(fetched.yaml));
      const errs = validateWorkflow(parsed);
      if (errs.length > 0) {
        throw new Error(`Marketplace workflow has schema errors: ${errs.map((e) => e.message).join("; ")}`);
      }
      const refined = await adaptWorkflowInteractive(parsed, {
        claude,
        skills: availableSkills,
        logger,
        initialRefinement: buildAdaptPrompt(mismatches),
      });
      if (refined === null) {
        // user cancelled — signal no install
        return {
          installed: false,
          adapted: false,
          workflowPath: "",
          mismatches,
          addedEnvKeys: 0,
        };
      }
      finalYaml = stringifyYaml(refined, { indent: 2, lineWidth: 120 });
      adapted = true;
    } catch (err) {
      logger.warn(`Adaptation failed, installing as-is: ${err instanceof Error ? err.message : String(err)}`);
    }
  } else if (mismatches.length > 0) {
    const swapDesc = mismatches
      .map((m) => `${m.workflowSkill} → ${m.userProvider}`)
      .join(", ");
    logger.warn(
      `Workflow uses providers different from your .sweny.yml (${swapDesc}). ` +
        `Install as-is and edit manually, or set ANTHROPIC_API_KEY and re-run to adapt automatically.`,
    );
  }

  // 4. Infer providers for fresh-project .sweny.yml (unchanged from existing logic)
  const finalSkills = extractSkillsFromYaml(finalYaml);
  const sourceControl = finalSkills.includes("gitlab") ? "gitlab" : "github";
  const issueTracker = finalSkills.includes("linear")
    ? "linear"
    : finalSkills.includes("jira")
      ? "jira"
      : "github-issues";
  const observability = finalSkills.includes("datadog")
    ? "datadog"
    : finalSkills.includes("sentry")
      ? "sentry"
      : finalSkills.includes("betterstack")
        ? "betterstack"
        : finalSkills.includes("newrelic")
          ? "newrelic"
          : null;

  writeSwenyYmlIfMissing(cwd, sourceControl, observability, issueTracker);

  // 5. Credentials
  const creds: Credential[] = collectCredentialsForSkills(finalSkills, availableSkills);
  const addedEnvKeys = appendMissingEnvKeys(cwd, creds);

  // 6. Workflow file (no overwrite prompt here — caller handles UX)
  const write = writeWorkflowFile(cwd, id, finalYaml, { overwrite: true });

  return {
    installed: true,
    adapted,
    workflowPath: write.path,
    mismatches,
    addedEnvKeys,
  };
}
```

- [ ] **Step 4: Run tests**

Run: `cd packages/core && npx vitest run src/cli/marketplace.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/marketplace.ts packages/core/src/cli/marketplace.test.ts
git commit -m "feat(core): installMarketplaceWorkflow orchestrator"
```

---

## Task 10: Route `marketplaceId` through `runNew`

**Files:**
- Modify: `packages/core/src/cli/new.ts` — accept `options?: { marketplaceId?: string }`, branch on it
- Modify: `packages/core/src/cli/new.test.ts` — test the branch

- [ ] **Step 1: Write failing test**

Append to `new.test.ts`:

```ts
import { runNew } from "./new.js";

vi.mock("./marketplace.js", async () => {
  const actual = await vi.importActual<typeof import("./marketplace.js")>("./marketplace.js");
  return {
    ...actual,
    installMarketplaceWorkflow: vi.fn(),
  };
});

describe("runNew with marketplaceId", () => {
  afterEach(() => vi.restoreAllMocks());

  it("calls installMarketplaceWorkflow when marketplaceId is provided", async () => {
    const mkt = await import("./marketplace.js");
    (mkt.installMarketplaceWorkflow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      installed: true,
      adapted: false,
      workflowPath: "/tmp/.sweny/workflows/pr-review.yml",
      mismatches: [],
      addedEnvKeys: 0,
    });

    await runNew({ marketplaceId: "pr-review" });

    expect(mkt.installMarketplaceWorkflow).toHaveBeenCalledWith(
      "pr-review",
      expect.objectContaining({ cwd: process.cwd() }),
    );
  });
});
```

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/core && npx vitest run src/cli/new.test.ts`
Expected: FAIL — `runNew` doesn't accept options

- [ ] **Step 3: Implement**

In `new.ts`, change `runNew`'s signature and add the marketplace branch near the top:

```ts
export async function runNew(options?: { marketplaceId?: string }): Promise<void> {
  const cwd = process.cwd();

  // ── Marketplace install fast path ───────────────────────────────────
  if (options?.marketplaceId) {
    const { installMarketplaceWorkflow } = await import("./marketplace.js");
    const { ClaudeClient } = await import("../claude.js");
    const allSkills = configuredSkills(process.env, cwd);
    const hasAgent = !!process.env.ANTHROPIC_API_KEY;
    const claude = hasAgent
      ? new ClaudeClient({ maxTurns: 3, cwd, logger: consoleLogger })
      : null;

    p.intro(`Installing ${options.marketplaceId} from marketplace`);

    let result;
    try {
      result = await installMarketplaceWorkflow(options.marketplaceId, {
        cwd,
        availableSkills: allSkills,
        claude,
        logger: consoleLogger,
      });
    } catch (err) {
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    if (!result.installed) {
      p.cancel("Setup cancelled.");
      process.exit(0);
    }

    if (result.adapted) p.log.success("Adapted workflow for your project");
    if (result.addedEnvKeys > 0) p.log.success(`Appended ${result.addedEnvKeys} key(s) to .env`);
    p.log.success(`Created ${path.relative(cwd, result.workflowPath)}`);
    p.outro("Workflow installed!");
    return;
  }

  // ── existing wizard flow ────────────────────────────────────────────
  // (rest of runNew unchanged)
```

- [ ] **Step 4: Run full test suite**

Run: `cd packages/core && npm test`
Expected: PASS (all existing + new tests)

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/new.ts packages/core/src/cli/new.test.ts
git commit -m "feat(core): route marketplaceId through runNew"
```

---

## Task 11: Wire positional `<id>` arg in `main.ts`

**Files:**
- Modify: `packages/core/src/cli/main.ts`

- [ ] **Step 1: Update the `sweny new` command**

Replace the `new` command definition at `main.ts:94–99`:

```ts
program
  .command("new [id]")
  .description(
    "Create a new workflow. With no id, opens the interactive picker. With an id, installs that workflow from the marketplace (swenyai/workflows).",
  )
  .action(async (id: string | undefined) => {
    await runNew(id ? { marketplaceId: id } : undefined);
  });
```

- [ ] **Step 2: Manual smoke test — `sweny new --help`**

Run: `cd packages/core && npm run build && node dist/cli/main.js new --help`
Expected: help text shows `new [id]` with updated description.

- [ ] **Step 3: Run full test suite**

Run: `cd packages/core && npm test`
Expected: PASS

- [ ] **Step 4: Commit**

```bash
git add packages/core/src/cli/main.ts
git commit -m "feat(core): sweny new <id> — marketplace install via positional arg"
```

---

## Task 12: Add "Browse marketplace" wizard option

**Files:**
- Modify: `packages/core/src/cli/new.ts` — add picker option, fetch index, delegate to `installMarketplaceWorkflow`
- Modify: `packages/core/src/cli/new.test.ts` — test the picker path

- [ ] **Step 1: Write failing test**

Append to `new.test.ts`:

```ts
describe("runNew wizard — browse marketplace branch", () => {
  afterEach(() => vi.restoreAllMocks());

  it("fetches index and delegates to installMarketplaceWorkflow when user picks a marketplace entry", async () => {
    const p = await import("@clack/prompts");
    const mkt = await import("./marketplace.js");

    (p.select as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce("__marketplace")
      .mockResolvedValueOnce("pr-review");
    (mkt.fetchMarketplaceIndex as ReturnType<typeof vi.fn>).mockResolvedValueOnce([
      { id: "pr-review", name: "PR Review", description: "Review PRs", skills: ["github"] },
    ]);
    (mkt.installMarketplaceWorkflow as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      installed: true,
      adapted: false,
      workflowPath: "/tmp/.sweny/workflows/pr-review.yml",
      mismatches: [],
      addedEnvKeys: 0,
    });

    await runNew();

    expect(mkt.fetchMarketplaceIndex).toHaveBeenCalled();
    expect(mkt.installMarketplaceWorkflow).toHaveBeenCalledWith("pr-review", expect.any(Object));
  });
});
```

(This test requires adding `fetchMarketplaceIndex: vi.fn()` to the existing `vi.mock("./marketplace.js", ...)` call in `new.test.ts`.)

- [ ] **Step 2: Run to verify fail**

Run: `cd packages/core && npx vitest run src/cli/new.test.ts`
Expected: FAIL — "__marketplace" not in picker

- [ ] **Step 3: Implement**

In `new.ts`, add the option at the top of the template picker (inside `runNew`, in the existing `p.select` at line 500):

```ts
  const templateChoice = await p.select({
    message: "What do you want to do?",
    options: [
      { value: "__marketplace", label: "Browse marketplace", hint: "install a published workflow from swenyai/workflows" },
      ...WORKFLOW_TEMPLATES.map((t) => ({
        value: t.id,
        label: t.name,
        hint: t.description,
      })),
      { value: "__e2e", label: "End-to-end browser testing", hint: "Automated browser tests for your app" },
      { value: "__custom", label: "Describe your own", hint: "AI-generated from your description" },
      { value: "__blank", label: "Start blank", hint: "just set up config, I'll create workflows later" },
    ],
  });
  if (p.isCancel(templateChoice)) cancel();
```

Then handle the new branch immediately after the `__e2e` short-circuit (around line 515):

```ts
  if (templateChoice === "__marketplace") {
    const { fetchMarketplaceIndex } = await import("./marketplace.js");
    const spinner = p.spinner();
    spinner.start("Fetching marketplace index…");
    let entries;
    try {
      entries = await fetchMarketplaceIndex();
      spinner.stop(`Found ${entries.length} workflow(s)`);
    } catch (err) {
      spinner.stop("Failed");
      p.log.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }

    const pick = await p.select({
      message: "Which workflow?",
      options: entries.map((e) => ({
        value: e.id,
        label: e.name,
        hint: e.description,
      })),
    });
    if (p.isCancel(pick)) cancel();

    // Delegate to the marketplace install path
    return runNew({ marketplaceId: pick as string });
  }
```

- [ ] **Step 4: Run full test suite**

Run: `cd packages/core && npm test`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/cli/new.ts packages/core/src/cli/new.test.ts
git commit -m "feat(core): wizard — browse marketplace option"
```

---

## Task 13: Full end-to-end smoke test

**Files:** no code changes — manual verification

- [ ] **Step 1: Build the CLI**

Run: `cd packages/core && npm run build`
Expected: build succeeds.

- [ ] **Step 2: Verify CLI help**

Run: `node packages/core/dist/cli/main.js new --help`
Expected: shows `new [id]` command with marketplace hint.

- [ ] **Step 3: Verify 404 path in isolation (no marketplace repo yet)**

Run: `cd /tmp && mkdir sweny-smoke && cd sweny-smoke && node /absolute/path/to/sweny/packages/core/dist/cli/main.js new nonexistent`
Expected: error message includes "Workflow \"nonexistent\" not found in swenyai/workflows" and exits non-zero.

- [ ] **Step 4: Verify test suite is green**

Run: `cd packages/core && npm test`
Expected: all tests pass, including new `marketplace.test.ts`.

- [ ] **Step 5: Verify nothing leaked into existing behavior**

Run: `cd packages/core && node dist/cli/main.js new` (in a clean temp dir)
Expected: wizard intro appears; picker shows "Browse marketplace" as the top option.

- [ ] **Step 6: Commit a note if any smoke test failed (or skip if all green)**

No commit needed if everything passes.

---

## Follow-ups (not part of this plan)

1. **Create `swenyai/workflows` repo** with the 4 templates from `templates.ts` as seed content + an `index.json` generator GitHub Action. Until this repo exists, `sweny new <id>` always hits 404 but the error message is correct.
2. **Marketplace rate-limit backoff** — detect `GITHUB_TOKEN` in env and send it as `Authorization: Bearer ${token}` to raise the 60/hr anonymous limit to 5000/hr.
3. **Local HTTP cache** (`~/.sweny/cache/marketplace/<id>.yml` with a TTL) — only if rate limits bite in practice.
4. **Versioning** — `sweny new pr-review@v2` resolves to a tag.
5. **Cloud proxy** — `api.sweny.ai/marketplace/<id>` for search/ranking once the marketplace has >50 workflows.
