# Task 26 — Tests for CLI Entry Point

## Objective

Add tests for `packages/agent/src/cli.ts` — the interactive REPL entry point (~109 lines). This is a Tier 3 "nice to have" but rounds out the test coverage.

## File Under Test

`packages/agent/src/cli.ts`

The file is a `main()` function that:
1. Loads config via `loadConfig()`
2. Creates storage stores, plugin registry, model runner, claude runner
3. Creates `cliChannel()` and registers commands
4. Creates Orchestrator wired to CLI channel
5. Prints status banner
6. Calls `channel.start()` with message handler
7. Sets up graceful shutdown on SIGTERM/SIGINT

Note: The CLI channel itself is already tested in `packages/agent/tests/channel/cli.test.ts` (18 tests). This task is about testing the entry point wiring, NOT the CLI channel.

## Approach

Since `main()` is called at module level (`main().catch(...)`) and wires together many real constructors, the most practical test approach is to:

1. Mock the heavy dependencies (`loadConfig`, `ClaudeCodeRunner`, `cliChannel`)
2. Verify the wiring: that Orchestrator is constructed with correct deps
3. Verify the banner prints
4. Verify graceful shutdown handlers are registered

Alternatively, skip this task if the ROI is too low — the CLI channel and Orchestrator are both well-tested individually.

## Test File

`packages/agent/tests/cli.test.ts`

## Test Cases

1. `main()` loads config and creates all components
2. Creates `cliChannel()` and calls `channel.start()`
3. Registers standard commands on the channel
4. Prints status banner with config name
5. Sets up SIGTERM and SIGINT handlers

## Mock Strategy

This requires mocking many modules — may be too brittle for the value. Consider keeping this minimal:

```ts
vi.mock("../src/config/loader.js", () => ({
  loadConfig: vi.fn(async () => ({
    sweny: { name: "test-agent", plugins: [], storage: { createSessionStore: () => ..., ... }, ... },
    env: { claudeApiKey: "key" },
  })),
}));
vi.mock("../src/channel/cli.js");
vi.mock("../src/model/claude-code.js");
```

## Verification

1. `npm test --workspace=packages/agent` — new tests pass
2. `npm test` — all tests pass

## Note

This is the lowest-priority task. If implementation proves too brittle due to the number of mocks required, it's acceptable to skip and mark as done with a note explaining why.
