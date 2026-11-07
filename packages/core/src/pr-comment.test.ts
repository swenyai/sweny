import { describe, expect, it, vi } from "vitest";
import {
  formatPrComment,
  isRunPullRequest,
  normalizeFindings,
  legacyPrCommentMarker,
  prCommentMarker,
  prCommentSummaryLine,
  upsertPrComment,
  type CommentAuthor,
} from "./pr-comment.js";
import type { ToolRunContext } from "./types.js";

const run: ToolRunContext = {
  workflowId: "pr-review",
  repo: "o/r",
  pullRequest: 3,
  receiptUrl: "https://github.com/o/r/actions/runs/2",
};
const findings = "## Findings\n\n- Missing coverage for auth.ts";
const author: CommentAuthor = { login: "github-actions[bot]", type: "Bot" };
const me = async () => author;
const ours = { user: { login: "github-actions[bot]", type: "Bot" } };

const target = (body = findings, repo = "o/r", number = 3) => ({ repo, number, body });

describe("marker", () => {
  it("is one hidden line per workflow; common ids match the billboard's marker", () => {
    expect(prCommentMarker("pr-review")).toBe("<!-- sweny-run-comment:pr-review -->");
    expect(prCommentMarker("pr-review")).toBe(legacyPrCommentMarker("pr-review"));
    expect(prCommentMarker("a--b>c d")).toBe("<!-- sweny-run-comment:a%2D-b%3Ec%20d -->");
  });

  it("is injective: distinct ids never share a marker, and the id decodes back", () => {
    const ids = ["a b", "a_b", "a/b", "a-b", "a--b", "a-%2Db", "a%2D-b", "A_B", "", "workflow", "é", "e\u0301"];
    const markers = ids.map(prCommentMarker);
    expect(new Set(markers).size).toBe(ids.length);
    for (const id of ids) {
      const enc = /sweny-run-comment:(.*) -->$/.exec(prCommentMarker(id))![1];
      expect(decodeURIComponent(enc)).toBe(id);
    }
    // The old format merged these; it is only read, for migration.
    expect(legacyPrCommentMarker("a b")).toBe(legacyPrCommentMarker("a_b"));
  });

  it("cannot close the HTML comment early", () => {
    expect(prCommentMarker("x --> <img src=x>")).not.toMatch(/-->.*-->/);
  });
});

