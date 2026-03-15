# Task 04: Add configSchema to Providers

## Context

The engine already has pre-flight config validation built in (`validateWorkflowConfig` in `runner-recipe.ts`).
`StepDefinition.uses?: string[]` is already in the type system.
`WorkflowConfigError` is already exported.

**What's missing:** individual providers don't declare their `configSchema` yet, so the pre-flight validation has nothing to check.

The `ProviderConfigSchema` type is already exported from `@sweny-ai/providers`:
```ts
interface ProviderConfigSchema {
  role: string;      // e.g. "observability"
  name: string;      // e.g. "Datadog"
  fields: ProviderConfigField[];
}
interface ProviderConfigField {
  key: string;       // logical field name, e.g. "apiKey"
  envVar: string;    // e.g. "DD_API_KEY"
  required?: boolean; // default true
  description: string;
}
```

**The pattern:** each provider factory returns an object. Add `configSchema` as a property on that returned object.

---

## Providers to Update

Find each provider in `packages/providers/src/`. The factory function returns an object — add `configSchema` to it.

### Observability providers

**`datadog`** (`observability/datadog.ts`):
```ts
configSchema: {
  role: "observability",
  name: "Datadog",
  fields: [
    { key: "apiKey", envVar: "DD_API_KEY", description: "Datadog API key" },
    { key: "appKey", envVar: "DD_APPLICATION_KEY", description: "Datadog Application key" },
  ],
}
```

**`sentry`** (`observability/sentry.ts`):
```ts
configSchema: {
  role: "observability",
  name: "Sentry",
  fields: [{ key: "authToken", envVar: "SENTRY_AUTH_TOKEN", description: "Sentry auth token" }],
}
```

**`newrelic`** (`observability/newrelic.ts`):
```ts
configSchema: {
  role: "observability",
  name: "New Relic",
  fields: [{ key: "apiKey", envVar: "NR_API_KEY", description: "New Relic API key" }],
}
```

**`cloudwatch`** (`observability/cloudwatch.ts`):
```ts
configSchema: {
  role: "observability",
  name: "CloudWatch",
  fields: [{ key: "region", envVar: "AWS_REGION", description: "AWS region" }],
}
```

**`splunk`** (`observability/splunk.ts`):
```ts
configSchema: {
  role: "observability",
  name: "Splunk",
  fields: [
    { key: "url", envVar: "SPLUNK_URL", description: "Splunk base URL" },
    { key: "token", envVar: "SPLUNK_TOKEN", description: "Splunk API token" },
  ],
}
```

**`elastic`** (`observability/elastic.ts`):
```ts
configSchema: {
  role: "observability",
  name: "Elasticsearch",
  fields: [
    { key: "url", envVar: "ELASTIC_URL", description: "Elasticsearch URL" },
    { key: "apiKey", envVar: "ELASTIC_API_KEY", description: "Elasticsearch API key" },
  ],
}
```

**`loki`** (`observability/loki.ts`):
```ts
configSchema: {
  role: "observability",
  name: "Grafana Loki",
  fields: [{ key: "url", envVar: "LOKI_URL", description: "Loki base URL" }],
}
```

### Issue tracking providers

**`linear`** (`issue-tracking/linear.ts`):
```ts
configSchema: {
  role: "issueTracker",
  name: "Linear",
  fields: [{ key: "apiKey", envVar: "LINEAR_API_KEY", description: "Linear API key" }],
}
```

**`githubIssues`** (`issue-tracking/github-issues.ts` or similar):
```ts
configSchema: {
  role: "issueTracker",
  name: "GitHub Issues",
  fields: [{ key: "token", envVar: "GITHUB_TOKEN", description: "GitHub personal access token" }],
}
```

**`jira`** (`issue-tracking/jira.ts`):
```ts
configSchema: {
  role: "issueTracker",
  name: "Jira",
  fields: [
    { key: "baseUrl", envVar: "JIRA_BASE_URL", description: "Jira instance base URL" },
    { key: "email", envVar: "JIRA_EMAIL", description: "Jira account email" },
    { key: "apiToken", envVar: "JIRA_API_TOKEN", description: "Jira API token" },
  ],
}
```

### Source control providers

**`github`** (`source-control/github.ts`):
```ts
configSchema: {
  role: "sourceControl",
  name: "GitHub",
  fields: [{ key: "token", envVar: "GITHUB_TOKEN", description: "GitHub personal access token" }],
}
```

