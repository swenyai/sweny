# Requires + Retry Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship two node-level features in `@sweny-ai/core` — `requires` (pre-condition checks) and `retry` (node-local self-healing on verify failure with optional autonomous reflection).

**Architecture:** Extend the existing verify path resolver and machine-checked correctness story. `requires` runs before the LLM and reuses verify's path helpers. `retry` wraps the LLM call in a bounded loop driven by verify failures. Adds one new method (`Claude.ask`) for autonomous reflection mode.

**Tech Stack:** TypeScript, Zod 4, Vitest 4, ESM. Tests live in `packages/core/src/__tests__/`. Execute from `packages/core/`.

**Spec:** `docs/superpowers/specs/2026-04-19-requires-and-retry-design.md`

---

## File Map

**New files:**
- `packages/core/src/requires.ts` — `evaluateRequires(requires, contextMap): string | null`
- `packages/core/src/retry.ts` — `buildRetryPreamble(opts): Promise<string>`
- `packages/core/src/__tests__/requires.test.ts`
- `packages/core/src/__tests__/retry.test.ts`

**Modified files:**
- `packages/core/src/types.ts` — `NodeRequires`, `NodeRetry`, optional fields on `Node`, `TraceStep.retryAttempt`, new `node:retry` `ExecutionEvent` variant, new `Claude.ask` method
- `packages/core/src/schema.ts` — `nodeRequiresZ`, `nodeRetryZ`, extend `nodeZ`, extend `workflowJsonSchema`
- `packages/core/src/executor.ts` — pre-LLM requires gate, retry loop with reflection, observer events, trace step extension
- `packages/core/src/claude.ts` — implement `ClaudeClient.ask`
- `packages/core/src/testing.ts` — implement `MockClaude.ask`
- `packages/core/src/__tests__/schema.test.ts` — Zod validation cases
- `packages/core/src/__tests__/executor.test.ts` — integration coverage
- `packages/core/src/__tests__/spec-conformance.test.ts` — JSON schema export coverage (if pattern requires it)
- `spec/src/content/docs/nodes.mdx` — Requires + Retry sections

**Working directory for all `npm` commands:** `/Users/nate/src/swenyai/sweny/packages/core`

---

## Task 1: Add `NodeRequires` and `NodeRetry` types

**Files:**
- Modify: `packages/core/src/types.ts`

- [ ] **Step 1: Add `NodeRequires` interface near `NodeVerify`**

In `packages/core/src/types.ts`, immediately after the existing `NodeVerify` interface block (around line 96), add:

```ts
/**
 * Machine-checked pre-condition for a node.
 *
 * Evaluated by the executor BEFORE the LLM runs. If any declared check fails,
 * the node is marked `failed` (or `skipped` when `on_fail: "skip"`) and the
 * LLM is never invoked.
 *
 * Path roots resolve against the cross-node context map:
 *   { input: <runtime input>, [priorNodeId]: <data of prior node>, ... }
 *
 * Reuses the same path grammar as `verify` (dotted segments, `[*]` wildcard,
 * optional `all:`/`any:` prefix).
 */
export interface NodeRequires {
  /** Listed paths must be present and non-null in the context map. */
  output_required?: string[];
  /** Each assertion must hold against the context map. */
  output_matches?: OutputMatch[];
  /** Action when checks fail. Default: "fail". */
  on_fail?: "fail" | "skip";
}

/**
 * Node-local retry on verify failure.
 *
 * Re-runs the LLM up to `max` additional times, prepending feedback derived
 * from the verify failure. Triggered ONLY by verify failure — not by tool/API
 * errors and not by `requires` failure.
 *
 * `instruction` shapes the feedback preamble:
 *   - omitted        → default "## Previous attempt failed verification..."
 *   - string         → static text + verify error
 *   - { auto: true } → LLM-generated diagnosis from default reflection prompt
 *   - { reflect: s } → LLM-generated diagnosis from author-provided prompt
 */
export interface NodeRetry {
  /** Maximum number of retry attempts after the initial run. Must be ≥ 1. */
  max: number;
  /** Preamble shape — see interface docs. */
  instruction?: string | { auto: true } | { reflect: string };
}
```

- [ ] **Step 2: Add optional fields to `Node`**

In the same file, locate the `interface Node` block. Append two optional fields after the existing `verify?: NodeVerify;` line:

```ts
  /** Machine-checked pre-conditions. Enforced by the executor before the LLM runs. */
  requires?: NodeRequires;
  /** Node-local retry on verify failure (with optional autonomous reflection). */
  retry?: NodeRetry;
```

- [ ] **Step 3: Add `retryAttempt` to `TraceStep`**

Locate the `interface TraceStep` block. After `iteration: number;` add:

```ts
  /** 0-indexed retry attempt for this iteration. Absent when no retry fired. */
  retryAttempt?: number;
```

- [ ] **Step 4: Add `node:retry` `ExecutionEvent` variant**

Locate the `ExecutionEvent` union. Add a new variant before `| { type: "workflow:end"; ... }`:

```ts
  | { type: "node:retry"; node: string; attempt: number; reason: string; preamble: string }
```

- [ ] **Step 5: Add `ask` to `Claude` interface**

Locate the `interface Claude` block. After the `evaluate(...)` method signature, add:

```ts
  /**
   * Single-completion free-text query. No tools, no output schema.
   * Used by the executor to generate retry strategies in autonomous reflection mode.
   */
  ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string>;
```

- [ ] **Step 6: Type-check**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm run typecheck 2>&1 | tail -30`
Expected: errors only in `claude.ts` and `testing.ts` (missing `ask` implementation). Capture them — they will be fixed in Task 2.

If errors appear in any other file, stop and resolve before continuing.

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/types.ts
git commit -m "feat(core): add NodeRequires, NodeRetry, retryAttempt, node:retry, Claude.ask types"
```

---

## Task 2: Implement `Claude.ask` on `ClaudeClient` and `MockClaude`

**Files:**
- Modify: `packages/core/src/claude.ts`
- Modify: `packages/core/src/testing.ts`
- Modify: `packages/core/src/__tests__/claude.test.ts` (or add new test file if pattern differs)

- [ ] **Step 1: Implement `ClaudeClient.ask`**

In `packages/core/src/claude.ts`, after the existing `evaluate(...)` method, add a new method on `ClaudeClient`:

