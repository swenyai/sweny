import { describe, it, expect, vi, afterEach } from "vitest";
import { linear, linearConfigSchema } from "../src/issue-tracking/linear.js";
import { githubIssues, githubIssuesConfigSchema } from "../src/issue-tracking/github-issues.js";
import {
  canLinkPr,
  canSearchByFingerprint,
  canListTriageHistory,
} from "../src/issue-tracking/types.js";
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
    expect(
      githubIssuesConfigSchema.safeParse({ token: "t", repo: "r" }).success,
    ).toBe(false);
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

  it("canSearchByFingerprint detects FingerprintCapable", () => {
    const provider = linear({ apiKey: "test", logger: silentLogger });
    expect(canSearchByFingerprint(provider)).toBe(true);
  });

  it("canListTriageHistory detects TriageHistoryCapable", () => {
    const provider = linear({ apiKey: "test", logger: silentLogger });
    expect(canListTriageHistory(provider)).toBe(true);
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

  it("canSearchByFingerprint returns false for githubIssues", () => {
    const provider = githubIssues({
      token: "t",
      owner: "o",
      repo: "r",
      logger: silentLogger,
    });
    expect(canSearchByFingerprint(provider)).toBe(false);
  });

  it("type guards return false for a minimal provider", () => {
    const minimal: IssueTrackingProvider = {
      verifyAccess: async () => {},
      createIssue: async () => ({ id: "", identifier: "", title: "", url: "", branchName: "" }),
      getIssue: async () => ({ id: "", identifier: "", title: "", url: "", branchName: "" }),
      updateIssue: async () => {},
      searchIssues: async () => [],
      addComment: async () => {},
    };
    expect(canLinkPr(minimal)).toBe(false);
    expect(canSearchByFingerprint(minimal)).toBe(false);
    expect(canListTriageHistory(minimal)).toBe(false);
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
      json: async () => ({
        errors: [{ message: "Not authorized" }],
      }),
    });

    const provider = linear({ apiKey: "bad", logger: silentLogger });
    await expect(provider.verifyAccess()).rejects.toThrow("Linear GraphQL error: Not authorized");
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
});
