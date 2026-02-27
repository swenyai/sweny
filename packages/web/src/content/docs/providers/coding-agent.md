---
title: Coding Agent
description: Install and run AI coding agents to implement changes.
---

```typescript
import { claudeCode } from "@sweny/providers/coding-agent";
```

## Interface

```typescript
interface CodingAgent {
  install(): Promise<void>;
  run(opts: CodingAgentRunOptions): Promise<number>;
}

interface CodingAgentRunOptions {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
}
```

## Claude Code

Wraps the Claude Code CLI via `@actions/exec`:

```typescript
const agent = claudeCode({
  cliFlags: ["--verbose"],  // optional extra CLI flags
  logger: myLogger,          // optional
});

// Install the CLI globally
await agent.install();

// Run with a prompt
const exitCode = await agent.run({
  prompt: "Fix the failing test in src/utils.test.ts",
  maxTurns: 10,
  env: { ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY! },
});
```

The `install()` method runs `npm install -g @anthropic-ai/claude-code`. The `run()` method invokes `claude` with `--allowedTools *`, `--dangerously-skip-permissions`, and the configured `--max-turns`.

Requires `@actions/exec` as a peer dependency (available automatically in GitHub Actions).
