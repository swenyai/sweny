---
title: Coding Agent
description: Install and run coding agents to implement changes.
---

```typescript
import { claudeCode, openaiCodex, googleGemini } from "@sweny-ai/providers/coding-agent";
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

The `install()` method runs `npm install -g @anthropic-ai/claude-code` (skipped if already installed). The `run()` method invokes `claude` with `--allowedTools *`, `--dangerously-skip-permissions`, and the configured `--max-turns`.

Uses native `child_process.spawn`. Zero external dependencies.

## OpenAI Codex

```typescript
const agent = openaiCodex({
  cliFlags: [],   // optional extra CLI flags
  logger: myLogger,
});

await agent.install();  // npm install -g @openai/codex

const exitCode = await agent.run({
  prompt: "Fix the failing test in src/utils.test.ts",
  maxTurns: 10,
  env: { OPENAI_API_KEY: process.env.OPENAI_API_KEY! },
});
```

Requires `OPENAI_API_KEY` in the environment.

## Google Gemini

```typescript
const agent = googleGemini({
  cliFlags: [],   // optional extra CLI flags
  logger: myLogger,
});

await agent.install();  // npm install -g @google/gemini-cli

const exitCode = await agent.run({
  prompt: "Fix the failing test in src/utils.test.ts",
  maxTurns: 10,
  env: { GEMINI_API_KEY: process.env.GEMINI_API_KEY! },
});
```

Requires `GEMINI_API_KEY` (or `GOOGLE_API_KEY`) in the environment.
