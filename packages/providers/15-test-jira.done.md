# Tests: Jira Issue Tracking Provider

Add unit tests for the Jira provider. Follow the exact pattern from `tests/issue-tracking.test.ts`.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Pattern to follow

From `tests/issue-tracking.test.ts` (Linear/GitHub Issues tests use mocked globalThis.fetch):

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { linear, linearConfigSchema } from "../src/issue-tracking/linear.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe("linearConfigSchema", () => {
  it("validates a valid config", () => { /* safeParse */ });
  it("rejects empty apiKey", () => { /* safeParse */ });
});

describe("LinearProvider", () => {
  function makeLinear() {
    return linear({ apiKey: "test-key", logger: silentLogger });
  }

  it("verifyAccess calls GraphQL viewer query", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: { viewer: { id: "u1", name: "Test" } } }),
    });
    globalThis.fetch = mockFetch;
    await makeLinear().verifyAccess();
    expect(mockFetch).toHaveBeenCalledOnce();
  });

  it("createIssue returns Issue with identifier", async () => { /* ... */ });
  it("throws on non-ok response", async () => { /* ... */ });
});
```

## Task

Create `tests/jira.test.ts` with tests for the Jira provider.

Import: `import { jira, jiraConfigSchema } from "../src/issue-tracking/jira.js";`

The Jira provider uses:
- Basic auth: `Authorization: Basic ${btoa(email + ":" + apiToken)}`
- REST API v3: `${baseUrl}/rest/api/3/...`
- ADF format for description/comments

### Test sections:

#### 1. `jiraConfigSchema`
- Valid config parses (baseUrl, email, apiToken)
- Rejects missing email, missing apiToken, missing baseUrl
- Rejects empty strings

#### 2. Factory function
- Returns object with all IssueTrackingProvider + PrLinkCapable methods
- canLinkPr() returns true for jira provider (import canLinkPr from types.js)

#### 3. `JiraProvider` (mock fetch)
- `verifyAccess()`: calls `/rest/api/3/myself` with Basic auth header
- `createIssue()`: POSTs to `/rest/api/3/issue`, returns Issue with Jira key as identifier, `fix/{KEY}` as branchName
- `getIssue()`: GETs `/rest/api/3/issue/{identifier}`, returns mapped Issue
- `updateIssue()`: PUTs issue fields, adds comment if provided
- `searchIssues()`: POSTs to `/rest/api/3/search` with JQL query, returns Issue[]
- `addComment()`: POSTs to `/rest/api/3/issue/{id}/comment` with ADF body
- `linkPr()`: POSTs remote link to `/rest/api/3/issue/{id}/remotelink`
- Error: throws on non-ok response

#### Mock response examples:

```ts
// createIssue response
{ id: "10001", key: "PROJ-123", self: "https://myco.atlassian.net/rest/api/3/issue/10001", fields: { summary: "Bug title", status: { name: "To Do" } } }

// getIssue response
{ id: "10001", key: "PROJ-123", self: "...", fields: { summary: "Bug title", status: { name: "In Progress" } } }

// search response
{ issues: [{ id: "10001", key: "PROJ-123", fields: { summary: "Bug", status: { name: "Open" } } }] }
```

## Completion

1. Run `npx vitest run tests/jira.test.ts`
2. Run `npx vitest run`
3. Rename: `mv packages/providers/15-test-jira.todo.md packages/providers/15-test-jira.done.md`
4. Commit:
```
test: add unit tests for Jira issue tracking provider

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
