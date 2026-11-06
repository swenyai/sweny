import { describe, expect, it, vi } from "vitest";
import {
  formatPrComment,
  isRunPullRequest,
  normalizeFindings,
  prCommentMarker,
  prCommentSummaryLine,
  upsertPrComment,
} from "./pr-comment.js";
import type { ToolRunContext } from "./types.js";

const run: ToolRunContext = {
  workflowId: "pr-review",
  repo: "o/r",
  pullRequest: 3,
  receiptUrl: "https://github.com/o/r/actions/runs/2",
};
const findings = "## Findings\n\n- Missing coverage for auth.ts";
const target = (body = findings, repo = "o/r", number = 3) => ({ repo, number, body });

describe("marker", () => {
  it("is one hidden line per workflow, the same format the billboard used", () => {
    expect(prCommentMarker("pr-review")).toBe("<!-- sweny-run-comment:pr-review -->");
    // Existing billboard comments carry this marker, so they become the findings comment.
    expect(prCommentMarker("a--b>c d")).toBe("<!-- sweny-run-comment:a-b_c_d -->");
    expect(prCommentMarker("")).toBe("<!-- sweny-run-comment:workflow -->");
  });

  it("cannot close the HTML comment early", () => {
    expect(prCommentMarker("x --> <img src=x>")).not.toMatch(/-->.*-->/);
  });
});

describe("upsertPrComment", () => {
  it("creates one marked comment: findings plus one receipt link", async () => {
    const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce({ id: 7, html_url: "https://h/7" });
    expect(await upsertPrComment(target(), run, request)).toEqual({
      outcome: "created",
      id: 7,
      html_url: "https://h/7",
    });
    const [path, init] = request.mock.calls[1];
    expect(path).toBe("/repos/o/r/issues/3/comments");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).body).toBe(
      `<!-- sweny-run-comment:pr-review -->\n${findings}\n\n[Run receipt](${run.receiptUrl})\n`,
    );
  });

  it("updates the workflow's marked comment in place, never another workflow's", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 1, body: formatPrComment("old", { ...run, workflowId: "another" }) },
        { id: 8, body: formatPrComment("old", run) },
      ])
      .mockResolvedValueOnce({ id: 8 });
    expect(await upsertPrComment(target(), run, request)).toMatchObject({ outcome: "updated", id: 8 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/8");
    expect(request.mock.calls[1][1].method).toBe("PATCH");
  });

  it("takes over an existing billboard comment with the same marker", async () => {
    const billboard = "<!-- sweny-run-comment:pr-review -->\n## ✅ PR Review\n\n```text\nreceipt\n```";
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 5, body: billboard }])
      .mockResolvedValueOnce({ id: 5 });
    expect((await upsertPrComment(target(), run, request)).outcome).toBe("updated");
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/5");
  });

  it("skips unchanged findings: no write, even with a new receipt, line endings and journal marker", async () => {
    const previous = formatPrComment(`${findings}\n\n<!-- sweny-output swenykold -->`, {
      ...run,
      receiptUrl: "https://github.com/o/r/actions/runs/1",
    }).replace(/\n/g, "\r\n");
    const request = vi.fn().mockResolvedValueOnce([{ id: 8, body: previous, html_url: "https://h/8" }]);
    expect(await upsertPrComment(target(`${findings}  \n\n<!-- sweny-output swenyknew -->`), run, request)).toEqual({
      outcome: "unchanged",
      id: 8,
      html_url: "https://h/8",
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("writes when the findings changed", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 8, body: formatPrComment(findings, run) }])
      .mockResolvedValueOnce({ id: 8 });
    expect((await upsertPrComment(target(`${findings}\n- New: no test for logout`), run, request)).outcome).toBe(
      "updated",
    );
  });

  it.each(["", " \n\t", "<!-- sweny-output swenykabc -->", "<!-- sweny-run-comment:pr-review -->\n"])(
    "skips empty findings without any API call: %j",
    async (body) => {
      const request = vi.fn();
      expect(await upsertPrComment(target(body), run, request)).toEqual({ outcome: "empty" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("refuses a repo other than the run's own, before any request", async () => {
    const request = vi.fn();
    await expect(upsertPrComment(target(findings, "attacker/r"), run, request)).rejects.toThrow(
      /run's own pull request/,
    );
    await expect(upsertPrComment(target(findings, "o/r", 4), run, request)).rejects.toThrow(/run's own pull request/);
    await expect(upsertPrComment(target(), { workflowId: "pr-review" }, request)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("reads later pages before creating", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, id) => ({ id, body: "unrelated" })))
      .mockResolvedValueOnce([{ id: 101, body: formatPrComment("old", run) }])
      .mockResolvedValueOnce({ id: 101 });
    await upsertPrComment(target(), run, request);
    expect(request.mock.calls[1][0]).toContain("page=2");
    expect(request.mock.calls[2][1].method).toBe("PATCH");
  });

  it("never falls back to a new comment when the list fails", async () => {
    const request = vi.fn().mockResolvedValueOnce({ message: "Not Found" });
    await expect(upsertPrComment(target(), run, request)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("does not treat a quoted marker as the workflow's comment", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 8, body: `> ${prCommentMarker("pr-review")}\nquoted` }])
      .mockResolvedValueOnce({ id: 9 });
    expect((await upsertPrComment(target(), run, request)).outcome).toBe("created");
    expect(request.mock.calls[1][1].method).toBe("POST");
  });
});

describe("formatPrComment", () => {
  it("leaves out a receipt link that is not a plain https URL", () => {
    for (const receiptUrl of ["http://x/1", "https://x/1) [click](https://evil", "javascript:alert(1)"]) {
      expect(formatPrComment(findings, { ...run, receiptUrl })).not.toContain("Run receipt");
    }
  });

  it("keeps the run journal's marker at the end for crash recovery", () => {
    const body = formatPrComment(`${findings}\n\n<!-- sweny-output swenykabc -->`, run);
    expect(body.trimEnd().endsWith("<!-- sweny-output swenykabc -->")).toBe(true);
    expect(normalizeFindings(body)).toBe(findings);
  });
});

describe("isRunPullRequest", () => {
  it("matches only the runtime-identified repo and PR", () => {
    expect(isRunPullRequest(run, "O/R", 3)).toBe(true);
    expect(isRunPullRequest(run, "o/r", 2)).toBe(false);
    expect(isRunPullRequest(run, "other/r", 3)).toBe(false);
    expect(isRunPullRequest({ workflowId: "w", repo: "o/r" }, "o/r", 3)).toBe(false);
    expect(isRunPullRequest(undefined, "o/r", 3)).toBe(false);
  });
});

describe("prCommentSummaryLine", () => {
  it("says why a comment was skipped, with only the run's own values", () => {
    expect(prCommentSummaryLine(run, "unchanged")).toBe(
      "**SWEny pr-review** on PR #3: skipped the comment: findings unchanged since the last post.",
    );
    expect(prCommentSummaryLine(run, "empty")).toBe("**SWEny pr-review** on PR #3: skipped the comment: no findings.");
    expect(prCommentSummaryLine({ ...run, workflowId: "x*`<b>`" }, "created")).toBe(
      "**SWEny x_b_** on PR #3: posted the findings comment.",
    );
  });
});
