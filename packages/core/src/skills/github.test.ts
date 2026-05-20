import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { github } from "./github.js";
import type { Logger, ToolContext } from "../types.js";

const ctx = (overrides: Partial<ToolContext> = {}): ToolContext => ({
  config: { GITHUB_TOKEN: "test-token" },
  logger: console,
  ...overrides,
});

function makeLogger(): Logger & { warnings: string[] } {
  const warnings: string[] = [];
  return {
    info: () => undefined,
    warn: (msg: string) => warnings.push(msg),
    error: () => undefined,
    debug: () => undefined,
    warnings,
  };
}

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

  it("defaults the label set to [sweny, agent] when caller omits labels", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 7, html_url: "https://github.com/o/r/pull/7" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }, { name: "agent" }]));

    await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    const labelCall = fetchMock.mock.calls[1];
    expect(labelCall[0]).toBe("https://api.github.com/repos/o/r/issues/7/labels");
    expect(JSON.parse(labelCall[1].body)).toEqual({ labels: ["sweny", "agent"] });
  });

  it("forwards an explicit labels array verbatim", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 8, html_url: "https://github.com/o/r/pull/8" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }, { name: "agent" }, { name: "triage" }]));

    await createPr.handler(
      { repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix", labels: ["sweny", "agent", "triage"] },
      ctx(),
    );

    const labelCall = fetchMock.mock.calls[1];
    expect(JSON.parse(labelCall[1].body)).toEqual({ labels: ["sweny", "agent", "triage"] });
  });

  it("does not relabel a reused PR (idempotent path skips labeling)", async () => {
    const existingPr = { number: 99, html_url: "https://github.com/o/r/pull/99", state: "open" };
    fetchMock
      .mockResolvedValueOnce(jsonResponse(422, ALREADY_EXISTS_422))
      .mockResolvedValueOnce(jsonResponse(200, [existingPr]));

    await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx());

    // Exactly two calls: POST /pulls (422) + GET /pulls?head=... (lookup).
    // No third call to /issues/:n/labels because reused === true.
    expect(fetchMock).toHaveBeenCalledTimes(2);
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

  it("logs a warn when the label POST fails after a successful PR create", async () => {
    // Closes the silent-failure path called out in the review of PR #189/#193:
    // a label POST that returns 5xx (or any non-2xx) was caught and swallowed
    // with zero log signal, so a label-misconfigured run looked indistinguishable
    // from a successful one. The PR is still considered created (labeling is
    // best-effort), but operators get a single line in the log naming the
    // failure so they can investigate without grepping for ghosts.
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 7, html_url: "https://github.com/o/r/pull/7" }))
      .mockResolvedValueOnce(jsonResponse(500, { message: "labels endpoint down" }));

    const logger = makeLogger();
    const result: any = await createPr.handler(
      { repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" },
      ctx({ logger }),
    );

    // PR creation still considered successful — labels are best-effort.
    expect(result).toMatchObject({ number: 7 });
    expect(result.reused).toBeFalsy();
    // A single warn line names the PR and the failure shape.
    expect(logger.warnings).toHaveLength(1);
    expect(logger.warnings[0]).toMatch(/label/i);
    expect(logger.warnings[0]).toMatch(/pull\/7|#7/);
  });

  it("does not warn when label POST succeeds (no false positives in CI logs)", async () => {
    fetchMock
      .mockResolvedValueOnce(jsonResponse(201, { number: 12, html_url: "https://github.com/o/r/pull/12" }))
      .mockResolvedValueOnce(jsonResponse(200, [{ name: "sweny" }, { name: "agent" }]));

    const logger = makeLogger();
    await createPr.handler({ repo: "o/r", title: "[X-1] fix: y", head: "x-1-fix" }, ctx({ logger }));

    expect(logger.warnings).toHaveLength(0);
  });
});
