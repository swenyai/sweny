# Task: Add Functional Tests for Splunk, Elastic, Loki, New Relic, and File Observability Providers

## Why

Five observability providers currently have only config schema and factory tests. They
lack functional tests (mocked HTTP calls) that verify the providers actually call the
right endpoints and map responses correctly.

| Provider | Current tests | Missing |
|----------|--------------|---------|
| Splunk | config schema + factory shape | `verifyAccess`, `queryLogs`, `aggregate`, `getAgentEnv`, error handling |
| Elastic | config schema + factory shape | same |
| Loki | config schema + factory shape | same |
| New Relic | config schema + factory shape | same |
| File | **none at all** | config schema, factory, all methods, error cases |

Reference: CloudWatch has thorough functional tests at
`packages/providers/tests/cloudwatch.test.ts` — follow that pattern.

---

## Existing test file to extend

**`packages/providers/tests/observability-new.test.ts`**

Currently has config schema + factory tests for Splunk, Elastic, Loki, New Relic.
Add functional tests to this file (or create a new file per provider if the file gets too large).

**`packages/providers/tests/` — new file needed**

Create `packages/providers/tests/observability-file.test.ts` for the File provider.

---

## Pattern to follow

All tests use `vitest` with mocked `globalThis.fetch`. Look at
`packages/providers/tests/cloudwatch.test.ts` for the exact pattern:

```typescript
import { describe, it, expect, vi, afterEach } from "vitest";
import { myProvider } from "../src/observability/my-provider.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("MyProvider", () => {
  it("verifyAccess calls the right URL", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ ... }),
    });
    await myProvider({ ... }).verifyAccess();
    expect(globalThis.fetch).toHaveBeenCalledWith(
      expect.stringContaining("/expected/path"),
      expect.objectContaining({ method: "GET" }),
    );
  });
});
```

---

## Tests to add for each provider

### 1. Splunk (`packages/providers/src/observability/splunk.ts`)

