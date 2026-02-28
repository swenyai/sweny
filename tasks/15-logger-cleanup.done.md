# Task 15 — Replace `console.error` with Logger

## Objective

Replace all 12 raw `console.error` calls in production source code with proper logger injection. The codebase already has a `Logger` interface in `packages/providers/src/logger.ts` and a `createLogger` factory in `packages/agent/src/logger.ts`. The storage classes bypass both and write directly to stderr.

## Background

- **Logger interface** (`packages/providers/src/logger.ts`):
  ```ts
  export interface Logger {
    info(msg: string, ...args: unknown[]): void;
    debug(msg: string, ...args: unknown[]): void;
    warn(msg: string, ...args: unknown[]): void;
    error(msg: string, ...args: unknown[]): void;
  }
  export const consoleLogger: Logger = { /* uses console.* */ };
  ```

- **`createLogger`** (`packages/agent/src/logger.ts`): Creates a leveled logger with `[prefix]` tag. Re-exports the `Logger` type from providers.

## Files to Modify

### Providers package — Storage classes (add optional `logger` constructor param, default to `consoleLogger`)

1. **`packages/providers/src/storage/session/fs.ts`** (lines 30, 58, 79)
   - `FsSessionStore` constructor: add `private logger: Logger = consoleLogger`
   - Replace `console.error("[session-store]...` → `this.logger.error("[session-store]...`

2. **`packages/providers/src/storage/session/s3.ts`** (lines 38, 70, 100)
   - `S3SessionStore` constructor: add `logger` param
   - Replace `console.error` → `this.logger.error`

3. **`packages/providers/src/storage/memory/fs.ts`** (line 29)
   - `FsMemoryStore` constructor: add `logger` param
   - Replace `console.error` → `this.logger.error`

4. **`packages/providers/src/storage/memory/s3.ts`** (line 39)
   - `S3MemoryStore` constructor: add `logger` param
   - Replace `console.error` → `this.logger.error`

5. **`packages/providers/src/storage/workspace/fs.ts`** (line 52)
   - `FsWorkspaceStore` constructor: add `logger` param
   - Replace `console.error` → `this.logger.error`

6. **`packages/providers/src/storage/workspace/s3.ts`** (line 63)
   - `S3WorkspaceStore` constructor: add `logger` param
   - Replace `console.error` → `this.logger.error`

### Agent package — SessionManager (line 74, 104, 114)

7. **`packages/agent/src/session/manager.ts`**
   - `SessionManager` constructor already accepts `store?` — add `logger?: Logger`
   - Replace 3x `console.error` → `this.logger.error`
   - Default to `consoleLogger` from `@sweny/providers`

### Agent entry points (top-level catch blocks — leave as-is or use logger)

8. **`packages/agent/src/index.ts`** (line 126) — `console.error("[sweny] Fatal error:", err)` — this is a last-resort catch before `process.exit(1)`. **Leave as-is** — logger may not be initialized.

9. **`packages/agent/src/cli.ts`** (line 107) — same pattern, last-resort. **Leave as-is**.

## Implementation Pattern

For each storage class:
```ts
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";

export class FsSessionStore implements SessionStore {
  private logger: Logger;

  constructor(baseDir: string, logger?: Logger) {
    this.baseDir = baseDir;
    this.logger = logger ?? consoleLogger;
  }
  // ... replace console.error → this.logger.error
}
```

## Verification

1. `npm run build --workspace=packages/providers` (must compile)
2. `npm test` (all 343 tests must pass — no test changes needed since tests mock at interface level)
3. `grep -r "console.error" packages/*/src/ --include="*.ts"` — only 4 remaining:
   - `providers/src/logger.ts:12` (the logger implementation itself)
   - `agent/src/logger.ts:25` (the logger implementation itself)
   - `agent/src/index.ts:126` (last-resort fatal)
   - `agent/src/cli.ts:107` (last-resort fatal)
