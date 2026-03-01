import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { teams } from "../src/messaging/teams.js";
import { opsgenie, opsgenieConfigSchema } from "../src/incident/opsgenie.js";
import type { MessagingProvider } from "../src/messaging/types.js";
import type { IncidentProvider } from "../src/incident/types.js";

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };
const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// Teams Messaging Provider
// ---------------------------------------------------------------------------

describe("teams messaging provider", () => {
  let provider: MessagingProvider;

  function mockTokenAndApiResponse(apiResponse: unknown) {
    const mockFetch = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600 }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => apiResponse,
      });
    globalThis.fetch = mockFetch;
    return mockFetch;
  }

  beforeEach(() => {
    provider = teams({
      tenantId: "tenant-123",
      clientId: "client-456",
      clientSecret: "secret-789",
      logger: silentLogger,
    });
  });

  describe("factory", () => {
    it("returns an object implementing MessagingProvider", () => {
      expect(typeof provider.sendMessage).toBe("function");
      expect(typeof provider.updateMessage).toBe("function");
    });
  });

  describe("sendMessage", () => {
    it("acquires OAuth token then sends via Graph API", async () => {
      const mockFetch = mockTokenAndApiResponse({ id: "msg-123" });

      const result = await provider.sendMessage({
        channelId: "team-1/channel-1",
        text: "Hello Teams!",
      });

      expect(result.messageId).toBe("msg-123");

      // First call: token acquisition
      const [tokenUrl, tokenOpts] = mockFetch.mock.calls[0];
      expect(tokenUrl).toBe("https://login.microsoftonline.com/tenant-123/oauth2/v2.0/token");
      expect(tokenOpts.method).toBe("POST");

      // Second call: Graph API message send
      const [graphUrl, graphOpts] = mockFetch.mock.calls[1];
      expect(graphUrl).toBe("https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages");
      expect(graphOpts.headers.Authorization).toBe("Bearer test-token");
      expect(graphOpts.method).toBe("POST");
    });

    it("sends reply to thread when threadId is provided", async () => {
      const mockFetch = mockTokenAndApiResponse({ id: "reply-456" });

      const result = await provider.sendMessage({
        channelId: "team-1/channel-1",
        threadId: "parent-msg-1",
        text: "Thread reply",
      });

      expect(result.messageId).toBe("reply-456");

      const [graphUrl] = mockFetch.mock.calls[1];
      expect(graphUrl).toBe(
        "https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/parent-msg-1/replies",
      );
    });

    it("throws on invalid channelId format (no separator)", async () => {
      // Mock the token endpoint so getAccessToken() succeeds before parseChannelId throws
      globalThis.fetch = vi.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({ access_token: "test-token", expires_in: 3600 }),
      });
      await expect(provider.sendMessage({ channelId: "no-slash-here", text: "fail" })).rejects.toThrow(
        'Invalid channelId format: expected "teamId/channelId"',
      );
    });

    it("caches token across multiple calls", async () => {
      const mockFetch = vi
        .fn()
        // First token call
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "test-token", expires_in: 3600 }),
        })
        // First message call
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "msg-1" }),
        })
        // Second message call (no token fetch needed)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ id: "msg-2" }),
        });
      globalThis.fetch = mockFetch;

      await provider.sendMessage({ channelId: "team-1/channel-1", text: "First" });
      await provider.sendMessage({ channelId: "team-1/channel-1", text: "Second" });

      // Should only have 3 fetch calls total: 1 token + 2 API calls
      expect(mockFetch).toHaveBeenCalledTimes(3);

      // Verify only the first call was a token request
      expect(mockFetch.mock.calls[0][0]).toContain("login.microsoftonline.com");
      expect(mockFetch.mock.calls[1][0]).toContain("graph.microsoft.com");
      expect(mockFetch.mock.calls[2][0]).toContain("graph.microsoft.com");
    });
  });

  describe("updateMessage", () => {
    it("PATCHes the message via Graph API", async () => {
      const mockFetch = vi
        .fn()
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ access_token: "test-token", expires_in: 3600 }),
        })
        .mockResolvedValueOnce({
          ok: true,
        });
      globalThis.fetch = mockFetch;

      await provider.updateMessage("team-1/channel-1", "msg-123", "Updated text");

      const [graphUrl, graphOpts] = mockFetch.mock.calls[1];
      expect(graphUrl).toBe("https://graph.microsoft.com/v1.0/teams/team-1/channels/channel-1/messages/msg-123");
      expect(graphOpts.method).toBe("PATCH");
      expect(graphOpts.headers.Authorization).toBe("Bearer test-token");

      const body = JSON.parse(graphOpts.body);
      expect(body.body.content).toBe("Updated text");
    });
  });
});

