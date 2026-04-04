import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ToolContext } from "../types.js";
import { github } from "../skills/github.js";
import { linear } from "../skills/linear.js";
import { slack } from "../skills/slack.js";
import { sentry } from "../skills/sentry.js";
import { datadog } from "../skills/datadog.js";
import { notification } from "../skills/notification.js";
import { loadCustomSkills, configuredSkills, createSkillMap } from "../skills/index.js";

// ─── Helpers ─────────────────────────────────────────────────────

const mockCtx = (config: Record<string, string> = {}): ToolContext => ({
  config,
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
});

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.restoreAllMocks();
});

function mockResponse(body: any, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  };
}

function findTool(skillTools: any[], name: string) {
  const tool = skillTools.find((t: any) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

// ─── GitHub skill tests ──────────────────────────────────────────

describe("github skill", () => {
  const ctx = () => mockCtx({ GITHUB_TOKEN: "ghp_test" });

  it("search_code sends correct request", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ items: [] }));
    const tool = findTool(github.tools, "github_search_code");
    await tool.handler({ query: "foo", repo: "owner/repo" }, ctx());

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/search/code");
    expect(url).toContain("repo%3Aowner%2Frepo");
    expect(opts.headers.Authorization).toBe("token ghp_test");
    expect(opts.signal).toBeDefined(); // timeout signal
  });

  it("get_issue sends correct request", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ id: 1, title: "Bug" }));
    const tool = findTool(github.tools, "github_get_issue");
    const result = await tool.handler({ repo: "owner/repo", number: 42 }, ctx());

    expect(fetchMock.mock.calls[0][0]).toContain("/repos/owner/repo/issues/42");
    expect(result.title).toBe("Bug");
  });

  it("create_issue sends POST with body", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ number: 1 }));
    const tool = findTool(github.tools, "github_create_issue");
    await tool.handler({ repo: "o/r", title: "New Issue", body: "Details", labels: ["bug"] }, ctx());

    const [, opts] = fetchMock.mock.calls[0];
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body);
    expect(body.title).toBe("New Issue");
    expect(body.labels).toContain("bug");
  });

  it("create_pr sends POST with correct fields", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ number: 10 }));
    const tool = findTool(github.tools, "github_create_pr");
    await tool.handler({ repo: "o/r", title: "PR", head: "feature", base: "develop" }, ctx());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.head).toBe("feature");
    expect(body.base).toBe("develop");
  });

  it("get_file decodes base64 content", async () => {
    const encoded = Buffer.from("hello world").toString("base64");
    fetchMock.mockResolvedValueOnce(mockResponse({ content: encoded, encoding: "base64" }));
    const tool = findTool(github.tools, "github_get_file");
    const result: any = await tool.handler({ repo: "o/r", path: "README.md" }, ctx());

    expect(result.decoded_content).toBe("hello world");
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("Not Found", false, 404));
    const tool = findTool(github.tools, "github_search_code");

    await expect(tool.handler({ query: "x", repo: "o/r" }, ctx())).rejects.toThrow("[GitHub]");
  });
});

// ─── Linear skill tests ─────────────────────────────────────────

describe("linear skill", () => {
  const ctx = () => mockCtx({ LINEAR_API_KEY: "lin_test" });

  it("create_issue sends correct GraphQL mutation", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: { issueCreate: { success: true, issue: { id: "1" } } } }));
    const tool = findTool(linear.tools, "linear_create_issue");
    await tool.handler({ teamId: "team1", title: "Bug" }, ctx());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.linear.app/graphql");
    expect(opts.headers.Authorization).toBe("lin_test");
    const body = JSON.parse(opts.body);
    expect(body.query).toContain("issueCreate");
  });

  it("search_issues sends correct query", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: { searchIssues: { nodes: [] } } }));
    const tool = findTool(linear.tools, "linear_search_issues");
    await tool.handler({ query: "memory leak", limit: 5 }, ctx());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.query).toBe("memory leak");
    expect(body.variables.first).toBe(5);
  });

  it("update_issue sends correct mutation", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: { issueUpdate: { success: true } } }));
    const tool = findTool(linear.tools, "linear_update_issue");
    await tool.handler({ issueId: "id1", title: "Updated" }, ctx());

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.variables.id).toBe("id1");
    expect(body.variables.input.title).toBe("Updated");
  });

  it("throws on GraphQL errors", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ errors: [{ message: "Not found" }] }));
    const tool = findTool(linear.tools, "linear_search_issues");

    await expect(tool.handler({ query: "x" }, ctx())).rejects.toThrow("[Linear] GraphQL error");
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("Unauthorized", false, 401));
    const tool = findTool(linear.tools, "linear_create_issue");

    await expect(tool.handler({ teamId: "t", title: "x" }, ctx())).rejects.toThrow("[Linear]");
  });
});

