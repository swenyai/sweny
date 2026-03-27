# SWEny Cleanup & Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove deprecated packages, migrate action+CLI to `@sweny-ai/core`, replace changesets with auto-release, and ship everything.

**Architecture:** Core is the single runtime — skills replace providers, `execute()` replaces `runWorkflow()`, workflows are pure data DAGs. The action and CLI both become thin wrappers that parse inputs, build a skill map, and call `execute()`. MCP auto-injection is shared in core. Changesets are replaced by auto-patch-on-push.

**Tech Stack:** TypeScript, Node 22, Vitest, NCC (action bundling), GitHub Actions, npm

**Spec:** `docs/superpowers/specs/2026-03-26-sweny-cleanup-release-design.md`

---

## File Map

### New files
- `packages/core/src/mcp.ts` — MCP server type + auto-injection function (shared by CLI + action)
- `packages/core/src/mcp.test.ts` — tests for MCP auto-injection
- `packages/core/src/cli/main.ts` — CLI entry point (commander setup, commands)
- `packages/core/src/cli/config.ts` — CLI flag parsing + .sweny.yml loading
- `packages/core/src/cli/config-file.ts` — YAML config file parser
- `packages/core/src/cli/output.ts` — terminal formatting (banners, spinners)
- `packages/core/src/cli/check.ts` — provider connectivity checks
- `packages/core/src/cli/setup.ts` — issue tracker label setup
- `packages/core/src/cli/renderer.ts` — DAG terminal visualization + execution animation

### Modified files
- `packages/core/src/types.ts` — add `McpServerConfig` type
- `packages/core/src/index.ts` — export MCP types + function
- `packages/core/package.json` — add `bin`, CLI deps (`chalk`, `commander`, `yaml`)
- `packages/core/tsconfig.json` — no change needed (`src/cli/` is under `src/`, already included)
- `packages/action/src/main.ts` — rewrite to use core's `execute()` + `buildAutoMcpServers()`
- `packages/action/src/config.ts` — remove `MCPServerConfig` import from providers, use core's type
- `packages/action/package.json` — replace engine+providers deps with core
- `packages/action/tsconfig.json` — no change
- `.github/workflows/release.yml` — full rewrite (auto-release, no changesets)
- `.github/workflows/ci.yml` — remove providers build steps, update smoke test
- `package.json` (root) — remove changeset deps, update workspaces

### Deleted files/directories
- `packages/engine/` — entire directory
- `packages/providers/` — entire directory
- `packages/agent/` — entire directory
- `packages/cli/` — entire directory (code moved to core)
- `packages/action/src/providers/` — entire directory
- `.changeset/` — entire directory
- `scripts/auto-changeset.mjs` — if it exists
- `.github/workflows/release-engine.yml`
- `.github/workflows/release-providers.yml`
- `.github/workflows/release-agent.yml`
- `.github/workflows/release-cli.yml`
- `.github/workflows/release-action.yml`
- `.github/workflows/auto-changeset.yml`

---

## Task 1: Add MCP types and auto-injection to core

**Why:** Both the action and CLI need to auto-inject MCP servers based on configured providers. This logic currently lives in `packages/action/src/main.ts:191-382`. We extract it to core so both consumers share it.

**Files:**
- Modify: `packages/core/src/types.ts`
- Create: `packages/core/src/mcp.ts`
- Create: `packages/core/src/mcp.test.ts`
- Modify: `packages/core/src/index.ts`

- [ ] **Step 1: Add `McpServerConfig` type to `packages/core/src/types.ts`**

Add at the end of the file, before the closing Logger definition:

```typescript
// ─── MCP Server Config ──────────────────────────────────────────

/** MCP server configuration for auto-injection */
export interface McpServerConfig {
  type: "stdio" | "http";
  /** Command to run (stdio only) */
  command?: string;
  /** Command arguments (stdio only) */
  args?: string[];
  /** HTTP endpoint URL (http only) */
  url?: string;
  /** HTTP headers (http only) */
  headers?: Record<string, string>;
  /** Environment variables for the process (stdio only) */
  env?: Record<string, string>;
}

/** Config for MCP auto-injection */
export interface McpAutoConfig {
  /** Which source control provider is configured */
  sourceControlProvider?: string;
  /** Which issue tracker provider is configured */
  issueTrackerProvider?: string;
  /** Which observability provider is configured */
  observabilityProvider?: string;
  /** Flat credential map — env var name → value */
  credentials: Record<string, string>;
  /** Workspace tool integrations (explicit opt-in) */
  workspaceTools?: string[];
  /** User-supplied MCP servers (wins on key conflict) */
  userMcpServers?: Record<string, McpServerConfig>;
}
```

- [ ] **Step 2: Write the failing test for `buildAutoMcpServers`**