```ts
  async ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string> {
    const { instruction, context } = opts;
    const prompt = [
      instruction,
      Object.keys(context).length > 0
        ? `\nContext:\n\`\`\`json\n${JSON.stringify(context, null, 2)}\n\`\`\``
        : "",
    ]
      .filter(Boolean)
      .join("\n");

    const env = this.buildEnv();
    let response = "";

    try {
      const stream = query({
        prompt,
        options: {
          maxTurns: 1,
          cwd: this.cwd,
          env,
          permissionMode: "bypassPermissions",
          allowDangerouslySkipPermissions: true,
          stderr: (data: string) => this.logger.debug(`[claude-code] ${data}`),
          ...(this.model ? { model: this.model } : {}),
        },
      });

      for await (const message of stream) {
        if (message.type === "result") {
          const resultMsg = message as SDKResultMessage;
          if (resultMsg.subtype === "success" && "result" in resultMsg) {
            response = resultMsg.result;
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`Ask query failed: ${err.message}`);
      return "";
    }

    return response.trim();
  }
```

- [ ] **Step 2: Implement `MockClaude.ask`**

In `packages/core/src/testing.ts`, extend `MockClaudeOptions`:

```ts
export interface MockClaudeOptions {
  /** Node ID → scripted response */
  responses: Record<string, MockNodeResponse>;
  /** Route decisions: "fromNode" → chosen target node ID */
  routes?: Record<string, string>;
  /** Workflow definition — enables instruction-based node matching (required for branching workflows) */
  workflow?: Workflow;
  /** Scripted responses for `ask()` calls. Match function: (instruction, context) → string. */
  ask?: (instruction: string, context: Record<string, unknown>) => string;
}
```

In the `MockClaude` class, add a private field `private askFn?: (i: string, c: Record<string, unknown>) => string;`, set it in the constructor (`this.askFn = opts.ask;`), and add the method:

```ts
  async ask(opts: { instruction: string; context: Record<string, unknown> }): Promise<string> {
    if (this.askFn) return this.askFn(opts.instruction, opts.context);
    return "Mock reflection: no scripted ask handler.";
  }
```

- [ ] **Step 3: Type-check passes**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm run typecheck 2>&1 | tail -10`
Expected: no errors.

- [ ] **Step 4: Add MockClaude.ask test**

Append to `packages/core/src/__tests__/claude.test.ts` (find the `describe("MockClaude", ...)` block; if absent, add a new top-level block):

```ts
  describe("ask", () => {
    it("returns scripted response from ask handler", async () => {
      const claude = new MockClaude({
        responses: {},
        ask: (instruction, context) => `Got: ${instruction}; ctx keys: ${Object.keys(context).join(",")}`,
      });
      const result = await claude.ask({ instruction: "diagnose this", context: { error: "x" } });
      expect(result).toBe("Got: diagnose this; ctx keys: error");
    });

    it("returns default mock string when no ask handler is provided", async () => {
      const claude = new MockClaude({ responses: {} });
      const result = await claude.ask({ instruction: "anything", context: {} });
      expect(result).toMatch(/Mock reflection/);
    });
  });
```

- [ ] **Step 5: Run the new tests**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/claude.test.ts 2>&1 | tail -20`
Expected: all tests pass (including the two new ones).

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/claude.ts packages/core/src/testing.ts packages/core/src/__tests__/claude.test.ts
git commit -m "feat(core): implement Claude.ask on ClaudeClient and MockClaude"
```

---

## Task 3: Implement `evaluateRequires`

**Files:**
- Create: `packages/core/src/requires.ts`
- Create: `packages/core/src/__tests__/requires.test.ts`

- [ ] **Step 1: Write the failing test file**

Create `packages/core/src/__tests__/requires.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { evaluateRequires } from "../requires.js";
import type { NodeRequires } from "../types.js";

describe("evaluateRequires", () => {
  it("returns null when requires is undefined", () => {
    expect(evaluateRequires(undefined, { input: {} })).toBeNull();
  });

  it("returns null when all checks pass", () => {
    const requires: NodeRequires = {
      output_required: ["input.repoUrl"],
      output_matches: [{ path: "triage.recommendation", equals: "implement" }],
    };
    const ctx = { input: { repoUrl: "https://x" }, triage: { recommendation: "implement" } };
    expect(evaluateRequires(requires, ctx)).toBeNull();
  });

  it("reports missing input field", () => {
    const requires: NodeRequires = { output_required: ["input.repoUrl"] };
    const err = evaluateRequires(requires, { input: {} });
    expect(err).not.toBeNull();
    expect(err).toMatch(/^requires failed:/);
    expect(err).toMatch(/'input\.repoUrl'/);
  });

  it("reports missing prior node output", () => {
    const requires: NodeRequires = { output_required: ["triage.recommendation"] };
    const err = evaluateRequires(requires, { input: {} });
    expect(err).not.toBeNull();
    expect(err).toMatch(/'triage\.recommendation'/);
  });

  it("reports null upstream value as missing", () => {
    const requires: NodeRequires = { output_required: ["triage.recommendation"] };
    const err = evaluateRequires(requires, { input: {}, triage: { recommendation: null } });
    expect(err).toMatch(/null/);
  });

  it("supports `any:` wildcard semantics on requires paths", () => {
    const requires: NodeRequires = {
      output_required: ["any:scan.findings[*].severity"],
    };
    const ctx = { input: {}, scan: { findings: [{ severity: "low" }, {}] } };
    expect(evaluateRequires(requires, ctx)).toBeNull();
  });

  it("reports output_matches failure with operator description", () => {
    const requires: NodeRequires = {
      output_matches: [{ path: "triage.recommendation", equals: "implement" }],
    };
    const err = evaluateRequires(requires, { input: {}, triage: { recommendation: "skip" } });
    expect(err).toMatch(/equals "implement"/);
    expect(err).toMatch(/got "skip"/);
  });

  it("aggregates multiple failures into one string", () => {
    const requires: NodeRequires = {
      output_required: ["input.a", "input.b"],
      output_matches: [{ path: "input.c", equals: 1 }],
    };
    const err = evaluateRequires(requires, { input: { c: 2 } });
    expect(err).toMatch(/'input\.a'/);
    expect(err).toMatch(/'input\.b'/);
    expect(err).toMatch(/'input\.c'/);
  });

  it("does not crash when context map is empty", () => {
    const requires: NodeRequires = { output_required: ["input.x"] };
    const err = evaluateRequires(requires, {});
    expect(err).not.toBeNull();
  });
});
```

- [ ] **Step 2: Verify test fails (file doesn't exist yet)**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/requires.test.ts 2>&1 | tail -10`
Expected: FAIL with module-not-found error pointing at `../requires.js`.

- [ ] **Step 3: Implement `requires.ts`**

Create `packages/core/src/requires.ts`:

```ts
// ─── Requires: pre-condition gate ───────────────────────────────────
//
// Evaluates `node.requires` BEFORE the LLM runs. Same path grammar and
// resolver as verify — the only differences are the data root (cross-node
// context map instead of result.data) and the error prefix.

import type { NodeRequires } from "./types.js";
import { checkOutputRequired, checkOutputMatches } from "./verify.js";

/**
 * Evaluate a node's `requires` block against the cross-node context map.
 * Returns null when all checks pass (or when `requires` is undefined),
 * otherwise a single concatenated failure string.
 */
export function evaluateRequires(
  requires: NodeRequires | undefined,
  context: Record<string, unknown>,
): string | null {
  if (!requires) return null;

  const failures: string[] = [];

  if (requires.output_required && requires.output_required.length > 0) {
    const e = checkOutputRequired(requires.output_required, context);
    if (e) failures.push(e);
  }
  if (requires.output_matches && requires.output_matches.length > 0) {
    const e = checkOutputMatches(requires.output_matches, context);
    if (e) failures.push(e);
  }

  if (failures.length === 0) return null;
  return `requires failed:\n  - ${failures.join("\n  - ")}`;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/requires.test.ts 2>&1 | tail -15`
Expected: all 9 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/requires.ts packages/core/src/__tests__/requires.test.ts
git commit -m "feat(core): add evaluateRequires pre-condition checker"
```

---

## Task 4: Implement `buildRetryPreamble`

**Files:**
- Create: `packages/core/src/retry.ts`
- Create: `packages/core/src/__tests__/retry.test.ts`

- [ ] **Step 1: Write failing test file**

Create `packages/core/src/__tests__/retry.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { buildRetryPreamble } from "../retry.js";
import type { Claude, ToolCall, NodeRetry, Logger } from "../types.js";

const tc = (tool: string, output?: unknown): ToolCall => ({ tool, input: {}, output });

const silentLogger: Logger = {
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {},
};

function fakeClaude(askResult: string | (() => Promise<string>) | (() => string)): Claude {
  return {
    run: async () => ({ status: "success", data: {}, toolCalls: [] }),
    evaluate: async () => "x",
    ask: vi.fn(async () => {
      if (typeof askResult === "function") return askResult();
      return askResult;
    }),
  };
}

describe("buildRetryPreamble", () => {
  const verifyError = "verify failed:\n  - any_tool_called: required one of [foo]";
  const nodeInstruction = "Open a PR with the fix";

  it("uses default preamble when no instruction is provided", async () => {
    const claude = fakeClaude("");
    const result = await buildRetryPreamble({
      retry: { max: 1 },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(result).toMatch(/Previous attempt failed verification/);
    expect(result).toContain(verifyError);
    expect(claude.ask).not.toHaveBeenCalled();
  });

  it("uses static string preamble when instruction is a string", async () => {
    const claude = fakeClaude("");
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: "Remember to call linear_create_issue first." },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(result).toContain("Remember to call linear_create_issue first.");
    expect(result).toContain(verifyError);
    expect(claude.ask).not.toHaveBeenCalled();
  });

  it("calls claude.ask with default reflection prompt when instruction.auto is true", async () => {
    const claude = fakeClaude("Diagnosis: you forgot to call foo. Strategy: call foo first.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [tc("bar", { ok: true })],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    expect(askSpy).toHaveBeenCalledOnce();
    const callArg = askSpy.mock.calls[0][0];
    expect(callArg.instruction).toMatch(/Briefly diagnose the failure/);
    expect(callArg.instruction).toContain(nodeInstruction);
    expect(callArg.instruction).toContain(verifyError);
    expect(callArg.instruction).toContain("bar"); // tool calls summary
    expect(result).toContain("Diagnosis: you forgot to call foo");
    expect(result).toContain(verifyError);
  });

  it("calls claude.ask with author prompt when instruction.reflect is set", async () => {
    const claude = fakeClaude("Custom diagnosis.");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { reflect: "Focus on the missing tool calls only." } },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    const callArg = askSpy.mock.calls[0][0];
    expect(callArg.instruction).toContain("Focus on the missing tool calls only.");
    expect(callArg.instruction).toContain(verifyError);
  });

  it("falls back to default preamble when claude.ask throws", async () => {
    const claude = fakeClaude(() => {
      throw new Error("network exploded");
    });
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed verification/);
    expect(result).toContain(verifyError);
    expect(warnSpy).toHaveBeenCalledOnce();
    expect(warnSpy.mock.calls[0][0]).toMatch(/reflection/i);
  });

  it("falls back to default preamble when claude.ask returns empty string", async () => {
    const claude = fakeClaude("   ");
    const warnSpy = vi.fn();
    const logger: Logger = { ...silentLogger, warn: warnSpy };
    const result = await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [],
      nodeInstruction,
      claude,
      logger,
    });
    expect(result).toMatch(/Previous attempt failed verification/);
    expect(warnSpy).toHaveBeenCalledOnce();
  });

  it("includes tool call summary in reflection prompt (names + ok/error)", async () => {
    const claude = fakeClaude("ok");
    const askSpy = claude.ask as ReturnType<typeof vi.fn>;
    await buildRetryPreamble({
      retry: { max: 1, instruction: { auto: true } },
      verifyError,
      toolCalls: [tc("foo", { ok: true }), tc("bar", { error: "boom" })],
      nodeInstruction,
      claude,
      logger: silentLogger,
    });
    const promptText = askSpy.mock.calls[0][0].instruction as string;
    expect(promptText).toContain("foo");
    expect(promptText).toContain("bar");
    expect(promptText).toMatch(/error/i);
  });
});
```

- [ ] **Step 2: Verify test fails**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/retry.test.ts 2>&1 | tail -10`
Expected: FAIL with module-not-found error pointing at `../retry.js`.

