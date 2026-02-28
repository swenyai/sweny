# Tests: Splunk, Elastic, Loki, New Relic Observability Providers

Add unit tests for all 4 new observability providers. Follow the exact pattern used in the existing `tests/observability.test.ts`.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Test framework
Vitest. Import from `vitest`: `describe`, `it`, `expect`, `vi`, `afterEach`.

## Pattern to follow

Here is the EXACT pattern from `tests/observability.test.ts` for Sentry (follow this closely):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { sentry, sentryConfigSchema } from "../src/observability/sentry.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("sentryConfigSchema", () => {
  it("validates a complete config", () => {
    const result = sentryConfigSchema.safeParse({ authToken: "tok", organization: "org", project: "proj" });
    expect(result.success).toBe(true);
  });
  it("applies default baseUrl", () => {
    const result = sentryConfigSchema.parse({ authToken: "tok", organization: "org", project: "proj" });
    expect(result.baseUrl).toBe("https://sentry.io");
  });
  it("rejects missing fields", () => {
    expect(sentryConfigSchema.safeParse({ authToken: "tok" }).success).toBe(false);
  });
});

describe("sentry factory", () => {
  it("returns an ObservabilityProvider", () => {
    const provider = sentry({ authToken: "t", organization: "o", project: "p" });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.queryLogs).toBe("function");
    expect(typeof provider.aggregate).toBe("function");
    expect(typeof provider.getAgentEnv).toBe("function");
    expect(typeof provider.getPromptInstructions).toBe("function");
  });
  it("getAgentEnv returns env vars", () => { /* ... */ });
  it("getPromptInstructions contains API docs", () => { /* ... */ });
});

describe("SentryProvider", () => {
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("verifyAccess calls the correct endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = mockFetch;
    await sentry({ authToken: "tok", organization: "org", project: "proj", logger: silentLogger }).verifyAccess();
    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain("/api/0/organizations/org/");
    expect(opts.headers.Authorization).toBe("Bearer tok");
  });

  it("queryLogs returns mapped LogEntry array", async () => { /* mock fetch, call queryLogs, assert mapping */ });
  it("aggregate returns grouped results", async () => { /* ... */ });
  it("throws on non-ok response", async () => { /* ... */ });
});
```

## Task

Create a NEW file `tests/observability-new.test.ts` with tests for all 4 new providers. Do NOT modify `tests/observability.test.ts`.

### For each provider, test:

#### 1. Config schema validation
- Valid config parses successfully
- Default values are applied
- Missing required fields are rejected
- Empty strings are rejected

#### 2. Factory function
- Returns object with all 5 ObservabilityProvider methods
- `getAgentEnv()` returns correct env vars
- `getPromptInstructions()` contains provider name and curl examples
- Throws on invalid config

#### 3. API methods (mock globalThis.fetch)
- `verifyAccess()`: calls correct endpoint with correct auth headers
- `queryLogs()`: returns mapped `LogEntry[]` from API response, handles empty results
- `aggregate()`: returns `AggregateResult[]`, handles empty results
- All methods throw on non-ok response (test with `{ ok: false, status: 401, statusText: "Unauthorized" }`)

### Provider-specific details:

**Splunk** (`src/observability/splunk.ts`):
- Config: `splunkConfigSchema` with `baseUrl`, `token`, `index` (default "main")
- Import: `import { splunk, splunkConfigSchema } from "../src/observability/splunk.js";`
- Auth header: `Authorization: Bearer {token}`
- Uses search jobs (POST to create, GET to poll, GET results)
- Env vars: SPLUNK_URL, SPLUNK_TOKEN, SPLUNK_INDEX

**Elastic** (`src/observability/elastic.ts`):
- Config: `elasticConfigSchema` with `baseUrl`, `apiKey` or `username`+`password`, `index` (default "logs-*")
- Import: `import { elastic, elasticConfigSchema } from "../src/observability/elastic.js";`
- Has refine() validation - must provide either apiKey or username+password
- Auth: `ApiKey {apiKey}` or Basic auth
- Env vars: ELASTIC_URL, ELASTIC_API_KEY (or ELASTIC_USERNAME/ELASTIC_PASSWORD), ELASTIC_INDEX

**Loki** (`src/observability/loki.ts`):
- Config: `lokiConfigSchema` with `baseUrl`, optional `apiKey`, optional `orgId`
- Import: `import { loki, lokiConfigSchema } from "../src/observability/loki.js";`
- Auth: optional Bearer token, optional X-Scope-OrgID header
- Env vars: LOKI_URL, optionally LOKI_API_KEY, LOKI_ORG_ID

**New Relic** (`src/observability/newrelic.ts`):
- Config: `newrelicConfigSchema` with `apiKey`, `accountId`, `region` (default "us", can be "eu")
- Import: `import { newrelic, newrelicConfigSchema } from "../src/observability/newrelic.js";`
- Auth: `API-Key: {apiKey}` header
- Uses GraphQL (POST to NerdGraph endpoint)
- Env vars: NR_API_KEY, NR_ACCOUNT_ID, NR_REGION
- Mock response shape: `{ data: { actor: { account: { nrql: { results: [...] } } } } }`

## Completion

1. Run `npx vitest run tests/observability-new.test.ts` to verify
2. Run `npx vitest run` for full suite
3. Rename: `mv packages/providers/14-test-observability.todo.md packages/providers/14-test-observability.done.md`
4. Commit:
```
test: add unit tests for Splunk, Elastic, Loki, and New Relic providers

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