Create `packages/core/src/mcp.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { buildAutoMcpServers } from "./mcp.js";

describe("buildAutoMcpServers", () => {
  it("returns empty object when no providers configured", () => {
    const result = buildAutoMcpServers({ credentials: {} });
    expect(result).toEqual({});
  });

  it("injects GitHub MCP when source control is github with token", () => {
    const result = buildAutoMcpServers({
      sourceControlProvider: "github",
      credentials: { GITHUB_TOKEN: "ghp_test" },
    });
    expect(result.github).toBeDefined();
    expect(result.github.type).toBe("stdio");
    expect(result.github.env?.GITHUB_PERSONAL_ACCESS_TOKEN).toBe("ghp_test");
  });

  it("injects Linear MCP when issue tracker is linear with API key", () => {
    const result = buildAutoMcpServers({
      issueTrackerProvider: "linear",
      credentials: { LINEAR_API_KEY: "lin_test" },
    });
    expect(result.linear).toBeDefined();
    expect(result.linear.type).toBe("http");
    expect(result.linear.url).toBe("https://mcp.linear.app/mcp");
    expect(result.linear.headers?.Authorization).toBe("Bearer lin_test");
  });

  it("injects Datadog MCP when observability is datadog with both keys", () => {
    const result = buildAutoMcpServers({
      observabilityProvider: "datadog",
      credentials: { DD_API_KEY: "dd_api", DD_APP_KEY: "dd_app" },
    });
    expect(result.datadog).toBeDefined();
    expect(result.datadog.type).toBe("http");
    expect(result.datadog.headers?.DD_API_KEY).toBe("dd_api");
  });

  it("injects Sentry MCP when observability is sentry with auth token", () => {
    const result = buildAutoMcpServers({
      observabilityProvider: "sentry",
      credentials: { SENTRY_AUTH_TOKEN: "sentry_test" },
    });
    expect(result.sentry).toBeDefined();
    expect(result.sentry.type).toBe("stdio");
    expect(result.sentry.env?.SENTRY_ACCESS_TOKEN).toBe("sentry_test");
  });

  it("injects Sentry MCP with self-hosted SENTRY_HOST", () => {
    const result = buildAutoMcpServers({
      observabilityProvider: "sentry",
      credentials: {
        SENTRY_AUTH_TOKEN: "sentry_test",
        SENTRY_URL: "https://sentry.example.com",
      },
    });
    expect(result.sentry.env?.SENTRY_HOST).toBe("sentry.example.com");
  });

  it("injects workspace tools when opted in with credentials", () => {
    const result = buildAutoMcpServers({
      credentials: { SLACK_BOT_TOKEN: "xoxb-test" },
      workspaceTools: ["slack"],
    });
    expect(result.slack).toBeDefined();
    expect(result.slack.type).toBe("stdio");
    expect(result.slack.env?.SLACK_BOT_TOKEN).toBe("xoxb-test");
  });

  it("does not inject workspace tools without opt-in", () => {
    const result = buildAutoMcpServers({
      credentials: { SLACK_BOT_TOKEN: "xoxb-test" },
    });
    expect(result.slack).toBeUndefined();
  });

  it("user-supplied MCP servers win on key conflict", () => {
    const result = buildAutoMcpServers({
      sourceControlProvider: "github",
      credentials: { GITHUB_TOKEN: "ghp_test" },
      userMcpServers: {
        github: { type: "http", url: "https://custom.example.com" },
      },
    });
    expect(result.github.type).toBe("http");
    expect(result.github.url).toBe("https://custom.example.com");
  });

  it("injects GitLab MCP with self-hosted URL", () => {
    const result = buildAutoMcpServers({
      sourceControlProvider: "gitlab",
      credentials: {
        GITLAB_TOKEN: "glpat_test",
        GITLAB_URL: "https://gitlab.example.com",
      },
    });
    expect(result.gitlab).toBeDefined();
    expect(result.gitlab.env?.GITLAB_API_URL).toBe("https://gitlab.example.com/api/v4");
  });

  it("injects New Relic MCP with EU region", () => {
    const result = buildAutoMcpServers({
      observabilityProvider: "newrelic",
      credentials: { NR_API_KEY: "nr_test", NR_REGION: "eu" },
    });
    expect(result.newrelic).toBeDefined();
    expect(result.newrelic.url).toContain("eu.newrelic.com");
  });

  it("injects Better Stack MCP", () => {
    const result = buildAutoMcpServers({
      observabilityProvider: "betterstack",
      credentials: { BETTERSTACK_API_TOKEN: "bs_test" },
    });
    expect(result.betterstack).toBeDefined();
    expect(result.betterstack.type).toBe("http");
    expect(result.betterstack.headers?.Authorization).toBe("Bearer bs_test");
  });

  it("injects Jira MCP when issue tracker is jira with all credentials", () => {
    const result = buildAutoMcpServers({
      issueTrackerProvider: "jira",
      credentials: {
        JIRA_URL: "https://myco.atlassian.net",
        JIRA_EMAIL: "dev@example.com",
        JIRA_API_TOKEN: "jira_token",
      },
    });
    expect(result.jira).toBeDefined();
    expect(result.jira.type).toBe("stdio");
    expect(result.jira.env?.JIRA_URL).toBe("https://myco.atlassian.net");
  });

  it("injects multiple providers simultaneously", () => {
    const result = buildAutoMcpServers({
      sourceControlProvider: "github",
      issueTrackerProvider: "linear",
      observabilityProvider: "datadog",
      credentials: {
        GITHUB_TOKEN: "ghp_test",
        LINEAR_API_KEY: "lin_test",
        DD_API_KEY: "dd_api",
        DD_APP_KEY: "dd_app",
      },
    });
    expect(Object.keys(result)).toEqual(
      expect.arrayContaining(["github", "linear", "datadog"]),
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/mcp.test.ts`
Expected: FAIL — `./mcp.js` module not found

- [ ] **Step 4: Implement `buildAutoMcpServers` in `packages/core/src/mcp.ts`**

```typescript
/**
 * MCP Auto-Injection
 *
 * Automatically configures well-known MCP servers based on which
 * providers the user has configured. Both the CLI and GitHub Action
 * call this to give Claude access to provider-specific tools.
 *
 * Design rules:
 * - HTTP transport preferred for cloud-hosted services (vendor-managed, no local install)
 * - stdio (npx) used when no stable HTTP endpoint exists
 * - Category A: injected from provider config (sourceControl, issueTracker, observability)
 * - Category B: workspace tools — explicit opt-in via workspaceTools array
 * - User-supplied mcpServers always win on key conflict (explicit > auto)
 */

import type { McpServerConfig, McpAutoConfig } from "./types.js";

export function buildAutoMcpServers(config: McpAutoConfig): Record<string, McpServerConfig> {
  const auto: Record<string, McpServerConfig> = {};
  const creds = config.credentials;

  // ── Category A: Provider-config triggered ─────────────────────────────────

  // GitHub MCP
  const githubToken = creds.GITHUB_TOKEN;
  if (
    (config.sourceControlProvider === "github" || config.issueTrackerProvider === "github-issues") &&
    githubToken
  ) {
    auto["github"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-github@latest"],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: githubToken },
    };
  }

  // GitLab MCP
  const gitlabToken = creds.GITLAB_TOKEN;
  if (config.sourceControlProvider === "gitlab" && gitlabToken) {
    const gitlabEnv: Record<string, string> = { GITLAB_PERSONAL_ACCESS_TOKEN: gitlabToken };
    const baseUrl = creds.GITLAB_URL || "https://gitlab.com";
    if (baseUrl !== "https://gitlab.com") gitlabEnv.GITLAB_API_URL = `${baseUrl}/api/v4`;
    auto["gitlab"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-gitlab@latest"],
      env: gitlabEnv,
    };
  }

  // Linear MCP — official HTTP remote
  if (config.issueTrackerProvider === "linear" && creds.LINEAR_API_KEY) {
    auto["linear"] = {
      type: "http",
      url: "https://mcp.linear.app/mcp",
      headers: { Authorization: `Bearer ${creds.LINEAR_API_KEY}` },
    };
  }

  // Jira/Confluence MCP
  if (
    config.issueTrackerProvider === "jira" &&
    creds.JIRA_URL &&
    creds.JIRA_EMAIL &&
    creds.JIRA_API_TOKEN
  ) {
    auto["jira"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sooperset/mcp-atlassian@latest"],
      env: {
        JIRA_URL: creds.JIRA_URL,
        JIRA_EMAIL: creds.JIRA_EMAIL,
        JIRA_API_TOKEN: creds.JIRA_API_TOKEN,
      },
    };
  }

  // Datadog MCP — HTTP transport
  if (config.observabilityProvider === "datadog" && creds.DD_API_KEY && creds.DD_APP_KEY) {
    auto["datadog"] = {
      type: "http",
      url: "https://mcp.datadoghq.com/api/unstable/mcp-server/mcp",
      headers: { DD_API_KEY: creds.DD_API_KEY, DD_APPLICATION_KEY: creds.DD_APP_KEY },
    };
  }

  // Sentry MCP
  if (config.observabilityProvider === "sentry" && creds.SENTRY_AUTH_TOKEN) {
    const sentryEnv: Record<string, string> = { SENTRY_ACCESS_TOKEN: creds.SENTRY_AUTH_TOKEN };
    const sentryUrl = creds.SENTRY_URL;
    if (sentryUrl && sentryUrl !== "https://sentry.io") {
      try {
        sentryEnv.SENTRY_HOST = new URL(sentryUrl).hostname;
      } catch {
        // malformed URL — leave SENTRY_HOST unset
      }
    }
    auto["sentry"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@sentry/mcp-server@latest"],
      env: sentryEnv,
    };
  }

  // New Relic MCP — HTTP, region-aware
  if (config.observabilityProvider === "newrelic" && creds.NR_API_KEY) {
    const nrEndpoint =
      creds.NR_REGION === "eu"
        ? "https://mcp.eu.newrelic.com/mcp/"
        : "https://mcp.newrelic.com/mcp/";
    auto["newrelic"] = {
      type: "http",
      url: nrEndpoint,
      headers: { "Api-Key": creds.NR_API_KEY },
    };
  }

  // Better Stack MCP — HTTP, Bearer token
  if (config.observabilityProvider === "betterstack" && creds.BETTERSTACK_API_TOKEN) {
    auto["betterstack"] = {
      type: "http",
      url: "https://mcp.betterstack.com",
      headers: { Authorization: `Bearer ${creds.BETTERSTACK_API_TOKEN}` },
    };
  }

  // ── Category B: Workspace tools (explicit opt-in) ─────────────────────────

  const tools = new Set(config.workspaceTools ?? []);

  if (tools.has("slack") && creds.SLACK_BOT_TOKEN) {
    const slackEnv: Record<string, string> = { SLACK_BOT_TOKEN: creds.SLACK_BOT_TOKEN };
    if (creds.SLACK_TEAM_ID) slackEnv.SLACK_TEAM_ID = creds.SLACK_TEAM_ID;
    auto["slack"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@modelcontextprotocol/server-slack@latest"],
      env: slackEnv,
    };
  }

  if (tools.has("notion") && (creds.NOTION_TOKEN || creds.NOTION_API_KEY)) {
    auto["notion"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@notionhq/notion-mcp-server@latest"],
      env: { NOTION_TOKEN: creds.NOTION_TOKEN || creds.NOTION_API_KEY },
    };
  }

  if (tools.has("pagerduty") && creds.PAGERDUTY_API_TOKEN) {
    auto["pagerduty"] = {
      type: "http",
      url: "https://mcp.pagerduty.com/mcp",
      headers: { Authorization: `Token token=${creds.PAGERDUTY_API_TOKEN}` },
    };
  }

  if (tools.has("monday") && creds.MONDAY_TOKEN) {
    auto["monday"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "@mondaydotcomorg/monday-api-mcp@latest"],
      env: { MONDAY_TOKEN: creds.MONDAY_TOKEN },
    };
  }

  if (tools.has("asana") && creds.ASANA_ACCESS_TOKEN) {
    auto["asana"] = {
      type: "stdio",
      command: "npx",
      args: ["-y", "asana-mcp@latest"],
      env: { ASANA_ACCESS_TOKEN: creds.ASANA_ACCESS_TOKEN },
    };
  }

  // User-supplied servers always win on key conflict
  return { ...auto, ...(config.userMcpServers ?? {}) };
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/mcp.test.ts`
Expected: ALL PASS