// ─── Slack skill tests ──────────────────────────────────────────

describe("slack skill", () => {
  it("sends via webhook when only webhook is configured", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("ok", true, 200));
    const tool = findTool(slack.tools, "slack_send_message");
    const ctx = mockCtx({ SLACK_WEBHOOK_URL: "https://hooks.slack.com/test" });

    await tool.handler({ text: "Hello" }, ctx);

    expect(fetchMock.mock.calls[0][0]).toBe("https://hooks.slack.com/test");
  });

  it("sends via bot token when bot token and channel are provided", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: true, ts: "123" }));
    const tool = findTool(slack.tools, "slack_send_message");
    const ctx = mockCtx({ SLACK_BOT_TOKEN: "xoxb-test" });

    const result = await tool.handler({ text: "Hello", channel: "C123" }, ctx);

    expect(fetchMock.mock.calls[0][0]).toBe("https://slack.com/api/chat.postMessage");
    expect(result.ok).toBe(true);
  });

  it("throws when Slack API returns ok:false", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, error: "channel_not_found" }));
    const tool = findTool(slack.tools, "slack_send_message");
    const ctx = mockCtx({ SLACK_BOT_TOKEN: "xoxb-test" });

    await expect(tool.handler({ text: "Hello", channel: "C123" }, ctx)).rejects.toThrow("channel_not_found");
  });

  it("throws when no credentials configured", async () => {
    const tool = findTool(slack.tools, "slack_send_message");
    const ctx = mockCtx({});

    await expect(tool.handler({ text: "Hello" }, ctx)).rejects.toThrow("No Slack credentials");
  });

  it("thread_reply requires bot token", async () => {
    const tool = findTool(slack.tools, "slack_send_thread_reply");
    const ctx = mockCtx({});

    await expect(tool.handler({ channel: "C1", thread_ts: "123", text: "Reply" }, ctx)).rejects.toThrow(
      "SLACK_BOT_TOKEN",
    );
  });

  it("thread_reply validates response", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ ok: false, error: "thread_not_found" }));
    const tool = findTool(slack.tools, "slack_send_thread_reply");
    const ctx = mockCtx({ SLACK_BOT_TOKEN: "xoxb-test" });

    await expect(tool.handler({ channel: "C1", thread_ts: "123", text: "Reply" }, ctx)).rejects.toThrow(
      "thread_not_found",
    );
  });
});

// ─── Sentry skill tests ─────────────────────────────────────────

describe("sentry skill", () => {
  const ctx = () => mockCtx({ SENTRY_AUTH_TOKEN: "sntrys_test", SENTRY_ORG: "my-org" });

  it("list_issues sends correct request", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([]));
    const tool = findTool(sentry.tools, "sentry_list_issues");
    await tool.handler({ project: "my-project" }, ctx());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/projects/my-org/my-project/issues/");
    expect(opts.headers.Authorization).toBe("Bearer sntrys_test");
  });

  it("get_issue sends correct request", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ id: "123" }));
    const tool = findTool(sentry.tools, "sentry_get_issue");
    await tool.handler({ issueId: "123" }, ctx());

    expect(fetchMock.mock.calls[0][0]).toContain("/issues/123/");
  });

  it("uses SENTRY_BASE_URL when configured", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([]));
    const tool = findTool(sentry.tools, "sentry_list_issues");
    const customCtx = mockCtx({
      SENTRY_AUTH_TOKEN: "x",
      SENTRY_ORG: "org",
      SENTRY_BASE_URL: "https://sentry.example.com",
    });
    await tool.handler({ project: "p" }, customCtx);

    expect(fetchMock.mock.calls[0][0]).toContain("https://sentry.example.com");
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("Forbidden", false, 403));
    const tool = findTool(sentry.tools, "sentry_list_issues");

    await expect(tool.handler({ project: "p" }, ctx())).rejects.toThrow("[Sentry]");
  });
});

// ─── Datadog skill tests ────────────────────────────────────────

