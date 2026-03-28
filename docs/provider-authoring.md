# Provider Authoring Guide (DEPRECATED — see Skills)

> **This document is outdated.** Providers have been replaced by **skills** in `@sweny-ai/core`.
>
> For current documentation, see:
> - **[Skills Overview](https://docs.sweny.ai/skills/)** — How skills work and the built-in catalog
> - **[MCP Servers](https://docs.sweny.ai/advanced/mcp-servers/)** — Auto-injection and custom MCP configuration
> - **[Architecture](https://docs.sweny.ai/advanced/architecture/)** — Skills vs. providers design decision
>
> The conceptual guidance below (Provider vs. MCP server decision tree) is still valid — just substitute "skill" for "provider" and "node" for "step."

---

> **Read `docs/architecture.md` before writing a new skill.**
> Most new integrations should be MCP server configs, not custom skills.
> Only write a skill when a workflow node needs a typed return value from the operation.

---

## Should This Be a Skill or an MCP Server?

**Write a skill when:**
- A workflow node calls the operation and needs the response (e.g., `create_issue` returns an issue ID the next node uses)
- The operation is deterministic and must succeed before the workflow continues
- You need to validate the result, not just hope the agent did it

**Configure an MCP server when:**
- The *agent* needs access to the service during reasoning (log querying, issue searching, code lookup)
- The service ships an official MCP server (Datadog, Linear, GitHub, Slack, etc.)
- The operation is "gather information" rather than "create something with a structured return"

```
Datadog logs for investigation  → MCP server config (agent queries during investigate step)
Create a Linear issue            → Provider (recipe needs the issue identifier back)
Search Linear for similar issues → MCP server config (agent can do this itself)
Open a GitHub PR                 → Provider (recipe needs the PR URL for notify step)
```

If the service has an MCP server — **use it**. Don't write a custom provider for data-gathering operations the agent can handle itself.

---

## The Two Provider Categories

### Category 1: Thin Orchestration Providers (what to write)

These implement **exactly the operations recipe steps need** and nothing more. They return typed data the recipe passes to subsequent steps.

Required interfaces:
- `IssueTrackingProvider` — `createIssue`, `updateIssue`, `getIssue` (recipe needs these)
- `SourceControlProvider` — `createPullRequest`, `createBranch`, `pushBranch` (recipe needs these)
- `NotificationProvider` — `send` (final report step)

Target size: **20–50 lines per method**. No feature-complete API coverage needed.

### Category 2: Observability / Search Providers (do not write new ones)

Observability providers (`queryLogs`, `aggregate`) exist for the `build-context` step. **Before adding a new observability provider**, check whether the service has an MCP server. If it does, the agent should query it via MCP during `investigate` rather than us pre-querying it in `build-context`.

Existing observability providers are maintained for backward compatibility and for cases where the service has no MCP server.

---

## Writing a Thin Orchestration Provider

### Issue-Tracking Provider

The interface (`packages/providers/src/issue-tracking/types.ts`):

```ts
export interface IssueTrackingProvider {
  verifyAccess(): Promise<void>;
  createIssue(opts: IssueCreateOptions): Promise<Issue>;
  getIssue(identifier: string): Promise<Issue>;
  updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void>;
  searchIssues(opts: IssueSearchOptions): Promise<Issue[]>;
  addComment(issueId: string, body: string): Promise<void>;
}

export interface Issue {
  id: string;
  identifier: string;   // human-readable key e.g. "ENG-123"
  title: string;
  url: string;
  branchName?: string;  // optional — derive from identifier if absent
  state?: string;
  description?: string;
}
```

Optional capability interfaces (implement if the provider supports them):

| Interface | Method | When to implement |
|---|---|---|
| `PrLinkCapable` | `linkPr(issueId, prUrl, prNumber)` | Provider can attach PRs to issues |
| `LabelHistoryCapable` | `searchIssuesByLabel(projectId, labelId, opts?)` | Provider supports label-filtered search |

Skeleton:

```ts
// packages/providers/src/issue-tracking/acme.ts
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";
import type { IssueTrackingProvider, Issue, IssueCreateOptions, IssueUpdateOptions, IssueSearchOptions } from "./types.js";

export const acmeIssuesConfigSchema = z.object({
  apiKey: z.string().min(1, "ACME API key is required"),
  logger: z.custom<Logger>().optional(),
});

export type AcmeIssuesConfig = z.infer<typeof acmeIssuesConfigSchema>;

export function acmeIssues(config: AcmeIssuesConfig): IssueTrackingProvider {
  const parsed = acmeIssuesConfigSchema.parse(config);
  const log = parsed.logger ?? consoleLogger;

  async function request(path: string, init?: RequestInit): Promise<Response> {
    const res = await fetch(`https://api.acme.example/v1${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${parsed.apiKey}`, "Content-Type": "application/json", ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ProviderApiError("Acme", res.status, res.statusText, body);
    }
    return res;
  }

  function toIssue(raw: Record<string, unknown>): Issue {
    const identifier = String(raw.key ?? raw.id ?? "");
    return {
      id: String(raw.id ?? ""),
      identifier,
      title: String(raw.title ?? raw.summary ?? ""),
      url: String(raw.url ?? raw.htmlUrl ?? ""),
      branchName: raw.branchName
        ? String(raw.branchName)
        : `fix/${identifier.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      state: raw.state ? String(raw.state) : undefined,
      description: raw.description ? String(raw.description) : undefined,
    };
  }

  return {
    async verifyAccess(): Promise<void> {
      await request("/ping");
      log.info("Acme access verified");
    },

    async createIssue(opts: IssueCreateOptions): Promise<Issue> {
      const res = await request("/issues", {
        method: "POST",
        body: JSON.stringify({ title: opts.title, description: opts.description, projectId: opts.projectId }),
      });
      const raw = await res.json() as Record<string, unknown>;
      log.info(`Acme: created issue ${raw.key}`);
      return toIssue(raw);
    },

    async getIssue(identifier: string): Promise<Issue> {
      const res = await request(`/issues/${identifier}`);
      return toIssue(await res.json() as Record<string, unknown>);
    },

    async updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void> {
      await request(`/issues/${issueId}`, {
        method: "PATCH",
        body: JSON.stringify({ stateId: opts.stateId, description: opts.description }),
      });
      if (opts.comment) {
        await request(`/issues/${issueId}/comments`, {
          method: "POST",
          body: JSON.stringify({ body: opts.comment }),
        });
      }
    },

    async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
      const params = new URLSearchParams({ q: opts.query ?? "" });
      const res = await request(`/issues/search?${params}`);
      const raw = await res.json() as unknown[];
      return (raw as Record<string, unknown>[]).map(toIssue);
    },

    async addComment(issueId: string, body: string): Promise<void> {
      await request(`/issues/${issueId}/comments`, { method: "POST", body: JSON.stringify({ body }) });
    },
  };
}
```

### Source Control Provider

Required for `createBranch`, `pushBranch`, `stageAndCommit` (git operations) and `createPullRequest` (API operation). The interfaces are split:

- `GitProvider` — local git shell operations (branch, commit, push)
- `RepoProvider` — remote API operations (create PR, list PRs, dispatch workflow)
- `SourceControlProvider = GitProvider & RepoProvider` — combined for providers that do both

See `packages/providers/src/source-control/types.ts` for the full interface.

### Notification Provider

```ts
export interface NotificationProvider {
  send(payload: NotificationPayload): Promise<void>;
}
```

Simple — implement `send()` and return. See `packages/providers/src/notification/types.ts` for `NotificationPayload` shape.

---

## Config Schema Pattern

Every provider follows the same three exports:

```ts
export const fooConfigSchema = z.object({
  apiKey: z.string().min(1, "API key is required"),
  logger: z.custom<Logger>().optional(),
});

export type FooConfig = z.infer<typeof fooConfigSchema>;

export function foo(config: FooConfig): ProviderInterface {
  const parsed = fooConfigSchema.parse(config);  // fail-fast on bad input
  // ...
}
```

- Validate at construction with `schema.parse(config)`, never at call time
- Accept `logger` as optional — fall back to `consoleLogger`
- Keep secrets (API keys, tokens) in config, never hardcoded or inferred from env directly

---

## Testing

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { acmeIssues } from "../src/issue-tracking/acme.js";

describe("acmeIssues", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("createIssue returns mapped Issue", async () => {
    vi.spyOn(globalThis, "fetch").mockImplementation(async () =>
      new Response(JSON.stringify({ id: "1", key: "ACME-1", title: "Test", url: "https://acme.example/1" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    const provider = acmeIssues({ apiKey: "test" });
    const issue = await provider.createIssue({ title: "Test", projectId: "proj-1" });

    expect(issue.identifier).toBe("ACME-1");
    expect(issue.title).toBe("Test");
    expect(issue.branchName).toBe("fix/acme-1");
  });
});
```

Use `vi.spyOn(globalThis, "fetch").mockImplementation(...)` — not `vi.fn()` and not `mockResolvedValue`.

---

## Registration

1. Export from the category index:
```ts
// packages/providers/src/issue-tracking/index.ts
export { acmeIssues, acmeIssuesConfigSchema, type AcmeIssuesConfig } from "./acme.js";
```

2. Add to the CLI provider switch (`packages/cli/src/providers/index.ts`):
```ts
case "acme":
  registry.set("issueTracker", acmeIssues({ apiKey: config.acmeApiKey, logger }));
  break;
```

3. Add to the Action provider switch (`packages/action/src/providers/index.ts`) with the same pattern.

4. Add validation in `packages/cli/src/config.ts` and `packages/action/src/config.ts`.

5. Create a changeset — this is a `minor` bump for `@sweny-ai/providers`.

---

## What Not to Build

- **Observability providers** for services that have MCP servers (Datadog, Splunk, New Relic, etc.) — configure their MCP server instead
- **MCP adapter providers** (`linearMCP`, `githubMCP`) — the wrong layer; the agent should use MCP tools directly
- **Feature-complete API clients** — implement exactly what the recipe step needs, nothing more
- **`npx -y <package>` subprocess launchers** — runtime npm downloads are not production-safe