- [ ] **Step 6: Export MCP from `packages/core/src/index.ts`**

Add after the schema exports:

```typescript
// MCP auto-injection
export { buildAutoMcpServers } from "./mcp.js";
export type { McpServerConfig, McpAutoConfig } from "./types.js";
```

- [ ] **Step 7: Run all core tests to confirm nothing broke**

Run: `cd packages/core && npx vitest run`
Expected: ALL PASS

- [ ] **Step 8: Commit**

```bash
git add packages/core/src/types.ts packages/core/src/mcp.ts packages/core/src/mcp.test.ts packages/core/src/index.ts
git commit -m "feat(core): add MCP auto-injection shared by CLI and action"
```

---

## Task 2: Update core package.json for CLI

**Why:** Core needs a `bin` entry and CLI dependencies (`chalk`, `commander`, `yaml`) to serve as the CLI package.

**Files:**
- Modify: `packages/core/package.json`

- [ ] **Step 1: Add bin entry and CLI dependencies to `packages/core/package.json`**

Add `"bin"` field after `"type"`:

```json
"bin": {
  "sweny": "./dist/cli/main.js"
},
```

Add to `"dependencies"`:

```json
"chalk": "^5",
"commander": "^13",
"yaml": "^2"
```

- [ ] **Step 2: Verify npm install works**

Run: `cd /Users/nate/src/swenyai/sweny && npm install`
Expected: installs chalk, commander, yaml without errors

- [ ] **Step 3: Commit**

```bash
git add packages/core/package.json package-lock.json
git commit -m "feat(core): add CLI bin entry and dependencies"
```

---

## Task 3: Move CLI code into core

**Why:** The CLI currently lives in `packages/cli/` as a separate package importing from `@sweny-ai/engine` + `@sweny-ai/providers`. We move it into `packages/core/src/cli/` and rewrite imports to use core's API.

**Files:**
- Create: `packages/core/src/cli/main.ts` (rewritten from `packages/cli/src/main.ts`)
- Create: `packages/core/src/cli/config.ts` (from `packages/cli/src/config.ts`)
- Create: `packages/core/src/cli/config-file.ts` (from `packages/cli/src/config-file.ts`)
- Create: `packages/core/src/cli/output.ts` (from `packages/cli/src/output.ts`)
- Create: `packages/core/src/cli/check.ts` (from `packages/cli/src/check.ts`)
- Create: `packages/core/src/cli/setup.ts` (from `packages/cli/src/setup.ts`)