describe("datadog skill", () => {
  const ctx = () => mockCtx({ DD_API_KEY: "dd_key", DD_APP_KEY: "dd_app" });

  it("search_logs sends correct POST to v2 API", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ data: [] }));
    const tool = findTool(datadog.tools, "datadog_search_logs");
    await tool.handler({ query: "service:web status:error" }, ctx());

    const [url, opts] = fetchMock.mock.calls[0];
    expect(url).toContain("/api/v2/logs/events/search");
    expect(opts.method).toBe("POST");
    expect(opts.headers["DD-API-KEY"]).toBe("dd_key");
    expect(opts.headers["DD-APPLICATION-KEY"]).toBe("dd_app");
  });

  it("query_metrics sends correct GET to v1 API", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse({ series: [] }));
    const tool = findTool(datadog.tools, "datadog_query_metrics");
    await tool.handler({ query: "avg:system.cpu.user{*}", from: 1000, to: 2000 }, ctx());

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/api/v1/query");
    expect(url).toContain("from=1000");
    expect(url).toContain("to=2000");
  });

  it("list_monitors sends correct GET", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([]));
    const tool = findTool(datadog.tools, "datadog_list_monitors");
    await tool.handler({ name: "CPU" }, ctx());

    const url = fetchMock.mock.calls[0][0];
    expect(url).toContain("/api/v1/monitor");
    expect(url).toContain("name=CPU");
  });

  it("uses DD_SITE for custom domain", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse([]));
    const tool = findTool(datadog.tools, "datadog_list_monitors");
    const euCtx = mockCtx({ DD_API_KEY: "k", DD_APP_KEY: "a", DD_SITE: "datadoghq.eu" });
    await tool.handler({}, euCtx);

    expect(fetchMock.mock.calls[0][0]).toContain("api.datadoghq.eu");
  });

  it("throws on HTTP error", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("Unauthorized", false, 401));
    const tool = findTool(datadog.tools, "datadog_search_logs");

    await expect(tool.handler({ query: "x" }, ctx())).rejects.toThrow("[Datadog]");
  });
});

// ─── Notification skill tests ───────────────────────────────────

describe("notification skill", () => {
  it("notify_webhook sends POST to configured URL", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("ok", true, 200));
    const tool = findTool(notification.tools, "notify_webhook");
    const ctx = mockCtx({ NOTIFICATION_WEBHOOK_URL: "https://example.com/hook" });
    await tool.handler({ payload: { event: "test" } }, ctx);

    expect(fetchMock.mock.calls[0][0]).toBe("https://example.com/hook");
  });

  it("notify_webhook allows URL override", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("ok", true, 200));
    const tool = findTool(notification.tools, "notify_webhook");
    const ctx = mockCtx({});
    await tool.handler({ url: "https://custom.com/hook", payload: { x: 1 } }, ctx);

    expect(fetchMock.mock.calls[0][0]).toBe("https://custom.com/hook");
  });

  it("notify_webhook throws without URL", async () => {
    const tool = findTool(notification.tools, "notify_webhook");
    await expect(tool.handler({ payload: {} }, mockCtx({}))).rejects.toThrow("No webhook URL");
  });

  it("notify_discord sends to Discord webhook", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse(null, true, 204));
    const tool = findTool(notification.tools, "notify_discord");
    const ctx = mockCtx({ DISCORD_WEBHOOK_URL: "https://discord.com/api/webhooks/test" });
    await tool.handler({ content: "Hello Discord" }, ctx);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body.content).toBe("Hello Discord");
  });

  it("notify_discord throws without URL", async () => {
    const tool = findTool(notification.tools, "notify_discord");
    await expect(tool.handler({ content: "x" }, mockCtx({}))).rejects.toThrow("DISCORD_WEBHOOK_URL");
  });

  it("notify_teams sends MessageCard", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("1", true, 200));
    const tool = findTool(notification.tools, "notify_teams");
    const ctx = mockCtx({ TEAMS_WEBHOOK_URL: "https://outlook.webhook.office.com/test" });
    await tool.handler({ text: "Alert!", title: "SWEny" }, ctx);

    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body["@type"]).toBe("MessageCard");
    expect(body.title).toBe("SWEny");
  });

  it("notify_teams throws without URL", async () => {
    const tool = findTool(notification.tools, "notify_teams");
    await expect(tool.handler({ text: "x" }, mockCtx({}))).rejects.toThrow("TEAMS_WEBHOOK_URL");
  });

  it("all notification fetches have timeout signal", async () => {
    fetchMock.mockResolvedValueOnce(mockResponse("ok", true, 200));
    const tool = findTool(notification.tools, "notify_webhook");
    const ctx = mockCtx({ NOTIFICATION_WEBHOOK_URL: "https://example.com" });
    await tool.handler({ payload: {} }, ctx);

    expect(fetchMock.mock.calls[0][1].signal).toBeDefined();
  });
});

