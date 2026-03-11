/**
 * MCP adapter unit tests.
 *
 * These tests mock MCPClient.call() to verify that each adapter correctly
 * maps provider interface methods to MCP tool calls and maps results back.
 * No real MCP server process is spawned.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { linearMCP } from "../src/issue-tracking/linear-mcp.js";
import { slackMCP } from "../src/notification/slack-mcp.js";
import { githubMCP } from "../src/source-control/github-mcp.js";
import { canLinkPr, canSearchIssuesByLabel } from "../src/issue-tracking/types.js";

// ---------------------------------------------------------------------------
// Shared mock setup
// ---------------------------------------------------------------------------

// Track instances so we can get the most recently created one's call mock.
const mcpInstances: Array<{ call: ReturnType<typeof vi.fn> }> = [];

vi.mock("../src/mcp/client.js", () => {
  class MockMCPClient {
    call = vi.fn();
    connect = vi.fn().mockResolvedValue(undefined);
    availableTools = vi.fn().mockReturnValue(["tool_a", "tool_b"]);
    hasTool = vi.fn().mockReturnValue(true);
    disconnect = vi.fn().mockResolvedValue(undefined);
    constructor() {
      mcpInstances.push(this);
    }
  }
  return { MCPClient: MockMCPClient };
});

function getMockCall() {
  return mcpInstances[mcpInstances.length - 1].call;
}

beforeEach(() => {
  mcpInstances.length = 0;
  vi.clearAllMocks();
});

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {} };

// ---------------------------------------------------------------------------
// linearMCP
// ---------------------------------------------------------------------------

describe("linearMCP", () => {
  const BASE_CONFIG = {
    apiKey: "lin_api_key",
    logger: silentLogger,
  };

  it("satisfies IssueTrackingProvider + PrLinkCapable + LabelHistoryCapable interfaces", () => {
    const provider = linearMCP(BASE_CONFIG);
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.createIssue).toBe("function");
    expect(typeof provider.getIssue).toBe("function");
    expect(typeof provider.updateIssue).toBe("function");
    expect(typeof provider.searchIssues).toBe("function");
    expect(typeof provider.addComment).toBe("function");
    expect(canLinkPr(provider)).toBe(true);
    expect(canSearchIssuesByLabel(provider)).toBe(true);
  });

  it("createIssue calls create_issue tool and maps result", async () => {
    const provider = linearMCP(BASE_CONFIG);
    const mockCall = getMockCall();
    mockCall.mockResolvedValue({
      id: "issue-1",
      identifier: "ENG-42",
      title: "Fix crash",
      url: "https://linear.app/ENG-42",
      branchName: "fix/eng-42",
      state: { name: "Todo" },
    });

    const issue = await provider.createIssue({
      title: "Fix crash",
      projectId: "TEAM-1",
      description: "It crashes on startup",
      labels: ["bug"],
      priority: 1,
    });

    expect(mockCall).toHaveBeenCalledWith("create_issue", {
      title: "Fix crash",
      teamId: "TEAM-1",
      description: "It crashes on startup",
      labelIds: ["bug"],
      priority: 1,
      stateId: undefined,
    });
    expect(issue.identifier).toBe("ENG-42");
    expect(issue.title).toBe("Fix crash");
    expect(issue.branchName).toBe("fix/eng-42");
    expect(issue.state).toBe("Todo");
  });

  it("getIssue calls get_issue tool", async () => {
    const provider = linearMCP(BASE_CONFIG);
    const mockCall = getMockCall();
    mockCall.mockResolvedValue({
      id: "issue-1",
      identifier: "ENG-42",
      title: "Fix crash",
      url: "https://linear.app/ENG-42",
      state: { name: "In Progress" },
    });

    const issue = await provider.getIssue("ENG-42");

    expect(mockCall).toHaveBeenCalledWith("get_issue", { issueId: "ENG-42" });
    expect(issue.identifier).toBe("ENG-42");
    expect(issue.state).toBe("In Progress");
  });

  it("derives branchName from identifier when not in response", async () => {
    const provider = linearMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue({
      id: "issue-1",
      identifier: "ENG-42",
      title: "Fix crash",
      url: "https://linear.app/ENG-42",
    });

    const issue = await provider.getIssue("ENG-42");
    expect(issue.branchName).toBe("fix/eng-42");
  });

  it("updateIssue calls update_issue, and add_comment when comment provided", async () => {
    const provider = linearMCP(BASE_CONFIG);
    const mockCall = getMockCall();
    mockCall.mockResolvedValue({});

    await provider.updateIssue("issue-1", {
      description: "Updated",
      comment: "Fixed in v2",
    });

    expect(mockCall).toHaveBeenCalledTimes(2);
    expect(mockCall.mock.calls[0][0]).toBe("update_issue");
    expect(mockCall.mock.calls[1][0]).toBe("add_comment");
    expect(mockCall.mock.calls[1][1]).toMatchObject({ issueId: "issue-1", body: "Fixed in v2" });
  });

  it("linkPr calls create_attachment tool", async () => {
    const provider = linearMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue({});

    await provider.linkPr("issue-1", "https://github.com/org/repo/pull/7", 7);

    const call = getMockCall();
    expect(call).toHaveBeenCalledWith("create_attachment", {
      issueId: "issue-1",
      title: "Pull Request #7",
      url: "https://github.com/org/repo/pull/7",
    });
  });

  it("searchIssuesByLabel filters by cutoff date client-side", async () => {
    const provider = linearMCP(BASE_CONFIG);
    const recent = new Date(Date.now() - 5 * 24 * 60 * 60 * 1000).toISOString();
    const old = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000).toISOString();
    getMockCall().mockResolvedValue([
      {
        id: "1",
        identifier: "ENG-1",
        title: "Recent",
        url: "u",
        createdAt: recent,
        state: { name: "Done", type: "completed" },
        description: "desc",
        labels: [{ name: "bug" }],
      },
      {
        id: "2",
        identifier: "ENG-2",
        title: "Old",
        url: "u",
        createdAt: old,
        state: { name: "Done", type: "completed" },
        labels: [],
      },
    ]);

    const results = await provider.searchIssuesByLabel("TEAM", "bug", { days: 30 });

    expect(results).toHaveLength(1);
    expect(results[0].identifier).toBe("ENG-1");
    expect(results[0].stateType).toBe("completed");
    expect(results[0].descriptionSnippet).toBe("desc");
    expect(results[0].labels).toEqual(["bug"]);
  });
});

// ---------------------------------------------------------------------------
// slackMCP
// ---------------------------------------------------------------------------

describe("slackMCP", () => {
  const BASE_CONFIG = {
    botToken: "xoxb-token",
    teamId: "T123",
    channel: "#alerts",
    logger: silentLogger,
  };

  it("satisfies NotificationProvider interface", () => {
    const provider = slackMCP(BASE_CONFIG);
    expect(typeof provider.send).toBe("function");
  });

  it("send calls slack_post_message with formatted text", async () => {
    const provider = slackMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue({});

    await provider.send({
      title: "Triage Complete",
      body: "Found 3 issues",
      status: "success",
      fields: [{ label: "Project", value: "ENG" }],
      links: [{ label: "View PR", url: "https://github.com/pr/1" }],
    });

    const call = getMockCall();
    expect(call).toHaveBeenCalledOnce();
    const [toolName, args] = call.mock.calls[0];
    expect(toolName).toBe("slack_post_message");
    expect(args.channel_id).toBe("#alerts");
    expect(args.text).toContain("Triage Complete");
    expect(args.text).toContain("Found 3 issues");
    expect(args.text).toContain("Project");
    expect(args.text).toContain("View PR");
  });

  it("uses custom postMessageTool name when configured", async () => {
    const provider = slackMCP({ ...BASE_CONFIG, postMessageTool: "post_message_v2" });
    getMockCall().mockResolvedValue({});

    await provider.send({ body: "hello" });

    const [toolName] = getMockCall().mock.calls[0];
    expect(toolName).toBe("post_message_v2");
  });
});

// ---------------------------------------------------------------------------
// githubMCP
// ---------------------------------------------------------------------------

describe("githubMCP", () => {
  const BASE_CONFIG = {
    personalAccessToken: "ghp_token",
    repo: "org/repo",
    logger: silentLogger,
  };

  it("satisfies RepoProvider interface (not SourceControlProvider)", () => {
    const provider = githubMCP(BASE_CONFIG);
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.createPullRequest).toBe("function");
    expect(typeof provider.listPullRequests).toBe("function");
    expect(typeof provider.findExistingPr).toBe("function");
    expect(typeof provider.dispatchWorkflow).toBe("function");
    // GitProvider methods must NOT be present
    expect("createBranch" in provider).toBe(false);
    expect("pushBranch" in provider).toBe(false);
    expect("stageAndCommit" in provider).toBe(false);
  });

  it("createPullRequest calls create_pull_request and maps PullRequest", async () => {
    const provider = githubMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue({
      number: 42,
      html_url: "https://github.com/org/repo/pull/42",
      state: "open",
      title: "Fix crash",
      merged_at: null,
      closed_at: null,
    });

    const pr = await provider.createPullRequest({
      title: "Fix crash",
      body: "Fixes ENG-99",
      head: "fix/eng-99",
      base: "main",
    });

    expect(getMockCall()).toHaveBeenCalledWith("create_pull_request", {
      owner: "org",
      repo: "repo",
      title: "Fix crash",
      body: "Fixes ENG-99",
      head: "fix/eng-99",
      base: "main",
      labels: undefined,
    });
    expect(pr.number).toBe(42);
    expect(pr.state).toBe("open");
    expect(pr.url).toBe("https://github.com/org/repo/pull/42");
  });

  it("listPullRequests maps merged state from merged_at", async () => {
    const provider = githubMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue([
      {
        number: 1,
        html_url: "u",
        state: "closed",
        title: "Merged PR",
        merged_at: "2024-01-01T00:00:00Z",
        closed_at: "2024-01-01T00:00:00Z",
      },
    ]);

    const prs = await provider.listPullRequests({ state: "all" });
    expect(prs[0].state).toBe("merged");
  });

  it("findExistingPr searches open PRs by title substring", async () => {
    const provider = githubMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue([
      { number: 5, html_url: "u", state: "open", title: "fix ENG-42 crash", merged_at: null, closed_at: null },
      { number: 6, html_url: "u", state: "open", title: "chore: update deps", merged_at: null, closed_at: null },
    ]);

    const pr = await provider.findExistingPr("ENG-42");
    expect(pr?.number).toBe(5);
  });

  it("findExistingPr returns null when no match", async () => {
    const provider = githubMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue([
      { number: 6, html_url: "u", state: "open", title: "chore: update deps", merged_at: null, closed_at: null },
    ]);

    const pr = await provider.findExistingPr("ENG-999");
    expect(pr).toBeNull();
  });

  it("dispatchWorkflow calls create_workflow_dispatch with split owner/repo", async () => {
    const provider = githubMCP(BASE_CONFIG);
    getMockCall().mockResolvedValue({});

    await provider.dispatchWorkflow({
      targetRepo: "other-org/other-repo",
      workflow: "ci.yml",
      inputs: { env: "prod" },
    });

    expect(getMockCall()).toHaveBeenCalledWith("create_workflow_dispatch", {
      owner: "other-org",
      repo: "other-repo",
      workflow_id: "ci.yml",
      ref: "main",
      inputs: { env: "prod" },
    });
  });
});
