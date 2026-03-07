import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { teams, teamsConfigSchema } from "../src/messaging/teams.js";
import { ProviderApiError } from "../src/errors.js";

const silentLogger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };

const validConfig = {
  tenantId: "tenant-123",
  clientId: "client-456",
  clientSecret: "secret-789",
  logger: silentLogger,
};

function mockTokenResponse(token = "test-token", expiresIn = 3600) {
  return new Response(JSON.stringify({ access_token: token, expires_in: expiresIn }), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function mockGraphResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("teams messaging provider", () => {
  afterEach(() => vi.restoreAllMocks());

  // ── Config validation ──────────────────────────────────────────────────────

  describe("config validation", () => {
    it("rejects missing tenantId", () => {
      const result = teamsConfigSchema.safeParse({ clientId: "a", clientSecret: "b" });
      expect(result.success).toBe(false);
    });

    it("rejects missing clientId", () => {
      const result = teamsConfigSchema.safeParse({ tenantId: "a", clientSecret: "b" });
      expect(result.success).toBe(false);
    });

    it("rejects missing clientSecret", () => {
      const result = teamsConfigSchema.safeParse({ tenantId: "a", clientId: "b" });
      expect(result.success).toBe(false);
    });

    it("accepts valid config", () => {
      const result = teamsConfigSchema.safeParse({
        tenantId: "t",
        clientId: "c",
        clientSecret: "s",
      });
      expect(result.success).toBe(true);
    });
  });

  // ── sendMessage ────────────────────────────────────────────────────────────

  describe("sendMessage", () => {
    it("makes token request to the correct URL", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-1" })));

      const provider = teams(validConfig);
      await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "hello" });

      const [tokenCall] = fetchSpy.mock.calls;
      expect(tokenCall[0]).toBe(`https://login.microsoftonline.com/${validConfig.tenantId}/oauth2/v2.0/token`);
    });

    it("sends POST to correct Graph URL with Authorization bearer header", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse("my-token")))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-1" })));

      const provider = teams(validConfig);
      await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "hello" });

      const [, graphCall] = fetchSpy.mock.calls;
      expect(graphCall[0]).toBe("https://graph.microsoft.com/v1.0/teams/team-abc/channels/channel-xyz/messages");
      const init = graphCall[1] as RequestInit;
      expect(init.method).toBe("POST");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer my-token");
    });

    it("uses 'html' contentType for markdown format", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-1" })));

      const provider = teams(validConfig);
      await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "**bold**", format: "markdown" });

      const [, graphCall] = fetchSpy.mock.calls;
      const body = JSON.parse((graphCall[1] as RequestInit).body as string);
      expect(body.body.contentType).toBe("html");
    });

    it("uses 'text' contentType for default (non-markdown) format", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-1" })));

      const provider = teams(validConfig);
      await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "plain text" });

      const [, graphCall] = fetchSpy.mock.calls;
      const body = JSON.parse((graphCall[1] as RequestInit).body as string);
      expect(body.body.contentType).toBe("text");
    });

    it("posts to /replies endpoint when threadId is provided", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "reply-1" })));

      const provider = teams(validConfig);
      await provider.sendMessage({
        channelId: "team-abc/channel-xyz",
        text: "a reply",
        threadId: "thread-999",
      });

      const [, graphCall] = fetchSpy.mock.calls;
      expect(graphCall[0]).toBe(
        "https://graph.microsoft.com/v1.0/teams/team-abc/channels/channel-xyz/messages/thread-999/replies",
      );
    });

    it("returns messageId from response", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-xyz" })));

      const provider = teams(validConfig);
      const result = await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "hi" });
      expect(result.messageId).toBe("msg-xyz");
    });

    it("throws ProviderApiError on 401 token failure", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(() =>
        Promise.resolve(new Response("Unauthorized", { status: 401, statusText: "Unauthorized" })),
      );

      const provider = teams(validConfig);
      await expect(provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "hi" })).rejects.toBeInstanceOf(
        ProviderApiError,
      );
    });

    it("throws ProviderApiError on non-2xx Graph API response", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() =>
          Promise.resolve(new Response("Forbidden", { status: 403, statusText: "Forbidden" })),
        );

      const provider = teams(validConfig);
      await expect(provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "hi" })).rejects.toBeInstanceOf(
        ProviderApiError,
      );
    });

    it("reuses cached token on second sendMessage (only 1 token fetch for 2 sends)", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse("cached-token", 3600)))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-1" })))
        .mockImplementationOnce(() => Promise.resolve(mockGraphResponse({ id: "msg-2" })));

      const provider = teams(validConfig);
      await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "first" });
      await provider.sendMessage({ channelId: "team-abc/channel-xyz", text: "second" });

      // 3 calls total: 1 token + 2 graph messages (no second token fetch)
      expect(fetchSpy.mock.calls).toHaveLength(3);
      expect(fetchSpy.mock.calls[0][0]).toContain("oauth2/v2.0/token");
      expect(fetchSpy.mock.calls[1][0]).toContain("graph.microsoft.com");
      expect(fetchSpy.mock.calls[2][0]).toContain("graph.microsoft.com");
    });
  });

  // ── updateMessage ──────────────────────────────────────────────────────────

  describe("updateMessage", () => {
    it("sends PATCH to correct URL with bearer token and correct body", async () => {
      const fetchSpy = vi
        .spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse("patch-token")))
        .mockImplementationOnce(() => Promise.resolve(new Response(null, { status: 200 })));

      const provider = teams(validConfig);
      await provider.updateMessage("team-abc/channel-xyz", "msg-999", "updated text");

      const [, patchCall] = fetchSpy.mock.calls;
      expect(patchCall[0]).toBe(
        "https://graph.microsoft.com/v1.0/teams/team-abc/channels/channel-xyz/messages/msg-999",
      );
      const init = patchCall[1] as RequestInit;
      expect(init.method).toBe("PATCH");
      expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer patch-token");
      const body = JSON.parse(init.body as string);
      expect(body.body.content).toBe("updated text");
    });

    it("throws ProviderApiError on non-2xx response", async () => {
      vi.spyOn(globalThis, "fetch")
        .mockImplementationOnce(() => Promise.resolve(mockTokenResponse()))
        .mockImplementationOnce(() =>
          Promise.resolve(new Response("Not Found", { status: 404, statusText: "Not Found" })),
        );

      const provider = teams(validConfig);
      await expect(provider.updateMessage("team-abc/channel-xyz", "bad-msg", "text")).rejects.toBeInstanceOf(
        ProviderApiError,
      );
    });
  });

  // ── channelId parsing ──────────────────────────────────────────────────────

  describe("channelId parsing", () => {
    it("throws Error when channelId has no slash", async () => {
      vi.spyOn(globalThis, "fetch").mockImplementationOnce(() => Promise.resolve(mockTokenResponse()));

      const provider = teams(validConfig);
      await expect(provider.sendMessage({ channelId: "no-slash-here", text: "hi" })).rejects.toThrow(
        /Invalid channelId format/,
      );
    });
  });
});
