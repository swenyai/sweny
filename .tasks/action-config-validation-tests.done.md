# Task: Tests for action `validateInputs` and `mapToTriageConfig`

## Why

`packages/action/src/config.ts` has ~130 lines of validation logic (`validateInputs`) and a
credential parser (`parseObservabilityCredentials`) that are completely untested.
`packages/action/src/main.ts` builds `agentEnv` in `mapToTriageConfig` — the codex/gemini
key paths added in the last PR have no test coverage.

Current `packages/action/tests/providers.test.ts` covers provider wiring only (shape checks).
A separate `config.test.ts` file should cover the config layer.

---

## File to create

**`packages/action/tests/config.test.ts`**

Mock `@actions/core` with `vi.mock` so `core.getInput` / `core.getBooleanInput` return
controlled values.

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

const mockGetInput = vi.fn();
const mockGetBooleanInput = vi.fn();

vi.mock("@actions/core", () => ({
  getInput: mockGetInput,
  getBooleanInput: mockGetBooleanInput,
}));

// Dynamic import after mock
const { validateInputs, parseInputs } = await import("../src/config.js");
```

---

## Tests to write

### `validateInputs` — auth errors

```typescript
describe("validateInputs — auth", () => {
  it("errors when neither anthropic-api-key nor claude-oauth-token provided", () => {
    const errors = validateInputs(makeConfig({ anthropicApiKey: "", claudeOauthToken: "" }));
    expect(errors.some((e) => e.includes("anthropic-api-key") || e.includes("claude-oauth-token"))).toBe(true);
  });

  it("passes when only anthropicApiKey provided", () => {
    const errors = validateInputs(makeConfig({ anthropicApiKey: "sk-ant-xxx" }));
    expect(errors.filter((e) => e.includes("anthropic"))).toHaveLength(0);
  });

  it("passes when only claudeOauthToken provided", () => {
    const errors = validateInputs(makeConfig({ claudeOauthToken: "oauth-xxx" }));
    expect(errors.filter((e) => e.includes("claude-oauth-token"))).toHaveLength(0);
  });
});
```

### `validateInputs` — observability provider credentials

Test every provider that has required fields:

- `datadog` — missing `dd-api-key` → error; missing `dd-app-key` → error
- `sentry` — missing `sentry-auth-token`, `sentry-org`, `sentry-project` → errors
- `cloudwatch` — missing `cloudwatch-log-group-prefix` → error
- `splunk` — missing `splunk-url`, `splunk-token` → errors
- `elastic` — missing `elastic-url`, `elastic-api-key` → errors
- `newrelic` — missing `newrelic-api-key`, `newrelic-account-id` → errors
- `loki` — missing `loki-url` → error
- `file` — missing `log-file-path` → error

Pattern:
```typescript
it("errors when datadog api key missing", () => {
  const errors = validateInputs(makeConfig({
    observabilityProvider: "datadog",
    observabilityCredentials: { apiKey: "", appKey: "app-key", site: "datadoghq.com" },
  }));
  expect(errors.some((e) => e.includes("dd-api-key"))).toBe(true);
});
```

### `validateInputs` — issue tracker credentials

- `linear` — missing `linear-api-key` → error; missing `linear-team-id` → error
- `jira` — missing `jira-base-url`, `jira-email`, `jira-api-token` → errors

### `validateInputs` — source control credentials

- `gitlab` — missing `gitlab-token` → error; missing `gitlab-project-id` → error

### `validateInputs` — coding agent credentials

- `codex` — missing `openai-api-key` → error; with key → no error
- `gemini` — missing `gemini-api-key` → error; with key → no error
- `claude` — no agent-specific key required (existing claude auth check covers it)

### `validateInputs` — turn bounds

```typescript
it("errors when maxInvestigateTurns is 0", () => {
  const errors = validateInputs(makeConfig({ maxInvestigateTurns: 0 }));
  expect(errors.some((e) => e.includes("max-investigate-turns"))).toBe(true);
});

