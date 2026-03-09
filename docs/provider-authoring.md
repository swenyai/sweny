# Provider Authoring Guide

Providers are the integration layer — they wrap third-party APIs and expose a
typed interface the engine and recipes use. All providers live in
`packages/providers/src/<category>/`.

Two categories are extensible by contributors:

- **Observability** — log query backends (Datadog, CloudWatch, Loki, …)
- **Issue tracking** — project management systems (Linear, Jira, GitHub Issues, …)

> Before adding a provider, check `CONTRIBUTING.md` for the build/test workflow.

---

## Observability provider

### Interface (`packages/providers/src/observability/types.ts`)

```ts
export interface ObservabilityProvider {
  verifyAccess(): Promise<void>;
  queryLogs(opts: LogQueryOptions): Promise<LogEntry[]>;
  aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]>;
  getAgentEnv(): Record<string, string>;       // env vars injected into the coding agent
  getPromptInstructions(): string;             // API docs appended to the triage prompt
}

export interface LogQueryOptions {
  timeRange: string;      // e.g. "1h", "24h"
  serviceFilter: string;  // service name or "*"
  severity: string;       // "error" | "warning" | "info"
}

export interface LogEntry {
  timestamp: string;
  service: string;
  level: string;
  message: string;
  attributes: Record<string, unknown>;
}

export interface AggregateResult {
  service: string;
  count: number;
}
```

### Skeleton implementation

```ts
// packages/providers/src/observability/acme.ts
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { ObservabilityProvider, LogQueryOptions, LogEntry, AggregateResult } from "./types.js";

export const acmeConfigSchema = z.object({
  apiKey: z.string().min(1, "ACME API key is required"),
  region: z.string().default("us-east-1"),
  logger: z.custom<Logger>().optional(),
});

export type AcmeConfig = z.infer<typeof acmeConfigSchema>;

export function acme(config: AcmeConfig): ObservabilityProvider {
  const parsed = acmeConfigSchema.parse(config);
  return new AcmeProvider(parsed);
}

class AcmeProvider implements ObservabilityProvider {
  private readonly apiKey: string;
  private readonly region: string;
  private readonly log: Logger;

  constructor(config: AcmeConfig) {
    this.apiKey = config.apiKey;
    this.region = config.region;
    this.log = config.logger ?? consoleLogger;
  }

  async verifyAccess(): Promise<void> {
    const res = await fetch(`https://api.acme.example/v1/ping`, {
      headers: { Authorization: `Bearer ${this.apiKey}` },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderApiError("Acme", res.status, res.statusText, body);
    }
    this.log.info("Acme access verified");
  }

  async queryLogs(opts: LogQueryOptions): Promise<LogEntry[]> {
    // fetch and map to LogEntry[]
    return [];
  }

  async aggregate(opts: Omit<LogQueryOptions, "severity">): Promise<AggregateResult[]> {
    // fetch and map to AggregateResult[]
    return [];
  }

  getAgentEnv(): Record<string, string> {
    return { ACME_API_KEY: this.apiKey, ACME_REGION: this.region };
  }

  getPromptInstructions(): string {
    return `### Acme Logs API\nUse ACME_API_KEY in Authorization: Bearer header.\n`;
  }
}
```

`getAgentEnv()` is merged into the coding agent's environment so it can make
direct API calls with `curl`. `getPromptInstructions()` is prepended to the
investigation prompt — include working `curl` examples the agent can copy.

### Registration

Add exports to `packages/providers/src/observability/index.ts`:

```ts
export { acme, acmeConfigSchema, type AcmeConfig } from "./acme.js";
```

---

## Issue-tracking provider

### Interface (`packages/providers/src/issue-tracking/types.ts`)

```ts
export interface IssueTrackingProvider {
  verifyAccess(): Promise<void>;
  createIssue(opts: IssueCreateOptions): Promise<Issue>;
  getIssue(identifier: string): Promise<Issue>;
  updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void>;
  searchIssues(opts: IssueSearchOptions): Promise<Issue[]>;
  addComment(issueId: string, body: string): Promise<void>;
}
```

Three optional capability interfaces extend the core:

| Interface | Method | Purpose |
|---|---|---|
| `PrLinkCapable` | `linkPr(issueId, prUrl, prNumber)` | Attach a PR to the issue |
| `FingerprintCapable` | `searchByFingerprint(projectId, pattern, opts?)` | Dedup by error hash |
| `TriageHistoryCapable` | `listTriageHistory(projectId, labelId, days?)` | Pattern detection |

Use the exported type guards (`canLinkPr`, `canSearchByFingerprint`,
`canListTriageHistory`) to check capability at runtime.

### Skeleton implementation

```ts
// packages/providers/src/issue-tracking/acme.ts
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type {
  IssueTrackingProvider, Issue,
  IssueCreateOptions, IssueUpdateOptions, IssueSearchOptions,
} from "./types.js";

