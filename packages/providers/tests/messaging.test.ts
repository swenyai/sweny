import { describe, it, expect, vi, beforeEach } from "vitest";
import { slack } from "../src/messaging/slack.js";
import type { MessagingProvider } from "../src/messaging/types.js";

// Mock @slack/web-api
const mockPostMessage = vi.fn();
const mockUpdate = vi.fn();

vi.mock("@slack/web-api", () => ({
  WebClient: class {
    chat = {
      postMessage: mockPostMessage,
      update: mockUpdate,
    };
  },
}));

describe("slack messaging provider", () => {
  let provider: MessagingProvider;
  const logger = { info: vi.fn(), debug: vi.fn(), warn: vi.fn() };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = slack({ token: "xoxb-test-token", logger });
  });

  describe("factory", () => {
    it("returns an object implementing MessagingProvider", () => {
      expect(typeof provider.sendMessage).toBe("function");
      expect(typeof provider.updateMessage).toBe("function");
    });
  });

  describe("sendMessage", () => {
    it("sends a basic message", async () => {
      mockPostMessage.mockResolvedValueOnce({ ts: "1234567890.123456" });

      const result = await provider.sendMessage({
        channelId: "C12345",
        text: "Hello, world!",
      });

      expect(result.messageId).toBe("1234567890.123456");
      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: "C12345",
        text: "Hello, world!",
      });
    });

    it("sends a threaded message", async () => {
      mockPostMessage.mockResolvedValueOnce({ ts: "1234567890.654321" });

      await provider.sendMessage({
        channelId: "C12345",
        threadId: "1234567890.000001",
        text: "Reply in thread",
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: "C12345",
        text: "Reply in thread",
        thread_ts: "1234567890.000001",
      });
    });

    it("sends markdown-formatted message", async () => {
      mockPostMessage.mockResolvedValueOnce({ ts: "1234567890.111111" });

      await provider.sendMessage({
        channelId: "C12345",
        text: "*bold* _italic_",
        format: "markdown",
      });

      expect(mockPostMessage).toHaveBeenCalledWith({
        channel: "C12345",
        text: "*bold* _italic_",
        mrkdwn: true,
      });
    });

    it("returns empty messageId when ts is undefined", async () => {
      mockPostMessage.mockResolvedValueOnce({});

      const result = await provider.sendMessage({
        channelId: "C12345",
        text: "No ts in response",
      });

      expect(result.messageId).toBe("");
    });
  });

  describe("updateMessage", () => {
    it("updates an existing message", async () => {
      mockUpdate.mockResolvedValueOnce({});

      await provider.updateMessage("C12345", "1234567890.123456", "Updated text");

      expect(mockUpdate).toHaveBeenCalledWith({
        channel: "C12345",
        ts: "1234567890.123456",
        text: "Updated text",
      });
    });
  });
});
