# Task: Add `implement` Subcommand to CLI

## Why

The CLI currently only has `sweny triage`. The engine has a fully built `implementWorkflow` that
takes a known issue identifier, fetches the issue, implements a fix, and opens a PR. Exposing this
as `sweny implement <issue-id>` gives users a way to run the implement recipe locally — useful for
one-off fixes and for CI pipelines that separate triage from implementation.

---

## Background

- `implementWorkflow` is exported from `@swenyai/engine`
- `ImplementConfig` is also exported from `@swenyai/engine`
- The CLI config is in `packages/cli/src/config.ts` — has `CliConfig` type and `registerTriageCommand`
- The CLI entry is `packages/cli/src/main.ts` — registers `triage` command and calls `runWorkflow`
- Provider hydration is in `mapToTriageConfig` in `main.ts` — the same env var mappings apply to implement

The `ImplementConfig` differs from `TriageConfig` in that it needs:
- `issueIdentifier: string` — the issue to fix (e.g. `"ENG-123"`)
- No observability provider (no log querying)
- Same `agentEnv`, `repository`, `dryRun`, `maxImplementTurns`, `projectId` etc.

---

## Step 1 — Register `implement` command in `packages/cli/src/config.ts`

Add `registerImplementCommand` alongside `registerTriageCommand`:

```typescript
export function registerImplementCommand(program: Command): Command {
  return program
    .command("implement <issueId>")
    .description("Implement a fix for a specific issue and open a PR")
    .option("--repo <owner/repo>", "Repository to work in (overrides config)")
    .option("--dry-run", "Skip creating PR and issue — report only", false)
    .option("--max-implement-turns <n>", "Max coding agent turns", "40")
    .option("--config <path>", "Path to sweny.config.json")
    .option("--anthropic-api-key <key>", "Anthropic API key")
    .option("--issue-tracker <provider>", "Issue tracker (linear|jira|github)")
    .option("--source-control <provider>", "Source control (github|gitlab|file)")
    // Add credential options per provider — same options as triage but without observability
    .option("--linear-api-key <key>", "Linear API key")
    .option("--linear-team-id <id>", "Linear team ID")
    .option("--github-token <token>", "GitHub personal access token")
    .option("--jira-base-url <url>", "Jira base URL")
    .option("--jira-email <email>", "Jira email")
    .option("--jira-api-token <token>", "Jira API token");
}
```

---

## Step 2 — Add `mapToImplementConfig` in `packages/cli/src/main.ts`

Add a function that builds `ImplementConfig` from CLI options and env vars:

```typescript
import { implementWorkflow } from "@swenyai/engine";
import type { ImplementConfig } from "@swenyai/engine";

function mapToImplementConfig(issueId: string, opts: Record<string, unknown>, config: CliConfig): ImplementConfig {
  const agentEnv: Record<string, string> = {};
  if (config.anthropicApiKey) agentEnv.ANTHROPIC_API_KEY = config.anthropicApiKey;
  if (config.claudeOauthToken) agentEnv.CLAUDE_OAUTH_TOKEN = config.claudeOauthToken;

  // Issue tracking credentials
  if (config.issueTracker === "linear") {
    if (config.issueTrackerCreds.apiKey) agentEnv.LINEAR_API_KEY = config.issueTrackerCreds.apiKey;
    if (config.issueTrackerCreds.teamId) agentEnv.LINEAR_TEAM_ID = config.issueTrackerCreds.teamId;
  }
  if (config.issueTracker === "jira") {
    if (config.issueTrackerCreds.baseUrl) agentEnv.JIRA_BASE_URL = config.issueTrackerCreds.baseUrl;
    if (config.issueTrackerCreds.email) agentEnv.JIRA_EMAIL = config.issueTrackerCreds.email;
    if (config.issueTrackerCreds.apiToken) agentEnv.JIRA_API_TOKEN = config.issueTrackerCreds.apiToken;
  }

  // Source control credentials
  if (config.sourceControlCreds.token) agentEnv.GITHUB_TOKEN = config.sourceControlCreds.token;
  if (config.sourceControlCreds.gitlabToken) agentEnv.GITLAB_TOKEN = config.sourceControlCreds.gitlabToken;

  return {
    issueIdentifier: issueId,
    repository: config.repo ?? "",
    dryRun: config.dryRun ?? false,
    maxImplementTurns: config.maxImplementTurns ?? 40,
    projectId: config.issueTrackerCreds.teamId ?? config.issueTrackerCreds.projectKey ?? "",
    stateInProgress: "",
    statePeerReview: "",
    agentEnv,
  };
}
```

---

## Step 3 — Wire in `main.ts`

```typescript
import { registerImplementCommand } from "./config.js";
import { implementWorkflow } from "@swenyai/engine";

// After registering triage:
const implementCmd = registerImplementCommand(program);
implementCmd.action(async (issueId: string, opts) => {
  // Parse config (reuse parseCliInputs or a simplified version)
  // Validate required fields (repo, issue tracker credentials)
  // Build providers (issueTracker + sourceControl + codingAgent — no observability)
  // Run: await runWorkflow(implementWorkflow, config, providers, { logger })
  // Output result
  process.exit(result.status === "failed" ? 1 : 0);
});
```

For provider hydration, reuse the existing provider factory functions from `mapToTriageConfig`
but skip the observability section. The same `hydrateIssueTracker`, `hydrateSourceControl`,
`hydrateCodeAgent` helpers can be extracted and shared if they aren't already.

---

## Step 4 — Provider registry for implement

The implement workflow needs:
- `issueTracker` (to fetch the issue)
- `sourceControl` (to clone, branch, push, open PR)
- `codingAgent` (to write the fix)

Use `createProviderRegistry()` from `@swenyai/engine` and `.set("issueTracker", ...)` etc.
same pattern as triage.

---

## Step 5 — Tests

**File:** `packages/cli/tests/implement.test.ts` (new)

Mock the engine, providers, config parsing — same pattern as existing CLI tests:

```typescript
vi.mock("@swenyai/engine", () => ({
  runWorkflow: vi.fn().mockResolvedValue({ status: "completed", steps: [], duration: 1000 }),
  implementWorkflow: {},
  createProviderRegistry: vi.fn().mockReturnValue({ set: vi.fn(), get: vi.fn() }),
}));
vi.mock("@swenyai/providers/issue-tracking", () => ({ linear: vi.fn(), jira: vi.fn(), githubIssues: vi.fn() }));
vi.mock("@swenyai/providers/source-control", () => ({ github: vi.fn(), gitlab: vi.fn() }));
vi.mock("@swenyai/providers/coding-agent", () => ({ claudeCode: vi.fn() }));

describe("implement command", () => {
  it("calls runWorkflow with implementWorkflow when given a valid issue id", async () => { ... });
  it("exits 1 when workflow fails", async () => { ... });
  it("maps linear credentials to agentEnv", async () => { ... });
  it("maps github credentials to agentEnv", async () => { ... });
  it("passes issueIdentifier to ImplementConfig", async () => { ... });
});
```

---

## How to run

```bash
npm test --workspace=packages/cli
```

Also smoke test manually:
```bash
# From sweny repo root
node packages/cli/dist/main.js implement ENG-123 --dry-run --repo owner/repo --linear-api-key test
```
