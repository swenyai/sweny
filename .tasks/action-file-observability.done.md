# Task: Add File Observability Provider to GitHub Action

## Why

The `file` observability provider (`packages/providers/src/observability/file.ts`) reads
log entries from a local JSON file instead of querying an external API. It is useful for:
- CI workflows that dump logs to disk before running triage
- Testing triage locally against captured production logs
- Offline/air-gapped environments

The provider is fully implemented and exported from `@sweny-ai/providers/observability`,
and the CLI (`packages/cli/src/providers/index.ts`) already supports it. However, the
GitHub Action (`action.yml`, `packages/action/src/config.ts`, and
`packages/action/src/providers/index.ts`) does not expose or wire it.

---

## File provider API

```typescript
import { file } from "@sweny-ai/providers/observability";

const provider = file({ path: "./logs/errors.json" });
```

Config schema (from `packages/providers/src/observability/file.ts`):
```typescript
{ path: string }  // path to a JSON file on disk
```

The file must contain either:
- An array of log entries: `[{ timestamp, service, level, message, attributes? }, ...]`
- Or a wrapper object: `{ "logs": [...] }`

`getAgentEnv()` returns `{ SWENY_LOG_FILE: "/path/to/file" }`.

---

## Files to change

1. `action.yml` (repo root)
2. `packages/action/src/config.ts`
3. `packages/action/src/providers/index.ts`

---

## Step 1 — `action.yml`

### 1a. Update the `observability-provider` input description (line 19)

```yaml
# Before
description: "Observability provider to use (datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki)"

# After
description: "Observability provider to use (datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, file)"
```

### 1b. Add a `log-file-path` input

Add this after the Loki inputs block (after the `loki-org-id` input, around line 104):

```yaml
  # File provider (when observability-provider = file)
  log-file-path:
    description: "Path to a local JSON log file (required when observability-provider is file)"
    required: false
```

---

## Step 2 — `packages/action/src/config.ts`

### 2a. Add `logFilePath` to the `ActionConfig` interface

After the existing observability fields (around line 11):

```typescript
  logFilePath: string;
```

### 2b. Read the input in `parseInputs()`

After `observabilityCredentials` (around line 76):

```typescript
    logFilePath: core.getInput("log-file-path"),
```

### 2c. Add `case "file"` to `parseObservabilityCredentials()`

This function is at the bottom of the file (around line 248). Add a case before `default`:

```typescript
    case "file":
      return {
        path: core.getInput("log-file-path"),
      };
```

### 2d. Add validation in `validateInputs()`

Add a case to the `switch (config.observabilityProvider)` block (around line 135):

```typescript
    case "file":
      if (!config.logFilePath)
        errors.push("Missing required input: `log-file-path` is required when `observability-provider` is `file`");
      break;
```

---

## Step 3 — `packages/action/src/providers/index.ts`

### 3a. Add `file` to the import (line 5)

```typescript
// Before
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki } from "@sweny-ai/providers/observability";

// After
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, file } from "@sweny-ai/providers/observability";
```

### 3b. Add `case "file"` to the observability switch (after the `loki` case, around line 83)

```typescript
    case "file":
      observability = file({
        path: obsCreds.path,
        logger: actionsLogger,
      });
      break;
```

---

## Note on `agentEnv` in `main.ts`

No changes needed to `packages/action/src/main.ts`. The file provider's `getAgentEnv()`
already returns `{ SWENY_LOG_FILE: path }`, and the engine calls `getAgentEnv()` on the
provider to pass env vars to the coding agent. The path ends up in the agent's
environment automatically via the existing mechanism.

---

## Tests to update

**File:** `packages/action/tests/providers.test.ts`

Add a test case for `observabilityProvider: "file"`:

```typescript
it("creates file observability provider", () => {
  const config = makeConfig({
    observabilityProvider: "file",
    observabilityCredentials: { path: "/tmp/logs.json" },
  });
  const registry = createProviders(config);
  const obs = registry.get("observability");
  expect(typeof obs.queryLogs).toBe("function");
});
```

---

## How to run tests

```bash
cd packages/action
npm test
```

---

## Usage example after this change

```yaml
- name: Dump recent errors to file
  run: ./scripts/export-logs.sh > /tmp/logs.json

- uses: swenyai/sweny@main
  with:
    observability-provider: file
    log-file-path: /tmp/logs.json
    issue-tracker-provider: github-issues
    github-token: ${{ secrets.GITHUB_TOKEN }}
```
