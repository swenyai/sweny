import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { github } from "./github.js";
import type { ToolContext } from "../types.js";

const ctx = (): ToolContext => ({
  config: { GITHUB_TOKEN: "test-token" },
  logger: console,
});

const createPr = github.tools.find((t) => t.name === "github_create_pr")!;

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const ALREADY_EXISTS_422 = {
  message: "Validation Failed",
  errors: [
    {
      resource: "PullRequest",
      code: "custom",
      message: "A pull request already exists for letsoffload:off-1768-fix.",
    },
  ],
  documentation_url: "https://docs.github.com/rest/pulls/pulls#create-a-pull-request",
};

describe("github_create_pr", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the new PR on the happy path", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 42, html_url: "https://github.com/o/r/pull/42" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }]));

    const result: any = await createPr.handler(
      { repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix", body: "body" },
      ctx(),
    );

    expect(result).toMatchObject({ number: 42 });
    expect(result.reused).toBeFalsy();
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.github.com/repos/o/r/pulls",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("returns the existing open PR when GitHub responds 422 'pull request already exists'", async () => {
    const existingPr = {
      number: 572,
      html_url: "https://github.com/o/r/pull/572",
      head: { ref: "x-1-fix" },
      state: "open",
    };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, [existingPr]))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }]));

    const result: any = await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    expect(result).toMatchObject({ number: 572, reused: true });
    const listCall = fetchMock.mock.calls[1][0] as string;
    expect(listCall).toContain("/repos/o/r/pulls");
    expect(listCall).toContain("head=o%3Ax-1-fix");
    expect(listCall).toContain("state=open");
  });

  it("falls back to a closed-state lookup if no open PR matches", async () => {
    const closedPr = { number: 9, html_url: "https://github.com/o/r/pull/9", state: "closed" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, [closedPr]));

    const result: any = await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    expect(result).toMatchObject({ number: 9, reused: true });
  });

  it("still throws on a 422 that is not the 'already exists' shape", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(422, {
        message: "Validation Failed",
        errors: [{ resource: "PullRequest", code: "invalid", message: "Base branch was modified." }],
      }),
    );

    await expect(createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx())).rejects.toThrow(
      /HTTP 422/,
    );
  });

  it("still throws on other non-2xx statuses", async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(500, { message: "Server error" }));
    await expect(createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx())).rejects.toThrow(
      /HTTP 500/,
    );
  });

  it("propagates the 422 if the existing-PR lookup itself fails", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, []))
      .mockResolvedValueOnce(jsonResponse(200, []));

    await expect(createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx())).rejects.toThrow(
      /already exists/i,
    );
  });
});
