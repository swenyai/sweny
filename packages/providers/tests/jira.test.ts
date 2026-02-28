import { describe, it, expect, vi, afterEach } from "vitest";
import { jira, jiraConfigSchema } from "../src/issue-tracking/jira.js";
import { canLinkPr } from "../src/issue-tracking/types.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("jiraConfigSchema", () => {
  it("validates a valid config", () => {
    const result = jiraConfigSchema.safeParse({
      baseUrl: "https://myco.atlassian.net",
      email: "bot@myco.com",
      apiToken: "tok_abc",
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing email", () => {
    const result = jiraConfigSchema.safeParse({
      baseUrl: "https://myco.atlassian.net",
      apiToken: "tok_abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing apiToken", () => {
    const result = jiraConfigSchema.safeParse({
      baseUrl: "https://myco.atlassian.net",
      email: "bot@myco.com",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing baseUrl", () => {
    const result = jiraConfigSchema.safeParse({
      email: "bot@myco.com",
      apiToken: "tok_abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty email", () => {
    const result = jiraConfigSchema.safeParse({
      baseUrl: "https://myco.atlassian.net",
      email: "",
      apiToken: "tok_abc",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty apiToken", () => {
    const result = jiraConfigSchema.safeParse({
      baseUrl: "https://myco.atlassian.net",
      email: "bot@myco.com",
      apiToken: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects empty baseUrl", () => {
    const result = jiraConfigSchema.safeParse({
      baseUrl: "",
      email: "bot@myco.com",
      apiToken: "tok_abc",
    });
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

describe("jira factory", () => {
  it("returns object with all IssueTrackingProvider and PrLinkCapable methods", () => {
    const provider = jira({
      baseUrl: "https://myco.atlassian.net",
      email: "bot@myco.com",
      apiToken: "tok_abc",
      logger: silentLogger,
    });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.createIssue).toBe("function");
    expect(typeof provider.getIssue).toBe("function");
    expect(typeof provider.updateIssue).toBe("function");
    expect(typeof provider.searchIssues).toBe("function");
    expect(typeof provider.addComment).toBe("function");
    expect(typeof provider.linkPr).toBe("function");
  });

  it("canLinkPr() returns true for jira provider", () => {
    const provider = jira({
      baseUrl: "https://myco.atlassian.net",
      email: "bot@myco.com",
      apiToken: "tok_abc",
      logger: silentLogger,
    });
    expect(canLinkPr(provider)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// JiraProvider (mocked fetch)
// ---------------------------------------------------------------------------

describe("JiraProvider", () => {
  const BASE_URL = "https://myco.atlassian.net";
  const EMAIL = "bot@myco.com";
  const API_TOKEN = "tok_abc";
  const EXPECTED_AUTH = `Basic ${btoa(`${EMAIL}:${API_TOKEN}`)}`;

  function makeJira() {
    return jira({
      baseUrl: BASE_URL,
      email: EMAIL,
      apiToken: API_TOKEN,
      logger: silentLogger,
    });
  }

  it("verifyAccess calls /rest/api/3/myself with Basic auth header", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ emailAddress: EMAIL, displayName: "Bot User" }),
    });
    globalThis.fetch = mockFetch;

    await makeJira().verifyAccess();

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/rest/api/3/myself`);
    expect(opts.headers.Authorization).toBe(EXPECTED_AUTH);
  });

  it("createIssue POSTs to /rest/api/3/issue and returns Issue with key as identifier", async () => {
    // createIssue makes two fetch calls: POST /issue then GET /issue/{key}
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "10001",
          key: "PROJ-123",
          self: `${BASE_URL}/rest/api/3/issue/10001`,
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          id: "10001",
          key: "PROJ-123",
          fields: { summary: "Bug title", status: { name: "To Do" } },
        }),
      });
    globalThis.fetch = mockFetch;

    const issue = await makeJira().createIssue({
      title: "Bug title",
      projectId: "PROJ",
      description: "Something broke",
      labels: ["bug"],
      priority: 2,
    });

    expect(issue.identifier).toBe("PROJ-123");
    expect(issue.id).toBe("10001");
    expect(issue.title).toBe("Bug title");
    expect(issue.url).toBe(`${BASE_URL}/browse/PROJ-123`);
    expect(issue.branchName).toBe("fix/PROJ-123");
    expect(issue.state).toBe("To Do");

    // Verify POST call
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [postUrl, postOpts] = mockFetch.mock.calls[0];
    expect(postUrl).toBe(`${BASE_URL}/rest/api/3/issue`);
    expect(postOpts.method).toBe("POST");
    const body = JSON.parse(postOpts.body);
    expect(body.fields.summary).toBe("Bug title");
    expect(body.fields.project.key).toBe("PROJ");
    expect(body.fields.labels).toEqual(["bug"]);
    expect(body.fields.priority.id).toBe("2");
  });

  it("getIssue GETs /rest/api/3/issue/{identifier} and returns mapped Issue", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        id: "10001",
        key: "PROJ-123",
        fields: { summary: "Bug title", status: { name: "In Progress" } },
      }),
    });
    globalThis.fetch = mockFetch;

    const issue = await makeJira().getIssue("PROJ-123");

    expect(issue.id).toBe("10001");
    expect(issue.identifier).toBe("PROJ-123");
    expect(issue.title).toBe("Bug title");
    expect(issue.url).toBe(`${BASE_URL}/browse/PROJ-123`);
    expect(issue.branchName).toBe("fix/PROJ-123");
    expect(issue.state).toBe("In Progress");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toContain(`${BASE_URL}/rest/api/3/issue/PROJ-123`);
    expect(opts.method).toBe("GET");
  });

  it("updateIssue PUTs issue fields and adds comment if provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 204,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    await makeJira().updateIssue("PROJ-123", {
      description: "Updated description",
      comment: "Fixed in latest deploy",
    });

    // First call: PUT to update description
    expect(mockFetch).toHaveBeenCalledTimes(2);
    const [putUrl, putOpts] = mockFetch.mock.calls[0];
    expect(putUrl).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-123`);
    expect(putOpts.method).toBe("PUT");
    const putBody = JSON.parse(putOpts.body);
    expect(putBody.fields.description.type).toBe("doc");
    expect(putBody.fields.description.content[0].content[0].text).toBe("Updated description");

    // Second call: POST comment
    const [commentUrl, commentOpts] = mockFetch.mock.calls[1];
    expect(commentUrl).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-123/comment`);
    expect(commentOpts.method).toBe("POST");
    const commentBody = JSON.parse(commentOpts.body);
    expect(commentBody.body.type).toBe("doc");
    expect(commentBody.body.content[0].content[0].text).toBe("Fixed in latest deploy");
  });

  it("searchIssues GETs /rest/api/3/search with JQL query and returns Issue[]", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        issues: [
          {
            id: "10001",
            key: "PROJ-123",
            fields: { summary: "Bug", status: { name: "Open" } },
          },
          {
            id: "10002",
            key: "PROJ-124",
            fields: { summary: "Another bug", status: { name: "Closed" } },
          },
        ],
      }),
    });
    globalThis.fetch = mockFetch;

    const issues = await makeJira().searchIssues({
      projectId: "PROJ",
      query: "crash",
    });

    expect(issues).toHaveLength(2);
    expect(issues[0].identifier).toBe("PROJ-123");
    expect(issues[0].title).toBe("Bug");
    expect(issues[0].url).toBe(`${BASE_URL}/browse/PROJ-123`);
    expect(issues[0].branchName).toBe("fix/PROJ-123");
    expect(issues[0].state).toBe("Open");

    expect(issues[1].identifier).toBe("PROJ-124");

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain(`${BASE_URL}/rest/api/3/search`);
    expect(url).toContain("jql=");
    expect(url).toContain("crash");
  });

  it("addComment POSTs to /rest/api/3/issue/{id}/comment with ADF body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: "comment-1" }),
    });
    globalThis.fetch = mockFetch;

    await makeJira().addComment("PROJ-123", "Deploying fix now");

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-123/comment`);
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.body.type).toBe("doc");
    expect(body.body.version).toBe(1);
    expect(body.body.content[0].type).toBe("paragraph");
    expect(body.body.content[0].content[0].type).toBe("text");
    expect(body.body.content[0].content[0].text).toBe("Deploying fix now");
  });

  it("linkPr POSTs remote link and adds comment", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ id: 1 }),
    });
    globalThis.fetch = mockFetch;

    await makeJira().linkPr("PROJ-123", "https://github.com/org/repo/pull/7", 7);

    // Two calls: POST remotelink + POST comment (via addComment)
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: remote link
    const [linkUrl, linkOpts] = mockFetch.mock.calls[0];
    expect(linkUrl).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-123/remotelink`);
    expect(linkOpts.method).toBe("POST");
    const linkBody = JSON.parse(linkOpts.body);
    expect(linkBody.object.url).toBe("https://github.com/org/repo/pull/7");
    expect(linkBody.object.title).toBe("Pull Request #7");

    // Second call: comment
    const [commentUrl, commentOpts] = mockFetch.mock.calls[1];
    expect(commentUrl).toBe(`${BASE_URL}/rest/api/3/issue/PROJ-123/comment`);
    expect(commentOpts.method).toBe("POST");
    const commentBody = JSON.parse(commentOpts.body);
    expect(commentBody.body.content[0].content[0].text).toContain("PR #7");
    expect(commentBody.body.content[0].content[0].text).toContain("https://github.com/org/repo/pull/7");
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "Invalid credentials",
    });

    await expect(makeJira().verifyAccess()).rejects.toThrow("Jira API error: 401 Unauthorized");
  });
});
