import { describe, it, expect, vi, afterEach } from "vitest";
import { slackWebhook, slackWebhookConfigSchema } from "../src/notification/slack-webhook.js";
import { teamsWebhook, teamsWebhookConfigSchema } from "../src/notification/teams-webhook.js";
import { discordWebhook, discordWebhookConfigSchema } from "../src/notification/discord-webhook.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("slackWebhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(
      slackWebhookConfigSchema.safeParse({
        webhookUrl: "https://hooks.slack.com/services/T00/B00/xxx",
      }).success,
    ).toBe(true);
  });

  it("rejects non-URL string", () => {
    expect(slackWebhookConfigSchema.safeParse({ webhookUrl: "not-a-url" }).success).toBe(false);
  });
});

describe("teamsWebhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(
      teamsWebhookConfigSchema.safeParse({
        webhookUrl: "https://outlook.office.com/webhook/xxx",
      }).success,
    ).toBe(true);
  });
});

describe("discordWebhookConfigSchema", () => {
  it("validates a valid URL", () => {
    expect(
      discordWebhookConfigSchema.safeParse({
        webhookUrl: "https://discord.com/api/webhooks/123/abc",
      }).success,
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Slack webhook — Block Kit
// ---------------------------------------------------------------------------

describe("slackWebhook", () => {
  it("sends Block Kit blocks with header and fallback text", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({ title: "Alert", body: "something broke" });

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/services/T/B/x");
    const payload = JSON.parse(opts.body);
    // Fallback text still present
    expect(payload.text).toBe("*Alert*\nsomething broke");
    // Block Kit blocks present
    expect(Array.isArray(payload.blocks)).toBe(true);
    // First block is a header
    expect(payload.blocks[0].type).toBe("header");
    expect(payload.blocks[0].text.text).toBe("Alert");
    // Body content in a section block (no structured fields → body fallback)
    const sectionBlock = payload.blocks.find((b: { type: string }) => b.type === "section");
    expect(sectionBlock).toBeDefined();
    expect(sectionBlock.text.text).toContain("something broke");
  });

  it("sends body only when no title — fallback text is body", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({ body: "just a message" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.text).toBe("just a message");
    expect(Array.isArray(payload.blocks)).toBe(true);
  });

  it("renders status emoji and summary in a section block", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({
      title: "Triage",
      body: "fallback",
      status: "success",
      summary: "New PR created — https://github.com/org/repo/pull/42",
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const statusBlock = payload.blocks.find(
      (b: { type: string; text?: { text: string } }) => b.type === "section" && b.text?.text.includes("✅"),
    );
    expect(statusBlock).toBeDefined();
    expect(statusBlock.text.text).toContain("New PR created");
  });

  it("renders metadata as fields grid", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      fields: [
        { label: "Service", value: "`api-*`", short: true },
        { label: "Time Range", value: "`24h`", short: true },
      ],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const fieldsBlock = payload.blocks.find(
      (b: { type: string; fields?: unknown[] }) => b.type === "section" && b.fields,
    );
    expect(fieldsBlock).toBeDefined();
    expect(fieldsBlock.fields).toHaveLength(2);
    expect(fieldsBlock.fields[0].text).toContain("Service");
    expect(fieldsBlock.fields[1].text).toContain("Time Range");
  });

  it("renders action links as buttons", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      links: [
        { label: "View PR", url: "https://github.com/org/repo/pull/42" },
        { label: "View Issue", url: "https://linear.app/ENG-100" },
      ],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const actionsBlock = payload.blocks.find((b: { type: string }) => b.type === "actions");
    expect(actionsBlock).toBeDefined();
    expect(actionsBlock.elements).toHaveLength(2);
    expect(actionsBlock.elements[0].url).toBe("https://github.com/org/repo/pull/42");
    expect(actionsBlock.elements[1].url).toBe("https://linear.app/ENG-100");
  });

  it("renders content sections with dividers", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      sections: [{ title: "Investigation Log", content: "Found 3 errors" }],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const dividerBlock = payload.blocks.find((b: { type: string }) => b.type === "divider");
    expect(dividerBlock).toBeDefined();
    const logBlock = payload.blocks.find(
      (b: { type: string; text?: { text: string } }) => b.type === "section" && b.text?.text.includes("Found 3 errors"),
    );
    expect(logBlock).toBeDefined();
    expect(logBlock.text.text).toContain("Investigation Log");
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "",
    });

    const provider = slackWebhook({
      webhookUrl: "https://hooks.slack.com/services/T/B/x",
      logger: silentLogger,
    });

    await expect(provider.send({ body: "x" })).rejects.toThrow("Slack API error: 500 Internal Server Error");
  });
});

