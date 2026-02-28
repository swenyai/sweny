# Task 18 — Extract AgentRunner Interface

## Objective

Extract an `AgentRunner` interface from the concrete `ClaudeRunner` class so the `Orchestrator` depends on an abstraction, not a concrete implementation. This follows the existing patterns: `AuthProvider`, `AccessGuard`, `Channel`, `ModelRunner` are all interfaces.

## Background

Currently `packages/agent/src/orchestrator.ts` imports and depends on:
```ts
import type { ClaudeRunner } from "./claude/runner.js";
```

And `OrchestratorDeps` has:
```ts
claudeRunner: ClaudeRunner;
```

This couples the Orchestrator to a specific implementation. The goal is to create an `AgentRunner` interface that `ClaudeRunner` implements.

## Two-Layer Abstraction

- **`ModelRunner`** (`packages/agent/src/model/types.ts`) — low-level SDK calls (prompt + tools → response)
- **`AgentRunner`** (NEW) — high-level orchestration (prompt + session + user + memories → response)

## Files to Create

### 1. `packages/agent/src/runner/types.ts`

```ts
import type { Session } from "../session/manager.js";
import type { UserIdentity } from "../auth/types.js";
import type { MemoryEntry } from "../storage/memory/types.js";
import type { RunResult } from "../model/types.js";

export interface AgentRunOpts {
  prompt: string;
  session: Session;
  user: UserIdentity;
  memories: MemoryEntry[];
  formatHint?: string;
}

export interface AgentRunner {
  run(opts: AgentRunOpts): Promise<RunResult>;
}
```

### 2. `packages/agent/src/runner/index.ts`

Barrel file:
```ts
export type { AgentRunner, AgentRunOpts } from "./types.js";
```

## Files to Modify

### 3. `packages/agent/src/claude/runner.ts`

- Add `implements AgentRunner` to `ClaudeRunner`
- Import `AgentRunner` from `../runner/types.js`
- The class already satisfies the interface — no method changes needed

### 4. `packages/agent/src/orchestrator.ts`

- Change import: `ClaudeRunner` → `AgentRunner` (from `./runner/types.js`)
- Change `OrchestratorDeps.claudeRunner: ClaudeRunner` → `runner: AgentRunner`
- Update the `handleMessage` method: `claudeRunner` → `runner`

### 5. `packages/agent/src/index.ts`

- Update the deps object: `claudeRunner` → `runner`

### 6. `packages/agent/src/cli.ts`

- Update the deps object: `claudeRunner` → `runner`

### 7. `packages/agent/tests/orchestrator.test.ts`

- Update imports: `ClaudeRunner` → `AgentRunner` from `../src/runner/types.js`
- Rename mock factory: `makeClaudeRunner()` → `makeRunner()`
- Update `buildDeps()`: `claudeRunner` → `runner`
- Update all test assertions referencing `deps.claudeRunner` → `deps.runner`

## Current Orchestrator (for reference)

```ts
export interface OrchestratorDeps {
  authProvider: AuthProvider;
  sessionManager: SessionManager;
  claudeRunner: ClaudeRunner;   // ← rename to runner: AgentRunner
  memoryStore?: MemoryStore;
  auditLogger?: AuditLogger;
  rateLimiter?: RateLimiter;
  accessGuard: AccessGuard;
  allowedUsers?: string[];
  logger: Logger;
}
```

## Verification

1. `npm run build --workspace=packages/agent` (must compile)
2. `npm test` — all tests pass
3. Verify no remaining imports of `ClaudeRunner` in `orchestrator.ts`
