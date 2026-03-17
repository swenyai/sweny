import { describe, it, expect, vi, afterEach } from "vitest";
import { linear, linearConfigSchema } from "../src/issue-tracking/linear.js";
import { githubIssues, githubIssuesConfigSchema } from "../src/issue-tracking/github-issues.js";
import { canLinkPr, canSearchIssuesByLabel } from "../src/issue-tracking/types.js";
import type { IssueTrackingProvider } from "../src/issue-tracking/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("linearConfigSchema", () => {
  it("validates a valid config", () => {
    expect(linearConfigSchema.safeParse({ apiKey: "lin_abc" }).success).toBe(true);
  });

  it("rejects empty apiKey", () => {
    expect(linearConfigSchema.safeParse({ apiKey: "" }).success).toBe(false);
  });
});

describe("githubIssuesConfigSchema", () => {
  it("validates a valid config", () => {
    const result = githubIssuesConfigSchema.safeParse({
      token: "ghp_abc",
      owner: "org",
      repo: "repo",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing owner", () => {
    expect(githubIssuesConfigSchema.safeParse({ token: "t", repo: "r" }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Type guards
// ---------------------------------------------------------------------------

describe("capability type guards", () => {
  it("canLinkPr detects PrLinkCapable", () => {
    const provider = linear({ apiKey: "test", logger: silentLogger });
    expect(canLinkPr(provider)).toBe(true);
  });

  it("canSearchIssuesByLabel detects LabelHistoryCapable", () => {
    const provider = linear({ apiKey: "test", logger: silentLogger });
    expect(canSearchIssuesByLabel(provider)).toBe(true);
  });

  it("canLinkPr returns true for githubIssues", () => {
    const provider = githubIssues({
      token: "t",
      owner: "o",
      repo: "r",
      logger: silentLogger,
    });
    expect(canLinkPr(provider)).toBe(true);
  });

  it("canSearchIssuesByLabel returns false for githubIssues", () => {
    const provider = githubIssues({
      token: "t",
      owner: "o",
      repo: "r",
      logger: silentLogger,
    });
    expect(canSearchIssuesByLabel(provider)).toBe(false);
  });

  it("type guards return false for a minimal provider", () => {
    const minimal: IssueTrackingProvider = {
      verifyAccess: async () => {},
      createIssue: async () => ({ id: "", identifier: "", title: "", url: "" }),
      getIssue: async () => ({ id: "", identifier: "", title: "", url: "" }),
      updateIssue: async () => {},
      searchIssues: async () => [],
      addComment: async () => {},
    };
    expect(canLinkPr(minimal)).toBe(false);
    expect(canSearchIssuesByLabel(minimal)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Linear provider (mocked fetch)
// ---------------------------------------------------------------------------

describe("LinearProvider", () => {
  it("verifyAccess calls GraphQL viewer query", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { viewer: { id: "u1", name: "Bot" } },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    await provider.verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.linear.app/graphql");
    expect(opts.headers.Authorization).toBe("lin_test");
  });

  it("createIssue sends mutation and returns Issue", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issueCreate: {
            success: true,
            issue: {
              id: "id1",
              identifier: "ENG-1",
              title: "Bug",
              url: "https://linear.app/issue/ENG-1",
              branchName: "eng-1-bug",
            },
          },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    const issue = await provider.createIssue({
      title: "Bug",
      projectId: "team-uuid",
      description: "desc",
      labels: ["label-1"],
      priority: 2,
    });

    expect(issue.identifier).toBe("ENG-1");
    expect(issue.id).toBe("id1");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.input.teamId).toBe("team-uuid");
    expect(body.variables.input.labelIds).toEqual(["label-1"]);
  });

  it("throws on GraphQL errors", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      json: async () => ({
        errors: [{ message: "Not authorized" }],
      }),
    });

    const provider = linear({ apiKey: "bad", logger: silentLogger });
    await expect(provider.verifyAccess()).rejects.toThrow("Linear API error: 200 OK");
  });

  it("getIssue fetches issue by identifier and returns state", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issue: {
            id: "issue-uuid",
            identifier: "ENG-42",
            title: "Login broken",
            url: "https://linear.app/issue/ENG-42",
            branchName: "eng-42-login-broken",
            state: { name: "In Progress" },
          },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    const issue = await provider.getIssue("ENG-42");

    expect(issue.id).toBe("issue-uuid");
    expect(issue.identifier).toBe("ENG-42");
    expect(issue.title).toBe("Login broken");
    expect(issue.url).toBe("https://linear.app/issue/ENG-42");
    expect(issue.branchName).toBe("eng-42-login-broken");
    expect(issue.state).toBe("In Progress");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.identifier).toBe("ENG-42");
  });

  it("updateIssue sends state and description mutation, then adds comment", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          issueUpdate: { success: true, issue: { id: "id1", identifier: "ENG-1", state: { name: "Done" } } },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    await provider.updateIssue("id1", {
      stateId: "state-done",
      description: "Updated desc",
      comment: "Resolved via PR",
    });

    // First call: issueUpdate mutation
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const updateBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(updateBody.variables.id).toBe("id1");
    expect(updateBody.variables.input.stateId).toBe("state-done");
    expect(updateBody.variables.input.description).toBe("Updated desc");

    // Second call: commentCreate mutation (from addComment)
    const commentBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(commentBody.variables.input.issueId).toBe("id1");
    expect(commentBody.variables.input.body).toBe("Resolved via PR");
  });

  it("addComment sends commentCreate mutation", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { commentCreate: { success: true } },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    await provider.addComment("issue-id", "This is a comment");

    expect(mockFetch).toHaveBeenCalledOnce();
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.input.issueId).toBe("issue-id");
    expect(body.variables.input.body).toBe("This is a comment");
  });

  it("linkPr creates attachment and adds comment", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { attachmentCreate: { success: true, attachment: { id: "att-1" } } },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    await provider.linkPr("issue-id", "https://github.com/org/repo/pull/7", 7);

    // First call: attachmentCreate
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const attachBody = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(attachBody.variables.input.issueId).toBe("issue-id");
    expect(attachBody.variables.input.url).toBe("https://github.com/org/repo/pull/7");
    expect(attachBody.variables.input.title).toBe("GitHub PR #7");

    // Second call: comment
    const commentBody = JSON.parse(mockFetch.mock.calls[1][1].body);
    expect(commentBody.variables.input.issueId).toBe("issue-id");
    expect(commentBody.variables.input.body).toContain("PR #7");
  });

  it("searchIssuesByLabel returns entries for the given label", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: {
          team: {
            issues: {
              nodes: [
                {
                  id: "t-1",
                  identifier: "ENG-20",
                  title: "Triage issue",
                  url: "https://linear.app/issue/ENG-20",
                  description: "Some desc\nMore text",
                  state: { name: "Triage", type: "triage" },
                  createdAt: "2026-02-01T00:00:00Z",
                  labels: { nodes: [{ name: "bug" }, { name: "triage" }] },
                },
                {
                  id: "t-2",
                  identifier: "ENG-21",
                  title: "Another issue",
                  url: "https://linear.app/issue/ENG-21",
                  description: null,
                  state: { name: "Backlog", type: "backlog" },
                  createdAt: "2026-02-15T00:00:00Z",
                  labels: { nodes: [{ name: "triage" }] },
                },
              ],
            },
          },
        },
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = linear({ apiKey: "lin_test", logger: silentLogger });
    const entries = await provider.searchIssuesByLabel("team-uuid", "label-triage", { days: 30 });

    expect(entries).toHaveLength(2);
    expect(entries[0].identifier).toBe("ENG-20");
    expect(entries[0].state).toBe("Triage");
    expect(entries[0].stateType).toBe("triage");
    expect(entries[0].labels).toEqual(["bug", "triage"]);
    expect(entries[0].descriptionSnippet).toContain("Some desc");
    expect(entries[1].identifier).toBe("ENG-21");
    expect(entries[1].descriptionSnippet).toBeNull();

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.variables.teamId).toBe("team-uuid");
    expect(body.variables.filter.labels).toEqual({ id: { eq: "label-triage" } });
  });
});