export const acmeIssuesConfigSchema = z.object({
  apiKey: z.string().min(1),
  logger: z.custom<Logger>().optional(),
});

export type AcmeIssuesConfig = z.infer<typeof acmeIssuesConfigSchema>;

export function acmeIssues(config: AcmeIssuesConfig): IssueTrackingProvider {
  const parsed = acmeIssuesConfigSchema.parse(config);
  return new AcmeIssuesProvider(parsed);
}

class AcmeIssuesProvider implements IssueTrackingProvider {
  private readonly apiKey: string;
  private readonly log: Logger;

  constructor(config: AcmeIssuesConfig) {
    this.apiKey = config.apiKey;
    this.log = config.logger ?? consoleLogger;
  }

  async verifyAccess(): Promise<void> { /* call a cheap read endpoint */ }

  async createIssue(opts: IssueCreateOptions): Promise<Issue> {
    // POST to provider, return Issue shape
    throw new Error("not implemented");
  }

  async getIssue(identifier: string): Promise<Issue> {
    throw new Error("not implemented");
  }

  async updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void> {
    // PATCH state / description; call addComment if opts.comment is set
  }

  async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
    return [];
  }

  async addComment(issueId: string, body: string): Promise<void> { /* POST comment */ }
}
```

The returned `Issue` shape must include: `id`, `identifier`, `title`, `url`,
`branchName`. `state` and `description` are optional.

### Registration

```ts
// packages/providers/src/issue-tracking/index.ts
export { acmeIssues, acmeIssuesConfigSchema, type AcmeIssuesConfig } from "./acme.js";
```

---

## Config schema pattern

Every provider follows the same three exports:

```ts
export const fooConfigSchema = z.object({ ... });  // validated at construction
export type FooConfig = z.infer<typeof fooConfigSchema>;
export function foo(config: FooConfig): ProviderInterface { ... }
```

Always call `fooConfigSchema.parse(config)` at the top of the factory to fail
fast on bad input.

---

## Testing

Use `vi.spyOn` to mock `fetch` — not `vi.fn()` on `globalThis.fetch`:

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { acme } from "../src/observability/acme.js";

describe("AcmeProvider", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifyAccess succeeds on 200", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("{}", { status: 200 }),
    );

    const provider = acme({ apiKey: "test-key" });
    await expect(provider.verifyAccess()).resolves.toBeUndefined();
  });

  it("verifyAccess throws ProviderApiError on 401", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response("Unauthorized", { status: 401, statusText: "Unauthorized" }),
    );

    const provider = acme({ apiKey: "bad-key" });
    await expect(provider.verifyAccess()).rejects.toThrow("401");
  });
});
```

Test each method (`queryLogs`, `aggregate`, `createIssue`, etc.) by providing
a mock response payload and asserting the mapped output shape.

---

## Wiring into the action

Providers are instantiated in `packages/action/src/main.ts` and passed to
`createProviderRegistry()` before `runRecipe()` is called. Add a new branch
there (or in a config-loading helper) to instantiate your provider when the
user sets the appropriate config keys.