// ─── Custom skill discovery tests ──────────────────────────────

describe("loadCustomSkills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweny-skills-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkill(dirName: string, content: string) {
    const dir = join(tmpDir, ".claude", "skills", dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
  }

  it("returns empty array when .claude/skills/ does not exist", () => {
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it("returns empty array when .claude/skills/ is empty", () => {
    mkdirSync(join(tmpDir, ".claude", "skills"), { recursive: true });
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it("discovers a valid custom skill from SKILL.md frontmatter", () => {
    writeSkill(
      "my-skill",
      `---
name: my-skill
description: A test skill
---

Instructions for Claude go here.
`,
    );
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0]).toMatchObject({
      id: "my-skill",
      name: "my-skill",
      description: "A test skill",
      category: "general",
    });
    expect(skills[0].tools).toEqual([]);
    expect(skills[0].config).toEqual({});
  });

  it("discovers multiple skills", () => {
    writeSkill("skill-a", `---\nname: skill-a\ndescription: First\n---\nBody`);
    writeSkill("skill-b", `---\nname: skill-b\ndescription: Second\n---\nBody`);
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toHaveLength(2);
    const ids = skills.map((s) => s.id).sort();
    expect(ids).toEqual(["skill-a", "skill-b"]);
  });

  it("skips directories without SKILL.md", () => {
    mkdirSync(join(tmpDir, ".claude", "skills", "no-skill-file"), { recursive: true });
    writeFileSync(join(tmpDir, ".claude", "skills", "no-skill-file", "README.md"), "not a skill");
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it("skips SKILL.md without frontmatter", () => {
    writeSkill("no-frontmatter", "Just plain text, no YAML frontmatter.");
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it("skips SKILL.md with frontmatter missing name field", () => {
    writeSkill("no-name", `---\ndescription: Missing name\n---\nBody`);
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toEqual([]);
  });

  it("uses fallback description when description is missing", () => {
    writeSkill("name-only", `---\nname: name-only\n---\nBody`);
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toHaveLength(1);
    expect(skills[0].description).toBe("Custom skill: name-only");
  });

  it("skips malformed YAML in frontmatter", () => {
    writeSkill("bad-yaml", `---\n: [invalid yaml\n---\nBody`);
    const skills = loadCustomSkills(tmpDir);
    expect(skills).toEqual([]);
  });
});

describe("configuredSkills with custom skills", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), "sweny-configured-test-"));
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function writeSkill(dirName: string, content: string) {
    const dir = join(tmpDir, ".claude", "skills", dirName);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "SKILL.md"), content);
  }

  it("includes custom skills alongside configured built-ins", () => {
    writeSkill("my-custom", `---\nname: my-custom\ndescription: Custom\n---\nBody`);
    // Provide a notification webhook so at least one built-in is configured
    const skills = configuredSkills({ NOTIFICATION_WEBHOOK_URL: "https://example.com" }, tmpDir);
    const ids = skills.map((s) => s.id);
    expect(ids).toContain("my-custom");
    expect(ids).toContain("notification");
  });

  it("built-in skills take precedence over custom skills with same ID", () => {
    // notification is configured when a webhook URL is set
    writeSkill("notification", `---\nname: notification\ndescription: Custom override attempt\n---\nBody`);
    const skills = configuredSkills({ NOTIFICATION_WEBHOOK_URL: "https://example.com" }, tmpDir);
    const notif = skills.filter((s) => s.id === "notification");
    expect(notif).toHaveLength(1);
    // Should be the built-in (has tools), not the custom one (tools: [])
    expect(notif[0].tools.length).toBeGreaterThan(0);
  });

  it("custom skills are usable in createSkillMap", () => {
    writeSkill("extract-colors", `---\nname: extract-colors\ndescription: Route color extraction\n---\nBody`);
    const skills = configuredSkills({}, tmpDir);
    const map = createSkillMap(skills);
    expect(map.has("extract-colors")).toBe(true);
    expect(map.get("extract-colors")!.tools).toEqual([]);
  });
});