- [ ] **Step 3: Implement `retry.ts`**

Create `packages/core/src/retry.ts`:

```ts
// ─── Retry: preamble construction for verify-failure self-healing ──
//
// Builds the preamble that gets prepended to the node instruction on retry.
// In autonomous modes ({ auto: true } or { reflect: ... }), this calls
// claude.ask to generate a diagnosis. If reflection fails or returns empty,
// falls back to the default static preamble — reflection failure never
// escalates to a workflow failure.

import type { Claude, NodeRetry, ToolCall, Logger } from "./types.js";

const DEFAULT_REFLECTION_PROMPT = "Briefly diagnose the failure and state your strategy for the retry. Keep your response to 2-4 sentences.";

const DEFAULT_PREAMBLE_HEADER = "## Previous attempt failed verification";

export interface BuildRetryPreambleOptions {
  retry: NodeRetry;
  verifyError: string;
  toolCalls: ToolCall[];
  nodeInstruction: string;
  claude: Claude;
  logger: Logger;
}

/**
 * Build the retry preamble for a single retry attempt.
 *
 * Resolution order:
 *   1. If retry.instruction is a string         → static preamble + verify error
 *   2. If retry.instruction is { auto: true }   → claude.ask(default prompt)
 *   3. If retry.instruction is { reflect: "..." } → claude.ask(author prompt)
 *   4. Otherwise (omitted)                      → default preamble
 *
 * Reflection failure (throw or empty response) silently falls back to the
 * default static preamble and logs a warning.
 */
export async function buildRetryPreamble(opts: BuildRetryPreambleOptions): Promise<string> {
  const { retry, verifyError, toolCalls, nodeInstruction, claude, logger } = opts;

  const inst = retry.instruction;

  if (typeof inst === "string") {
    return `## Retry guidance\n\n${inst}\n\n${DEFAULT_PREAMBLE_HEADER}\n\n${verifyError}`;
  }

  if (inst && typeof inst === "object") {
    const reflectPrompt = "reflect" in inst ? inst.reflect : DEFAULT_REFLECTION_PROMPT;
    const askInstruction = buildReflectionPrompt(reflectPrompt, nodeInstruction, verifyError, toolCalls);
    try {
      const diagnosis = await claude.ask({ instruction: askInstruction, context: {} });
      const trimmed = diagnosis.trim();
      if (trimmed.length > 0) {
        return `## Reflection on previous attempt\n\n${trimmed}\n\n${DEFAULT_PREAMBLE_HEADER}\n\n${verifyError}`;
      }
      logger.warn("Retry reflection returned empty response; falling back to default preamble.");
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn(`Retry reflection threw: ${msg}; falling back to default preamble.`);
    }
  }

  return defaultPreamble(verifyError);
}

function defaultPreamble(verifyError: string): string {
  return `${DEFAULT_PREAMBLE_HEADER}\n\n${verifyError}\n\nFix the issue and try again.`;
}

function buildReflectionPrompt(
  reflectPrompt: string,
  nodeInstruction: string,
  verifyError: string,
  toolCalls: ToolCall[],
): string {
  const summary = summarizeToolCalls(toolCalls);
  return [
    `You attempted to: ${nodeInstruction}`,
    "",
    `Verification failed with: ${verifyError}`,
    "",
    `You called these tools during the failed attempt:`,
    summary,
    "",
    reflectPrompt,
  ].join("\n");
}

function summarizeToolCalls(toolCalls: ToolCall[]): string {
  if (toolCalls.length === 0) return "(no tools were called)";
  return toolCalls
    .map((c) => {
      const status = isError(c.output) ? "error" : "ok";
      return `  - ${c.tool} (${status})`;
    })
    .join("\n");
}

function isError(output: unknown): boolean {
  if (!output || typeof output !== "object") return false;
  const err = (output as Record<string, unknown>).error;
  return err !== undefined && err !== null && err !== false;
}
```

- [ ] **Step 4: Verify tests pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/retry.test.ts 2>&1 | tail -20`
Expected: all 7 tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/retry.ts packages/core/src/__tests__/retry.test.ts
git commit -m "feat(core): add buildRetryPreamble with autonomous reflection support"
```

---

## Task 5: Add Zod schema for `NodeRequires`

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Append to `packages/core/src/__tests__/schema.test.ts` (find a sensible location near the existing `nodeVerifyZ` tests; if a `describe("nodeRequiresZ", ...)` block does not yet exist, add a fresh one at the bottom):

```ts
describe("nodeRequiresZ", () => {
  it("accepts output_required only", () => {
    expect(() => nodeRequiresZ.parse({ output_required: ["input.x"] })).not.toThrow();
  });

  it("accepts output_matches only", () => {
    expect(() =>
      nodeRequiresZ.parse({ output_matches: [{ path: "input.x", equals: 1 }] }),
    ).not.toThrow();
  });

  it("accepts on_fail: 'fail'", () => {
    expect(() =>
      nodeRequiresZ.parse({ output_required: ["input.x"], on_fail: "fail" }),
    ).not.toThrow();
  });

  it("accepts on_fail: 'skip'", () => {
    expect(() =>
      nodeRequiresZ.parse({ output_required: ["input.x"], on_fail: "skip" }),
    ).not.toThrow();
  });

  it("rejects empty requires (no checks declared)", () => {
    expect(() => nodeRequiresZ.parse({})).toThrow();
  });

  it("rejects on_fail other than 'fail' or 'skip'", () => {
    expect(() =>
      nodeRequiresZ.parse({ output_required: ["input.x"], on_fail: "throw" }),
    ).toThrow();
  });

  it("rejects empty output_required array", () => {
    expect(() => nodeRequiresZ.parse({ output_required: [] })).toThrow();
  });

  it("nodeZ accepts a node with requires", () => {
    expect(() =>
      nodeZ.parse({
        name: "Test",
        instruction: "Do thing",
        skills: [],
        requires: { output_required: ["input.x"] },
      }),
    ).not.toThrow();
  });
});
```

If `nodeRequiresZ` and `nodeZ` are not already imported in this file, ensure both names appear in the existing import statement at the top of `schema.test.ts`.

- [ ] **Step 2: Verify tests fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/schema.test.ts -t nodeRequiresZ 2>&1 | tail -10`
Expected: FAIL with `nodeRequiresZ is not defined` or import error.

