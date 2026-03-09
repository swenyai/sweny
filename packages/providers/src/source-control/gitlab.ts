import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { z } from "zod";
import type {
  SourceControlProvider,
  PullRequest,
  PrCreateOptions,
  PrListOptions,
  DispatchWorkflowOptions,
} from "./types.js";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import { ProviderApiError } from "../errors.js";

const execFileAsync = promisify(execFile);

export const gitlabConfigSchema = z.object({
  token: z.string().min(1, "GitLab token is required"),
  projectId: z.union([z.string().min(1), z.number()]),
  baseUrl: z.string().default("https://gitlab.com"),
  baseBranch: z.string().default("main"),
  logger: z.custom<Logger>().optional(),
});

export type GitLabSourceControlConfig = z.infer<typeof gitlabConfigSchema>;

async function git(args: string[], opts?: { ignoreReturnCode?: boolean }): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args);
    return stdout;
  } catch (err: unknown) {
    if (opts?.ignoreReturnCode) return "";
    throw err;
  }
}

async function glApi(
  method: string,
  path: string,
  baseUrl: string,
  token: string,
  body?: Record<string, unknown>,
): Promise<unknown> {
  const resp = await fetch(`${baseUrl}/api/v4${path}`, {
    method,
    headers: {
      "PRIVATE-TOKEN": token,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!resp.ok) {
    const body = await resp.text().catch(() => "");
    throw new ProviderApiError("GitLab", resp.status, resp.statusText, body);
  }
  // Some endpoints (204 No Content) return no body
  const contentLength = resp.headers.get("content-length");
  if (resp.status === 204 || contentLength === "0") return undefined;
  return resp.json();
}

/** Map GitLab MR state to our normalized PullRequest state */
function mapMrState(state: string, mergedAt: string | null): PullRequest["state"] {
  if (mergedAt || state === "merged") return "merged";
  if (state === "opened") return "open";
  return "closed";
}

/** Map our PrListOptions state to GitLab MR state query param */
function toGitLabState(state: string): string {
  switch (state) {
    case "open":
      return "opened";
    case "all":
      return "all";
    default:
      return state; // "closed", "merged" pass through
  }
}

export function gitlab(config: GitLabSourceControlConfig): SourceControlProvider {
  const parsed = gitlabConfigSchema.parse(config);
  const { token, baseBranch } = parsed;
  const baseUrl = parsed.baseUrl.replace(/\/+$/, "");
  const projectId =
    typeof parsed.projectId === "number" ? String(parsed.projectId) : encodeURIComponent(parsed.projectId);
  const log = parsed.logger ?? consoleLogger;

  return {
    async verifyAccess(): Promise<void> {
      const project = (await glApi("GET", `/projects/${projectId}`, baseUrl, token)) as {
        path_with_namespace: string;
      };
      log.info(`Verified access to ${project.path_with_namespace}`);
    },

    async configureBotIdentity(): Promise<void> {
      await git(["config", "user.name", "gitlab-bot"]);
      await git(["config", "user.email", "gitlab-bot@noreply.gitlab.com"]);
      log.debug("Configured git bot identity");
    },

    async createBranch(name: string): Promise<void> {
      await git(["checkout", "-b", name]);
      log.info(`Created branch: ${name}`);
    },

    async pushBranch(name: string): Promise<void> {
      // Retrieve the project path for constructing the remote URL
      const project = (await glApi("GET", `/projects/${projectId}`, baseUrl, token)) as {
        path_with_namespace: string;
      };
      const host = new URL(baseUrl).host;
      const remoteUrl = `https://gitlab-ci-token@${host}/${project.path_with_namespace}.git`;
      await git(["remote", "set-url", "origin", remoteUrl]);
      // Push using http.extraheader to provide the token without exposing it in the URL
      await execFileAsync("git", ["-c", `http.extraheader=PRIVATE-TOKEN: ${token}`, "push", "origin", name]);
      log.info(`Pushed branch: ${name}`);
    },

    async hasChanges(): Promise<boolean> {
      const unstaged = await git(["diff", "--name-only"], { ignoreReturnCode: true });
      const staged = await git(["diff", "--cached", "--name-only"], { ignoreReturnCode: true });
      return unstaged.trim().length > 0 || staged.trim().length > 0;
    },

    async hasNewCommits(): Promise<boolean> {
      const output = await git(["rev-list", "--count", "HEAD", `^origin/${baseBranch}`], { ignoreReturnCode: true });
      const count = parseInt(output.trim(), 10);
      return !isNaN(count) && count > 0;
    },

    async getChangedFiles(): Promise<string[]> {
      const output = await git(["diff", "--name-only", `origin/${baseBranch}..HEAD`], { ignoreReturnCode: true });
      return output.trim().split("\n").filter(Boolean);
    },

    async resetPaths(paths: string[]): Promise<void> {
      for (const p of paths) {
        await git(["checkout", "HEAD", "--", p], { ignoreReturnCode: true });
      }
      log.debug(`Reset paths: ${paths.join(", ")}`);
    },

    async stageAndCommit(message: string): Promise<void> {
      await git(["add", "-A"]);
      await git(["commit", "-m", message]);
    },

    async createPullRequest(opts: PrCreateOptions): Promise<PullRequest> {
      const body: Record<string, unknown> = {
        title: opts.title,
        description: opts.body,
        source_branch: opts.head,
        target_branch: opts.base || baseBranch,
      };

      if (opts.labels && opts.labels.length > 0) {
        body.labels = opts.labels.join(",");
      }

      const mr = (await glApi("POST", `/projects/${projectId}/merge_requests`, baseUrl, token, body)) as {
        iid: number;
        web_url: string;
        state: string;
        title: string;
      };
      log.info(`Created MR !${mr.iid}: ${mr.web_url}`);

      return {
        number: mr.iid,
        url: mr.web_url,
        state: "open",
        title: mr.title,
      };
    },

    async listPullRequests(opts?: PrListOptions): Promise<PullRequest[]> {
      const state = opts?.state ?? "open";
      const limit = opts?.limit ?? 30;
      const params = new URLSearchParams({
        state: toGitLabState(state),
        per_page: String(limit),
        order_by: "updated_at",
        sort: "desc",
      });

      if (opts?.labels && opts.labels.length > 0) {
        params.set("labels", opts.labels.join(","));
      }

      const mrs = (await glApi("GET", `/projects/${projectId}/merge_requests?${params}`, baseUrl, token)) as {
        iid: number;
        web_url: string;
        title: string;
        state: string;
        merged_at: string | null;
        closed_at: string | null;
        labels: string[];
      }[];

      return mrs.map((mr) => ({
        number: mr.iid,
        url: mr.web_url,
        state: mapMrState(mr.state, mr.merged_at),
        title: mr.title,
        mergedAt: mr.merged_at,
        closedAt: mr.closed_at,
      }));
    },

    async findExistingPr(searchTerm: string): Promise<PullRequest | null> {
      // Search open MRs
      const openParams = new URLSearchParams({
        state: "opened",
        search: searchTerm,
        per_page: "20",
      });

      const openMrs = (await glApi("GET", `/projects/${projectId}/merge_requests?${openParams}`, baseUrl, token)) as {
        iid: number;
        web_url: string;
        title: string;
        description: string | null;
        state: string;
        merged_at: string | null;
      }[];

      for (const mr of openMrs) {
        const text = `${mr.title} ${mr.description || ""}`;
        if (new RegExp(`\\b${searchTerm}\\b`, "i").test(text)) {
          log.info(`Found open MR with match: ${mr.web_url}`);
          return {
            number: mr.iid,
            url: mr.web_url,
            state: "open",
            title: mr.title,
          };
        }
      }

      // Search recently merged MRs
      const mergedParams = new URLSearchParams({
        state: "merged",
        search: searchTerm,
        order_by: "updated_at",
        sort: "desc",
        per_page: "20",
      });

      const mergedMrs = (await glApi(
        "GET",
        `/projects/${projectId}/merge_requests?${mergedParams}`,
        baseUrl,
        token,
      )) as {
        iid: number;
        web_url: string;
        title: string;
        description: string | null;
        state: string;
        merged_at: string | null;
      }[];

      const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      for (const mr of mergedMrs) {
        if (mr.merged_at && new Date(mr.merged_at) > cutoff) {
          const text = `${mr.title} ${mr.description || ""}`;
          if (new RegExp(`\\b${searchTerm}\\b`, "i").test(text)) {
            log.info(`Found merged MR with match: ${mr.web_url}`);
            return {
              number: mr.iid,
              url: mr.web_url,
              state: "merged",
              title: mr.title,
              mergedAt: mr.merged_at,
            };
          }
        }
      }

      return null;
    },

    async enableAutoMerge(_prNumber: number): Promise<void> {
      log.warn(
        "Auto-merge is not supported by the GitLab provider. Enable 'Merge when pipeline succeeds' on the MR manually.",
      );
    },

    async dispatchWorkflow(opts: DispatchWorkflowOptions): Promise<void> {
      // GitLab triggers pipelines via POST /projects/:id/pipeline
      // The targetRepo can override the project; the workflow field is used as the ref
      const targetProjectId = opts.targetRepo ? encodeURIComponent(opts.targetRepo) : projectId;

      const variables = opts.inputs
        ? Object.entries(opts.inputs).map(([key, value]) => ({
            key,
            value,
            variable_type: "env_var" as const,
          }))
        : [];

      await glApi("POST", `/projects/${targetProjectId}/pipeline`, baseUrl, token, {
        ref: opts.workflow || baseBranch,
        variables,
      });
      log.info(`Triggered pipeline on ref "${opts.workflow}" for project ${opts.targetRepo || projectId}`);
    },
  };
}