// ---------------------------------------------------------------------------
// Teams webhook — Adaptive Card
// ---------------------------------------------------------------------------

describe("teamsWebhook", () => {
  it("sends Adaptive Card with title and body (no structured fields)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({
      webhookUrl: "https://outlook.office.com/webhook/xxx",
      logger: silentLogger,
    });

    await provider.send({ title: "Deploy", body: "v1.2.3 deployed" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.type).toBe("message");
    expect(payload.attachments[0].content.type).toBe("AdaptiveCard");
    const blocks = payload.attachments[0].content.body;
    expect(blocks).toHaveLength(2);
    expect(blocks[0].text).toBe("Deploy");
    expect(blocks[1].text).toBe("v1.2.3 deployed");
  });

  it("sends body-only card when no title", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({
      webhookUrl: "https://outlook.office.com/webhook/xxx",
      logger: silentLogger,
    });

    await provider.send({ body: "hello" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const blocks = payload.attachments[0].content.body;
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe("hello");
  });

  it("renders FactSet when fields are provided", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({
      webhookUrl: "https://outlook.office.com/webhook/xxx",
      logger: silentLogger,
    });

    await provider.send({
      title: "Triage",
      body: "fallback",
      fields: [
        { label: "Service", value: "api-*" },
        { label: "Time Range", value: "24h" },
      ],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const body = payload.attachments[0].content.body;
    const factSet = body.find((b: { type: string }) => b.type === "FactSet");
    expect(factSet).toBeDefined();
    expect(factSet.facts).toHaveLength(2);
    expect(factSet.facts[0].title).toBe("Service");
    expect(factSet.facts[1].title).toBe("Time Range");
  });

  it("includes Action.OpenUrl for links", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({
      webhookUrl: "https://outlook.office.com/webhook/xxx",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      links: [{ label: "View PR", url: "https://github.com/org/repo/pull/42" }],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    const actions = payload.attachments[0].content.actions;
    expect(actions).toHaveLength(1);
    expect(actions[0].type).toBe("Action.OpenUrl");
    expect(actions[0].url).toBe("https://github.com/org/repo/pull/42");
  });
});

// ---------------------------------------------------------------------------
// Discord webhook — Embeds
// ---------------------------------------------------------------------------

describe("discordWebhook", () => {
  it("sends an embed with title and description", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({ title: "Alert", body: "fire" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(Array.isArray(payload.embeds)).toBe(true);
    expect(payload.embeds[0].title).toBe("Alert");
    expect(payload.embeds[0].description).toContain("fire");
  });

  it("sets color from status", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({ title: "Done", body: "all good", status: "success" });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.embeds[0].color).toBe(5763719); // green
  });

  it("renders metadata as inline embed fields", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({
      title: "Triage",
      body: "fallback",
      fields: [
        { label: "Service", value: "`api-*`", short: true },
        { label: "Time", value: "`24h`", short: true },
      ],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.embeds[0].fields).toHaveLength(2);
    expect(payload.embeds[0].fields[0].name).toBe("Service");
    expect(payload.embeds[0].fields[0].inline).toBe(true);
  });

  it("uses summary with status emoji in description", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      status: "skipped",
      summary: "No novel issues found",
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.embeds[0].description).toContain("⏭️");
    expect(payload.embeds[0].description).toContain("No novel issues found");
  });

  it("truncates description to 4096 chars", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    const longBody = "x".repeat(5000);
    await provider.send({ body: longBody });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.embeds[0].description.length).toBeLessThanOrEqual(4096);
  });

  it("includes both sections and links in content when both are present", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      sections: [{ title: "Log", content: "Found 3 errors" }],
      links: [{ label: "View PR", url: "https://github.com/org/repo/pull/42" }],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    // Both sections and links must appear in content — not one or the other
    expect(payload.content).toContain("Found 3 errors");
    expect(payload.content).toContain("View PR");
  });

  it("includes only links in content when no sections", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await provider.send({
      title: "Summary",
      body: "fallback",
      links: [{ label: "View Issue", url: "https://linear.app/ENG-100" }],
    });

    const payload = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(payload.content).toContain("View Issue");
    expect(payload.content).toContain("https://linear.app/ENG-100");
  });

  it("throws on non-ok response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "invalid payload",
    });

    const provider = discordWebhook({
      webhookUrl: "https://discord.com/api/webhooks/123/abc",
      logger: silentLogger,
    });

    await expect(provider.send({ body: "x" })).rejects.toThrow("Discord API error");
  });
});
