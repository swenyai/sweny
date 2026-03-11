import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import * as path from "node:path";
import { z } from "zod";
import type { Logger } from "../logger.js";
import { consoleLogger } from "../logger.js";
import type {
  IssueTrackingProvider,
  Issue,
  IssueCreateOptions,
  IssueUpdateOptions,
  IssueSearchOptions,
  LabelHistoryCapable,
  IssueHistoryEntry,
} from "./types.js";

export const fileIssueTrackingConfigSchema = z.object({
  outputDir: z.string().min(1, "Output directory is required"),
  logger: z.custom<Logger>().optional(),
});

export type FileIssueTrackingConfig = z.infer<typeof fileIssueTrackingConfigSchema>;

export function fileIssueTracking(config: FileIssueTrackingConfig): IssueTrackingProvider & LabelHistoryCapable {
  const parsed = fileIssueTrackingConfigSchema.parse(config);
  return new FileIssueTrackingProvider(parsed);
}

// ---------------------------------------------------------------------------
// State persisted in outputDir/state.json
// ---------------------------------------------------------------------------

interface IssueRecord {
  id: string;
  identifier: string;
  number: number;
  title: string;
  state: string;
  description: string;
  labels: string[];
  priority: number;
  branchName: string;
  createdAt: string;
  comments: string[];
}

interface State {
  nextIssueNumber: number;
  issues: IssueRecord[];
  // source-control provider may also read/write this file
  nextPrNumber?: number;
  prs?: unknown[];
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

class FileIssueTrackingProvider implements IssueTrackingProvider, LabelHistoryCapable {
  private readonly outputDir: string;
  private readonly issuesDir: string;
  private readonly statePath: string;
  private readonly log: Logger;

  constructor(config: FileIssueTrackingConfig) {
    this.outputDir = path.resolve(config.outputDir);
    this.issuesDir = path.join(this.outputDir, "issues");
    this.statePath = path.join(this.outputDir, "state.json");
    this.log = config.logger ?? consoleLogger;
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private readState(): State {
    try {
      return JSON.parse(readFileSync(this.statePath, "utf-8")) as State;
    } catch {
      return { nextIssueNumber: 1, issues: [] };
    }
  }

  private writeState(state: State): void {
    writeFileSync(this.statePath, JSON.stringify(state, null, 2), "utf-8");
  }

  private toIssue(rec: IssueRecord): Issue {
    const filePath = path.join(this.issuesDir, `${rec.identifier}.md`);
    return {
      id: rec.id,
      identifier: rec.identifier,
      title: rec.title,
      url: `file://${filePath}`,
      branchName: rec.branchName,
      state: rec.state,
    };
  }

  private writeIssueMd(rec: IssueRecord): void {
    const labels = rec.labels.length > 0 ? rec.labels.join(", ") : "—";
    const lines = [
      `# ${rec.identifier}: ${rec.title}`,
      "",
      "| Field | Value |",
      "|-------|-------|",
      `| **Identifier** | ${rec.identifier} |`,
      `| **Status** | ${rec.state} |`,
      `| **Priority** | P${rec.priority} |`,
      `| **Labels** | ${labels} |`,
      `| **Created** | ${rec.createdAt} |`,
      `| **Branch** | \`${rec.branchName}\` |`,
      "",
      "## Description",
      "",
      rec.description || "_No description provided._",
    ];

    if (rec.comments.length > 0) {
      lines.push("", "---", "");
      for (const comment of rec.comments) {
        lines.push(`### Comment`, "", comment, "");
      }
    }

    const filePath = path.join(this.issuesDir, `${rec.identifier}.md`);
    writeFileSync(filePath, lines.join("\n"), "utf-8");
  }

  // ── IssueTrackingProvider ────────────────────────────────────────────

  async verifyAccess(): Promise<void> {
    mkdirSync(this.issuesDir, { recursive: true });
    // ensure state file exists
    const state = this.readState();
    this.writeState(state);
    this.log.info("File issue tracker access verified");
  }

  async createIssue(opts: IssueCreateOptions): Promise<Issue> {
    const state = this.readState();
    const num = state.nextIssueNumber;
    state.nextIssueNumber = num + 1;

    const rec: IssueRecord = {
      id: `local-${num}`,
      identifier: `LOCAL-${num}`,
      number: num,
      title: opts.title,
      state: opts.stateId ?? "open",
      description: opts.description ?? "",
      labels: opts.labels ?? [],
      priority: opts.priority ?? 2,
      branchName: `local-${num}-triage-fix`,
      createdAt: new Date().toISOString(),
      comments: [],
    };

    state.issues.push(rec);
    this.writeState(state);
    this.writeIssueMd(rec);

    this.log.info(`Created issue ${rec.identifier}: ${rec.title}`);
    return this.toIssue(rec);
  }

  async getIssue(identifier: string): Promise<Issue> {
    const state = this.readState();
    const upper = identifier.toUpperCase();
    const rec = state.issues.find((i) => i.identifier === upper || i.id === identifier);
    if (!rec) throw new Error(`Issue not found: ${identifier}`);
    return this.toIssue(rec);
  }

  async updateIssue(issueId: string, opts: IssueUpdateOptions): Promise<void> {
    const state = this.readState();
    const rec = state.issues.find((i) => i.id === issueId);
    if (!rec) {
      this.log.warn(`Issue not found for update: ${issueId}`);
      return;
    }
    if (opts.stateId) rec.state = opts.stateId;
    if (opts.description) rec.description = opts.description;
    if (opts.comment) rec.comments.push(opts.comment);
    this.writeState(state);
    this.writeIssueMd(rec);
    this.log.info(`Updated issue ${rec.identifier}`);
  }

  async searchIssues(opts: IssueSearchOptions): Promise<Issue[]> {
    const state = this.readState();
    const query = opts.query.toLowerCase();
    return state.issues
      .filter((i) => {
        if (!i.title.toLowerCase().includes(query)) return false;
        if (opts.labels && opts.labels.length > 0) {
          const hasLabel = opts.labels.some((l) => i.labels.includes(l));
          if (!hasLabel) return false;
        }
        return true;
      })
      .map((i) => this.toIssue(i));
  }

  async addComment(issueId: string, body: string): Promise<void> {
    const state = this.readState();
    const rec = state.issues.find((i) => i.id === issueId);
    if (!rec) {
      this.log.warn(`Issue not found for comment: ${issueId}`);
      return;
    }
    rec.comments.push(body);
    this.writeState(state);
    this.writeIssueMd(rec);
    this.log.info(`Added comment to ${rec.identifier}`);
  }

  // ── LabelHistoryCapable ──────────────────────────────────────────────

  async searchIssuesByLabel(
    _projectId: string,
    labelId: string,
    opts?: { days?: number },
  ): Promise<IssueHistoryEntry[]> {
    const days = opts?.days ?? 30;
    const state = this.readState();
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    return state.issues
      .filter((i) => i.createdAt >= cutoff && i.labels.includes(labelId))
      .map((i) => ({
        identifier: i.identifier,
        title: i.title,
        state: i.state,
        stateType: i.state === "open" ? "started" : "completed",
        url: `file://${path.join(this.issuesDir, `${i.identifier}.md`)}`,
        descriptionSnippet: i.description.slice(0, 200) || null,
        createdAt: i.createdAt,
        labels: i.labels,
      }));
  }
}