// ---------------------------------------------------------------------------
// GitHub Issues provider (mocked fetch)
// ---------------------------------------------------------------------------

describe("GitHubIssuesProvider", () => {
  it("verifyAccess calls repo endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 123 }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "ghp_test",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    await provider.verifyAccess();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/org/repo");
    expect(opts.headers.Authorization).toBe("Bearer ghp_test");
  });

  it("createIssue returns Issue with # identifier", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 999,
        number: 42,
        title: "Fix thing",
        html_url: "https://github.com/org/repo/issues/42",
        state: "open",
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "t",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    const issue = await provider.createIssue({
      title: "Fix thing",
      projectId: "ignored",
    });

    expect(issue.identifier).toBe("#42");
    expect(issue.branchName).toBe("fix/42");
    expect(issue.url).toBe("https://github.com/org/repo/issues/42");
  });

  it("searchIssues calls search API with query params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ items: [] }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "t",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    await provider.searchIssues({
      projectId: "ignored",
      query: "crash",
      labels: ["bug"],
    });

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("/search/issues");
    expect(url).toContain("crash");
    expect(url).toContain("repo%3Aorg%2Frepo");
  });

  it("getIssue fetches by issue number and strips # prefix", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: 555,
        number: 10,
        title: "Auth regression",
        html_url: "https://github.com/org/repo/issues/10",
        state: "open",
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "ghp_test",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    const issue = await provider.getIssue("#10");

    // id is the issue number (used for API calls like PATCH /issues/:id)
    expect(issue.id).toBe("10");
    expect(issue.identifier).toBe("#10");
    expect(issue.title).toBe("Auth regression");
    expect(issue.branchName).toBe("fix/10");
    expect(issue.state).toBe("open");

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe("https://api.github.com/repos/org/repo/issues/10");
  });

  it("updateIssue patches fields and adds comment", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "ghp_test",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    await provider.updateIssue("10", {
      stateId: "closed",
      description: "Updated body",
      comment: "Fixed in PR #5",
    });

    // First call: PATCH to update issue fields
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [patchUrl, patchOpts] = mockFetch.mock.calls[0];
    expect(patchUrl).toBe("https://api.github.com/repos/org/repo/issues/10");
    expect(patchOpts.method).toBe("PATCH");
    const patchBody = JSON.parse(patchOpts.body);
    expect(patchBody.state).toBe("closed");
    expect(patchBody.body).toBe("Updated body");

    // Second call: POST comment
    const [commentUrl, commentOpts] = mockFetch.mock.calls[1];
    expect(commentUrl).toBe("https://api.github.com/repos/org/repo/issues/10/comments");
    expect(commentOpts.method).toBe("POST");
    const commentBody = JSON.parse(commentOpts.body);
    expect(commentBody.body).toBe("Fixed in PR #5");
  });

  it("addComment posts to issue comments endpoint", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "ghp_test",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    await provider.addComment("15", "Deploying now");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/org/repo/issues/15/comments");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.body).toBe("Deploying now");
  });

  it("linkPr adds a comment mentioning the PR", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    globalThis.fetch = mockFetch;

    const provider = githubIssues({
      token: "ghp_test",
      owner: "org",
      repo: "repo",
      logger: silentLogger,
    });
    await provider.linkPr("20", "https://github.com/org/repo/pull/5", 5);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.github.com/repos/org/repo/issues/20/comments");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.body).toContain("PR #5");
    expect(body.body).toContain("https://github.com/org/repo/pull/5");
  });
});
