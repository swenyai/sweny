---
title: Model Architecture
description: How the SWEny agent and action delegate to coding agents through layered abstractions.
---

SWEny runs coding agents in two different modes depending on the deployment target. The GitHub Action uses a subprocess CLI harness. The Slack agent uses an in-process SDK. Both share the same plugin and provider infrastructure.

## Overview

```
GitHub Action                          Slack Agent / CLI
─────────────                          ──────────────────
@sweny/action                          @sweny/agent
     │                                      │
CodingAgent                            ClaudeRunner
(subprocess CLI)                       (orchestrator)
     │                                      │
claudeCode()                           ModelRunner
├ install()                            ├ run(prompt, tools, ...)
└ run(prompt, maxTurns, env)                │
     │                                 ClaudeCodeRunner
claude CLI process                     ├ Claude Code SDK query()
                                       ├ in-process MCP server
                                       └ toSdkTool() adapter
                                            │
                                       PluginRegistry
                                       └ AgentTool[]
```

## CodingAgent (GitHub Action path)

The `CodingAgent` interface abstracts subprocess-based coding agents for the GitHub Action:

```typescript
import { claudeCode } from "@sweny/providers/coding-agent";
import type { CodingAgent } from "@sweny/providers/coding-agent";
```

### Interface

```typescript
interface CodingAgentRunOptions {
  prompt: string;
  maxTurns: number;
  env?: Record<string, string>;
}

interface CodingAgent {
  install(): Promise<void>;
  run(opts: CodingAgentRunOptions): Promise<number>; // exit code
}
```

### claudeCode() factory

```typescript
const agent = claudeCode({ cliFlags: ["--verbose"] });

// Install the CLI globally
await agent.install();

// Run with a prompt
const exitCode = await agent.run({
  prompt: "Investigate the error spike",
  maxTurns: 50,
  env: { DD_API_KEY: process.env.DD_API_KEY! },
});
```

The factory installs the Claude Code CLI via `npm install -g @anthropic-ai/claude-code`, then shells out to it with `--dangerously-skip-permissions` and `--allowedTools *`. It uses `@actions/exec` (lazy-loaded, only available in GitHub Actions).

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `cliFlags` | `string[]` | `[]` | Extra CLI flags appended to every `run()` call |
| `logger` | `Logger` | `consoleLogger` | Logger for install/run status messages |

## ModelRunner (Slack Agent path)

The `ModelRunner` interface abstracts in-process agent SDKs for the Slack agent and CLI:

```typescript
import type { ModelRunner, ModelRunOptions, RunResult } from "@sweny/agent";
```

### Interface

```typescript
interface ModelRunOptions {
  prompt: string;
  systemPrompt: string;
  tools: AgentTool[];
  maxTurns: number;
  sessionId?: string | null;
  env?: Record<string, string>;
  disallowedTools?: string[];
  cwd?: string;
  name?: string;
}

interface ModelRunner {
  run(opts: ModelRunOptions): Promise<RunResult>;
}
```

### RunResult

```typescript
interface RunResult {
  response: string;
  sessionId: string | null;
  toolCalls: ToolCall[];
}

interface ToolCall {
  toolName: string;
  toolInput: Record<string, unknown>;
  executedAt: string;
}
```

The `sessionId` is an opaque string used for session resumption. Pass it back in subsequent calls to continue a conversation. `toolCalls` records every tool invocation the model made during the turn.

### ClaudeCodeRunner

The built-in implementation uses the `@anthropic-ai/claude-code` SDK:

```typescript
import { ClaudeCodeRunner } from "@sweny/agent";

const runner = new ClaudeCodeRunner({
  apiKey: process.env.ANTHROPIC_API_KEY,
  // or: oauthToken: process.env.CLAUDE_CODE_OAUTH_TOKEN,
});
```

It creates an in-process MCP server via `createSdkMcpServer()`, converts `AgentTool[]` to SDK format, and streams the response from `query()`. Session resumption, tool call tracking, and max-turns handling are all managed internally.

### toSdkTool() adapter

The adapter bridges the SDK-agnostic `AgentTool` from `@sweny/providers/agent-tool` to the Claude SDK's `tool()` format:

```typescript
import { tool } from "@anthropic-ai/claude-code";
import type { AgentTool } from "@sweny/providers/agent-tool";

function toSdkTool(agentTool: AgentTool): SdkTool {
  return tool(agentTool.name, agentTool.description, agentTool.schema, agentTool.execute);
}
```

This adapter and `ClaudeCodeRunner` are the **only two files** that import from `@anthropic-ai/claude-code`. Every other module in the codebase works with the universal `AgentTool` and `ModelRunner` interfaces.

## ClaudeRunner (orchestrator)

`ClaudeRunner` sits between the Slack/CLI frontend and the `ModelRunner`. It assembles the system prompt, resolves plugins, and delegates to the injected runner:

```typescript
const runner = new ClaudeRunner(config, resources, modelRunner);

const result = await runner.run({
  prompt: "What's the status of the API?",
  session,
  user: identity,
  memories: savedMemories,
});
```

### Run flow

1. Build a `PluginContext` from the user's identity and storage stores
2. Call `registry.buildSystemPromptSections(ctx)` to collect plugin instructions
3. Call `buildSystemPrompt()` to assemble the full system prompt
4. Call `registry.buildToolsForSession(ctx)` to get all `AgentTool[]` for this session
5. Delegate to `modelRunner.run()` with prompt, system prompt, tools, max turns, session ID, and denied tools

### System prompt assembly

The system prompt is built from four sections:

```
Your name is [name].

[basePrompt or default Slack-formatted instructions]

[plugin sections — Memory, Workspace, etc.]

## Things you remember about this user
- [memory entries]
```

Override the base prompt in your config with `systemPrompt`. Plugin sections are collected from each plugin's `systemPromptSection()` method. User memories are loaded from the memory store.

### Tool guard

The tool guard defines tools that are always denied:

```typescript
const DENIED_TOOLS: string[] = ["NotebookEdit"];
```

Bash, Write, and Edit are allowed so the agent can execute scripts in `/tmp`. In Kubernetes deployments, the filesystem is immutable outside `/tmp`, making this safe. The system prompt provides additional read-only guidance, and the storage layer has built-in enforcement.

## Swapping model runners

The `ModelRunner` interface is designed for alternative backends. To use a different agent SDK, implement the interface and pass it to `ClaudeRunner`:

```typescript
import type { ModelRunner, ModelRunOptions, RunResult } from "@sweny/agent";

class CustomRunner implements ModelRunner {
  async run(opts: ModelRunOptions): Promise<RunResult> {
    // Call your preferred SDK with opts.prompt, opts.tools, etc.
    return {
      response: "...",
      sessionId: null,
      toolCalls: [],
    };
  }
}

const modelRunner = new CustomRunner();
const runner = new ClaudeRunner(config, resources, modelRunner);
```

The `tools` array contains `AgentTool[]` objects with Zod schemas and `execute()` functions. Your runner is responsible for converting these to whatever format your SDK expects, similar to how `ClaudeCodeRunner` uses `toSdkTool()`.