- [ ] **Step 3: Add `nodeRequiresZ` to `schema.ts`**

In `packages/core/src/schema.ts`, immediately after the `nodeVerifyZ` block, add:

```ts
export const nodeRequiresZ = z
  .object({
    output_required: z.array(z.string().min(1)).min(1).optional(),
    output_matches: z.array(outputMatchZ).min(1).optional(),
    on_fail: z.enum(["fail", "skip"]).optional(),
  })
  .refine(
    (r) => r.output_required !== undefined || r.output_matches !== undefined,
    {
      message: "requires must declare at least one check (output_required or output_matches)",
    },
  );
```

- [ ] **Step 4: Extend `nodeZ` with `requires`**

Locate `export const nodeZ = z.object({ ... });` and add `requires: nodeRequiresZ.optional(),` after the `verify: nodeVerifyZ.optional(),` line.

- [ ] **Step 5: Verify tests pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/schema.test.ts -t nodeRequiresZ 2>&1 | tail -15`
Expected: all 8 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): add nodeRequiresZ Zod schema and extend nodeZ"
```

---

## Task 6: Add Zod schema for `NodeRetry`

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/__tests__/schema.test.ts`

- [ ] **Step 1: Write failing schema tests**

Append to `packages/core/src/__tests__/schema.test.ts`:

```ts
describe("nodeRetryZ", () => {
  it("accepts max alone", () => {
    expect(() => nodeRetryZ.parse({ max: 2 })).not.toThrow();
  });

  it("accepts max + string instruction", () => {
    expect(() => nodeRetryZ.parse({ max: 1, instruction: "Try harder" })).not.toThrow();
  });

  it("accepts max + { auto: true }", () => {
    expect(() => nodeRetryZ.parse({ max: 1, instruction: { auto: true } })).not.toThrow();
  });

  it("accepts max + { reflect: '...' }", () => {
    expect(() =>
      nodeRetryZ.parse({ max: 1, instruction: { reflect: "Focus on tool calls" } }),
    ).not.toThrow();
  });

  it("rejects max: 0", () => {
    expect(() => nodeRetryZ.parse({ max: 0 })).toThrow();
  });

  it("rejects negative max", () => {
    expect(() => nodeRetryZ.parse({ max: -1 })).toThrow();
  });

  it("rejects non-integer max", () => {
    expect(() => nodeRetryZ.parse({ max: 1.5 })).toThrow();
  });

  it("rejects { auto: false }", () => {
    expect(() => nodeRetryZ.parse({ max: 1, instruction: { auto: false } })).toThrow();
  });

  it("rejects empty reflect string", () => {
    expect(() => nodeRetryZ.parse({ max: 1, instruction: { reflect: "" } })).toThrow();
  });

  it("rejects instruction with both auto and reflect", () => {
    expect(() =>
      nodeRetryZ.parse({ max: 1, instruction: { auto: true, reflect: "x" } as any }),
    ).toThrow();
  });

  it("requires max field", () => {
    expect(() => nodeRetryZ.parse({ instruction: "x" })).toThrow();
  });

  it("nodeZ accepts a node with retry", () => {
    expect(() =>
      nodeZ.parse({
        name: "Test",
        instruction: "Do thing",
        skills: [],
        retry: { max: 2, instruction: { auto: true } },
      }),
    ).not.toThrow();
  });
});
```

Ensure `nodeRetryZ` is imported at the top of `schema.test.ts`.

- [ ] **Step 2: Verify tests fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/schema.test.ts -t nodeRetryZ 2>&1 | tail -10`
Expected: FAIL with `nodeRetryZ is not defined`.

- [ ] **Step 3: Add `nodeRetryZ` to `schema.ts`**

In `packages/core/src/schema.ts`, immediately after `nodeRequiresZ`, add:

```ts
const retryInstructionAutoZ = z.object({ auto: z.literal(true) }).strict();
const retryInstructionReflectZ = z.object({ reflect: z.string().min(1) }).strict();

export const nodeRetryZ = z.object({
  max: z.number().int().min(1),
  instruction: z
    .union([z.string().min(1), retryInstructionAutoZ, retryInstructionReflectZ])
    .optional(),
});
```

- [ ] **Step 4: Extend `nodeZ` with `retry`**

In the `nodeZ = z.object({...})` definition, add `retry: nodeRetryZ.optional(),` after the `requires:` line.

- [ ] **Step 5: Verify tests pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/schema.test.ts -t nodeRetryZ 2>&1 | tail -20`
Expected: all 12 tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/__tests__/schema.test.ts
git commit -m "feat(core): add nodeRetryZ Zod schema with tagged-union instruction"
```

---

## Task 7: Wire `requires` gate into the executor

**Files:**
- Modify: `packages/core/src/executor.ts`
- Modify: `packages/core/src/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing executor tests for requires**

Append to `packages/core/src/__tests__/executor.test.ts`:

```ts
describe("requires (pre-conditions)", () => {
  it("fails the node and skips the LLM when output_required is missing", async () => {
    const workflow: Workflow = {
      id: "req-fail",
      name: "Req Fail",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          requires: { output_required: ["input.missing"] },
        },
      },
      edges: [],
    };
    const claude = new MockClaude({
      responses: { a: { data: { ran: true } } },
      workflow,
    });
    const { results } = await execute(workflow, { other: 1 }, {
      skills: createSkillMap([]),
      claude,
    });
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.data.error).toMatch(/^requires failed:/);
    expect(a.data.error).toMatch(/'input\.missing'/);
    expect(claude.executedNodes).toEqual([]); // LLM never ran
  });

  it("skips the node when on_fail: 'skip' and requires fails", async () => {
    const workflow: Workflow = {
      id: "req-skip",
      name: "Req Skip",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          requires: { output_required: ["input.missing"], on_fail: "skip" },
        },
      },
      edges: [],
    };
    const claude = new MockClaude({ responses: { a: { data: {} } }, workflow });
    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
    });
    const a = results.get("a")!;
    expect(a.status).toBe("skipped");
    expect(a.data.skipped_reason).toMatch(/requires not met/);
    expect(claude.executedNodes).toEqual([]);
  });

  it("runs the LLM when requires passes", async () => {
    const workflow: Workflow = {
      id: "req-pass",
      name: "Req Pass",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          requires: { output_required: ["input.x"] },
        },
      },
      edges: [],
    };
    const claude = new MockClaude({ responses: { a: { data: { ran: true } } }, workflow });
    const { results } = await execute(workflow, { x: 1 }, {
      skills: createSkillMap([]),
      claude,
    });
    expect(results.get("a")!.status).toBe("success");
    expect(claude.executedNodes).toEqual(["a"]);
  });

  it("resolves cross-node paths against prior node data", async () => {
    const workflow: Workflow = {
      id: "req-cross",
      name: "Req Cross",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Do A", skills: [] },
        b: {
          name: "B",
          instruction: "Do B",
          skills: [],
          requires: { output_required: ["a.handle"] },
        },
      },
      edges: [{ from: "a", to: "b" }],
    };
    const claude = new MockClaude({
      responses: {
        a: { data: { handle: "ok" } },
        b: { data: { ran: true } },
      },
      workflow,
    });
    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
    });
    expect(results.get("b")!.status).toBe("success");
  });
});
```

(`Workflow` is already imported at the top of `executor.test.ts`.)

- [ ] **Step 2: Verify tests fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "requires" 2>&1 | tail -20`
Expected: FAIL — node `a` has `status: "success"` (executor ignores `requires` field).

