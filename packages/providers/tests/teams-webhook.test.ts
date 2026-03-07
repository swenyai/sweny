import { describe, it, expect, vi, afterEach } from "vitest";
import { teamsWebhook, teamsWebhookConfigSchema } from "../src/notification/teams-webhook.js";

const silentLogger = { info: () => {}, debug: () => {}, warn: () => {}, error: () => {} };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

const payload = {
  status: "success" as const,
  summary: "Triage complete for acme/api",
  body: "Triage complete for acme/api",
  fields: [{ label: "Repo", value: "acme/api" }],
  sections: [],
  links: [],
};

// ---------------------------------------------------------------------------
// Config validation
// ---------------------------------------------------------------------------

describe("teamsWebhookConfigSchema", () => {
  it("validates a valid webhookUrl", () => {
    expect(
      teamsWebhookConfigSchema.safeParse({
        webhookUrl: "https://outlook.office.com/webhook/xxx",
      }).success,
    ).toBe(true);
  });

  it("rejects non-URL string", () => {
    expect(teamsWebhookConfigSchema.safeParse({ webhookUrl: "not-a-url" }).success).toBe(false);
  });

  it("rejects missing webhookUrl", () => {
    expect(teamsWebhookConfigSchema.safeParse({}).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// notify() — HTTP request
// ---------------------------------------------------------------------------

describe("teamsWebhook notify", () => {
  it("sends POST to the configured webhookUrl", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send(payload);

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("https://outlook.office.com/webhook/xxx");
    expect(init.method).toBe("POST");
  });

  it("sends content-type application/json", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send(payload);

    const [, init] = mockFetch.mock.calls[0];
    expect(init.headers["Content-Type"]).toBe("application/json");
  });

  it("request body is a valid Adaptive Card (type=message, has attachments)", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send(payload);

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    expect(body.type).toBe("message");
    expect(Array.isArray(body.attachments)).toBe(true);
    expect(body.attachments[0].content.type).toBe("AdaptiveCard");
  });

  it("Adaptive Card body contains summary text", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send({ ...payload, summary: "Triage complete for acme/api" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const cardBody = body.attachments[0].content.body as Array<{ type: string; text?: string }>;
    const summaryBlock = cardBody.find((b) => b.text?.includes("Triage complete for acme/api"));
    expect(summaryBlock).toBeDefined();
  });

  it("success status produces a TextBlock with color Good", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send({ ...payload, status: "success", summary: "All good" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const cardBody = body.attachments[0].content.body as Array<{ type: string; color?: string }>;
    const coloredBlock = cardBody.find((b) => b.type === "TextBlock" && b.color === "Good");
    expect(coloredBlock).toBeDefined();
  });

  it("error status produces a TextBlock with color Attention", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send({ ...payload, status: "error", summary: "Deploy failed" });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const cardBody = body.attachments[0].content.body as Array<{ type: string; color?: string }>;
    const coloredBlock = cardBody.find((b) => b.type === "TextBlock" && b.color === "Attention");
    expect(coloredBlock).toBeDefined();
  });

  it("fields render as a FactSet with correct titles", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send({
      body: "fallback",
      fields: [
        { label: "Repo", value: "acme/api" },
        { label: "Branch", value: "main" },
      ],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const cardBody = body.attachments[0].content.body as Array<{
      type: string;
      facts?: Array<{ title: string; value: string }>;
    }>;
    const factSet = cardBody.find((b) => b.type === "FactSet");
    expect(factSet).toBeDefined();
    expect(factSet!.facts).toHaveLength(2);
    expect(factSet!.facts![0].title).toBe("Repo");
    expect(factSet!.facts![1].title).toBe("Branch");
  });

  it("links render as Action.OpenUrl in card actions", async () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true });
    globalThis.fetch = mockFetch;

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await provider.send({
      body: "fallback",
      links: [{ label: "View PR", url: "https://github.com/acme/api/pull/1" }],
    });

    const [, init] = mockFetch.mock.calls[0];
    const body = JSON.parse(init.body as string);
    const actions = body.attachments[0].content.actions as Array<{ type: string; url: string; title: string }>;
    expect(Array.isArray(actions)).toBe(true);
    expect(actions[0].type).toBe("Action.OpenUrl");
    expect(actions[0].url).toBe("https://github.com/acme/api/pull/1");
    expect(actions[0].title).toBe("View PR");
  });

  it("throws on non-2xx response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      text: async () => "",
    });

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await expect(provider.send(payload)).rejects.toThrow("Teams API error: 400 Bad Request");
  });

  it("throws on 502 Bad Gateway", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 502,
      statusText: "Bad Gateway",
      text: async () => "",
    });

    const provider = teamsWebhook({ webhookUrl: "https://outlook.office.com/webhook/xxx", logger: silentLogger });
    await expect(provider.send(payload)).rejects.toThrow("Teams API error: 502");
  });
});