// ---------------------------------------------------------------------------
// OpsGenie Config Schema
// ---------------------------------------------------------------------------

describe("opsgenieConfigSchema", () => {
  it("validates config and applies defaults (region=us)", () => {
    const result = opsgenieConfigSchema.safeParse({ apiKey: "test-key" });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("us");
    }
  });

  it("accepts region eu", () => {
    const result = opsgenieConfigSchema.safeParse({
      apiKey: "test-key",
      region: "eu",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.region).toBe("eu");
    }
  });

  it("rejects missing apiKey", () => {
    const result = opsgenieConfigSchema.safeParse({});
    expect(result.success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// OpsGenie Incident Provider
// ---------------------------------------------------------------------------

describe("OpsGenieProvider", () => {
  it("factory returns IncidentProvider with all methods", () => {
    const mockFetch = vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "test-key", logger: silentLogger });
    expect(typeof provider.verifyAccess).toBe("function");
    expect(typeof provider.createIncident).toBe("function");
    expect(typeof provider.acknowledgeIncident).toBe("function");
    expect(typeof provider.resolveIncident).toBe("function");
    expect(typeof provider.getOnCall).toBe("function");
  });

  it("verifyAccess GETs /v2/account with GenieKey auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "test-key", logger: silentLogger });
    await provider.verifyAccess();

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.opsgenie.com/v2/account");
    expect(opts.headers.Authorization).toBe("GenieKey test-key");
  });

  it("createIncident POSTs to /v2/alerts and maps high priority to P1", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { alertId: "alert-123", alias: "alias-123" },
        requestId: "req-1",
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "test-key", logger: silentLogger });
    const incident = await provider.createIncident({
      title: "Server on fire",
      urgency: "high",
    });

    expect(incident.id).toBe("alert-123");
    expect(incident.status).toBe("triggered");
    expect(incident.urgency).toBe("high");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.opsgenie.com/v2/alerts");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.message).toBe("Server on fire");
    expect(body.priority).toBe("P1");
  });

  it("createIncident maps low priority to P3", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        data: { alertId: "alert-456", alias: "alias-456" },
        requestId: "req-2",
      }),
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "test-key", logger: silentLogger });
    await provider.createIncident({ title: "Slow queries", urgency: "low" });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.priority).toBe("P3");
  });

  it("acknowledgeIncident POSTs to /v2/alerts/{id}/acknowledge", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "test-key", logger: silentLogger });
    await provider.acknowledgeIncident("alert-123");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.opsgenie.com/v2/alerts/alert-123/acknowledge");
    expect(opts.method).toBe("POST");
  });

  it("resolveIncident POSTs to /v2/alerts/{id}/close", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({}),
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "test-key", logger: silentLogger });
    await provider.resolveIncident("alert-123", "Root cause fixed");

    const [url, opts] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.opsgenie.com/v2/alerts/alert-123/close");
    expect(opts.method).toBe("POST");

    const body = JSON.parse(opts.body);
    expect(body.note).toBe("Root cause fixed");
  });

  it("EU region uses correct base URL", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ data: {} }),
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({
      apiKey: "test-key",
      region: "eu",
      logger: silentLogger,
    });
    await provider.verifyAccess();

    const [url] = mockFetch.mock.calls[0];
    expect(url).toBe("https://api.eu.opsgenie.com/v2/account");
  });

  it("throws on non-ok response", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      text: async () => "",
    });
    globalThis.fetch = mockFetch;

    const provider = opsgenie({ apiKey: "bad-key", logger: silentLogger });

    await expect(provider.verifyAccess()).rejects.toThrow("OpsGenie API error: 401 Unauthorized");
  });
});