it("errors when maxImplementTurns exceeds 500", () => {
  const errors = validateInputs(makeConfig({ maxImplementTurns: 501 }));
  expect(errors.some((e) => e.includes("max-implement-turns"))).toBe(true);
});

it("passes with valid turn counts", () => {
  const errors = validateInputs(makeConfig({ maxInvestigateTurns: 50, maxImplementTurns: 30 }));
  expect(errors).toHaveLength(0);
});
```

### `validateInputs` — notification credentials

- `slack` / `teams` / `discord` / `webhook` — missing `notification-webhook-url` → error
- `email` — missing `sendgrid-api-key`, `email-from`, `email-to` → errors

### `mapToTriageConfig` — agentEnv

Import `mapToTriageConfig` (it is not exported — either export it or test via a spy on
the workflow runner). Simplest approach: export it from `main.ts` for testing only, or
inline the logic test by calling the full `run()` with mocked `runWorkflow`.

Actually, easiest: extract `mapToTriageConfig` to its own function exported from
`packages/action/src/triageConfig.ts`, import it, and test directly.

If that refactor is out of scope, test the agentEnv by capturing what gets passed to
`runWorkflow` via a mock:

```typescript
it("passes OPENAI_API_KEY to agentEnv when codex selected", async () => {
  // mock runWorkflow to capture config arg
  // set codingAgentProvider: "codex", openaiApiKey: "sk-openai-xxx"
  // verify triageConfig.agentEnv.OPENAI_API_KEY === "sk-openai-xxx"
});

it("passes GEMINI_API_KEY to agentEnv when gemini selected", async () => {
  // set codingAgentProvider: "gemini", geminiApiKey: "gemini-xxx"
  // verify triageConfig.agentEnv.GEMINI_API_KEY === "gemini-xxx"
});

it("does not set OPENAI_API_KEY when key is empty", () => {
  // openaiApiKey: "" → agentEnv should not have OPENAI_API_KEY key
});
```

---

## Helper

```typescript
function makeConfig(overrides: Partial<ActionConfig> = {}): ActionConfig {
  return {
    anthropicApiKey: "sk-ant-test",
    claudeOauthToken: "",
    codingAgentProvider: "claude",
    openaiApiKey: "",
    geminiApiKey: "",
    observabilityProvider: "datadog",
    observabilityCredentials: { apiKey: "dd-key", appKey: "dd-app", site: "datadoghq.com" },
    logFilePath: "",
    issueTrackerProvider: "github-issues",
    linearApiKey: "",
    linearTeamId: "",
    linearBugLabelId: "",
    linearTriageLabelId: "",
    linearStateBacklog: "",
    linearStateInProgress: "",
    linearStatePeerReview: "",
    timeRange: "24h",
    severityFocus: "errors",
    serviceFilter: "*",
    investigationDepth: "standard",
    maxInvestigateTurns: 50,
    maxImplementTurns: 30,
    baseBranch: "main",
    prLabels: ["agent"],
    dryRun: false,
    noveltyMode: false,
    linearIssue: "",
    additionalInstructions: "",
    serviceMapPath: ".github/service-map.yml",
    githubToken: "ghp_test",
    botToken: "",
    sourceControlProvider: "github",
    jiraBaseUrl: "",
    jiraEmail: "",
    jiraApiToken: "",
    gitlabToken: "",
    gitlabProjectId: "",
    gitlabBaseUrl: "https://gitlab.com",
    notificationProvider: "github-summary",
    notificationWebhookUrl: "",
    sendgridApiKey: "",
    emailFrom: "",
    emailTo: "",
    webhookSigningSecret: "",
    repository: "org/repo",
    repositoryOwner: "org",
    ...overrides,
  };
}
```

---

## How to run

```bash
cd packages/action
npm test
```

Target: ~30 new tests, all existing tests still pass.