- [ ] **Step 3: Wire requires gate into executor**

In `packages/core/src/executor.ts`, add an import near the top alongside `import { evaluateVerify } from "./verify.js";`:

```ts
import { evaluateRequires } from "./requires.js";
```

Inside the main `while (currentId)` loop, locate the section where `context` is built (around line 154):

```ts
    // Build context: input + all prior node results
    const context: Record<string, unknown> = {
      input,
      ...Object.fromEntries([...results.entries()].map(([k, v]) => [k, v.data])),
    };
```

Immediately after that block, add the requires gate (before tool wrapping):

```ts
    // Pre-condition gate: evaluate `requires` against the cross-node context
    // BEFORE invoking the LLM. Failure either marks the node failed (on_fail
    // default) or skipped (on_fail: "skip") and skips execution entirely.
    const requiresError = evaluateRequires(node.requires, context);
    if (requiresError) {
      const onFail = node.requires?.on_fail ?? "fail";
      const result: NodeResult =
        onFail === "skip"
          ? {
              status: "skipped",
              data: { skipped_reason: requiresError.replace(/^requires failed:/, "requires not met:") },
              toolCalls: [],
            }
          : {
              status: "failed",
              data: { error: requiresError },
              toolCalls: [],
            };
      results.set(currentId, result);
      trace.steps.push({ node: currentId, status: result.status, iteration });
      safeObserve(observer, { type: "node:exit", node: currentId, result }, logger);
      logger.warn(`  requires ${onFail === "skip" ? "skipped" : "failed"}: ${requiresError}`, { node: currentId });

      // Apply normal routing rules (dry run gate + resolveNext).
      const isDryRun = input && typeof input === "object" && (input as Record<string, unknown>).dryRun === true;
      if (isDryRun) {
        const outEdges = workflow.edges.filter((e) => e.from === currentId);
        if (outEdges.some((e) => e.when)) {
          safeObserve(observer, { type: "route", from: currentId, to: "(end)", reason: "dry run" }, logger);
          currentId = null;
          continue;
        }
      }

      const prevId = currentId;
      currentId = await resolveNext(workflow, currentId, results, input, claude, observer, edgeCounts, logger);
      if (currentId) {
        const reason = workflow.edges.find((e) => e.from === prevId && e.to === currentId)?.when ?? "only path";
        trace.edges.push({ from: prevId, to: currentId, reason });
      }
      continue;
    }
```

- [ ] **Step 4: Verify tests pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "requires" 2>&1 | tail -20`
Expected: all 4 tests pass.

- [ ] **Step 5: Run the full executor test file (no regressions)**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts 2>&1 | tail -10`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/executor.ts packages/core/src/__tests__/executor.test.ts
git commit -m "feat(core): wire requires pre-condition gate into executor"
```

---

## Task 8: Wire `retry` loop into the executor (default + static modes)

**Files:**
- Modify: `packages/core/src/executor.ts`
- Modify: `packages/core/src/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing executor tests for retry (default + static)**

Append to `packages/core/src/__tests__/executor.test.ts`:

```ts
describe("retry on verify failure", () => {
  it("retries with default preamble and succeeds on second attempt", async () => {
    const workflow: Workflow = {
      id: "retry-default",
      name: "Retry Default",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 1 },
        },
      },
      edges: [],
    };

    let callCount = 0;
    const claude: any = {
      run: async (opts: { instruction: string }) => {
        callCount++;
        if (callCount === 1) return { status: "success", data: {}, toolCalls: [] };
        // Second call sees the retry preamble in the instruction
        expect(opts.instruction).toMatch(/Previous attempt failed verification/);
        return { status: "success", data: { done: true }, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
    });
    expect(callCount).toBe(2);
    const a = results.get("a")!;
    expect(a.status).toBe("success");
    expect(a.data.done).toBe(true);
  });

  it("marks failed and stops after retry exhaustion", async () => {
    const workflow: Workflow = {
      id: "retry-exhaust",
      name: "Retry Exhaust",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 2 },
        },
      },
      edges: [],
    };

    let callCount = 0;
    const claude: any = {
      run: async () => {
        callCount++;
        return { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
    });
    expect(callCount).toBe(3); // initial + 2 retries
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.data.error).toMatch(/output_required/);
  });

  it("includes the static preamble text in the retry instruction", async () => {
    const workflow: Workflow = {
      id: "retry-static",
      name: "Retry Static",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 1, instruction: "Try harder this time." },
        },
      },
      edges: [],
    };

    const seenInstructions: string[] = [];
    const claude: any = {
      run: async (opts: { instruction: string }) => {
        seenInstructions.push(opts.instruction);
        return seenInstructions.length === 2
          ? { status: "success", data: { done: true }, toolCalls: [] }
          : { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    await execute(workflow, {}, { skills: createSkillMap([]), claude });
    expect(seenInstructions[1]).toContain("Try harder this time.");
    expect(seenInstructions[1]).toContain("Previous attempt failed verification");
  });

  it("does not retry when claude.run itself fails (non-verify failure)", async () => {
    const workflow: Workflow = {
      id: "retry-no-trigger",
      name: "No Trigger",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 3 },
        },
      },
      edges: [],
    };

    let callCount = 0;
    const claude: any = {
      run: async () => {
        callCount++;
        return { status: "failed", data: { error: "API down" }, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
    });
    expect(callCount).toBe(1);
    expect(results.get("a")!.status).toBe("failed");
    expect(results.get("a")!.data.error).toBe("API down");
  });
});
```

- [ ] **Step 2: Verify tests fail**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "retry on verify failure" 2>&1 | tail -20`
Expected: FAIL — `callCount` is 1 (no retry happens yet).

- [ ] **Step 3: Wire retry loop into executor**

In `packages/core/src/executor.ts`, add an import alongside the requires/verify imports:

```ts
import { buildRetryPreamble } from "./retry.js";
```

Locate the existing post-LLM verify block (around line 213):

```ts
    if (result.status === "success") {
      const verifyError = evaluateVerify(node.verify, result);
      if (verifyError) {
        result.status = "failed";
        result.data = { ...result.data, error: verifyError };
        logger.warn(`  verify failed: ${verifyError}`, { node: currentId });
      }
    }
```

Replace the `claude.run` call and the verify block with a retry loop. The new structure looks like this — locate:

```ts
    // Run Claude on this node
    const result = await claude.run({
      instruction,
      context,
      tools: trackedTools,
      outputSchema: node.output,
      maxTurns: node.max_turns,
      onProgress: (message) => {
        safeObserve(observer, { type: "node:progress", node: currentId!, message }, logger);
      },
    });

    // Machine-checked post-condition. ... (existing verify block)
    if (result.status === "success") {
      const verifyError = evaluateVerify(node.verify, result);
      if (verifyError) {
        result.status = "failed";
        result.data = { ...result.data, error: verifyError };
        logger.warn(`  verify failed: ${verifyError}`, { node: currentId });
      }
    }

    results.set(currentId, result);
    trace.steps.push({ node: currentId, status: result.status, iteration });
```

Replace with:

```ts
    // Run Claude on this node, with optional verify-failure retry loop.
    let attempt = 0;
    let result: NodeResult;
    let currentInstruction = instruction;
    const retry = node.retry;

    // eslint-disable-next-line no-constant-condition
    while (true) {
      result = await claude.run({
        instruction: currentInstruction,
        context,
        tools: trackedTools,
        outputSchema: node.output,
        maxTurns: node.max_turns,
        onProgress: (message) => {
          safeObserve(observer, { type: "node:progress", node: currentId!, message }, logger);
        },
      });

      // Retry only triggers on verify failure — bail on tool/API errors.
      if (result.status !== "success") break;

      const verifyError = evaluateVerify(node.verify, result);
      if (!verifyError) break;

      // Apply verify failure to the result.
      result.status = "failed";
      result.data = { ...result.data, error: verifyError };

      if (!retry || attempt >= retry.max) {
        logger.warn(`  verify failed: ${verifyError}`, { node: currentId });
        break;
      }

      // Build retry preamble + record attempt in trace.
      trace.steps.push({ node: currentId, status: "failed", iteration, retryAttempt: attempt });
      logger.warn(`  verify failed (attempt ${attempt + 1}/${retry.max + 1}): ${verifyError}`, { node: currentId });

      const preamble = await buildRetryPreamble({
        retry,
        verifyError,
        toolCalls: result.toolCalls,
        nodeInstruction: resolvedInstruction,
        claude,
        logger,
      });
      currentInstruction = `${preamble}\n\n---\n\n${instruction}`;
      safeObserve(
        observer,
        { type: "node:retry", node: currentId, attempt: attempt + 1, reason: verifyError, preamble },
        logger,
      );
      attempt++;
    }

    results.set(currentId, result);
    trace.steps.push(
      attempt > 0
        ? { node: currentId, status: result.status, iteration, retryAttempt: attempt }
        : { node: currentId, status: result.status, iteration },
    );
