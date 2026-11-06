/** The single findings surface for a workflow on a PR. No runner or Node dependencies. */
export interface PrCommentContext {
  workflowId: string;
  receiptUrl?: string;
  /** When set by the executor, only this PR receives the updating surface. */
  repo?: string;
  number?: number;
}

export function isPrCommentTarget(context: PrCommentContext, repo: string, number: number): boolean {
  return (
    (context.repo === undefined || context.repo.toLowerCase() === repo.toLowerCase()) &&
    (context.number === undefined || context.number === number)
  );
}

export type PrCommentStatus = "created" | "updated" | "unchanged" | "empty";
type Comment = { id: number; body: string; html_url?: string };
type Request = (path: string, init?: RequestInit) => Promise<unknown>;

/** Percent encoding keeps distinct workflow ids distinct and prevents HTML comment delimiters. */
export function prCommentMarker(workflowId: string): string {
  const id = encodeURIComponent(workflowId).replace(/--/g, "%2D%2D");
  return `<!-- sweny-run-comment:${id} -->`;
}

/** Journal keys and receipt URLs change every run; neither is a finding. */
export function normalizeFindings(body: string): string {
  return body
    .replace(/\r\n?/g, "\n")
    .replace(/<!-- sweny-run-comment:[^\n]*? -->\n?/g, "")
    .replace(/<!-- sweny-pr-risk -->\n?/g, "")
    .replace(/<!-- sweny-output [^\n]*? -->/g, "")
    .replace(/^\[Run receipt\]\(https:\/\/[^\n]+\)\s*$/gm, "")
    .split("\n")
    .map((line) => line.trimEnd())
    .join("\n")
    .trim();
}

export function formatPrComment(findings: string, context: PrCommentContext): string {
  const normalized = normalizeFindings(findings);
  if (!normalized) return "";
  // Retain write-ahead journal markers for crash recovery, outside the comparison.
  const journal = findings.match(/<!-- sweny-output [^\n]*? -->/g) ?? [];
  const receipt =
    context.receiptUrl && /^https:\/\/[^\s<>()[\]]+$/.test(context.receiptUrl)
      ? `\n\n[Run receipt](${context.receiptUrl})`
      : "";
  return `${prCommentMarker(context.workflowId)}\n${normalized}${receipt}${journal.length ? `\n\n${journal.join("\n")}` : ""}\n`;
}

/** List before writing, including later pages. A lookup failure never falls back to POST. */
export async function upsertPrComment(
  repo: string,
  number: number,
  findings: string,
  context: PrCommentContext,
  request: Request,
): Promise<{ swenyCommentStatus: PrCommentStatus; id?: number; html_url?: string }> {
  const normalized = normalizeFindings(findings);
  if (!normalized) return { swenyCommentStatus: "empty" };
  const marker = prCommentMarker(context.workflowId);
  let existing: Comment | undefined;
  for (let page = 1; ; page++) {
    const comments = await request(`/repos/${repo}/issues/${number}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(comments)) throw new Error("GitHub comment list is unavailable");
    existing = comments.find(
      (c): c is Comment =>
        typeof c?.id === "number" &&
        typeof c?.body === "string" &&
        (c.body === marker || c.body.startsWith(`${marker}\n`) || c.body.startsWith(`${marker}\r\n`) ||
          (context.workflowId === "pr-risk-review" && c.body.startsWith("<!-- sweny-pr-risk -->\n"))),
    );
    if (existing || comments.length < 100) break;
  }
  if (existing && normalizeFindings(existing.body) === normalized) {
    return { swenyCommentStatus: "unchanged", id: existing.id, html_url: existing.html_url };
  }
  const output = (await request(
    existing ? `/repos/${repo}/issues/comments/${existing.id}` : `/repos/${repo}/issues/${number}/comments`,
    {
      method: existing ? "PATCH" : "POST",
      body: JSON.stringify({ body: formatPrComment(findings, context) }),
    },
  )) as { id?: number; html_url?: string };
  return { id: output?.id, html_url: output?.html_url, swenyCommentStatus: existing ? "updated" : "created" };
}

/** Build a receipt link only from the runner's repository, server and run id. */
export function prReceiptUrl(env: Record<string, string | undefined>): string | undefined {
  const { GITHUB_SERVER_URL: server, GITHUB_REPOSITORY: repo, GITHUB_RUN_ID: run } = env;
  if (!repo || !/^[\w.-]+\/[\w.-]+$/.test(repo) || !run || !/^\d+$/.test(run)) return undefined;
  try {
    const base = new URL(server || "https://github.com");
    if (
      base.protocol !== "https:" || base.username || base.password || base.search || base.hash || base.pathname !== "/"
    ) return undefined;
    return `${base.origin}/${repo}/actions/runs/${run}`;
  } catch {
    return undefined;
  }
}
