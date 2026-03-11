# Task 05 — Deduplicate provider factory switch blocks (CLI vs Action)

## Context

`packages/cli/src/providers/index.ts` and `packages/action/src/providers/index.ts` both
contain nearly identical switch/case blocks for instantiating providers:

- **Observability**: 8 cases (datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, file)
  — identical logic, different `logger` arg
- **Coding agent**: 3 cases (codex, gemini, claude)
  — identical, only `quiet: true` in CLI is the difference

Every time a new observability provider or coding agent is added, it must be added in both
files. This is the primary maintenance burden.

The fix: add two shared factory functions to `@sweny-ai/providers`:
- `createObservabilityProvider(name, credentials, logger)` — handles all 8 cases
- `createCodingAgentProvider(name, options)` — handles all 3 cases

Both CLI and Action then call these instead of inlining the switches.

## Changes required

### 1. New file: `packages/providers/src/factories.ts`

```ts
import type { Logger } from "./logger.js";
import type { ObservabilityProvider } from "./observability/index.js";
import type { CodingAgent } from "./coding-agent/index.js";
import { datadog, sentry, cloudwatch, splunk, elastic, newrelic, loki, file } from "./observability/index.js";
import { claudeCode, openaiCodex, googleGemini } from "./coding-agent/index.js";

export function createObservabilityProvider(
  name: string,
  credentials: Record<string, string>,
  logger: Logger,
): ObservabilityProvider {
  switch (name) {
    case "datadog":
      return datadog({ apiKey: credentials.apiKey, appKey: credentials.appKey, site: credentials.site, logger });
    case "sentry":
      return sentry({ authToken: credentials.authToken, organization: credentials.organization, project: credentials.project, baseUrl: credentials.baseUrl, logger });
    case "cloudwatch":
      return cloudwatch({ region: credentials.region, logGroupPrefix: credentials.logGroupPrefix, logger });
    case "splunk":
      return splunk({ baseUrl: credentials.baseUrl, token: credentials.token, index: credentials.index, logger });
    case "elastic":
      return elastic({ baseUrl: credentials.baseUrl, apiKey: credentials.apiKey, index: credentials.index, logger });
    case "newrelic":
      return newrelic({ apiKey: credentials.apiKey, accountId: credentials.accountId, region: credentials.region as "us" | "eu", logger });
    case "loki":
      return loki({ baseUrl: credentials.baseUrl, apiKey: credentials.apiKey, orgId: credentials.orgId, logger });
    case "file":
      return file({ path: credentials.path, logger });
    default:
      throw new Error(`Unsupported observability provider: ${name}`);
  }
}

export function createCodingAgentProvider(
  name: string,
  logger: Logger,
  opts?: { quiet?: boolean },
): CodingAgent {
  const quiet = opts?.quiet ?? false;
  switch (name) {
    case "codex":
      return openaiCodex({ logger, quiet });
    case "gemini":
      return googleGemini({ logger, quiet });
    case "claude":
    default:
      return claudeCode({ logger, quiet });
  }
}
```

### 2. Export from `packages/providers/src/index.ts`

Add at the bottom:
```ts
// Factories
export { createObservabilityProvider, createCodingAgentProvider } from "./factories.js";
```

### 3. `packages/cli/src/providers/index.ts`

Remove the inline observability and coding agent imports and switch blocks.
Replace with:
```ts
import { createObservabilityProvider, createCodingAgentProvider } from "@sweny-ai/providers";
```

Replace the observability switch block with:
```ts
const observability = createObservabilityProvider(config.observabilityProvider, config.observabilityCredentials, logger);
registry.set("observability", observability);
```

Replace both coding agent switch blocks (in `createProviders` and `createImplementProviders`) with:
```ts
registry.set("codingAgent", createCodingAgentProvider(config.codingAgentProvider, logger, { quiet: true }));
```

Remove now-unused individual imports (datadog, sentry, etc. and claudeCode, etc.) — keep only the ones still directly used.

### 4. `packages/action/src/providers/index.ts`

Same treatment — replace observability and coding agent switches with the shared factory calls.

## Build and test

```
cd packages/providers && npm run build
cd packages/cli && npm run typecheck
cd packages/action && npm run typecheck && npx vitest run
```

## Definition of done

- The observability 8-case switch does NOT appear in either CLI or Action providers file
- The coding agent 3-case switch does NOT appear in either CLI or Action providers file
- Both typechecks pass
- No test failures
- Create a changeset: `@sweny-ai/providers` minor (new exports), `@sweny-ai/cli` patch