```

- [ ] **Step 4: Verify tests pass**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "retry on verify failure" 2>&1 | tail -20`
Expected: all 4 tests pass.

- [ ] **Step 5: Run the full executor test file**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts 2>&1 | tail -10`
Expected: all tests pass — pre-existing tests still green.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/executor.ts packages/core/src/__tests__/executor.test.ts
git commit -m "feat(core): wire retry-on-verify-failure loop into executor"
```

---

## Task 9: Wire autonomous reflection retry through the executor

**Files:**
- Modify: `packages/core/src/__tests__/executor.test.ts`

(`buildRetryPreamble` already handles auto + reflect; this task confirms end-to-end wiring.)

- [ ] **Step 1: Write failing executor tests for autonomous retry**

Append to `packages/core/src/__tests__/executor.test.ts`:

```ts
describe("retry — autonomous reflection", () => {
  it("calls claude.ask and injects reflection into the retry preamble", async () => {
    const workflow: Workflow = {
      id: "retry-auto",
      name: "Retry Auto",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Open the PR",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 1, instruction: { auto: true } },
        },
      },
      edges: [],
    };

    const askCalls: { instruction: string; context: Record<string, unknown> }[] = [];
    const seenInstructions: string[] = [];

    const claude: any = {
      run: async (opts: { instruction: string }) => {
        seenInstructions.push(opts.instruction);
        return seenInstructions.length === 2
          ? { status: "success", data: { done: true }, toolCalls: [] }
          : { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async (opts: { instruction: string; context: Record<string, unknown> }) => {
        askCalls.push(opts);
        return "Diagnosis: missing the create_pr tool. Strategy: call it before returning.";
      },
    };

    await execute(workflow, {}, { skills: createSkillMap([]), claude });
    expect(askCalls).toHaveLength(1);
    expect(askCalls[0].instruction).toContain("Open the PR");
    expect(askCalls[0].instruction).toMatch(/Briefly diagnose/);
    expect(seenInstructions[1]).toContain("Diagnosis: missing the create_pr tool");
  });

  it("falls back to default preamble when claude.ask throws", async () => {
    const workflow: Workflow = {
      id: "retry-auto-fallback",
      name: "Retry Auto Fallback",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Open the PR",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 1, instruction: { auto: true } },
        },
      },
      edges: [],
    };

    const seenInstructions: string[] = [];
    const claude: any = {
      run: async (opts: { instruction: string }) => {
        seenInstructions.push(opts.instruction);
        return seenInstructions.length === 2
          ? { status: "success", data: { done: true }, toolCalls: [] }
          : { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => {
        throw new Error("network down");
      },
    };

    await execute(workflow, {}, { skills: createSkillMap([]), claude });
    expect(seenInstructions[1]).toMatch(/Previous attempt failed verification/);
  });

  it("uses the author's reflect prompt when instruction.reflect is set", async () => {
    const workflow: Workflow = {
      id: "retry-reflect",
      name: "Retry Reflect",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Open the PR",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 1, instruction: { reflect: "Focus on tool selection only." } },
        },
      },
      edges: [],
    };

    const askCalls: { instruction: string }[] = [];
    const claude: any = {
      run: async () => ({ status: "success", data: { done: true }, toolCalls: [] }),
      evaluate: async () => "x",
      ask: async (opts: { instruction: string; context: Record<string, unknown> }) => {
        askCalls.push(opts);
        return "diagnosis";
      },
    };

    // First call deliberately fails verify (output_required missing) to trigger ask.
    let callCount = 0;
    claude.run = async () => {
      callCount++;
      return callCount === 1
        ? { status: "success", data: {}, toolCalls: [] }
        : { status: "success", data: { done: true }, toolCalls: [] };
    };

    await execute(workflow, {}, { skills: createSkillMap([]), claude });
    expect(askCalls).toHaveLength(1);
    expect(askCalls[0].instruction).toContain("Focus on tool selection only.");
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "autonomous reflection" 2>&1 | tail -20`
Expected: all 3 tests pass (no executor changes needed — `buildRetryPreamble` already handles these modes).