**Important context:** The old CLI imports from `@sweny-ai/engine` and `@sweny-ai/providers`. In the new location, these become relative imports from `../` (core's own modules). The key transformation pattern is:

| Old import | New import |
|-----------|------------|
| `import { runWorkflow, triageWorkflow, implementWorkflow } from "@sweny-ai/engine"` | `import { execute } from "../executor.js"` + `import { triageWorkflow } from "../workflows/triage.js"` + `import { implementWorkflow } from "../workflows/implement.js"` |
| `import { createProviderRegistry } from "./providers/index.js"` | `import { createSkillMap, configuredSkills } from "../skills/index.js"` |
| `import type { TriageConfig, ImplementConfig } from "@sweny-ai/engine"` | `import type { ExecuteOptions } from "../executor.js"` |
| `import type { MCPServerConfig } from "@sweny-ai/providers"` | `import type { McpServerConfig } from "../types.js"` |
| `const providers = createProviderRegistry(config)` | `const skills = createSkillMap(configuredSkills())` |
| `await runWorkflow(triageWorkflow, triageConfig, providers, runOptions)` | `await execute(triageWorkflow, input, { skills, claude, observer, logger })` |

- [ ] **Step 1: Copy unchanged files**

Copy these files verbatim (no import changes needed — they only import from local siblings or npm packages):
- `packages/cli/src/config-file.ts` → `packages/core/src/cli/config-file.ts`
- `packages/cli/src/output.ts` → `packages/core/src/cli/output.ts`
- `packages/cli/src/check.ts` → `packages/core/src/cli/check.ts`
- `packages/cli/src/setup.ts` → `packages/core/src/cli/setup.ts`

After copying, verify each file's imports. If any import from `@sweny-ai/engine` or `@sweny-ai/providers`, update those imports to use relative core paths. For example:
- `@sweny-ai/engine` → `../executor.js` or `../types.js`
- `@sweny-ai/providers` → `../types.js`

- [ ] **Step 2: Create `packages/core/src/cli/config.ts`**

Copy from `packages/cli/src/config.ts`. Key changes:
- Replace `import type { MCPServerConfig } from "@sweny-ai/providers"` → `import type { McpServerConfig } from "../types.js"`
- Replace any engine type imports with core equivalents
- The config interface and flag parsing logic stays the same — it's pure CLI flag definitions

- [ ] **Step 3: Create `packages/core/src/cli/main.ts`**

This is the big rewrite. Copy from `packages/cli/src/main.ts` and apply these transformations:

**Imports section — replace entirely:**

```typescript
#!/usr/bin/env node

import { Command } from "commander";
import chalk from "chalk";
import { execute } from "../executor.js";
import { ClaudeClient } from "../claude.js";
import { createSkillMap, configuredSkills } from "../skills/index.js";
import { triageWorkflow } from "../workflows/triage.js";
import { implementWorkflow } from "../workflows/implement.js";
import { buildAutoMcpServers } from "../mcp.js";
import type { ExecuteOptions } from "../executor.js";
import type { ExecutionEvent, McpServerConfig } from "../types.js";
import { consoleLogger } from "../types.js";
import { parseCliConfig, loadConfigFile } from "./config.js";
import { formatBanner, formatPhaseHeader, /* ... other formatters */ } from "./output.js";
import { runChecks } from "./check.js";
```

**Workflow execution — replace the `runWorkflow()` call pattern:**

Old pattern:
```typescript
const providers = createProviders(config);
const result = await runWorkflow(triageWorkflow, triageConfig, providers, runOptions);
```

New pattern:
```typescript
const skills = createSkillMap(configuredSkills());
const claude = new ClaudeClient({
  maxTurns: config.maxInvestigateTurns || 50,
  cwd: process.cwd(),
  logger: consoleLogger,
});

const mcpServers = buildAutoMcpServers({
  sourceControlProvider: config.sourceControlProvider,
  issueTrackerProvider: config.issueTrackerProvider,
  observabilityProvider: config.observabilityProvider,
  credentials: buildCredentialMap(config),
  workspaceTools: config.workspaceTools,
  userMcpServers: config.mcpServers,
});

const results = await execute(triageWorkflow, {
  timeRange: config.timeRange,
  severityFocus: config.severityFocus,
  serviceFilter: config.serviceFilter,
  dryRun: config.dryRun,
}, {
  skills,
  claude,
  observer: (event: ExecutionEvent) => handleEvent(event),
  logger: consoleLogger,
});
```

**Add a `buildCredentialMap` helper** that reads config fields + process.env into the flat credential map that `buildAutoMcpServers` expects:

```typescript
function buildCredentialMap(config: CliConfig): Record<string, string> {
  const creds: Record<string, string> = {};
  const env = process.env;

  // Source control
  if (env.GITHUB_TOKEN) creds.GITHUB_TOKEN = env.GITHUB_TOKEN;
  if (env.GITLAB_TOKEN) creds.GITLAB_TOKEN = env.GITLAB_TOKEN;
  if (env.GITLAB_URL) creds.GITLAB_URL = env.GITLAB_URL;

  // Issue tracking
  if (env.LINEAR_API_KEY) creds.LINEAR_API_KEY = env.LINEAR_API_KEY;
  if (env.JIRA_URL) creds.JIRA_URL = env.JIRA_URL;
  if (env.JIRA_EMAIL) creds.JIRA_EMAIL = env.JIRA_EMAIL;
  if (env.JIRA_API_TOKEN) creds.JIRA_API_TOKEN = env.JIRA_API_TOKEN;

  // Observability
  if (env.DD_API_KEY) creds.DD_API_KEY = env.DD_API_KEY;
  if (env.DD_APP_KEY) creds.DD_APP_KEY = env.DD_APP_KEY;
  if (env.SENTRY_AUTH_TOKEN) creds.SENTRY_AUTH_TOKEN = env.SENTRY_AUTH_TOKEN;
  if (env.SENTRY_ORG) creds.SENTRY_ORG = env.SENTRY_ORG;
  if (env.SENTRY_URL) creds.SENTRY_URL = env.SENTRY_URL;
  if (env.NR_API_KEY) creds.NR_API_KEY = env.NR_API_KEY;
  if (env.NR_REGION) creds.NR_REGION = env.NR_REGION;
  if (env.BETTERSTACK_API_TOKEN) creds.BETTERSTACK_API_TOKEN = env.BETTERSTACK_API_TOKEN;

  // Workspace tools
  if (env.SLACK_BOT_TOKEN) creds.SLACK_BOT_TOKEN = env.SLACK_BOT_TOKEN;
  if (env.SLACK_TEAM_ID) creds.SLACK_TEAM_ID = env.SLACK_TEAM_ID;
  if (env.NOTION_TOKEN) creds.NOTION_TOKEN = env.NOTION_TOKEN;
  if (env.PAGERDUTY_API_TOKEN) creds.PAGERDUTY_API_TOKEN = env.PAGERDUTY_API_TOKEN;
  if (env.MONDAY_TOKEN) creds.MONDAY_TOKEN = env.MONDAY_TOKEN;
  if (env.ASANA_ACCESS_TOKEN) creds.ASANA_ACCESS_TOKEN = env.ASANA_ACCESS_TOKEN;

  return creds;
}
```

**Remove:** The old `providers/index.ts` import and all references to `createProviders()`.

**Delete:** Do NOT copy `packages/cli/src/providers/index.ts` — it's replaced by `createSkillMap(configuredSkills())`.

**Delete:** Do NOT copy `packages/cli/src/cache.ts` — the core executor does not use the old engine caching mechanism.

- [ ] **Step 4: Add shebang and verify CLI entry point compiles**

Ensure `packages/core/src/cli/main.ts` starts with `#!/usr/bin/env node`.

Run: `cd packages/core && npm run build`
Expected: Compiles without errors. `dist/cli/main.js` exists.

- [ ] **Step 5: Verify CLI entry point is executable**

Run: `node packages/core/dist/cli/main.js --help`
Expected: Shows commander help output with triage/implement/check/init commands.

- [ ] **Step 6: Commit**

```bash
git add packages/core/src/cli/
git commit -m "feat(core): fold CLI into core package"
```

---

## Task 4: Add DAG terminal renderer

**Why:** The CLI should visualize the workflow DAG in the terminal and animate node state transitions as the workflow executes.

**Files:**
- Create: `packages/core/src/cli/renderer.ts`
- Create: `packages/core/src/cli/renderer.test.ts`

- [ ] **Step 1: Write the test for the renderer**

Create `packages/core/src/cli/renderer.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { DagRenderer } from "./renderer.js";
import type { Workflow, ExecutionEvent } from "../types.js";

const testWorkflow: Workflow = {
  id: "test",
  name: "Test Workflow",
  description: "A simple test workflow",
  nodes: {
    gather: { name: "Gather Context", instruction: "Gather", skills: [], output: undefined },
    investigate: { name: "Investigate", instruction: "Investigate", skills: [], output: undefined },
    report: { name: "Report", instruction: "Report", skills: [], output: undefined },
  },
  edges: [
    { from: "gather", to: "investigate" },
    { from: "investigate", to: "report" },
  ],
  entry: "gather",
};

describe("DagRenderer", () => {
  it("tracks node state from execution events", () => {
    const renderer = new DagRenderer(testWorkflow, { animate: false });

    renderer.update({ type: "workflow:start", workflow: "test" });
    expect(renderer.getNodeState("gather")).toBe("pending");

    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    expect(renderer.getNodeState("gather")).toBe("running");

    renderer.update({
      type: "node:exit",
      node: "gather",
      result: { status: "success", data: {}, toolCalls: [] },
    });
    expect(renderer.getNodeState("gather")).toBe("completed");
  });

  it("tracks failed nodes", () => {
    const renderer = new DagRenderer(testWorkflow, { animate: false });
    renderer.update({
      type: "node:exit",
      node: "gather",
      result: { status: "failed", data: {}, toolCalls: [] },
    });
    expect(renderer.getNodeState("gather")).toBe("failed");
  });

  it("renders to string without crashing", () => {
    const renderer = new DagRenderer(testWorkflow, { animate: false });
    const output = renderer.renderToString();
    expect(output).toContain("Gather Context");
    expect(output).toContain("Investigate");
    expect(output).toContain("Report");
  });

  it("counts tool calls per node", () => {
    const renderer = new DagRenderer(testWorkflow, { animate: false });
    renderer.update({ type: "node:enter", node: "gather", instruction: "Gather" });
    renderer.update({ type: "tool:call", node: "gather", tool: "github_search", input: {} });
    renderer.update({ type: "tool:result", node: "gather", tool: "github_search", output: {} });
    renderer.update({ type: "tool:call", node: "gather", tool: "sentry_query", input: {} });
    renderer.update({ type: "tool:result", node: "gather", tool: "sentry_query", output: {} });
    expect(renderer.getToolCallCount("gather")).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/core && npx vitest run src/cli/renderer.test.ts`
Expected: FAIL — `./renderer.js` module not found

- [ ] **Step 3: Implement the renderer**

Create `packages/core/src/cli/renderer.ts`:

```typescript
/**
 * DAG Terminal Renderer
 *
 * Visualizes a workflow DAG in the terminal using box-drawing characters.
 * Subscribes to ExecutionEvent stream and animates node state transitions.
 *
 *   ┌─────────────┐     ┌──────────────┐     ┌─────────────┐
 *   │ ● gather    │────▶│ ◉ investigate│────▶│ ○ create    │
 *   │   context   │     │              │     │   issue     │
 *   └─────────────┘     └──────────────┘     └──────┬──────┘
 *
 *   ● completed  ◉ running  ○ pending  ✕ failed
 */

import chalk from "chalk";
import type { Workflow, ExecutionEvent } from "../types.js";

type NodeState = "pending" | "running" | "completed" | "failed";

interface RenderOptions {
  /** Disable terminal cursor manipulation (for testing/piping) */
  animate?: boolean;
  /** Stream to write to (default: process.stdout) */
  stream?: NodeJS.WritableStream;
}

export class DagRenderer {
  private workflow: Workflow;
  private nodeStates: Map<string, NodeState> = new Map();
  private toolCounts: Map<string, number> = new Map();
  private startTimes: Map<string, number> = new Map();
  private animate: boolean;
  private stream: NodeJS.WritableStream;
  private lineCount = 0;

  constructor(workflow: Workflow, options: RenderOptions = {}) {
    this.workflow = workflow;
    this.animate = options.animate ?? true;
    this.stream = options.stream ?? process.stdout;

    // Initialize all nodes as pending
    for (const id of Object.keys(workflow.nodes)) {
      this.nodeStates.set(id, "pending");
      this.toolCounts.set(id, 0);
    }
  }

  /** Update state from an execution event */
  update(event: ExecutionEvent): void {
    switch (event.type) {
      case "node:enter":
        this.nodeStates.set(event.node, "running");
        this.startTimes.set(event.node, Date.now());
        break;
      case "node:exit":
        this.nodeStates.set(event.node, event.result.status === "failed" ? "failed" : "completed");
        break;
      case "tool:call":
        this.toolCounts.set(event.node, (this.toolCounts.get(event.node) ?? 0) + 1);
        break;
    }

    if (this.animate) this.render();
  }

  getNodeState(nodeId: string): NodeState {
    return this.nodeStates.get(nodeId) ?? "pending";
  }

  getToolCallCount(nodeId: string): number {
    return this.toolCounts.get(nodeId) ?? 0;
  }

  /** Render the DAG to the terminal (overwrites previous render) */
  render(): void {
    const output = this.renderToString();
    const lines = output.split("\n").length;

    // Clear previous render
    if (this.lineCount > 0) {
      (this.stream as any).moveCursor?.(0, -this.lineCount);
      (this.stream as any).clearScreenDown?.();
    }

    this.stream.write(output + "\n");
    this.lineCount = lines;
  }

  /** Render the DAG to a string (for testing or non-interactive use) */
  renderToString(): string {
    const nodeIds = this.topologicalOrder();
    const lines: string[] = [];

    // Render each node as a box with status
    const boxes = nodeIds.map((id) => this.renderNodeBox(id));

    // Simple linear layout: connect boxes with arrows
    // For now, render as a vertical list with arrows
    // A future enhancement could do 2D layout based on the DAG structure
    for (let i = 0; i < boxes.length; i++) {
      lines.push(boxes[i]);
      if (i < boxes.length - 1) {
        lines.push(this.renderArrow(nodeIds[i], nodeIds[i + 1]));
      }
    }

    // Legend
    lines.push("");
    lines.push(
      `  ${chalk.green("●")} completed  ${chalk.yellow("◉")} running  ${chalk.gray("○")} pending  ${chalk.red("✕")} failed`,
    );

    return lines.join("\n");
  }

  private renderNodeBox(nodeId: string): string {
    const node = this.workflow.nodes[nodeId];
    const state = this.getNodeState(nodeId);
    const name = node.name || nodeId;

    const icon = this.stateIcon(state);
    const colorFn = this.stateColor(state);

    let detail = "";
    if (state === "running") {
      const elapsed = Date.now() - (this.startTimes.get(nodeId) ?? Date.now());
      detail = chalk.dim(` ${Math.round(elapsed / 1000)}s`);
    } else if (state === "completed") {
      const calls = this.getToolCallCount(nodeId);
      if (calls > 0) detail = chalk.dim(` ${calls} tools`);
    }

    const label = `${icon} ${name}${detail}`;
    const width = Math.max(stripAnsi(label).length + 4, 20);
    const padded = label + " ".repeat(Math.max(0, width - 4 - stripAnsi(label).length));

    const top = `  ${colorFn("┌" + "─".repeat(width - 2) + "┐")}`;
    const mid = `  ${colorFn("│")} ${padded} ${colorFn("│")}`;
    const bot = `  ${colorFn("└" + "─".repeat(width - 2) + "┘")}`;

    return [top, mid, bot].join("\n");
  }

  private renderArrow(_from: string, _to: string): string {
    return `  ${chalk.dim("     │")}`;
  }

  private stateIcon(state: NodeState): string {
    switch (state) {
      case "completed":
        return chalk.green("●");
      case "running":
        return chalk.yellow("◉");
      case "failed":
        return chalk.red("✕");
      default:
        return chalk.gray("○");
    }
  }

  private stateColor(state: NodeState): (s: string) => string {
    switch (state) {
      case "completed":
        return chalk.green;
      case "running":
        return chalk.yellow;
      case "failed":
        return chalk.red;
      default:
        return chalk.gray;
    }
  }

  /** Topological sort of node IDs for rendering order */
  private topologicalOrder(): string[] {
    const visited = new Set<string>();
    const order: string[] = [];
    const nodeIds = Object.keys(this.workflow.nodes);

    const visit = (id: string) => {
      if (visited.has(id)) return;
      visited.add(id);
      // Visit predecessors first
      for (const edge of this.workflow.edges) {
        if (edge.to === id) visit(edge.from);
      }
      order.push(id);
    };

    // Start from entry, then visit remaining
    if (this.workflow.entry) visit(this.workflow.entry);
    for (const id of nodeIds) visit(id);

    return order;
  }
}

/** Strip ANSI escape codes for length calculation */
function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/core && npx vitest run src/cli/renderer.test.ts`
Expected: ALL PASS

- [ ] **Step 5: Wire renderer into CLI main.ts**

In `packages/core/src/cli/main.ts`, import the renderer and use it as the observer:

```typescript
import { DagRenderer } from "./renderer.js";

// In the triage/implement command handler:
const renderer = new DagRenderer(workflow);
renderer.render(); // initial render

const results = await execute(workflow, input, {
  skills,
  claude,
  observer: (event) => renderer.update(event),
  logger: consoleLogger,
});
```

- [ ] **Step 6: Build and verify**

Run: `cd packages/core && npm run build`
Expected: Compiles without errors

- [ ] **Step 7: Commit**

```bash
git add packages/core/src/cli/renderer.ts packages/core/src/cli/renderer.test.ts packages/core/src/cli/main.ts
git commit -m "feat(core): add DAG terminal renderer with execution animation"
```

---

## Task 5: Migrate action to core

**Why:** The action currently imports from deprecated `@sweny-ai/engine` + `@sweny-ai/providers`. It needs to use core's `execute()`, skill map, and MCP auto-injection.

**Files:**
- Modify: `packages/action/package.json`
- Modify: `packages/action/src/config.ts`
- Modify: `packages/action/src/main.ts`
- Delete: `packages/action/src/providers/` (entire directory)

- [ ] **Step 1: Update `packages/action/package.json` dependencies**

Replace:
```json
"@sweny-ai/engine": "*",
"@sweny-ai/providers": "*"
```

With:
```json
"@sweny-ai/core": "*"
```

- [ ] **Step 2: Update `packages/action/src/config.ts`**

Replace the providers import:
```typescript
// Old:
import type { MCPServerConfig } from "@sweny-ai/providers";
// New:
import type { McpServerConfig } from "@sweny-ai/core";
```

Update the `ActionConfig` interface — change line 77:
```typescript
// Old:
mcpServers: Record<string, MCPServerConfig>;
// New:
mcpServers: Record<string, McpServerConfig>;
```

- [ ] **Step 3: Add `mcpServers` support to `ClaudeClientOptions`**

The auto-injected MCP servers (GitHub, Linear, Datadog, etc.) need to flow through to Claude Code's `query()` call. Add `mcpServers` to `ClaudeClientOptions` in `packages/core/src/claude.ts`:

In `ClaudeClientOptions`, add:
```typescript
/** External MCP servers (GitHub, Linear, Sentry, etc.) — merged with core skill tools */
mcpServers?: Record<string, McpServerConfig>;
```

Import the type:
```typescript
import type { Claude, Tool, ToolContext, NodeResult, ToolCall, JSONSchema, Logger, McpServerConfig } from "./types.js";
```

Add a private field: `private mcpServers: Record<string, McpServerConfig>;` and set it in the constructor: `this.mcpServers = opts.mcpServers ?? {};`

In the `run()` method, merge external MCP servers with the core skill tools server (around line 93):

```typescript
const allMcpServers: Record<string, any> = { ...this.mcpServers };
if (sdkTools.length > 0) {
  allMcpServers["sweny-core"] = mcpServer;
}

const stream = query({
  prompt,
  options: {
    maxTurns: this.maxTurns,
    systemPrompt: SYSTEM_PROMPT,
    cwd: this.cwd,
    env,
    permissionMode: "bypassPermissions",
    ...(this.model ? { model: this.model } : {}),
    ...(Object.keys(allMcpServers).length > 0 ? { mcpServers: allMcpServers } : {}),
  },
});
```

- [ ] **Step 4: Rewrite `packages/action/src/main.ts`**

Replace the entire file with:

```typescript
import * as core from "@actions/core";
import { execute, ClaudeClient, createSkillMap, configuredSkills, buildAutoMcpServers, consoleLogger } from "@sweny-ai/core";
import { triageWorkflow, implementWorkflow } from "@sweny-ai/core/workflows";
import type { ExecutionEvent, NodeResult } from "@sweny-ai/core";
import { parseInputs, validateInputs, ActionConfig } from "./config.js";

const actionsLogger = {
  info: core.info,
  debug: core.debug,
  warn: core.warning,
  error: core.error,
};

async function run(): Promise<void> {
  try {
    const config = parseInputs();
    const validationErrors = validateInputs(config);
    if (validationErrors.length > 0) {
      core.setFailed(validationErrors.join("\n"));
      return;
    }

    // Populate process.env from action inputs so skills can read their config
    populateEnv(config);

    // Build auto-injected MCP servers from provider config
    const mcpServers = buildAutoMcpServers({
      sourceControlProvider: config.sourceControlProvider,
      issueTrackerProvider: config.issueTrackerProvider,
      observabilityProvider: config.observabilityProvider,
      credentials: Object.fromEntries(
        Object.entries(process.env).filter((e): e is [string, string] => e[1] != null),
      ),
      workspaceTools: config.workspaceTools,
      userMcpServers: config.mcpServers,
    });

    // Build skill map from configured skills
    const skills = createSkillMap(configuredSkills());

    // Create Claude client with external MCP servers
    const claude = new ClaudeClient({
      maxTurns: config.workflow === "implement" ? config.maxImplementTurns : config.maxInvestigateTurns,
      cwd: process.cwd(),
      logger: actionsLogger,
      mcpServers,
    });

    // Select workflow
    const workflow = config.workflow === "implement" ? implementWorkflow : triageWorkflow;

    // Build workflow input
    const input = buildWorkflowInput(config);

    // Execute workflow
    const results = await execute(workflow, input, {
      skills,
      claude,
      observer: (event: ExecutionEvent) => handleEvent(event),
      logger: actionsLogger,
    });

    setGitHubOutputs(results);
  } catch (error) {
    if (error instanceof Error) {
      core.setFailed(error.message);
    } else {
      core.setFailed("An unexpected error occurred");
    }
  }
}

/** Populate process.env from action inputs so skills can resolve config via env vars */
function populateEnv(config: ActionConfig): void {
  const set = (key: string, value: string | undefined) => {
    if (value) process.env[key] = value;
  };

  // Auth
  set("ANTHROPIC_API_KEY", config.anthropicApiKey);
  set("CLAUDE_CODE_OAUTH_TOKEN", config.claudeOauthToken);
  set("GITHUB_TOKEN", config.githubToken || config.botToken);

  // Issue tracker
  set("LINEAR_API_KEY", config.linearApiKey);
  set("LINEAR_TEAM_ID", config.linearTeamId);
  set("LINEAR_BUG_LABEL_ID", config.linearBugLabelId);

  // Observability — map from structured credentials to flat env vars
  const obs = config.observabilityCredentials;
  switch (config.observabilityProvider) {
    case "datadog":
      set("DD_API_KEY", obs.apiKey);
      set("DD_APP_KEY", obs.appKey);
      set("DD_SITE", obs.site);
      break;
    case "sentry":
      set("SENTRY_AUTH_TOKEN", obs.authToken);
      set("SENTRY_ORG", obs.organization);
      set("SENTRY_PROJECT", obs.project);
      break;
    case "cloudwatch":
      set("AWS_REGION", obs.region);
      set("CLOUDWATCH_LOG_GROUP_PREFIX", obs.logGroupPrefix);
      break;
    case "splunk":
      set("SPLUNK_URL", obs.baseUrl);
      set("SPLUNK_TOKEN", obs.token);
      break;
    case "elastic":
      set("ELASTIC_URL", obs.baseUrl);
      set("ELASTIC_API_KEY", obs.apiKey);
      break;
    case "newrelic":
      set("NR_API_KEY", obs.apiKey);
      set("NR_ACCOUNT_ID", obs.accountId);
      set("NR_REGION", obs.region);
      break;
    case "loki":
      set("LOKI_URL", obs.baseUrl);
      set("LOKI_API_KEY", obs.apiKey);
      set("LOKI_ORG_ID", obs.orgId);
      break;
    case "betterstack":
      set("BETTERSTACK_API_TOKEN", obs.apiToken);
      break;
  }

  // Coding agent
  set("OPENAI_API_KEY", config.openaiApiKey);
  set("GEMINI_API_KEY", config.geminiApiKey);

  // Source control
  set("GITLAB_TOKEN", config.gitlabToken);
  set("GITLAB_URL", config.gitlabBaseUrl);

  // Jira
  set("JIRA_URL", config.jiraBaseUrl);
  set("JIRA_EMAIL", config.jiraEmail);
  set("JIRA_API_TOKEN", config.jiraApiToken);

  // Notification
  set("SLACK_WEBHOOK_URL", config.notificationWebhookUrl);
  set("SENDGRID_API_KEY", config.sendgridApiKey);
}

/** Build workflow input from action config */
function buildWorkflowInput(config: ActionConfig): Record<string, unknown> {
  return {
    timeRange: config.timeRange,
    severityFocus: config.severityFocus,
    serviceFilter: config.serviceFilter,
    investigationDepth: config.investigationDepth,
    dryRun: config.dryRun,
    reviewMode: config.reviewMode,
    noveltyMode: config.noveltyMode,
    repository: config.repository,
    baseBranch: config.baseBranch,
    prLabels: config.prLabels,
    issueOverride: config.linearIssue,
    additionalInstructions: config.additionalInstructions,
    serviceMapPath: config.serviceMapPath,
    issueTrackerName: config.issueTrackerProvider,
    projectId: config.linearTeamId,
    issueIdentifier: config.linearIssue,
  };
}

/** Handle execution events — map to GitHub Actions log groups */
function handleEvent(event: ExecutionEvent): void {
  switch (event.type) {
    case "node:enter":
      core.startGroup(`${event.node}: ${event.instruction.slice(0, 80)}`);
      break;
    case "node:exit":
      core.info(`${event.node}: ${event.result.status}`);
      core.endGroup();
      break;
    case "tool:call":
      core.info(`  → ${event.tool}`);
      break;
  }
}

/** Set GitHub Action outputs from execution results */
function setGitHubOutputs(results: Map<string, NodeResult>): void {
  const investigateResult = results.get("investigate");
  if (investigateResult) {
    core.setOutput("issues-found", String(investigateResult.data.issuesFound ?? false));
    core.setOutput("recommendation", String(investigateResult.data.recommendation ?? "skip"));
  }

  const prResult = results.get("create_pr") ?? results.get("implement");
  const issueResult = results.get("create_issue") ?? results.get("create-issue");
  if (prResult) {
    core.setOutput("issue-identifier", String(prResult.data.issueIdentifier ?? ""));
    core.setOutput("issue-url", String(prResult.data.issueUrl ?? ""));
    core.setOutput("pr-url", String(prResult.data.prUrl ?? ""));
    core.setOutput("pr-number", String(prResult.data.prNumber ?? ""));
  } else if (issueResult) {
    core.setOutput("issue-identifier", String(issueResult.data.issueIdentifier ?? ""));
    core.setOutput("issue-url", String(issueResult.data.issueUrl ?? ""));
  }
}

run();
```

- [ ] **Step 5: Delete `packages/action/src/providers/` directory**

Run: `rm -rf packages/action/src/providers/`

- [ ] **Step 6: Build the action**

Run: `cd packages/core && npm run build && cd ../action && npm run build`
Expected: Compiles without errors

- [ ] **Step 7: Run action tests**

Run: `cd packages/action && npx vitest run`

Some tests will need updating — specifically:
- `providers.test.ts` — delete this file (providers dir deleted)
- `mapToTriageConfig.test.ts` — delete this file (function removed)
- `main.test.ts` — update to test new `run()` flow
- `config.test.ts` — update `MCPServerConfig` → `McpServerConfig` type references

Fix any failing tests by updating imports and expectations.

- [ ] **Step 8: Bundle with NCC and verify**

Run: `cd packages/action && npm run package`
Expected: `../../dist/index.js` is generated

- [ ] **Step 9: Commit**

```bash
git add packages/action/ -A
git commit -m "feat(action): migrate from engine+providers to core"
```

---

## Task 6: Delete deprecated packages

**Why:** Engine, providers, agent, and cli packages are dead code. Core replaces them all.

**Files:**
- Delete: `packages/engine/` (entire directory)
- Delete: `packages/providers/` (entire directory)
- Delete: `packages/agent/` (entire directory)
- Delete: `packages/cli/` (entire directory)
- Modify: root `package.json` (workspaces still uses `packages/*` glob, which is fine — deleted dirs won't match)

- [ ] **Step 1: Delete the deprecated package directories**

```bash
rm -rf packages/engine packages/providers packages/agent packages/cli
```

- [ ] **Step 2: Update root package.json if needed**

The root uses `"workspaces": ["packages/*"]` which is a glob — deleted directories are automatically excluded. No change needed unless there are explicit workspace references elsewhere.

Check `package.json` scripts for any references to deleted packages and remove them.

- [ ] **Step 3: Run npm install to update lockfile**

Run: `npm install`
Expected: lockfile updates to remove deleted package references

- [ ] **Step 4: Verify build still works**

Run: `npm run build --workspace=packages/core && npm run build --workspace=packages/action`
Expected: Both compile successfully

- [ ] **Step 5: Run all tests**

Run: `npm test`
Expected: Only core, action, and studio tests run — all pass

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: remove deprecated engine, providers, agent, cli packages"
```

---

## Task 7: Remove changesets infrastructure

**Why:** Changesets require manual intervention (creating changeset files). We're replacing with fully automated auto-patch-on-push.

**Files:**
- Delete: `.changeset/` directory
- Delete: `scripts/auto-changeset.mjs` (if exists)
- Delete: `.github/workflows/auto-changeset.yml` (if exists)
- Modify: root `package.json` — remove `@changesets/cli` from devDependencies

- [ ] **Step 1: Delete changeset infrastructure**

```bash
rm -rf .changeset
rm -f scripts/auto-changeset.mjs
rm -f .github/workflows/auto-changeset.yml
```

- [ ] **Step 2: Remove changeset deps from root `package.json`**

Remove `@changesets/cli` from `devDependencies`.
Remove any `"release"` script that references `changeset publish`.

- [ ] **Step 3: Run npm install to update lockfile**

Run: `npm install`
Expected: lockfile updates cleanly

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "chore: remove changesets infrastructure"
```

---

## Task 8: Replace release and CI workflows

**Why:** The release workflow needs to build core (not engine/providers), auto-bump versions, and publish without changesets. Old per-package release workflows need to be deleted.

**Files:**
- Modify: `.github/workflows/release.yml` (full rewrite)
- Modify: `.github/workflows/ci.yml` (update build steps)
- Delete: `.github/workflows/release-engine.yml`
- Delete: `.github/workflows/release-providers.yml`
- Delete: `.github/workflows/release-agent.yml`
- Delete: `.github/workflows/release-cli.yml`
- Delete: `.github/workflows/release-action.yml`

- [ ] **Step 1: Delete old per-package release workflows**

```bash
rm -f .github/workflows/release-engine.yml
rm -f .github/workflows/release-providers.yml
rm -f .github/workflows/release-agent.yml
rm -f .github/workflows/release-cli.yml
rm -f .github/workflows/release-action.yml
```

- [ ] **Step 2: Rewrite `.github/workflows/release.yml`**

Replace entire file with:

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release
  cancel-in-progress: false

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      id-token: write

    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0
          token: ${{ secrets.GH_PAT || github.token }}

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          registry-url: https://registry.npmjs.org
          cache: npm

      - run: npm ci

      - name: Build
        run: |
          npm run build --workspace=packages/core
          npm run build:lib --workspace=packages/studio

      - name: Test
        run: npm run test

      - name: Configure git
        run: |
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"

      - name: Detect changes and publish
        env:
          NODE_AUTH_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: |
          # Find the last release marker tag, or fall back to first commit
          LAST_TAG=$(git describe --tags --abbrev=0 --match 'release-*' 2>/dev/null || echo "")
          DIFF_BASE=${LAST_TAG:-$(git rev-list --max-parents=0 HEAD)}

          CHANGED_CORE=$(git diff --name-only "$DIFF_BASE"..HEAD -- packages/core/ | head -1)
          CHANGED_STUDIO=$(git diff --name-only "$DIFF_BASE"..HEAD -- packages/studio/ | head -1)

          PUBLISHED=false

          if [ -n "$CHANGED_CORE" ]; then
            cd packages/core
            LOCAL_VER=$(node -p "require('./package.json').version")
            NPM_VER=$(npm view @sweny-ai/core version 2>/dev/null || echo "0.0.0")

            if [ "$LOCAL_VER" = "$NPM_VER" ]; then
              # Auto-bump patch
              NEXT=$(echo "$LOCAL_VER" | awk -F. '{$NF=$NF+1; print}' OFS=.)
              npm version "$NEXT" --no-git-tag-version
            fi
            # else: local version is already ahead (manual minor/major bump) — publish as-is

            npm publish
            PUBLISHED=true
            echo "Published @sweny-ai/core@$(node -p "require('./package.json').version")"
            cd ../..
          fi

          if [ -n "$CHANGED_STUDIO" ]; then
            cd packages/studio
            LOCAL_VER=$(node -p "require('./package.json').version")
            NPM_VER=$(npm view @sweny-ai/studio version 2>/dev/null || echo "0.0.0")

            if [ "$LOCAL_VER" = "$NPM_VER" ]; then
              NEXT=$(echo "$LOCAL_VER" | awk -F. '{$NF=$NF+1; print}' OFS=.)
              npm version "$NEXT" --no-git-tag-version
            fi

            npm publish
            PUBLISHED=true
            echo "Published @sweny-ai/studio@$(node -p "require('./package.json').version")"
            cd ../..
          fi

          if [ "$PUBLISHED" = true ]; then
            git add -A
            git commit -m "chore: release packages [skip ci]"
            git push
          fi

      - name: Rebuild action dist and tag
        run: |
          npm run package --workspace=packages/action
          git add dist/
          if ! git diff --cached --quiet; then
            git commit -m "chore: rebuild action dist [skip ci]"
            git push
          fi

          # Floating v3 tag — always points to latest main
          git tag -f v3
          git push origin v3 --force

          # Immutable version tag from core version
          CORE_VERSION=$(node -p "require('./packages/core/package.json').version")
          VERSIONED_TAG="v3.${CORE_VERSION}"
          if git tag "$VERSIONED_TAG" 2>/dev/null; then
            git push origin "$VERSIONED_TAG"
            echo "Pushed $VERSIONED_TAG"
          fi

          # Release marker for next diff detection
          git tag -f "release-latest"
          git push origin "release-latest" --force
```

- [ ] **Step 3: Update `.github/workflows/ci.yml`**

Replace the build steps. Change:

```yaml
      - name: Build providers
        run: npm run build --workspace=packages/providers

      - name: Build core
        run: npm run build --workspace=packages/core
```

To:

```yaml
      - name: Build core
        run: npm run build --workspace=packages/core
```

This change needs to be applied in **three places** in ci.yml: the `typecheck` job, the `test` job, and the `smoke-test` job.

Update the smoke test — replace the providers-specific test:

```yaml
  smoke-test:
    name: Smoke — core loads without optional deps
    runs-on: ubuntu-latest
    needs: [test]
    steps:
      - uses: actions/checkout@v6

      - uses: actions/setup-node@v6
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Build core
        run: npm run build --workspace=packages/core

      - name: Verify core loads
        run: |
          node --input-type=module <<'EOF'
          import('./packages/core/dist/index.js')
            .then(() => { console.log('✓ @sweny-ai/core loads'); })
            .catch((err) => { console.error('✗', err.message); process.exit(1); });
          EOF
```

- [ ] **Step 4: Verify CI workflow syntax**

Run: `npx yaml-lint .github/workflows/release.yml .github/workflows/ci.yml` (or check with any YAML validator)
Expected: Valid YAML

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ -A
git commit -m "ci: replace changesets with auto-release, remove deprecated workflows"
```

---

## Task 9: Deprecate old packages on npm and final verification

**Why:** Existing consumers of the deprecated packages should see deprecation warnings pointing to `@sweny-ai/core`.

**Files:** None (npm CLI commands only)

- [ ] **Step 1: Build everything from clean**

```bash
npm ci
npm run build --workspace=packages/core
npm run build:lib --workspace=packages/studio
npm run build --workspace=packages/action
```

Expected: All compile successfully

- [ ] **Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: No type errors

- [ ] **Step 4: Bundle action**

Run: `npm run package --workspace=packages/action`
Expected: `dist/index.js` generated

- [ ] **Step 5: Verify CLI works**

Run: `node packages/core/dist/cli/main.js --help`
Expected: Shows help text with triage, implement, check, init commands

- [ ] **Step 6: Deprecate old packages on npm**

```bash
npm deprecate @sweny-ai/engine "Replaced by @sweny-ai/core — see https://docs.sweny.ai"
npm deprecate @sweny-ai/providers "Replaced by @sweny-ai/core — see https://docs.sweny.ai"
npm deprecate @sweny-ai/agent "Replaced by @sweny-ai/core — see https://docs.sweny.ai"
npm deprecate @sweny-ai/cli "Use @sweny-ai/core instead — see https://docs.sweny.ai"
```

- [ ] **Step 7: Final commit and push**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
git push origin main
```

This push triggers the release workflow, which will:
1. Build core + studio
2. Run tests
3. Auto-bump and publish `@sweny-ai/core` (first npm release)
4. Auto-bump and publish `@sweny-ai/studio`
5. Rebuild action dist
6. Update `v3` floating tag
7. Create immutable version tag

---

## Execution Notes

**Task dependencies:**
- Tasks 1, 2 are independent of each other but must complete before Task 3
- Task 3 (CLI move) and Task 5 (action migration) both depend on Task 1 (MCP in core) and can run in parallel
- Task 4 (renderer) depends on Task 3
- Task 6 (delete packages) depends on Tasks 3 and 5
- Task 7 (remove changesets) is independent — can run any time
- Task 8 (workflows) depends on Tasks 6 and 7
- Task 9 (verification) must be last

**Parallel execution graph:**
```
Task 1 ──┬── Task 3 ── Task 4 ──┐
         │                       ├── Task 6 ──┬── Task 8 ── Task 9
Task 2 ──┘── Task 5 ────────────┘             │
                                  Task 7 ─────┘
```