**`gitlab`** (`source-control/gitlab.ts`):
```ts
configSchema: {
  role: "sourceControl",
  name: "GitLab",
  fields: [{ key: "token", envVar: "GITLAB_TOKEN", description: "GitLab personal access token" }],
}
```

### Coding agent providers

**`claudeCode`** (`coding-agent/claude-code.ts`):
```ts
configSchema: {
  role: "codingAgent",
  name: "Claude Code",
  fields: [
    { key: "anthropicApiKey", envVar: "ANTHROPIC_API_KEY", required: false, description: "Anthropic API key (or use CLAUDE_CODE_OAUTH_TOKEN)" },
    { key: "oauthToken", envVar: "CLAUDE_CODE_OAUTH_TOKEN", required: false, description: "Claude Code OAuth token (or use ANTHROPIC_API_KEY)" },
  ],
}
```

**`openaiCodex`** (`coding-agent/openai-codex.ts`):
```ts
configSchema: {
  role: "codingAgent",
  name: "OpenAI Codex",
  fields: [{ key: "apiKey", envVar: "OPENAI_API_KEY", description: "OpenAI API key" }],
}
```

**`googleGemini`** (`coding-agent/google-gemini.ts`):
```ts
configSchema: {
  role: "codingAgent",
  name: "Google Gemini",
  fields: [{ key: "apiKey", envVar: "GEMINI_API_KEY", description: "Gemini API key" }],
}
```

---

## How to Add to a Provider

Find the provider factory. It returns an object. Add `configSchema` as a property:

```ts
// Before:
export function datadog(config: DatadogConfig) {
  return {
    async queryLogs(...) { ... },
    async aggregate(...) { ... },
    // ...
  };
}

// After:
export function datadog(config: DatadogConfig) {
  return {
    configSchema: {
      role: "observability",
      name: "Datadog",
      fields: [...],
    },
    async queryLogs(...) { ... },
    // ...
  };
}
```

If the return type is typed (e.g. `ObservabilityProvider`), update the interface in `types.ts` to include `configSchema?: ProviderConfigSchema`.

---

## Update triage/implement definitions

`packages/engine/src/recipes/triage/definition.ts` — add `uses` arrays per step (the type supports it, just not populated yet). Reference the workflow-refactor.md for the complete mapping:

```ts
"dedup-check":      { phase: "learn",  uses: ["observability"], ... },
"verify-access":    { phase: "learn",  critical: true, ... },
"build-context":    { phase: "learn",  uses: ["observability"], critical: true, ... },
"investigate":      { phase: "learn",  uses: ["codingAgent"], critical: true, ... },
"novelty-gate":     { phase: "act",    uses: ["issueTracker"], ... },
"create-issue":     { phase: "act",    uses: ["issueTracker"], ... },
"cross-repo-check": { phase: "act",    uses: ["sourceControl"], ... },
"implement-fix":    { phase: "act",    uses: ["codingAgent"], ... },
"create-pr":        { phase: "act",    uses: ["sourceControl"], ... },
"notify":           { phase: "report", uses: ["notification"] },
```

`packages/engine/src/recipes/implement/definition.ts`:
```ts
"verify-access":  { phase: "learn",  critical: true, ... },
"create-issue":   { phase: "learn",  uses: ["issueTracker"], critical: true, ... },
"implement-fix":  { phase: "act",    uses: ["codingAgent"], ... },
"create-pr":      { phase: "act",    uses: ["sourceControl"], ... },
"notify":         { phase: "report", uses: ["notification"] },
```

---

## Tests

In `packages/engine/src/runner-recipe.test.ts`, add tests for pre-flight validation:
- "throws WorkflowConfigError when required env vars are missing"
- "reports all missing vars at once"
- "passes when all required vars are present"
- "skips steps with no uses field"
- "skips providers with no configSchema"

---

## Changeset

`.changeset/provider-config-schemas.md`:
```md
---
"@sweny-ai/providers": minor
"@sweny-ai/engine": minor
---

Providers now expose `configSchema` — a declarative list of required env vars.
`runWorkflow()` runs pre-flight validation before step 1 and throws `WorkflowConfigError`
listing all missing env vars grouped by step. Built-in workflows now declare `uses` on each step.
```

---

## Done Criteria

- [ ] All listed providers have `configSchema` property on their returned object
- [ ] `ObservabilityProvider` (and other provider interfaces) include `configSchema?: ProviderConfigSchema`
- [ ] triage and implement definitions have `uses` arrays on all relevant steps
- [ ] Engine pre-flight tests pass
- [ ] `npm test` passes in `packages/engine`, `packages/providers`
- [ ] Changeset created
