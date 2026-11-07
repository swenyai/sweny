/**
 * The single updating PR comment (#536): one marked comment per workflow per
 * pull request, edited in place, never stacked, and left alone when there is
 * nothing new to say.
 *
 * The skill that posts comments calls {@link upsertPrComment} only for the
 * run's own pull request, which the runtime reads from the operator's
 * environment (ToolContext.run), never from tool input. Everything sweny adds
 * to the body is the run's own typed values: the marker (from the workflow id)
 * and the receipt link (from the runner's server, repository and run id). The
 * findings are the agent's requested comment body, unchanged.
 *
 * Pure: no Node or runner dependencies (skills stay browser-safe).
 */

import type { ToolRunContext } from "./types.js";

/** Hidden first line that identifies a workflow's comment. Safe inside an HTML comment. */
export function prCommentMarker(workflowId: string): string {
  const safe = workflowId.replace(/[^A-Za-z0-9._-]+/g, "_").replace(/-{2,}/g, "-") || "workflow";
  return `<!-- sweny-run-comment:${safe} -->`;
}

const RECEIPT_LABEL = "Run receipt";

/**
 * The findings, without what changes on every run: the marker, the receipt
 * link, the run journal's idempotency markers, line endings and trailing
 * whitespace. Two runs with the same findings normalize to the same text.
 */
export function normalizeFindings(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/<!-- sweny-run-comment:[^\n]*? -->/g, "")
    .replace(/<!-- sweny-output [^\n]*? -->/g, "")
    .replace(new RegExp(`^\\[${RECEIPT_LABEL}\\]\\(https://[^\\s)]+\\)[ \\t]*$`, "gm"), "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** A receipt link only when it is a plain https URL with nothing that could break the markdown. */
function receiptLine(url: string | undefined): string {
  return url && /^https:\/\/[^\s<>()[\]]+$/.test(url) ? `\n\n[${RECEIPT_LABEL}](${url})` : "";
}

/** Marker, findings, one receipt link, then the run journal's markers (kept for crash recovery). */
export function formatPrComment(findings: string, run: ToolRunContext): string {
  const journal = findings.match(/<!-- sweny-output [^\n]*? -->/g) ?? [];
  return [
    prCommentMarker(run.workflowId),
    "\n",
    normalizeFindings(findings),
    receiptLine(run.receiptUrl),
    journal.length > 0 ? `\n\n${journal.join("\n")}` : "",
    "\n",
  ].join("");
}

/** Whether `repo#number` is the run's own pull request, as the runtime identified it. */
export function isRunPullRequest(run: ToolRunContext | undefined, repo: string, number: number): boolean {
  return (
    !!run?.repo &&
    run.pullRequest !== undefined &&
    typeof repo === "string" &&
    repo.toLowerCase() === run.repo.toLowerCase() &&
    number === run.pullRequest
  );
}

export type PrCommentOutcome = "created" | "updated" | "unchanged" | "empty";

export interface PrCommentResult {
  outcome: PrCommentOutcome;
  id?: number;
  html_url?: string;
}

type Request = (path: string, init?: RequestInit) => Promise<unknown>;
type Comment = { id: number; body: string; html_url?: string; user?: { login?: unknown; type?: unknown } | null };

/** The account sweny posts as: a user (a PAT) or an app's bot (an installation token). */
export interface CommentAuthor {
  login: string;
  type: "User" | "Bot";
}

/** Whether `c` was written by `author`. Login and account kind must both match. */
export function isAuthoredBy(c: Comment, author: CommentAuthor | undefined): boolean {
  if (!author || !c.user || typeof c.user.login !== "string") return false;
  const bot = c.user.type === "Bot";
  return c.user.login.toLowerCase() === author.login.toLowerCase() && bot === (author.type === "Bot");
}

/** Pages of 100 comments read while looking for the marker. */
const MAX_PAGES = 30;

/**
 * Create or update the workflow's one comment on the run's own pull request.
 * Empty findings make no API call. Findings equal to the marked comment's
 * (after normalization) make no write. A list failure never falls back to a
 * new comment. Any target other than the run's own pull request is refused
 * before a request is made.
 *
 * Only a marked comment written by `author()` (the account sweny posts as,
 * looked up only when there is something to post) is ours: anyone can paste
 * the marker into a comment. With no known author, none is ours and a new
 * comment is created.
 */
export async function upsertPrComment(
  target: { repo: string; number: number; body: string },
  run: ToolRunContext,
  request: Request,
  author: () => Promise<CommentAuthor | undefined>,
): Promise<PrCommentResult> {
  if (!isRunPullRequest(run, target.repo, target.number)) {
    throw new Error("the updating PR comment may only target the run's own pull request");
  }
  const repo = run.repo!;
  const number = run.pullRequest!;
  const findings = normalizeFindings(target.body);
  if (!findings) return { outcome: "empty" };

  const marker = prCommentMarker(run.workflowId);
  const ours = await author();
  let existing: Comment | undefined;
  for (let page = 1; ours && page <= MAX_PAGES && !existing; page++) {
    const comments = await request(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(comments)) throw new Error("GitHub comment list is unavailable");
    existing = comments.find(
      (c): c is Comment =>
        typeof c?.id === "number" &&
        typeof c?.body === "string" &&
        (c.body === marker || c.body.startsWith(`${marker}\n`) || c.body.startsWith(`${marker}\r\n`)) &&
        isAuthoredBy(c, ours),
    );
    if (comments.length < 100) break;
  }

  if (existing && normalizeFindings(existing.body) === findings) {
    return { outcome: "unchanged", id: existing.id, ...(existing.html_url ? { html_url: existing.html_url } : {}) };
  }
  const out = (await request(
    existing ? `/repos/${repo}/issues/comments/${existing.id}` : `/repos/${repo}/issues/${number}/comments`,
    { method: existing ? "PATCH" : "POST", body: JSON.stringify({ body: formatPrComment(target.body, run) }) },
  )) as { id?: unknown; html_url?: unknown } | null;
  return {
    outcome: existing ? "updated" : "created",
    ...(typeof out?.id === "number" ? { id: out.id } : {}),
    ...(typeof out?.html_url === "string" ? { html_url: out.html_url } : {}),
  };
}

/** Why a write was skipped, as the tool's `skipped` output (see ToolContext). */
export const PR_COMMENT_SKIP_REASON: Partial<Record<PrCommentOutcome, string>> = {
  empty: "no findings",
  unchanged: "findings unchanged since the last post",
};

/**
 * The job summary line for an outcome. Only the run's own values: a
 * sanitized workflow id, the PR number and a fixed phrase. No findings.
 */
export function prCommentSummaryLine(run: ToolRunContext, outcome: PrCommentOutcome): string {
  const id = run.workflowId.replace(/[^A-Za-z0-9._-]+/g, "_") || "workflow";
  const pr = run.pullRequest !== undefined ? ` on PR #${run.pullRequest}` : "";
  const what = {
    created: "posted the findings comment",
    updated: "updated the findings comment in place",
    unchanged: "skipped the comment: findings unchanged since the last post",
    empty: "skipped the comment: no findings",
  }[outcome];
  return `**SWEny ${id}**${pr}: ${what}.`;
}