Splunk uses the [Search Jobs REST API](https://docs.splunk.com/Documentation/Splunk/latest/RESTREF/RESTsearch).
Check the source file to see the exact endpoints and request shapes.

```typescript
describe("SplunkProvider", () => {
  it("verifyAccess calls /services/server/info with Bearer token", async () => {
    // mock fetch returning { entry: [{ content: { version: "9.0" } }] }
    // verify URL is `${baseUrl}/services/server/info?output_mode=json`
    // verify Authorization header is `Bearer ${token}`
  });

  it("queryLogs creates a search job and returns LogEntry[]", async () => {
    // Splunk search is two-step: POST /search/jobs, then GET /search/jobs/{sid}/results
    // mock both calls
    // verify returned entries have { timestamp, service, level, message }
    // service comes from fields (host, source, or sourcetype depending on implementation)
  });

  it("aggregate returns AggregateResult[] sorted by count descending", async () => {
    // mock the search results with multiple services
    // verify results are sorted: highest count first
    // verify shape: { service: string, count: number }[]
  });

  it("getAgentEnv returns SPLUNK_URL and SPLUNK_TOKEN", async () => {
    const provider = splunk({ baseUrl: "https://splunk.example.com", token: "tok" });
    const env = provider.getAgentEnv();
    expect(env.SPLUNK_URL).toBe("https://splunk.example.com");
    expect(env.SPLUNK_TOKEN).toBe("tok");
  });

  it("throws ProviderApiError on non-ok response", async () => {
    // mock fetch returning { ok: false, status: 403, statusText: "Forbidden" }
    // verify it throws ProviderApiError
  });
});
```

### 2. Elastic (`packages/providers/src/observability/elastic.ts`)

Elastic uses the [Elasticsearch REST API](https://www.elastic.co/guide/en/elasticsearch/reference).
Check the source file for endpoints.

```typescript
describe("ElasticProvider", () => {
  it("verifyAccess calls cluster health endpoint", async () => {
    // mock GET /_cluster/health returning { status: "green" }
    // verify Authorization: ApiKey header
  });

  it("queryLogs calls /{index}/_search and returns LogEntry[]", async () => {
    // mock POST /{index}/_search returning { hits: { hits: [...] } }
    // verify query contains timeRange filter
    // verify returned entries shape
  });

  it("aggregate calls /{index}/_search with aggs and returns AggregateResult[]", async () => {
    // mock aggregation response with buckets
    // verify { service: string, count: number }[] shape
  });

  it("getAgentEnv returns ELASTIC_URL and ELASTIC_API_KEY", async () => {
    const provider = elastic({ baseUrl: "https://elastic.example.com", apiKey: "key123" });
    const env = provider.getAgentEnv();
    expect(env.ELASTIC_URL).toBe("https://elastic.example.com");
    expect(env.ELASTIC_API_KEY).toBe("key123");
  });

  it("throws ProviderApiError on non-ok response", async () => { ... });
});
```

### 3. Loki (`packages/providers/src/observability/loki.ts`)

Loki uses LogQL queries via the HTTP API. The source file uses
`/loki/api/v1/query_range` and `/loki/api/v1/query`.

```typescript
describe("LokiProvider", () => {
  it("verifyAccess calls /loki/api/v1/labels", async () => {
    // mock returning { data: ["app", "service"] }
    // verify URL contains /loki/api/v1/labels
  });

  it("queryLogs calls /loki/api/v1/query_range and returns LogEntry[]", async () => {
    // mock returning { data: { result: [{ stream: {}, values: [[ts, line]] }] } }
    // verify returned entries have timestamp, service, level, message
  });

  it("aggregate counts entries per service and returns sorted AggregateResult[]", async () => {
    // mock results with entries from multiple services
    // verify { service, count }[] sorted descending
  });

  it("getAgentEnv returns LOKI_URL and LOKI_API_KEY", async () => {
    const provider = loki({ baseUrl: "https://loki.example.com", apiKey: "key" });
    expect(provider.getAgentEnv().LOKI_URL).toBe("https://loki.example.com");
    expect(provider.getAgentEnv().LOKI_API_KEY).toBe("key");
  });

  it("includes X-Scope-OrgID header when orgId provided", async () => {
    // create loki({ baseUrl, orgId: "tenant-1" })
    // call verifyAccess, verify the header is set
  });

  it("throws ProviderApiError on non-ok response", async () => { ... });
});
```

### 4. New Relic (`packages/providers/src/observability/newrelic.ts`)

New Relic uses the NerdGraph GraphQL API and/or the Logs API.
Check the source file for exact endpoints and query shapes.

```typescript
describe("NewRelicProvider", () => {
  it("verifyAccess calls NerdGraph to validate credentials", async () => {
    // mock returning a valid actor response
    // verify Authorization: NRAK-... header is set
  });

  it("queryLogs calls NerdGraph NRQL and returns LogEntry[]", async () => {
    // mock returning { data: { actor: { account: { nrql: { results: [...] } } } } }
    // verify returned entries shape
  });

  it("aggregate returns AggregateResult[] from NRQL facet query", async () => {
    // mock facet query results
    // verify { service, count }[] shape
  });

  it("getAgentEnv returns NR_API_KEY and NR_ACCOUNT_ID", async () => {
    const provider = newrelic({ apiKey: "NRAK-abc", accountId: "12345" });
    expect(provider.getAgentEnv().NR_API_KEY).toBe("NRAK-abc");
    expect(provider.getAgentEnv().NR_ACCOUNT_ID).toBe("12345");
  });

  it("throws ProviderApiError on non-ok response", async () => { ... });
});
```

---

## Tests for File provider (new file)

**Create: `packages/providers/tests/observability-file.test.ts`**

The File provider reads from disk using `node:fs` — use `node:fs` and `node:os` to
create temp files in tests. Do NOT mock `globalThis.fetch` (no HTTP calls).

```typescript
import { describe, it, expect, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { file, fileConfigSchema } from "../src/observability/file.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

function writeTmp(content: string): string {
  const p = path.join(os.tmpdir(), `sweny-test-${Date.now()}.json`);
  fs.writeFileSync(p, content, "utf-8");
  return p;
}

describe("fileConfigSchema", () => {
  it("validates a valid config", () => { ... });
  it("rejects missing path", () => { ... });
  it("rejects empty path", () => { ... });
});

describe("file factory", () => {
  it("returns an ObservabilityProvider with all methods", () => { ... });
});

describe("FileProvider", () => {
  const entries = [
    { timestamp: "2024-01-01T00:00:00Z", service: "api", level: "error", message: "boom" },
    { timestamp: "2024-01-01T00:01:00Z", service: "worker", level: "warn", message: "slow" },
    { timestamp: "2024-01-01T00:02:00Z", service: "api", level: "error", message: "crash" },
  ];

  it("verifyAccess loads the file without throwing", async () => {
    const p = writeTmp(JSON.stringify(entries));
    await file({ path: p, logger: silentLogger }).verifyAccess();
    fs.unlinkSync(p);
  });

  it("verifyAccess throws if file does not exist", async () => {
    await expect(
      file({ path: "/nonexistent/file.json", logger: silentLogger }).verifyAccess()
    ).rejects.toThrow();
  });

  it("queryLogs returns all entries when serviceFilter is '*'", async () => {
    const p = writeTmp(JSON.stringify(entries));
    const results = await file({ path: p }).queryLogs({ serviceFilter: "*", timeRange: "24h" });
    expect(results).toHaveLength(3);
    fs.unlinkSync(p);
  });

  it("queryLogs filters by service", async () => {
    const p = writeTmp(JSON.stringify(entries));
    const results = await file({ path: p }).queryLogs({ serviceFilter: "api", timeRange: "24h" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.service === "api")).toBe(true);
    fs.unlinkSync(p);
  });

  it("queryLogs filters by severity", async () => {
    const p = writeTmp(JSON.stringify(entries));
    const results = await file({ path: p }).queryLogs({ serviceFilter: "*", timeRange: "24h", severity: "error" });
    expect(results).toHaveLength(2);
    expect(results.every((e) => e.level === "error")).toBe(true);
    fs.unlinkSync(p);
  });

  it("aggregate counts entries per service sorted by count desc", async () => {
    const p = writeTmp(JSON.stringify(entries));
    const results = await file({ path: p }).aggregate({ serviceFilter: "*", timeRange: "24h" });
    expect(results[0]).toEqual({ service: "api", count: 2 });
    expect(results[1]).toEqual({ service: "worker", count: 1 });
    fs.unlinkSync(p);
  });

  it("supports { logs: [...] } wrapper format", async () => {
    const p = writeTmp(JSON.stringify({ logs: entries }));
    const results = await file({ path: p }).queryLogs({ serviceFilter: "*", timeRange: "24h" });
    expect(results).toHaveLength(3);
    fs.unlinkSync(p);
  });

  it("throws on invalid JSON", async () => {
    const p = writeTmp("not json at all");
    await expect(
      file({ path: p }).verifyAccess()
    ).rejects.toThrow();
    fs.unlinkSync(p);
  });

  it("throws on valid JSON that is not an array or { logs: [] }", async () => {
    const p = writeTmp(JSON.stringify({ invalid: "shape" }));
    await expect(
      file({ path: p }).verifyAccess()
    ).rejects.toThrow("Invalid log file format");
    fs.unlinkSync(p);
  });

  it("getAgentEnv returns SWENY_LOG_FILE with the path", () => {
    const provider = file({ path: "/tmp/logs.json" });
    expect(provider.getAgentEnv()).toEqual({ SWENY_LOG_FILE: "/tmp/logs.json" });
  });

  it("getPromptInstructions mentions the file path", () => {
    const provider = file({ path: "/tmp/logs.json" });
    expect(provider.getPromptInstructions()).toContain("/tmp/logs.json");
  });
});
```

---

## How to run tests

```bash
cd packages/providers
npm test
```

All existing tests must still pass (currently 490 tests). New tests should add coverage
for all the scenarios listed above.

---

## Notes

- Read each provider's source file before writing tests to understand the exact
  endpoint URLs, request body shapes, and response formats.
- For error handling tests, import `ProviderApiError` from
  `../src/errors.js` and verify the thrown error is an instance of it.
- The `silentLogger` pattern (`{ info: () => {}, debug: () => {}, warn: () => {} }`)
  suppresses test output noise — use it in all tests.