If a test fails, the failure is in `buildRetryPreamble` or its call site in `executor.ts` — fix there, not in the test.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/executor.test.ts
git commit -m "test(core): cover autonomous + reflect retry modes end-to-end"
```

---

## Task 10: Trace + observer extension tests

**Files:**
- Modify: `packages/core/src/__tests__/executor.test.ts`

- [ ] **Step 1: Write failing trace + observer tests**

Append to `packages/core/src/__tests__/executor.test.ts`:

```ts
describe("retry — trace and observer", () => {
  it("records each retry attempt as its own TraceStep with retryAttempt", async () => {
    const workflow: Workflow = {
      id: "retry-trace",
      name: "Retry Trace",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 2 },
        },
      },
      edges: [],
    };

    let callCount = 0;
    const claude: any = {
      run: async () => {
        callCount++;
        return callCount === 3
          ? { status: "success", data: { done: true }, toolCalls: [] }
          : { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    const { trace } = await execute(workflow, {}, { skills: createSkillMap([]), claude });
    const aSteps = trace.steps.filter((s) => s.node === "a");
    expect(aSteps).toHaveLength(3);
    expect(aSteps[0]).toMatchObject({ node: "a", status: "failed", iteration: 1, retryAttempt: 0 });
    expect(aSteps[1]).toMatchObject({ node: "a", status: "failed", iteration: 1, retryAttempt: 1 });
    expect(aSteps[2]).toMatchObject({ node: "a", status: "success", iteration: 1, retryAttempt: 2 });
  });

  it("emits node:retry observer events with attempt and preamble", async () => {
    const workflow: Workflow = {
      id: "retry-observer",
      name: "Retry Observer",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          verify: { output_required: ["done"] },
          retry: { max: 1 },
        },
      },
      edges: [],
    };

    const events: ExecutionEvent[] = [];
    let callCount = 0;
    const claude: any = {
      run: async () => {
        callCount++;
        return callCount === 2
          ? { status: "success", data: { done: true }, toolCalls: [] }
          : { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
      observer: (e) => events.push(e),
    });

    const retryEvents = events.filter((e) => e.type === "node:retry");
    expect(retryEvents).toHaveLength(1);
    const evt = retryEvents[0] as Extract<ExecutionEvent, { type: "node:retry" }>;
    expect(evt.node).toBe("a");
    expect(evt.attempt).toBe(1);
    expect(evt.preamble).toMatch(/Previous attempt failed verification/);
    expect(evt.reason).toMatch(/output_required/);
  });

  it("omits retryAttempt on TraceStep when no retry fires", async () => {
    const workflow: Workflow = {
      id: "no-retry",
      name: "No Retry",
      description: "",
      entry: "a",
      nodes: { a: { name: "A", instruction: "Do A", skills: [] } },
      edges: [],
    };
    const claude = new MockClaude({ responses: { a: { data: { ok: true } } }, workflow });
    const { trace } = await execute(workflow, {}, { skills: createSkillMap([]), claude });
    expect(trace.steps[0].retryAttempt).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "trace and observer" 2>&1 | tail -20`
Expected: all 3 tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/executor.test.ts
git commit -m "test(core): cover retry trace shape and node:retry observer event"
```

---

## Task 11: Cross-feature: requires + retry on the same node

**Files:**
- Modify: `packages/core/src/__tests__/executor.test.ts`

- [ ] **Step 1: Write the cross-feature test**

Append to `packages/core/src/__tests__/executor.test.ts`:

```ts
describe("requires + retry interaction", () => {
  it("does not trigger retry when requires fails (LLM never runs)", async () => {
    const workflow: Workflow = {
      id: "req-no-retry",
      name: "Req No Retry",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          requires: { output_required: ["input.missing"] },
          verify: { output_required: ["done"] },
          retry: { max: 5 },
        },
      },
      edges: [],
    };

    let callCount = 0;
    const claude: any = {
      run: async () => {
        callCount++;
        return { status: "success", data: { done: true }, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    const { results } = await execute(workflow, {}, {
      skills: createSkillMap([]),
      claude,
    });
    expect(callCount).toBe(0);
    const a = results.get("a")!;
    expect(a.status).toBe("failed");
    expect(a.data.error).toMatch(/^requires failed:/);
  });

  it("requires passes → verify fails → retry runs as normal", async () => {
    const workflow: Workflow = {
      id: "req-pass-retry",
      name: "Req Pass Retry",
      description: "",
      entry: "a",
      nodes: {
        a: {
          name: "A",
          instruction: "Do A",
          skills: [],
          requires: { output_required: ["input.x"] },
          verify: { output_required: ["done"] },
          retry: { max: 1 },
        },
      },
      edges: [],
    };

    let callCount = 0;
    const claude: any = {
      run: async () => {
        callCount++;
        return callCount === 2
          ? { status: "success", data: { done: true }, toolCalls: [] }
          : { status: "success", data: {}, toolCalls: [] };
      },
      evaluate: async () => "x",
      ask: async () => "",
    };

    const { results } = await execute(workflow, { x: 1 }, {
      skills: createSkillMap([]),
      claude,
    });
    expect(callCount).toBe(2);
    expect(results.get("a")!.status).toBe("success");
  });
});
```

- [ ] **Step 2: Run the new tests**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/executor.test.ts -t "requires + retry" 2>&1 | tail -15`
Expected: both tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/core/src/__tests__/executor.test.ts
git commit -m "test(core): cover requires + retry interaction on a single node"
```

---

## Task 12: Update `workflowJsonSchema` JSON Schema export

**Files:**
- Modify: `packages/core/src/schema.ts`
- Modify: `packages/core/src/__tests__/spec-conformance.test.ts` (only if it covers JSON-schema field presence; otherwise skip)

- [ ] **Step 1: Inspect spec-conformance pattern**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && grep -n "verify" src/__tests__/spec-conformance.test.ts | head -10`
Expected: lines that reference how verify is asserted in the JSON schema.

If spec-conformance tests assert specific node-level fields in `workflowJsonSchema`, write a parallel assertion for `requires` and `retry` (Step 2 below). If not, skip Step 2 and proceed directly to Step 3.

- [ ] **Step 2 (conditional): Add JSON-schema field-presence test**

If spec-conformance asserts node-level fields, append a similar test:

```ts
it("workflowJsonSchema declares requires and retry on node properties", () => {
  const nodeProps = (workflowJsonSchema.properties.nodes as any).additionalProperties.properties;
  expect(nodeProps.requires).toBeDefined();
  expect(nodeProps.retry).toBeDefined();
  expect(nodeProps.requires.properties.output_required).toBeDefined();
  expect(nodeProps.requires.properties.on_fail.enum).toEqual(["fail", "skip"]);
  expect(nodeProps.retry.properties.max.type).toBe("integer");
});
```

Ensure `workflowJsonSchema` is imported.

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/spec-conformance.test.ts -t "workflowJsonSchema declares requires and retry" 2>&1 | tail -10`
Expected: FAIL — fields not declared yet.

- [ ] **Step 3: Extend `workflowJsonSchema` node properties**

In `packages/core/src/schema.ts`, locate the `nodes` block of `workflowJsonSchema.properties` (around the existing `properties.nodes.additionalProperties.properties`). Add two properties alongside `verify` (note: if `verify` is not yet present in `workflowJsonSchema`, add it as part of this task to maintain parity — confirm by reading the existing block):

```ts
          requires: {
            type: "object",
            description: "Pre-condition checks evaluated before the LLM runs.",
            additionalProperties: false,
            properties: {
              output_required: {
                type: "array",
                items: { type: "string", minLength: 1 },
                minItems: 1,
              },
              output_matches: {
                type: "array",
                items: {
                  type: "object",
                  required: ["path"],
                  additionalProperties: false,
                  properties: {
                    path: { type: "string", minLength: 1 },
                    equals: {},
                    in: { type: "array" },
                    matches: { type: "string", minLength: 1 },
                  },
                },
                minItems: 1,
              },
              on_fail: { type: "string", enum: ["fail", "skip"] },
            },
          },
          retry: {
            type: "object",
            description: "Node-local retry on verify failure.",
            required: ["max"],
            additionalProperties: false,
            properties: {
              max: { type: "integer", minimum: 1 },
              instruction: {
                oneOf: [
                  { type: "string", minLength: 1 },
                  {
                    type: "object",
                    required: ["auto"],
                    additionalProperties: false,
                    properties: { auto: { const: true } },
                  },
                  {
                    type: "object",
                    required: ["reflect"],
                    additionalProperties: false,
                    properties: { reflect: { type: "string", minLength: 1 } },
                  },
                ],
              },
            },
          },
```

- [ ] **Step 4: Verify tests pass**

If Step 2 added a test:
Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npx vitest run src/__tests__/spec-conformance.test.ts 2>&1 | tail -10`
Expected: all tests pass.

If Step 2 was skipped, run a quick smoke check:
```bash
cd /Users/nate/src/swenyai/sweny/packages/core && node --input-type=module -e "import { workflowJsonSchema } from './src/schema.ts'" 2>&1 || true
```
The schema is plain data — verifying the test suite still passes is the real check (Task 13 does the full run).

- [ ] **Step 5: Commit**

```bash
git add packages/core/src/schema.ts packages/core/src/__tests__/spec-conformance.test.ts
git commit -m "feat(core): declare requires and retry in workflowJsonSchema"
```

---

## Task 13: Update spec docs (`spec/src/content/docs/nodes.mdx`)

**Files:**
- Modify: `spec/src/content/docs/nodes.mdx`

- [ ] **Step 1: Read the current file structure**

Run: `cd /Users/nate/src/swenyai/sweny && grep -n "^## " spec/src/content/docs/nodes.mdx`
Expected: ordered list of `##` headings — note where the existing `## Verify` section ends and where to insert `## Requires` and `## Retry`.

- [ ] **Step 2: Add `requires` and `retry` rows to the Fields table**

Locate the node Fields table in `spec/src/content/docs/nodes.mdx`. Find the row that adds `verify` (added in the previous shipping pass). Add two more rows immediately after it:

```mdx
| `requires` | `NodeRequires?` | Pre-condition checks evaluated before the LLM runs. See [Requires](#requires). |
| `retry`    | `NodeRetry?`    | Node-local retry on verify failure with optional autonomous reflection. See [Retry](#retry). |
```

- [ ] **Step 3: Add the `## Requires` section**

Immediately before `## Verify` (so the lifecycle reads pre → run → post in the document), insert:

```mdx
## Requires

Machine-checked **pre-conditions**. Evaluated before the LLM runs. If any
declared check fails, the node is marked failed (or skipped) and the LLM
is never invoked.

### Why

Catch missing upstream context — bad runtime input, an upstream node that
returned without producing a required field — before burning tokens. The
checks are deterministic and run synchronously.

### Schema

```yaml
requires:
  output_required: [string]      # paths must resolve, non-null/undefined
  output_matches: [OutputMatch]  # equals / in / matches
  on_fail: fail | skip            # default: fail
```

### Path roots

Paths resolve against the cross-node context map:

```
{ input: <runtime input>, [priorNodeId]: <data of prior node>, ... }
```

The grammar is identical to [verify paths](#path-grammar): dotted segments,
`[*]` wildcards, optional `all:` / `any:` prefix.

| Path                              | Resolves to                                     |
| --------------------------------- | ----------------------------------------------- |
| `input.repoUrl`                   | The `repoUrl` field on the runtime input.       |
| `triage.recommendation`           | `data.recommendation` of the prior `triage` node. |
| `any:scan.findings[*].severity`   | At least one finding has a non-null severity.   |

### Failure modes

| `on_fail`         | Result status | Result data                                      |
| ----------------- | ------------- | ------------------------------------------------ |
| `fail` (default)  | `failed`      | `{ error: "requires failed: ..." }`              |
| `skip`            | `skipped`     | `{ skipped_reason: "requires not met: ..." }`    |

In both cases the LLM is not invoked. Routing continues normally — edges
with `when` conditions can read the failure status and route around it.

### Example

```yaml
nodes:
  open_pr:
    name: Open PR
    instruction: Open a PR with the fix
    skills: [github]
    requires:
      output_required:
        - input.repoUrl
        - implement_fix.branch
      output_matches:
        - { path: implement_fix.filesChanged, matches: "^[1-9]" }
      on_fail: fail
```
```

- [ ] **Step 4: Add the `## Retry` section**

After the `## Verify` section, insert:

```mdx
## Retry

**Node-local self-healing on verify failure.** When `verify` fails, the
executor re-invokes the LLM up to `max` additional times, prepending
feedback derived from the failure.

Triggered ONLY by verify failure — not by tool/API errors and not by
`requires` failure. Re-running cannot fix upstream data problems.

### Schema

```yaml
retry:
  max: integer                      # ≥ 1
  instruction:                      # optional
    | string                        # static preamble
    | { auto: true }                # LLM-generated diagnosis (default prompt)
    | { reflect: string }           # LLM-generated diagnosis (author prompt)
```

### Modes

| `instruction` value          | Behavior                                                                                   |
| ---------------------------- | ------------------------------------------------------------------------------------------ |
| (omitted)                    | Default preamble: "Previous attempt failed verification: {error}. Fix and try again."       |
| `"static text"`              | Author's text + the verify error appended.                                                  |
| `{ auto: true }`             | Executor calls `claude.ask` with a default reflection prompt; the response becomes preamble. |
| `{ reflect: "<prompt>" }`    | Same as `auto`, but the author's `reflect` prompt is used as the diagnosis question.        |

The preamble is prepended to the node's normal instruction so the LLM sees
it before the original task. Each retry uses only the **latest** verify
failure as feedback — older errors are noise.

### Reflection failure

If `claude.ask` throws or returns empty during autonomous mode, the
executor falls back to the default static preamble for that attempt and
logs a warning. Reflection failure never escalates to a workflow failure.

### Cost

`retry × autonomous reflection` is up to `2 × max + 1` LLM calls per
node (initial + N retries × 2 calls each). Workflow authors set the
ceiling via `max`.

### Trace and observer events

Each attempt is recorded as its own `TraceStep` with a `retryAttempt`
field (0-indexed). The executor emits a `node:retry` observer event
before each retry attempt with `{ node, attempt, reason, preamble }`.

### Example

```yaml
nodes:
  open_pr:
    name: Open PR
    instruction: Open a PR with the fix
    skills: [github]
    verify:
      any_tool_called: [github_create_pr]
      output_required: [prUrl]
    retry:
      max: 2
      instruction: { auto: true }
```
```

- [ ] **Step 5: Verify the markdown renders (link sanity)**

Run: `cd /Users/nate/src/swenyai/sweny && grep -nE "^## (Requires|Retry|Verify)" spec/src/content/docs/nodes.mdx`
Expected: three lines, in order — `## Requires`, `## Verify`, `## Retry`.

- [ ] **Step 6: Commit**

```bash
git add spec/src/content/docs/nodes.mdx
git commit -m "docs(spec): add Requires and Retry sections to nodes spec"
```

---

## Task 14: Final verification + changeset

**Files:**
- Create: `.changeset/requires-and-retry.md`

- [ ] **Step 1: Full type-check across the package**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm run typecheck 2>&1 | tail -10`
Expected: zero errors.

- [ ] **Step 2: Full test suite**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm test 2>&1 | tail -20`
Expected: all tests pass — count should equal pre-existing total + new tests added (≈40+ new test cases across `requires.test.ts`, `retry.test.ts`, `schema.test.ts`, `executor.test.ts`, `claude.test.ts`).

- [ ] **Step 3: Build the package**

Run: `cd /Users/nate/src/swenyai/sweny/packages/core && npm run build 2>&1 | tail -10`
Expected: build succeeds, no errors.

- [ ] **Step 4: Repo-wide test sweep (downstream packages)**

Run: `cd /Users/nate/src/swenyai/sweny && npm test 2>&1 | tail -30`
Expected: all packages green. If a downstream package (e.g. `@sweny-ai/studio`) re-imports `Node` types and breaks because of the new optional fields, fix the import.

- [ ] **Step 5: Create changeset**

Create `.changeset/requires-and-retry.md`:

```md
---
"@sweny-ai/core": minor
---

Add `requires` (pre-condition checks) and `retry` (node-local self-healing on verify failure) to workflow nodes.

`requires` is symmetric to `verify` but runs before the LLM, catching missing upstream context without burning tokens. Same path grammar; resolves against the cross-node context map. Configurable `on_fail: "fail" | "skip"`.

`retry` re-runs the node up to `max` additional times when verify fails. Three feedback modes: default ("Previous attempt failed verification..."), static (author-provided preamble), or autonomous — `{ auto: true }` invokes `claude.ask` to generate a diagnosis from the failure context, and `{ reflect: "..." }` lets the author shape the diagnosis prompt.

Adds one new method to the `Claude` interface: `ask({ instruction, context }): Promise<string>`. Implemented for `ClaudeClient` and `MockClaude`.

Each retry attempt is recorded in the trace with `retryAttempt`; a new `node:retry` observer event fires before each retry.
```

(Bumping `minor` is appropriate — net-additive features, no breaking changes, but new public surface.)

- [ ] **Step 6: Commit changeset**

```bash
git add .changeset/requires-and-retry.md
git commit -m "chore: changeset for requires + retry"
```

- [ ] **Step 7: Hand off to finishing-a-development-branch**

After all tests pass and the changeset is committed, invoke the `superpowers:finishing-a-development-branch` skill — it will verify tests, present merge/PR options, and execute the chosen workflow.

---

## Self-Review

**1. Spec coverage**

- [x] `requires` schema (Task 5) — `output_required`, `output_matches`, `on_fail`
- [x] `requires` path roots vs cross-node context map (Task 7 cross-node test)
- [x] `requires` failure modes (Task 7 fail + skip tests)
- [x] `requires` not retry-triggering (Task 11)
- [x] `retry` schema (Task 6) — `max`, tagged-union `instruction`
- [x] `retry` trigger = verify only (Task 8 "non-verify failure" test)
- [x] `retry` default preamble (Task 8)
- [x] `retry` static preamble (Task 8)
- [x] `retry` autonomous (`auto`) preamble (Task 9)
- [x] `retry` autonomous (`reflect`) preamble (Task 9)
- [x] Reflection failure fallback (Task 4 unit + Task 9 integration)
- [x] Trace shape — `retryAttempt` per attempt (Task 10)
- [x] `node:retry` observer event (Task 10)
- [x] `Claude.ask` interface (Task 1) + impls (Task 2)
- [x] Zod validation refusal cases (Task 5, 6)
- [x] JSON Schema export (Task 12)
- [x] Spec docs (Task 13)
- [x] Changeset (Task 14)

**2. Placeholder scan** — none. Every step has either complete code, an exact command, or a concrete instruction with the file/line context.

**3. Type consistency**
- `evaluateRequires(requires, context)` signature matches across Task 3 (definition) and Task 7 (call site).
- `buildRetryPreamble({ retry, verifyError, toolCalls, nodeInstruction, claude, logger })` signature matches across Task 4 (definition) and Task 8 (call site).
- `Claude.ask({ instruction, context }): Promise<string>` matches across Task 1 (interface), Task 2 (impls), Task 4 (test), and Task 9 (integration test).
- `node:retry` event shape `{ type, node, attempt, reason, preamble }` matches Task 1 (interface), Task 8 (executor), and Task 10 (test).
- `retryAttempt` is optional on `TraceStep` and only emitted when retries fire (Tasks 1, 8, 10).
