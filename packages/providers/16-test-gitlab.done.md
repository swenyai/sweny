# Tests: GitLab Source Control Provider

Add unit tests for the GitLab provider. Follow the exact pattern from `tests/source-control.test.ts`.

## Working directory
`/Users/nate/src/swenyai/sweny/packages/providers`

## Pattern to follow

From `tests/source-control.test.ts` (GitHub provider):

```ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { execFile as _execFile } from "node:child_process";
import { github } from "../src/source-control/github.js";
import type { SourceControlProvider } from "../src/source-control/types.js";

vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => {
    cb(null, { stdout: "", stderr: "" });
  }),
}));
const mockExecFile = vi.mocked(_execFile);

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe("github source-control provider", () => {
  let provider: SourceControlProvider;
  beforeEach(() => { vi.clearAllMocks(); provider = github(config); });

  it("verifyAccess calls GitHub API", async () => {
    mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 123 }));
    await provider.verifyAccess();
    expect(mockFetch).toHaveBeenCalledWith("https://api.github.com/repos/acme/app", expect.anything());
  });
  // ... tests for all methods
});
```

## Task

Create `tests/gitlab.test.ts` with tests for the GitLab provider.

Import: `import { gitlab } from "../src/source-control/gitlab.js";`

The GitLab provider uses:
- Auth: `PRIVATE-TOKEN: {token}` header
- API: `${baseUrl}/api/v4/projects/${projectId}/...`
- Git operations: same execFile pattern as GitHub
- MRs instead of PRs

### Test sections:

#### 1. Factory
- Returns object with all SourceControlProvider methods

#### 2. API methods (mock fetch + execFile)
- `verifyAccess()`: GETs `/api/v4/projects/{id}` with PRIVATE-TOKEN header
- `configureBotIdentity()`: calls git config for user.name and user.email
- `createBranch()`: calls `git checkout -b {name}`
- `createPullRequest()`: POSTs to `/api/v4/projects/{id}/merge_requests` with `source_branch`, `target_branch`, `title`, `description`
- `listPullRequests()`: GETs `/api/v4/projects/{id}/merge_requests`, maps GitLab states (opened→open, merged→merged, closed→closed)
- `findExistingPr()`: searches merge requests, returns null when no match
- `dispatchWorkflow()`: POSTs to `/api/v4/projects/{id}/pipeline`
- `hasChanges()`, `hasNewCommits()`, `getChangedFiles()`: test git command calls
- Error: throws on non-ok API response

## Completion

1. Run `npx vitest run tests/gitlab.test.ts`
2. Run `npx vitest run`
3. Rename: `mv packages/providers/16-test-gitlab.todo.md packages/providers/16-test-gitlab.done.md`
4. Commit:
```
test: add unit tests for GitLab source control provider

Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
```
