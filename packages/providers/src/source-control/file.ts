import { execSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  SourceControlProvider,
  PullRequest,
  PrCreateOptions,
  PrListOptions,
  DispatchWorkflowOptions,
} from "./types.js";

export const fileSourceControlConfigSchema = z.object({
  outputDir: z.string().min(1, "Output directory is required"),
  baseBranch: z.string().default("main"),
  logger: z.custom<Logger>().optional(),
});

export type FileSourceControlConfig = z.infer<typeof fileSourceControlConfigSchema>;

export function fileSourceControl(config: FileSourceControlConfig): SourceControlProvider {
  const parsed = fileSourceControlConfigSchema.parse(config);
  return new FileSourceControlProvider(parsed);
}

// ---------------------------------------------------------------------------
// State stored in outputDir/state.json (shared with issue-tracking file provider)
// ---------------------------------------------------------------------------

interface PrRecord {
  number: number;
  title: string;
  state: "open" | "merged" | "closed";
  url: string;
  head: string;
  base: string;
  labels: string[];
  createdAt: string;
}

interface State {
  // issue-tracking provider may also read/write these keys
  nextIssueNumber?: number;
  issues?: unknown[];
  nextPrNumber: number;
  prs: PrRecord[];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class FileSourceControlProvider implements SourceControlProvider {
  private readonly outputDir: string;
  private readonly prsDir: string;
  private readonly statePath: string;
  private readonly baseBranch: string;
  private readonly log: Logger;
  private readonly inGitRepo: boolean;

  constructor(config: FileSourceControlConfig) {
    this.outputDir = path.resolve(config.outputDir);
    this.prsDir = path.join(this.outputDir, "prs");
    this.statePath = path.join(this.outputDir, "state.json");
    this.baseBranch = config.baseBranch;
    this.log = config.logger ?? consoleLogger;
    this.inGitRepo = this.detectGit();
  }

  private detectGit(): boolean {
    try {
      execSync("git rev-parse --is-inside-work-tree", { stdio: "pipe" });
      return true;
    } catch {
      return false;
    }
  }

  private git(cmd: string): string {
    return execSync(`git ${cmd}`, { encoding: "utf-8", stdio: "pipe" }).trim();
  }

  // ── state helpers ────────────────────────────────────────────────────

  private readState(): State {
    try {
      const raw = JSON.parse(readFileSync(this.statePath, "utf-8"));
      return { nextPrNumber: 1, prs: [], ...raw } as State;
    } catch {
      return { nextPrNumber: 1, prs: [] };
    }
  }

  private writeState(state: State): void {
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  private toPullRequest(rec: PrRecord): PullRequest {
    return {
      number: rec.number,
      url: rec.url,
      state: rec.state,
      title: rec.title,
    };
  }

  // ── SourceControlProvider ────────────────────────────────────────────

  async verifyAccess(): Promise<void> {
    mkdirSync(this.prsDir, { recursive: true });
    this.log.info(`File source control verified (git: ${this.inGitRepo})`);
  }

  async configureBotIdentity(): Promise<void> {
    if (!this.inGitRepo) {
      this.log.info("Skipping bot identity (no git repo)");
      return;
    }
    try {
      this.git('config user.name "sweny-bot"');
      this.git('config user.email "bot@sweny.ai"');
      this.log.info("Configured local git identity: sweny-bot");
    } catch (err) {
      this.log.warn(`Failed to configure git identity: ${err}`);
    }
  }

  async createBranch(name: string): Promise<void> {
    if (!this.inGitRepo) {
      this.log.info(`Skipping branch creation (no git repo): ${name}`);
      return;
    }
    this.git(`checkout -b ${name}`);
    this.log.info(`Created branch: ${name}`);
  }

  async pushBranch(name: string): Promise<void> {
    this.log.info(`Skipping push (file provider — local only): ${name}`);
  }

  async hasChanges(): Promise<boolean> {
    if (!this.inGitRepo) return false;
    const output = this.git("status --porcelain");
    return output.length > 0;
  }

  async hasNewCommits(): Promise<boolean> {
    if (!this.inGitRepo) return false;
    try {
      const count = this.git(`rev-list --count ${this.baseBranch}..HEAD`);
      return parseInt(count, 10) > 0;
    } catch {
      return false;
    }
  }

  async getChangedFiles(): Promise<string[]> {
    if (!this.inGitRepo) return [];
    try {
      const output = this.git(`diff --name-only ${this.baseBranch}..HEAD`);
      return output ? output.split("\n").filter(Boolean) : [];
    } catch {
      return [];
    }
  }

  async resetPaths(paths: string[]): Promise<void> {
    if (!this.inGitRepo) return;
    for (const p of paths) {
      try {
        this.git(`checkout HEAD -- ${p}`);
      } catch {
        // path may not exist — ignore
      }
    }
  }

  async stageAndCommit(message: string): Promise<void> {
    if (!this.inGitRepo) {
      this.log.info("Skipping commit (no git repo)");
      return;
    }
    this.git("add -A");
    this.git(`commit -m "${message.replace(/"/g, '\\"')}"`);
    this.log.info("Staged and committed changes");
  }

  async createPullRequest(opts: PrCreateOptions): Promise<PullRequest> {
    const state = this.readState();
    const num = state.nextPrNumber;
    state.nextPrNumber = num + 1;

    const filePath = path.join(this.prsDir, `pr-${num}.md`);

    const rec: PrRecord = {
      number: num,
      title: opts.title,
      state: "open",
      url: `file://${filePath}`,
      head: opts.head,
      base: opts.base ?? this.baseBranch,
      labels: opts.labels ?? [],
      createdAt: new Date().toISOString(),
    };

    state.prs.push(rec);
    this.writeState(state);

    // Write PR markdown
    const labels = rec.labels.length > 0 ? rec.labels.join(", ") : "—";
    const lines = [
      `# PR #${num}: ${opts.title}`,
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| **Number** | ${num} |`,
      `| **State** | open |`,
      `| **Head** | \`${rec.head}\` |`,
      `| **Base** | \`${rec.base}\` |`,
      `| **Labels** | ${labels} |`,
      `| **Created** | ${rec.createdAt} |`,
      "",
      "## Description",
      "",
      opts.body,
    ];
    writeFileSync(filePath, lines.join("\n"), "utf-8");

    this.log.info(`Created PR #${num}: ${filePath}`);
    return this.toPullRequest(rec);
  }

  async listPullRequests(opts?: PrListOptions): Promise<PullRequest[]> {
    const state = this.readState();
    let prs = state.prs;

    if (opts?.state && opts.state !== "all") {
      prs = prs.filter((p) => p.state === opts.state);
    }
    if (opts?.labels && opts.labels.length > 0) {
      const labels = opts.labels ?? [];
      prs = prs.filter((p) => labels.some((l) => p.labels.includes(l)));
    }
    if (opts?.limit) {
      prs = prs.slice(0, opts.limit);
    }

    return prs.map((p) => this.toPullRequest(p));
  }

  async findExistingPr(searchTerm: string): Promise<PullRequest | null> {
    const state = this.readState();
    const lower = searchTerm.toLowerCase();
    const match = state.prs.find((p) => p.title.toLowerCase().includes(lower));
    return match ? this.toPullRequest(match) : null;
  }

  async dispatchWorkflow(_opts: DispatchWorkflowOptions): Promise<void> {
    this.log.info("Skipping workflow dispatch (file provider — local only)");
  }

  async enableAutoMerge(_prNumber: number): Promise<void> {
    this.log.info("Skipping auto-merge (file provider — local only)");
  }
}
