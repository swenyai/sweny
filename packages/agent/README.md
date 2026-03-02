<h1 align="center">@sweny-ai/agent</h1>

<p align="center">
  <strong>AI assistant framework powered by Claude Code SDK — Slack bot + CLI with plugin architecture</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@sweny-ai/agent"><img alt="npm version" src="https://img.shields.io/npm/v/@sweny-ai/agent?style=flat-square&color=orange" /></a>
  <a href="https://github.com/swenyai/sweny/blob/main/LICENSE"><img alt="License" src="https://img.shields.io/github/license/swenyai/sweny?style=flat-square" /></a>
  <a href="https://sweny.ai"><img alt="Website" src="https://img.shields.io/badge/sweny.ai-website-blue?style=flat-square" /></a>
</p>

---

## Overview

`@sweny-ai/agent` is a framework for building AI assistants on top of the [Claude Code SDK](https://docs.anthropic.com/en/docs/claude-code/sdk). It ships with two ready-to-use interfaces — a **Slack bot** and an **interactive CLI** — and exposes a plugin architecture so you can extend the assistant with custom tools, storage backends, and authentication providers.

Core concepts:

- **Plugin architecture** — register custom tools that Claude can invoke during a conversation.
- **Provider pattern** — swap storage (filesystem, S3) and auth (no-auth, API key, custom) without changing application code.
- **Session management** — automatic conversation threading with persistent memory and per-user workspaces.
- **Access control** — role-based access guards with configurable permission levels.

---

## Quick Start

**Prerequisites:** Node.js >= 22, a Claude Code OAuth token (from a [Claude Max subscription](https://claude.ai)) or an Anthropic API key.

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env
```

Open `.env` and set your Claude credentials:

```bash
# Recommended — Claude Max / Pro subscription token
CLAUDE_CODE_OAUTH_TOKEN=your-oauth-token

# Alternative — direct API billing
# ANTHROPIC_API_KEY=sk-ant-...
```

```bash
# 3a. Start the CLI (no Slack credentials needed)
npm run cli

# 3b. Or start the Slack bot (requires Slack credentials in .env)
npm run dev
```

---

## Architecture

```
sweny.config.ts
       |
       v
 ┌───────────┐    ┌──────────────┐    ┌──────────────┐
 │   Config   │───>│ AuthProvider  │───>│StorageProvider│
 │   Loader   │    │              │    │              │
 └─────┬──────┘    └──────────────┘    └──────┬───────┘
       │                                      │
       │           ┌──────────────┐           │
       ├──────────>│  AccessGuard │           │
       │           └──────────────┘           │
       │                                      │
       │           ┌──────────────┐           │
       └──────────>│  ToolPlugins │<──────────┘
                   └──────┬───────┘
                          │
                   ┌──────▼───────┐
                   │ ClaudeRunner │
                   │ (Claude SDK) │
                   └──────┬───────┘
                          │
                ┌─────────┴─────────┐
                │                   │
         ┌──────▼──────┐    ┌──────▼──────┐
         │  Slack Bot   │    │     CLI     │
         └─────────────┘    └─────────────┘
```

### Extension Points

| Interface | Purpose |
|-----------|---------|
| `AuthProvider` | Authenticate users and manage sessions |
| `StorageProvider` | Persist sessions, memories, and workspace files |
| `AccessGuard` | Role-based permission enforcement |
| `ToolPlugin` | Register custom tools for Claude to invoke |

---

## Configuration

All configuration lives in `sweny.config.ts` at the project root. Use the `defineConfig()` helper for type safety:

```ts
import { defineConfig } from "./src/config/types.js";
import { fsStorage } from "./src/storage/providers/fs.js";
import { noAuth } from "./src/auth/no-auth.js";
import { memoryPlugin } from "./src/plugins/memory/index.js";
import { workspacePlugin } from "./src/plugins/workspace/index.js";

export default defineConfig({
  name: "my-assistant",
  auth: noAuth(),
  storage: fsStorage({ baseDir: "./.sweny-data" }),
  plugins: [memoryPlugin(), workspacePlugin()],
  model: {
    maxTurns: 20,
  },
});
```

### Config Reference

| Option | Type | Description |
|--------|------|-------------|
| `name` | `string` | Assistant name, shown in prompts and CLI |
| `auth` | `AuthProvider` | Authentication provider |
| `storage` | `StorageProvider` | Storage backend for sessions, memory, workspace |
| `plugins` | `ToolPlugin[]` | Array of tool plugins to register |
| `accessGuard` | `AccessGuard` | Optional role-based access guard |
| `systemPrompt` | `string` | Optional custom system prompt |
| `model.maxTurns` | `number` | Max Claude turns per message (default `20`) |
| `model.disallowedTools` | `string[]` | Tool names Claude cannot use |
| `slack.appToken` | `string` | Slack app-level token (overrides env) |
| `slack.botToken` | `string` | Slack bot token (overrides env) |
| `slack.signingSecret` | `string` | Slack signing secret (overrides env) |
| `rateLimit.maxPerMinute` | `number` | Rate limit per user per minute |
| `rateLimit.maxPerHour` | `number` | Rate limit per user per hour |
| `audit` | `AuditLogger` | Optional audit logger for conversation turns |
| `healthPort` | `number` | Health check HTTP port (default `3000`) |
| `logLevel` | `string` | `debug`, `info`, `warn`, or `error` |
| `allowedUsers` | `string[]` | Restrict Slack access to these user IDs |

---

## Plugins

Plugins add custom tools that Claude can invoke during conversations. Each plugin implements the `ToolPlugin` interface:

```ts
interface ToolPlugin {
  name: string;
  description?: string;
  createTools(ctx: PluginContext): AgentTool[] | Promise<AgentTool[]>;
  systemPromptSection?(ctx: PluginContext): string;
  destroy?(): Promise<void>;
}
```

The `PluginContext` gives each plugin access to the current user, storage, config, and logger:

```ts
interface PluginContext {
  user: UserIdentity;
  storage: {
    memory: MemoryStore;
    workspace: WorkspaceStore;
  };
  config: Record<string, unknown>;
  logger: Logger;
}
```

### Built-in Plugins

| Plugin | Description |
|--------|-------------|
| `memoryPlugin()` | Persistent per-user memory — Claude can save and recall facts across sessions |
| `workspacePlugin()` | Per-user file workspace — Claude can read, write, and manage files |

### Writing a Custom Plugin

Here is a complete example that adds an HTTP request tool. This ships with the package at `src/examples/http-plugin/index.ts`:

```ts
import { z } from "zod";
import { tool } from "@anthropic-ai/claude-code";
import type { ToolPlugin, PluginContext, SdkTool } from "../../plugins/types.js";

interface HttpPluginOpts {
  allowedHosts?: string[];
}

export function httpPlugin(opts: HttpPluginOpts = {}): ToolPlugin {
  return {
    name: "http",
    description: "HTTP request tool for making outbound API calls.",

    createTools(_ctx: PluginContext): SdkTool[] {
      return [
        tool(
          "http_request",
          "Make an HTTP request. Returns the status code, headers, and body.",
          {
            method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE"]),
            url: z.string().url(),
            headers: z.record(z.string()).optional(),
            body: z.string().optional(),
          },
          async (args) => {
            if (opts.allowedHosts?.length) {
              const url = new URL(args.url);
              if (!opts.allowedHosts.includes(url.hostname)) {
                return {
                  content: [{ type: "text" as const, text: `Host not allowed: ${url.hostname}` }],
                  isError: true,
                };
              }
            }

            const response = await fetch(args.url, {
              method: args.method,
              headers: args.headers,
              body: args.body,
            });

            return {
              content: [{
                type: "text" as const,
                text: JSON.stringify({
                  status: response.status,
                  body: await response.text(),
                }, null, 2),
              }],
            };
          },
        ),
      ];
    },

    systemPromptSection(): string {
      return `## HTTP\nYou can make outbound HTTP requests using the \`http_request\` tool.`;
    },
  };
}
```

Register it in `sweny.config.ts`:

```ts
import { httpPlugin } from "./src/examples/http-plugin/index.js";

export default defineConfig({
  // ...
  plugins: [
    memoryPlugin(),
    workspacePlugin(),
    httpPlugin({ allowedHosts: ["api.example.com"] }),
  ],
});
```

---

## Storage Providers

Storage providers persist three types of data: sessions, memories, and workspace files. Two providers ship out of the box.

### Filesystem (`fsStorage`)

Stores everything on the local filesystem. Good for development and single-node deployments.

```ts
import { fsStorage } from "./src/storage/providers/fs.js";

storage: fsStorage({ baseDir: "./.sweny-data" })
```

### S3 (`s3Storage`)

Stores everything in an S3 bucket. Suitable for production and multi-node deployments.

```ts
import { s3Storage } from "./src/storage/providers/s3.js";

storage: s3Storage({
  bucket: "my-sweny-bucket",
  prefix: "agent/",       // optional key prefix (default: "")
  region: "us-west-2",    // optional (default: "us-west-2")
})
```

The S3 provider uses the optional `@aws-sdk` peer dependencies. Install them when using S3:

```bash
npm install @aws-sdk/client-s3 @aws-sdk/credential-provider-node @aws-sdk/s3-request-presigner
```

### Custom Storage

Implement the `StorageProvider` interface to use any backend:

```ts
interface StorageProvider {
  createSessionStore(): SessionStore;
  createMemoryStore(): MemoryStore;
  createWorkspaceStore(): WorkspaceStore;
}
```

Each sub-store (`SessionStore`, `MemoryStore`, `WorkspaceStore`) has its own interface — see `src/storage/*/types.ts` for the full contracts.

---

## Auth Providers

Auth providers handle user authentication and session management. Two providers are included.

### No Auth (`noAuth`)

All users are automatically authenticated as a local admin. Use this for development and CLI mode.

```ts
import { noAuth } from "./src/auth/no-auth.js";

auth: noAuth()
```

### API Key Auth (`apiKeyAuth`)

Users authenticate with an API key. Provide a `validate` function that looks up the key and returns a `UserIdentity` or `null`:

```ts
import { apiKeyAuth } from "./src/auth/api-key.js";

auth: apiKeyAuth({
  validate: async (apiKey) => {
    const user = await db.users.findByApiKey(apiKey);
    if (!user) return null;
    return {
      userId: user.id,
      displayName: user.name,
      email: user.email,
      roles: user.roles,
      metadata: {},
    };
  },
})
```

### Custom Auth

Implement the `AuthProvider` interface:

```ts
interface AuthProvider {
  readonly displayName: string;
  readonly loginFields?: LoginField[];

  authenticate(userId: string): Promise<UserIdentity | null>;
  login?(userId: string, credentials: Record<string, string>): Promise<UserIdentity>;
  hasValidSession(userId: string): boolean;
  clearSession(userId: string): void;
}
```

---

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `CLAUDE_CODE_OAUTH_TOKEN` | Yes (recommended) | Claude Code OAuth token from a Max subscription |
| `ANTHROPIC_API_KEY` | Alternative | Anthropic API key for direct pay-per-use billing |
| `SLACK_APP_TOKEN` | For Slack | Slack app-level token (`xapp-...`) |
| `SLACK_BOT_TOKEN` | For Slack | Slack bot token (`xoxb-...`) |
| `SLACK_SIGNING_SECRET` | For Slack | Slack signing secret |
| `LOG_LEVEL` | No | `debug`, `info`, `warn`, or `error` (default: `info`) |

> Most users should use `CLAUDE_CODE_OAUTH_TOKEN` — this is the token from Claude Max / Pro subscriptions. The `ANTHROPIC_API_KEY` option is available as an alternative for direct API billing.

---

## Deployment

### Docker

The included `Dockerfile` builds a minimal production image:

```bash
docker build -t sweny-agent .

docker run -d \
  -e CLAUDE_CODE_OAUTH_TOKEN=your-token \
  -e SLACK_APP_TOKEN=xapp-... \
  -e SLACK_BOT_TOKEN=xoxb-... \
  -e SLACK_SIGNING_SECRET=... \
  sweny-agent
```

The image uses a multi-stage build (Node 22 Alpine), runs as a non-root `node` user, and starts the Slack bot by default (`node dist/index.js`).

### Production Build

```bash
npm run build    # Compiles TypeScript to dist/
npm start        # Runs dist/index.js
```

---

## CLI Mode

The CLI lets you test the agent end-to-end without Slack credentials. Only a Claude token is needed.

```bash
npm run cli
```

### Commands

| Command | Description |
|---------|-------------|
| `/help` | Show available commands |
| `/memory` | Show saved memories |
| `/memory clear` | Clear all memories |
| `/workspace` | Show workspace contents |
| `/workspace reset` | Clear workspace |
| `/reset` | Clear session (start a fresh conversation) |
| `/quit` | Exit the CLI |

---

## Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Slack bot in development mode (tsx + .env) |
| `npm run cli` | Start interactive CLI (tsx + .env) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled Slack bot |
| `npm run typecheck` | Type-check without emitting |
| `npm test` | Run tests (vitest) |
| `npm run test:watch` | Run tests in watch mode |

---

## License

[MIT](../../LICENSE)
