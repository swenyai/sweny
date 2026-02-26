import { describe, it, expect, vi, beforeEach } from "vitest";
import { github } from "../src/source-control/github.js";
import type { SourceControlProvider } from "../src/source-control/types.js";

// Mock child_process.execFile
vi.mock("node:child_process", () => ({
  execFile: vi.fn((_cmd: string, _args: string[], cb: Function) => {
    cb(null, { stdout: "", stderr: "" });
  }),
}));

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function makeJsonResponse(data: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(data),
    text: () => Promise.resolve(JSON.stringify(data)),
  } as Response;
}

describe("github source-control provider", () => {
  let provider: SourceControlProvider;
  const config = {
    token: "ghp_test",
    owner: "acme",
    repo: "app",
    logger: { info: vi.fn(), debug: vi.fn(), warn: vi.fn() },
  };

  beforeEach(() => {
    vi.clearAllMocks();
    provider = github(config);
  });

  describe("factory", () => {
    it("returns an object implementing SourceControlProvider", () => {
      expect(typeof provider.verifyAccess).toBe("function");
      expect(typeof provider.configureBotIdentity).toBe("function");
      expect(typeof provider.createBranch).toBe("function");
      expect(typeof provider.pushBranch).toBe("function");
      expect(typeof provider.hasChanges).toBe("function");
      expect(typeof provider.stageAndCommit).toBe("function");
      expect(typeof provider.createPullRequest).toBe("function");
      expect(typeof provider.findExistingPr).toBe("function");
    });
  });

  describe("verifyAccess", () => {
    it("calls GitHub API to verify repo access", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ id: 123, full_name: "acme/app" }));

      await provider.verifyAccess();

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/app",
        expect.objectContaining({
          method: "GET",
          headers: expect.objectContaining({
            Authorization: "Bearer ghp_test",
          }),
        }),
      );
      expect(config.logger.info).toHaveBeenCalledWith("Verified access to acme/app");
    });

    it("throws on API failure", async () => {
      mockFetch.mockResolvedValueOnce(makeJsonResponse({ message: "Not Found" }, 404));

      await expect(provider.verifyAccess()).rejects.toThrow("GitHub API GET /repos/acme/app failed (404)");
    });
  });

  describe("createPullRequest", () => {
    it("creates a PR via GitHub API", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ number: 42, html_url: "https://github.com/acme/app/pull/42", state: "open" }),
      );

      const pr = await provider.createPullRequest({
        title: "Fix bug",
        body: "Fixes the thing",
        head: "fix/bug-123",
      });

      expect(pr.number).toBe(42);
      expect(pr.url).toBe("https://github.com/acme/app/pull/42");
      expect(pr.state).toBe("open");
      expect(pr.title).toBe("Fix bug");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.github.com/repos/acme/app/pulls",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"title":"Fix bug"'),
        }),
      );
    });

    it("adds labels after PR creation", async () => {
      mockFetch
        .mockResolvedValueOnce(
          makeJsonResponse({ number: 42, html_url: "https://github.com/acme/app/pull/42", state: "open" }),
        )
        .mockResolvedValueOnce(makeJsonResponse([]));

      await provider.createPullRequest({
        title: "Fix bug",
        body: "Fixes it",
        head: "fix/bug",
        labels: ["bug", "auto-fix"],
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch).toHaveBeenLastCalledWith(
        "https://api.github.com/repos/acme/app/issues/42/labels",
        expect.objectContaining({
          method: "POST",
          body: expect.stringContaining('"labels":["bug","auto-fix"]'),
        }),
      );
    });

    it("uses baseBranch config for default base", async () => {
      const customProvider = github({ ...config, baseBranch: "develop" });
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse({ number: 1, html_url: "https://github.com/acme/app/pull/1", state: "open" }),
      );

      await customProvider.createPullRequest({
        title: "Feature",
        body: "New feature",
        head: "feat/thing",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.base).toBe("develop");
    });
  });

  describe("findExistingPr", () => {
    it("finds matching open PR", async () => {
      mockFetch.mockResolvedValueOnce(
        makeJsonResponse([
          { number: 10, html_url: "https://github.com/acme/app/pull/10", title: "Fix ABC-123 bug", body: "Details" },
        ]),
      );

      const pr = await provider.findExistingPr("ABC-123");

      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(10);
      expect(pr!.state).toBe("open");
    });

    it("finds matching merged PR when no open match", async () => {
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse([]))
        .mockResolvedValueOnce(
          makeJsonResponse([
            {
              number: 5,
              html_url: "https://github.com/acme/app/pull/5",
              title: "Fix ABC-456",
              body: null,
              merged_at: new Date().toISOString(),
            },
          ]),
        );

      const pr = await provider.findExistingPr("ABC-456");

      expect(pr).not.toBeNull();
      expect(pr!.number).toBe(5);
      expect(pr!.state).toBe("merged");
    });

    it("returns null when no match found", async () => {
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse([]))
        .mockResolvedValueOnce(makeJsonResponse([]));

      const pr = await provider.findExistingPr("UNKNOWN-999");
      expect(pr).toBeNull();
    });

    it("ignores merged PRs older than 30 days", async () => {
      const oldDate = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000).toISOString();
      mockFetch
        .mockResolvedValueOnce(makeJsonResponse([]))
        .mockResolvedValueOnce(
          makeJsonResponse([
            {
              number: 1,
              html_url: "https://github.com/acme/app/pull/1",
              title: "Fix ABC-789",
              body: null,
              merged_at: oldDate,
            },
          ]),
        );

      const pr = await provider.findExistingPr("ABC-789");
      expect(pr).toBeNull();
    });
  });
});