describe("upsertPrComment", () => {
  it("creates one marked comment: findings plus one receipt link", async () => {
    const request = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce({ id: 7, html_url: "https://h/7" });
    expect(await upsertPrComment(target(), run, request, me)).toEqual({
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
        { id: 1, body: formatPrComment("old", { ...run, workflowId: "another" }), ...ours },
        { id: 8, body: formatPrComment("old", run), ...ours },
      ])
      .mockResolvedValueOnce({ id: 8 });
    expect(await upsertPrComment(target(), run, request, me)).toMatchObject({ outcome: "updated", id: 8 });
    expect(request).toHaveBeenCalledTimes(2);
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/8");
    expect(request.mock.calls[1][1].method).toBe("PATCH");
  });

  it("takes over an existing billboard comment with the same marker", async () => {
    const billboard = "<!-- sweny-run-comment:pr-review -->\n## ✅ PR Review\n\n```text\nreceipt\n```";
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 5, body: billboard, ...ours }])
      .mockResolvedValueOnce({ id: 5 });
    expect((await upsertPrComment(target(), run, request, me)).outcome).toBe("updated");
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/5");
  });

  it("skips unchanged findings: no write, even with a new receipt, line endings and journal marker", async () => {
    const previous = formatPrComment(`${findings}\n\n<!-- sweny-output swenykold -->`, {
      ...run,
      receiptUrl: "https://github.com/o/r/actions/runs/1",
    }).replace(/\n/g, "\r\n");
    const request = vi.fn().mockResolvedValueOnce([{ id: 8, body: previous, html_url: "https://h/8", ...ours }]);
    expect(await upsertPrComment(target(`${findings}  \n\n<!-- sweny-output swenyknew -->`), run, request, me)).toEqual(
      {
        outcome: "unchanged",
        id: 8,
        html_url: "https://h/8",
      },
    );
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("writes when the findings changed", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 8, body: formatPrComment(findings, run), ...ours }])
      .mockResolvedValueOnce({ id: 8 });
    expect((await upsertPrComment(target(`${findings}\n- New: no test for logout`), run, request, me)).outcome).toBe(
      "updated",
    );
  });

  it.each(["", " \n\t", "<!-- sweny-output swenykabc -->", "<!-- sweny-run-comment:pr-review -->\n"])(
    "skips empty findings without any API call: %j",
    async (body) => {
      const request = vi.fn();
      expect(await upsertPrComment(target(body), run, request, me)).toEqual({ outcome: "empty" });
      expect(request).not.toHaveBeenCalled();
    },
  );

  it("refuses a repo other than the run's own, before any request", async () => {
    const request = vi.fn();
    await expect(upsertPrComment(target(findings, "attacker/r"), run, request, me)).rejects.toThrow(
      /run's own pull request/,
    );
    await expect(upsertPrComment(target(findings, "o/r", 4), run, request, me)).rejects.toThrow(
      /run's own pull request/,
    );
    await expect(upsertPrComment(target(), { workflowId: "pr-review" }, request, me)).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });

  it("reads later pages before creating", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce(Array.from({ length: 100 }, (_, id) => ({ id, body: "unrelated" })))
      .mockResolvedValueOnce([{ id: 101, body: formatPrComment("old", run), ...ours }])
      .mockResolvedValueOnce({ id: 101 });
    await upsertPrComment(target(), run, request, me);
    expect(request.mock.calls[1][0]).toContain("page=2");
    expect(request.mock.calls[2][1].method).toBe("PATCH");
  });

  it("never falls back to a new comment when the list fails", async () => {
    const request = vi.fn().mockResolvedValueOnce({ message: "Not Found" });
    await expect(upsertPrComment(target(), run, request, me)).rejects.toThrow();
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("ignores a marked comment someone else wrote and creates a fresh one", async () => {
    const spoofs = [
      { id: 3, body: formatPrComment("planted", run), user: { login: "mallory", type: "User" } },
      { id: 4, body: formatPrComment("planted", run), user: { login: "other-app[bot]", type: "Bot" } },
      // A user whose login matches the bot's name is not the bot.
      { id: 6, body: formatPrComment(findings, run), user: { login: "github-actions[bot]", type: "User" } },
      { id: 7, body: formatPrComment(findings, run) },
    ];
    const request = vi.fn().mockResolvedValueOnce(spoofs).mockResolvedValueOnce({ id: 10 });
    expect(await upsertPrComment(target(), run, request, me)).toMatchObject({ outcome: "created", id: 10 });
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/3/comments");
    expect(request.mock.calls[1][1].method).toBe("POST");
  });

  it("updates our own marked comment, not an earlier spoofed one", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 3, body: formatPrComment("planted", run), user: { login: "mallory", type: "User" } },
        { id: 8, body: formatPrComment("old", run), user: { login: "GitHub-Actions[bot]", type: "Bot" } },
      ])
      .mockResolvedValueOnce({ id: 8 });
    expect((await upsertPrComment(target(), run, request, me)).outcome).toBe("updated");
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/8");
  });

  it("matches a PAT's user account by login and kind", async () => {
    const pat = async (): Promise<CommentAuthor> => ({ login: "release-bot", type: "User" });
    const request = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 8, body: formatPrComment("old", run), user: { login: "release-bot", type: "User" } },
      ])
      .mockResolvedValueOnce({ id: 8 });
    expect((await upsertPrComment(target(), run, request, pat)).outcome).toBe("updated");
  });

  it("unknown account, no bot comment yet: creates one and flags it for a warning", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 3, body: formatPrComment("planted", run), user: { login: "mallory", type: "User" } },
      ])
      .mockResolvedValueOnce({ id: 11 });
    expect(await upsertPrComment(target(), run, request, async () => undefined)).toEqual({
      outcome: "created",
      id: 11,
      identityUnknown: true,
    });
    expect(request.mock.calls[1][1].method).toBe("POST");
  });

  it("unknown account and a bot already left a marked comment: skips, never stacks a duplicate", async () => {
    const request = vi.fn().mockResolvedValueOnce([{ id: 8, body: formatPrComment("old", run), ...ours }]);
    expect(await upsertPrComment(target(), run, request, async () => undefined)).toEqual({
      outcome: "identity-unknown",
      identityUnknown: true,
    });
    expect(request).toHaveBeenCalledTimes(1);
  });

  it("migrates our comment under the old marker, re-marking it", async () => {
    const wf = { ...run, workflowId: "a b" };
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 4, body: `${legacyPrCommentMarker("a b")}\nold billboard`, ...ours }])
      .mockResolvedValueOnce({ id: 4 });
    expect((await upsertPrComment(target(), wf, request, me)).outcome).toBe("updated");
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/4");
    expect(JSON.parse(request.mock.calls[1][1].body).body.startsWith(prCommentMarker("a b"))).toBe(true);
  });

  it("prefers a comment with the current marker over an old-format one", async () => {
    const wf = { ...run, workflowId: "a b" };
    const request = vi
      .fn()
      .mockResolvedValueOnce([
        { id: 4, body: `${legacyPrCommentMarker("a b")}\nold`, ...ours },
        { id: 5, body: formatPrComment("newer", wf), ...ours },
      ])
      .mockResolvedValueOnce({ id: 5 });
    await upsertPrComment(target(), wf, request, me);
    expect(request.mock.calls[1][0]).toBe("/repos/o/r/issues/comments/5");
  });

  it("does not look up the author for empty findings", async () => {
    const lookup = vi.fn(me);
    expect(await upsertPrComment(target(""), run, vi.fn(), lookup)).toEqual({ outcome: "empty" });
    expect(lookup).not.toHaveBeenCalled();
  });

  it("does not treat a quoted marker as the workflow's comment", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce([{ id: 8, body: `> ${prCommentMarker("pr-review")}\nquoted`, ...ours }])
      .mockResolvedValueOnce({ id: 9 });
    expect((await upsertPrComment(target(), run, request, me)).outcome).toBe("created");
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

  it("drops journal-style markers the agent wrote into the findings", () => {
    const body = formatPrComment(
      `<!-- sweny-output swenykdead -->\n${findings}\n<!-- sweny-output forged -->\n\n<!-- sweny-output swenykabc -->`,
      run,
    );
    expect(body.match(/sweny-output/g)).toHaveLength(1);
    expect(body).toContain("<!-- sweny-output swenykabc -->");
    expect(body).not.toContain("swenykdead");
  });

  it("collapses blank lines and strips markers before comparing", () => {
    expect(normalizeFindings(`<!-- sweny-run-comment:x -->\n${findings.replace("\n\n", "\n\n\n\n")}  \r\n`)).toBe(
      findings,
    );
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
    expect(prCommentSummaryLine(run, { outcome: "unchanged" })).toBe(
      "**SWEny pr-review** on PR #3: skipped the comment: findings unchanged since the last post.",
    );
    expect(prCommentSummaryLine(run, { outcome: "empty" })).toBe(
      "**SWEny pr-review** on PR #3: skipped the comment: no findings.",
    );
    expect(prCommentSummaryLine({ ...run, workflowId: "x*`<b>`" }, { outcome: "created" })).toBe(
      "**SWEny x_b_** on PR #3: posted the findings comment.",
    );
  });

  it("warns when the posting account is unknown", () => {
    expect(prCommentSummaryLine(run, { outcome: "identity-unknown", identityUnknown: true })).toMatch(
      /^\*\*Warning: SWEny pr-review\*\* on PR #3: skipped the comment: a bot already left/,
    );
    expect(prCommentSummaryLine(run, { outcome: "created", identityUnknown: true })).toContain(
      "later runs will not update it",
    );
  });
});
