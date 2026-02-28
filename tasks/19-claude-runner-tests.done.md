# Task 19 — Tests for ClaudeRunner

## Objective

Add unit tests for `ClaudeRunner` — the agent's brain that orchestrates prompt assembly, plugin resolution, and model delegation. Zero tests currently.

## File Under Test

`packages/agent/src/claude/runner.ts` (88 lines)

```ts
export class ClaudeRunner {
  constructor(config: RunnerConfig, resources: RunnerResources, modelRunner: ModelRunner) { ... }

  async run(opts: { prompt, session, user, memories, formatHint? }): Promise<RunResult> {
    // 1. Build PluginContext from user identity + storage stores
    // 2. Build plugin system prompt sections via registry.buildSystemPromptSections()
    // 3. Build full system prompt via buildSystemPrompt()
    // 4. Build tools from plugin registry via registry.buildToolsForSession()
    // 5. Delegate to modelRunner.run() with assembled prompt, tools, config
  }
}
```

### Dependencies to Mock

```ts
interface RunnerConfig {
  name: string;
  basePrompt?: string;
  maxTurns: number;
  model: { apiKey?: string; oauthToken?: string };
}

interface RunnerResources {
  registry: PluginRegistry;
  memoryStore: MemoryStore;
  workspaceStore: WorkspaceStore;
}

interface ModelRunner {
  run(opts: ModelRunOptions): Promise<RunResult>;
}
```

### Key Types

- `PluginRegistry` — `packages/agent/src/plugins/registry.ts` — has `buildSystemPromptSections(ctx)` and `buildToolsForSession(ctx)` methods
- `buildSystemPrompt` — `packages/agent/src/claude/system-prompt.ts` — pure function
- `DENIED_TOOLS` — `packages/agent/src/claude/tool-guard.ts` — string array

## Test File

`packages/agent/tests/claude/runner.test.ts`

## Test Cases

1. **Passes prompt to modelRunner** — verify `modelRunner.run()` receives `opts.prompt`
2. **Builds system prompt** — verify system prompt includes config name, basePrompt, formatHint, plugin sections, memories
3. **Passes tools from registry** — verify tools returned by `registry.buildToolsForSession()` are forwarded to modelRunner
4. **Passes maxTurns from config** — verify config.maxTurns reaches modelRunner
5. **Passes sessionId from session** — verify `session.agentSessionId` is forwarded
6. **Passes DENIED_TOOLS as disallowedTools** — verify the denied tools list reaches modelRunner
7. **Passes config.name to modelRunner** — verify name propagation
8. **Constructs PluginContext correctly** — verify the PluginContext passed to registry includes correct user, storage, logger
9. **Returns modelRunner result unchanged** — verify the RunResult passes through

## Mock Strategy

```ts
const mockRegistry = {
  buildSystemPromptSections: vi.fn(() => []),
  buildToolsForSession: vi.fn(async () => []),
} as unknown as PluginRegistry;

const mockModelRunner: ModelRunner = {
  run: vi.fn(async () => ({ response: "Hello", sessionId: "s1", toolCalls: [] })),
};

const mockMemoryStore = { getMemories: vi.fn(), addEntry: vi.fn(), removeEntry: vi.fn(), clearMemories: vi.fn() };
const mockWorkspaceStore = { getManifest: vi.fn(), readFile: vi.fn(), writeFile: vi.fn(), deleteFile: vi.fn(), reset: vi.fn(), getDownloadUrl: vi.fn() };
```

## Verification

1. `npm test --workspace=packages/agent` — new tests pass
2. `npm test` — all tests pass
