import { describe, expect, it, vi } from "vitest";
import { formatPrComment, isPrCommentTarget, prCommentMarker, prReceiptUrl, upsertPrComment } from "./pr-comment.js";

const options = { workflowId: "pr-review", receiptUrl: "https://github.com/o/r/actions/runs/2" };
const findings = "## Findings\n\n- Missing coverage for auth.ts";

describe("one updating PR surface", () => {
  it("creates a marked findings comment with one receipt link", async () => {
    const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce({ id: 7 });
    expect(await upsertPrComment("o/r", 3, findings, options, request)).toMatchObject({
      swenyCommentStatus: "created", id: 7,
    });
    const [path, init] = request.mock.calls[1];
    expect(path).toBe("/repos/o/r/issues/3/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).body).toBe(`${prCommentMarker("pr-review")}\n${findings}\n\n[Run receipt](${options.receiptUrl})\n`);
  });

  it("updates the marked workflow comment instead of stacking or editing another workflow", async () => {
    const request = vi.fn().mockResolvedValueOnce([
      { id: 1, body: formatPrComment("old", { workflowId: "another" }) },
      { id: 8, body: formatPrComment("old", options) },
    ]).mockResolvedValueOnce({ id: 8 });
    expect(await upsertPrComment("o/r", 3, findings, options, request)).toMatchObject({ swenyCommentStatus: "updated" });
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/8");
    expect(request.mock.calls[1][1].method).toBe("PATCH");
  });

  it("skips unchanged findings despite a new receipt, line endings and journal marker", async () => {
    const request = vi.fn().mockResolvedValueOnce([{
      id: 8,
      body: formatPrComment(`${findings}\n\n<!-- sweny-output old-key -->`, {
        ...options, receiptUrl: "https://github.com/o/r/actions/runs/1",
      }).replace(/\n/g, "\r\n"),
    }]);
    expect(await upsertPrComment("o/r", 3, `${findings}  \n<!-- sweny-output new-key -->`, options, request))
      .toMatchObject({ swenyCommentStatus: "unchanged", id: 8 });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it.each(["", " \n\t", "<!-- sweny-pr-risk -->\n<!-- sweny-output key -->"])(
    "skips empty findings without listing or posting: %j", async (body) => {
      const request = vi.fn();
      expect(await upsertPrComment("o/r", 3, body, options, request)).toEqual({ swenyCommentStatus: "empty" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("reads later pages before creating a new comment", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, id) => ({ id, body: "unrelated" })))
      .mockResolvedValueOnce([{ id: 101, body: formatPrComment("old", options) }])
      .mockResolvedValueOnce({ id: 101 });
    await upsertPrComment("o/r", 3, findings, options, request);
    expect(request.mock.calls[1][0]).toContain("page=2");
    expect(request.mock.calls[2][1].method).toBe("PATCH");
  });

  it("does not create on a failed or malformed list", async () => {
    const request = vi.fn().mockResolvedValueOnce({ message: "not comments" });
    await expect(upsertPrComment("o/r", 3, findings, options, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not treat a quoted marker as the workflow's surface", async () => {
    const request = vi.fn().mockResolvedValueOnce([{ id: 8, body: `> ${prCommentMarker("pr-review")}\nquoted` }])
      .mockResolvedValueOnce({ id: 9 });
    await upsertPrComment("o/r", 3, findings, options, request);
    expect(request.mock.calls[1][1].method).toBe("POST");
  });

  it("migrates the installed risk pack's legacy marker", async () => {
    const request = vi.fn().mockResolvedValueOnce([{ id: 4, body: "<!-- sweny-pr-risk -->\nold findings" }])
      .mockResolvedValueOnce({ id: 4 });
    await upsertPrComment("o/r", 3, findings, { ...options, workflowId: "pr-risk-review" }, request);
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/4");
  });

  it("keeps workflow identities distinct and HTML-comment safe", () => {
    expect(prCommentMarker("a/b")).not.toBe(prCommentMarker("a_b"));
    expect(prCommentMarker("a--b>c d")).toBe("<!-- sweny-run-comment:a%2D%2Db%3Ec%20d -->");
  });

  it("links to the runner receipt and refuses malformed runner URLs", () => {
    expect(prReceiptUrl({ GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123" }))
      .toBe("https://github.com/o/r/actions/runs/123");
    expect(prReceiptUrl({ GITHUB_SERVER_URL: "https://github.enterprise.test", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123" }))
      .toBe("https://github.enterprise.test/o/r/actions/runs/123");
    expect(prReceiptUrl({ GITHUB_SERVER_URL: "https://user:password@host", GITHUB_REPOSITORY: "o/r", GITHUB_RUN_ID: "123" }))
      .toBeUndefined();
  });

  it("scopes the surface to its PR, leaving issue comments and other repos alone", () => {
    const context = { ...options, repo: "o/r", number: 2 };
    expect(isPrCommentTarget(context, "O/R", 2)).toBe(true);
    expect(isPrCommentTarget(context, "o/r", 3)).toBe(false);
    expect(isPrCommentTarget(context, "other/r", 2)).toBe(false);
  });
});
