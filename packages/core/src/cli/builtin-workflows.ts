/**
 * Bind a built-in workflow (triage, implement) to the providers `sweny triage`
 * and `sweny implement` run with (#365).
 *
 * The bundled YAML is written for the exemplary case: analysis nodes are
 * `read`, and tracker and PR writes are safe outputs that the github or linear
 * skill applies after the node. Here the CLI pins each output to the tracker
 * the user configured (`via`) and to the repository (`target`), so a Linear key
 * in the environment never redirects a GitHub-issues user's issues, and back.
 *
 * Two setups cannot run that way. Each affected node keeps its pre-#365 shape,
 * and the CLI prints one notice naming the nodes and the reason:
 *
 *  - Reads that need the shell or an MCP server (a Jira or GitLab integration,
 *    an observability provider with no built-in skill, user MCP servers or
 *    workspace tools). A `read` node has neither, so the analysis nodes run
 *    write-capable with file edits and every skill write tool denied, as before.
 *  - Writes no safe-output skill can apply (a Jira or file tracker, GitLab or
 *    file source control). Those nodes use the tracker's own tools, as before.
 *
 * Pure: returns a new workflow, never mutates the input.
 */

import { builtinSkills } from "../skills/index.js";
import { resolveNodePermissions } from "../node-policy.js";
import type { Node, SafeOutputDeclaration, SafeOutputType, Workflow } from "../types.js";

export interface BuiltinProviders {
  /** `github-issues` | `linear` | `jira` | `file` */
  issueTracker: string;
  /** `github` | `gitlab` | `file` */
  sourceControl: string;
  observability: string[];
  /** `owner/repo`; pins GitHub outputs. */
  repository?: string;
  /** User-configured MCP servers (`SWENY_MCP_SERVERS`). */
  userMcpServers?: string[];
  workspaceTools?: string[];
}

export interface BoundWorkflow {
  workflow: Workflow;
  /** One line per fallback, for the CLI to print. Empty when every node runs as written. */
  notes: string[];
}

/** Observability providers a read-only node can reach: a built-in skill, or a local log file (Read). */
const SKILL_OBSERVABILITY = new Set(["sentry", "datadog", "betterstack", "file"]);

/** Trackers whose issues and comments a safe-output skill applies. */
const TRACKER_SKILL: Record<string, string> = { "github-issues": "github", linear: "linear" };

/** Skill write tools a legacy node keeps for each output type it declared. */
const LEGACY_WRITE_TOOLS: Record<SafeOutputType, string[]> = {
  issue: ["github_create_issue", "linear_create_issue"],
  // Reopening a closed duplicate goes with the +1 comment.
  comment: ["github_add_comment", "linear_add_comment", "linear_update_issue"],
  pr: ["github_create_pr"],
  label: ["github_add_labels"],
};

const writeToolsBySkill = new Map(
  builtinSkills.map((s) => [s.id, s.tools.filter((t) => t.access !== "read").map((t) => t.name)]),
);

function skillWriteTools(node: Node): string[] {
  return node.skills.flatMap((id) => writeToolsBySkill.get(id) ?? []);
}

function union(...lists: (string[] | undefined)[]): string[] {
  return [...new Set(lists.flatMap((l) => l ?? []))];
}

/** What a read-only node could not reach for these providers. Empty when it reaches everything. */
export function readGaps(p: BuiltinProviders): string[] {
  const gaps: string[] = [];
  for (const o of p.observability) if (!SKILL_OBSERVABILITY.has(o)) gaps.push(o);
  if (!(p.issueTracker in TRACKER_SKILL) && p.issueTracker !== "file") gaps.push(p.issueTracker);
  if (p.sourceControl !== "github") gaps.push(`${p.sourceControl} source control`);
  if ((p.userMcpServers ?? []).length > 0) gaps.push("user MCP servers");
  if ((p.workspaceTools ?? []).length > 0) gaps.push("workspace tools");
  return [...new Set(gaps)];
}

/** The skill that applies this output type for these providers, or undefined when none can. */
export function outputSkill(type: SafeOutputType, p: BuiltinProviders): string | undefined {
  if (type === "issue" || type === "comment") return TRACKER_SKILL[p.issueTracker];
  return p.sourceControl === "github" ? "github" : undefined;
}

/** A read node that needs the shell or MCP: write-capable, but no file edits and no skill write tool. */
function legacyRead(node: Node): Node {
  return {
    ...node,
    permissions: { access: "write", deny: ["write", "edit"] },
    tools: { ...(node.tools ?? {}), deny: union(node.tools?.deny, skillWriteTools(node)) },
  };
}

/** An output node whose writes no safe-output skill can apply: the tracker's own tools, as before. */
function legacyWrite(node: Node): Node {
  const { outputs, ...rest } = node;
  const keep = new Set((outputs ?? []).flatMap((o) => LEGACY_WRITE_TOOLS[o.type]));
  const deny = union(node.tools?.deny, skillWriteTools(node)).filter((t) => !keep.has(t));
  const tools = node.tools?.allow
    ? { allow: node.tools.allow, ...(deny.length > 0 ? { deny } : {}) }
    : deny.length > 0
      ? { deny }
      : undefined;
  const { tools: _old, ...base } = rest;
  return { ...base, permissions: "write", ...(tools ? { tools } : {}) };
}

function bindOutput(o: SafeOutputDeclaration, p: BuiltinProviders): SafeOutputDeclaration {
  const via = o.via ?? outputSkill(o.type, p);
  const target = o.target ?? (via === "github" && p.repository ? p.repository : undefined);
  return { ...o, ...(via ? { via } : {}), ...(target ? { target } : {}) };
}

export function bindBuiltinWorkflow(workflow: Workflow, p: BuiltinProviders): BoundWorkflow {
  const gaps = readGaps(p);
  const legacyReads: string[] = [];
  const legacyWrites: string[] = [];
  const unsupported = new Set<string>();
  const nodes: Record<string, Node> = {};

  for (const [id, node] of Object.entries(workflow.nodes)) {
    const outputs = node.outputs ?? [];
    const access = resolveNodePermissions(node, workflow).access;
    const missing = outputs.filter((o) => !outputSkill(o.type, p));
    if (missing.length > 0) {
      for (const o of missing)
        unsupported.add(o.type === "pr" || o.type === "label" ? p.sourceControl : p.issueTracker);
      legacyWrites.push(id);
      nodes[id] = legacyWrite(node);
    } else if (outputs.length > 0) {
      nodes[id] = { ...node, outputs: outputs.map((o) => bindOutput(o, p)) };
    } else if (access === "read" && gaps.length > 0) {
      legacyReads.push(id);
      nodes[id] = legacyRead(node);
    } else {
      nodes[id] = node;
    }
  }

  const notes: string[] = [];
  if (legacyReads.length > 0) {
    notes.push(
      `${legacyReads.join(", ")} run write-capable (file edits and write tools still denied): ` +
        `a read-only step cannot reach ${gaps.join(", ")}`,
    );
  }
  if (legacyWrites.length > 0) {
    notes.push(
      `${legacyWrites.join(", ")} write through the tracker's own tools: ` +
        `no safe-output skill writes to ${[...unsupported].join(", ")}`,
    );
  }
  return { workflow: { ...workflow, nodes }, notes };
}
