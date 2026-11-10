/**
 * #598: safe by default.
 *
 * Spec v2: a node that declares no permissions and no outputs, in a workflow
 * that declares no permissions, is read-only. Spec v1 keeps `write`, and the
 * loader names every node that writes only because nothing limits it.
 * `sweny workflow upgrade` writes that v1 `write` out explicitly, never more.
 * Every bundled template is v2 and writes only where a node declares it, and
 * the pr-review template has no way to approve a pull request.
 */
import { describe, it, expect } from "vitest";
import { mkdtempSync, readdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

import { approveDirectiveWarnings, defaultNodeAccess, hasNodePolicy, resolveNodePermissions } from "../node-policy.js";
import {
  CURRENT_SPEC_VERSION,
  effectiveSpecVersion,
  implicitWriteWarning,
  migrateWorkflow,
  type RawWorkflow,
} from "../migrations.js";
import { canonicalHash, workflowHashOf } from "../journal.js";
import { loadAndValidateWorkflow, validateParsed } from "../loader.js";
import { upgradeWorkflowFile } from "../cli/workflow-upgrade.js";
import { WORKFLOW_TEMPLATES } from "../cli/templates.js";
import { execute } from "../executor.js";
import { buildSystemPrompt, buildWorkflow, refineWorkflow } from "../workflow-builder.js";
import { createSkillMap, github } from "../skills/index.js";
import type { Claude, Node, NodeResult, Skill, Tool, Workflow } from "../types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const silent = { info() {}, warn() {}, error() {}, debug() {} };

function tmpFile(name: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), "sweny-safe-default-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

// ─── Default access ──────────────────────────────────────────────

describe("default node access by spec_version", () => {
  it("is write for v1 and for a workflow with no spec_version, read from v2 on", () => {
    expect(defaultNodeAccess({})).toBe("write");
    expect(defaultNodeAccess({ spec_version: "1" })).toBe("write");
    expect(defaultNodeAccess({ spec_version: "2" })).toBe("read");
    expect(defaultNodeAccess({ spec_version: "3" })).toBe("read");
  });

  type Row = [string, Pick<Node, "permissions" | "outputs">, Pick<Workflow, "permissions" | "spec_version">, string];
  const rows: Row[] = [
    ["v2, nothing declared", {}, { spec_version: "2" }, "read"],
    ["v2, node write", { permissions: "write" }, { spec_version: "2" }, "write"],
    ["v2, node object without access", { permissions: { deny: ["shell"] } }, { spec_version: "2" }, "read"],
    ["v2, workflow write", {}, { spec_version: "2", permissions: "write" }, "write"],
    [
      "v2, workflow read ceiling over node write",
      { permissions: "write" },
      { spec_version: "2", permissions: "read" },
      "read",
    ],
    ["v2, outputs", { outputs: [{ type: "comment" }] }, { spec_version: "2" }, "read"],
    ["v1, nothing declared", {}, { spec_version: "1" }, "write"],
    ["no spec_version, nothing declared", {}, {}, "write"],
    ["v1, workflow read", {}, { spec_version: "1", permissions: "read" }, "read"],
    ["v1, outputs", { outputs: [{ type: "comment" }] }, { spec_version: "1" }, "read"],
  ];
  it.each(rows)("%s -> access %s", (_label, node, workflow, access) => {
    expect(resolveNodePermissions(node, workflow).access).toBe(access);
  });

  it("a v2 node with nothing declared runs under a policy; a v1 one keeps the harness defaults", () => {
    expect(hasNodePolicy({}, { spec_version: "2" })).toBe(true);
    expect(hasNodePolicy({}, { spec_version: "1" })).toBe(false);
    expect(hasNodePolicy({}, {})).toBe(false);
    expect(hasNodePolicy({ permissions: "write" }, {})).toBe(true);
  });
});

// ─── v1 -> v2 migration ──────────────────────────────────────────

/** One node per case the migration distinguishes. */
const V1: RawWorkflow = {
  id: "mixed",
  name: "Mixed",
  entry: "a",
  nodes: {
    a: { name: "A", instruction: "a", skills: ["github"] },
    b: { name: "B", instruction: "b", skills: [] },
    c: { name: "C", instruction: "c", skills: [], permissions: { deny: ["shell"] } },
    d: { name: "D", instruction: "d", skills: ["github"], permissions: "read" },
    e: { name: "E", instruction: "e", skills: ["github"], outputs: [{ type: "comment", number: 1 }] },
    f: { name: "F", instruction: "f", skills: [], permissions: { native: "none" } },
  },
  edges: [
    { from: "a", to: "b" },
    { from: "b", to: "c" },
    { from: "c", to: "d" },
    { from: "d", to: "e" },
    { from: "e", to: "f" },
  ],
};

const V1_YAML = `# My workflow
id: mixed
name: Mixed
entry: a
nodes:
  a:
    name: A
    instruction: a
    skills: [github]
  b:
    name: B
    instruction: b
    skills: []
  c:
    name: C
    instruction: c
    skills: []
    permissions:
      deny: [shell]
  d:
    name: D
    instruction: d
    skills: [github]
    permissions: read
  e:
    name: E
    instruction: e
    skills: [github]
    outputs:
      - type: comment
        number: 1
  f:
    name: F
    instruction: f
    skills: []
    permissions:
      native: none
edges:
  - from: a
    to: b
  - from: b
    to: c
  - from: c
    to: d
  - from: d
    to: e
  - from: e
    to: f
`;

describe("spec v1 -> v2 migration", () => {
  it("the built-in registry reads v2 natively", () => {
    expect(CURRENT_SPEC_VERSION).toBe(2);
  });

  it("declares the v1 write on each node that relied on the default, and nothing else", () => {
    const before = JSON.stringify(V1);
    const r = migrateWorkflow(V1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(JSON.stringify(V1)).toBe(before); // pure
    const nodes = r.workflow.nodes as Record<string, Record<string, unknown>>;
    expect(r.workflow.spec_version).toBe("2");
    expect(nodes.a.permissions).toBe("write");
    expect(nodes.b.permissions).toBe("write");
    expect(nodes.c.permissions).toEqual({ deny: ["shell"], access: "write" });
    expect(nodes.d.permissions).toBe("read");
    expect(nodes.e.permissions).toBeUndefined();
    // No skills and no built-in tools: nothing for write to unlock.
    expect(nodes.f.permissions).toEqual({ native: "none", access: "read" });
  });

  it("keeps every node's effective permissions (never grants more), except a node with no tools at all", () => {
    const r = migrateWorkflow(V1);
    if (!r.ok) throw new Error(r.message);
    const v1 = V1 as unknown as Workflow;
    const v2 = r.workflow as unknown as Workflow;
    for (const id of ["a", "b", "c", "d", "e"]) {
      expect(resolveNodePermissions(v2.nodes[id], v2), id).toEqual(resolveNodePermissions(v1.nodes[id], v1));
    }
    // f has no skills and no built-in tools, so read takes nothing away.
    expect(resolveNodePermissions(v1.nodes.f, v1).access).toBe("write");
    expect(resolveNodePermissions(v2.nodes.f, v2)).toEqual({ access: "read", deny: [], strict: false, native: "none" });
  });

  it("notes each node it made explicit; warns only for the ones that can write", () => {
    const r = migrateWorkflow(V1);
    if (!r.ok) throw new Error(r.message);
    expect(r.notes.map((n) => n.nodeId)).toEqual(["a", "b", "c", "f"]);
    expect(r.notes.filter((n) => n.warning).map((n) => n.nodeId)).toEqual(["a", "b", "c"]);
    expect(r.notes.find((n) => n.nodeId === "c")?.path).toEqual(["nodes", "c", "permissions", "access"]);
    expect(r.notes.find((n) => n.nodeId === "a")?.path).toEqual(["nodes", "a", "permissions"]);
    expect(r.notes.find((n) => n.nodeId === "a")?.comment).toContain("its skills [github] may need their write tools");
    expect(r.notes.find((n) => n.nodeId === "b")?.comment).toContain("built-in shell and file edit tools");
  });

  it("a workflow-level access leaves every node alone", () => {
    for (const permissions of ["write", "read", { access: "write", deny: ["net"] }]) {
      const r = migrateWorkflow({ ...V1, permissions });
      if (!r.ok) throw new Error(r.message);
      expect(r.notes).toEqual([]);
      expect(r.workflow.nodes).toEqual(V1.nodes);
    }
  });

  it("a v2 file is not migrated", () => {
    const r = migrateWorkflow({ ...V1, spec_version: "2" });
    if (!r.ok) throw new Error(r.message);
    expect(r.applied).toEqual([]);
    expect(r.notes).toEqual([]);
  });
});

// ─── Loader warnings ─────────────────────────────────────────────

describe("loading a v1 file", () => {
  it("keeps write and warns once per node that can write because nothing limits it", () => {
    const f = tmpFile("wf.yml", V1_YAML);
    try {
      const r = loadAndValidateWorkflow(f.path);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      for (const id of ["a", "b", "c"]) {
        expect(
          r.warnings!.filter((w) => w.includes(`"${id}"`)),
          id,
        ).toEqual([implicitWriteWarning(id)]);
        expect(resolveNodePermissions(r.workflow.nodes[id], r.workflow).access).toBe("write");
      }
      for (const id of ["d", "e", "f"]) expect(r.warnings!.some((w) => w.includes(`Node "${id}"`))).toBe(false);
      // Plus the one file-level line that names the upgrade command.
      expect(r.warnings!.filter((w) => w.includes("migrated in memory"))).toHaveLength(1);
      expect(r.warnings).toHaveLength(4);
      expect(readFileSync(f.path, "utf-8")).toBe(V1_YAML); // the loader never writes
    } finally {
      f.cleanup();
    }
  });

  it("the warning says what to do", () => {
    expect(implicitWriteWarning("post")).toBe(
      'Node "post" can write because nothing limits it (spec_version "1" default). ' +
        "Declare permissions or outputs on it, or run `sweny workflow upgrade`.",
    );
  });

  it("the same nodes in a v2 file load read-only, with no warning", () => {
    const r = validateParsed({ ...V1, spec_version: "2" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.warnings).toBeUndefined();
    for (const id of ["a", "b"]) expect(resolveNodePermissions(r.workflow.nodes[id], r.workflow).access).toBe("read");
  });
});

// ─── sweny workflow upgrade ──────────────────────────────────────

describe("sweny workflow upgrade to v2", () => {
  it("writes the explicit permissions with a comment on each, and reloads clean and identical", () => {
    const f = tmpFile("wf.yml", V1_YAML);
    try {
      const inMemory = loadAndValidateWorkflow(f.path);
      const r = upgradeWorkflowFile(f.path);
      expect(r.status).toBe("upgraded");
      if (r.status !== "upgraded") return;
      expect([r.from, r.to]).toEqual([1, 2]);
      expect(r.notes.map((n) => n.nodeId)).toEqual(["a", "b", "c", "f"]);

      const text = readFileSync(f.path, "utf-8");
      expect(text.startsWith('# My workflow\nspec_version: "2"\n')).toBe(true);
      expect(text.match(/# sweny workflow upgrade: /g)).toHaveLength(4);
      // The comment sits on the line right above the key it explains.
      const lines = text.split("\n");
      const aStart = lines.indexOf("  a:");
      const aPerm = lines.findIndex((l, i) => i > aStart && l.trim() === "permissions: write");
      expect(aStart).toBeGreaterThan(0);
      expect(aPerm).toBeGreaterThan(aStart);
      expect(lines.slice(aStart, aPerm).some((l) => l.trim() === "b:")).toBe(false);
      expect(lines[aPerm - 1]).toContain("# sweny workflow upgrade: write, kept from spec v1");

      const parsed = parseYaml(text);
      expect(parsed.nodes.a.permissions).toBe("write");
      expect(parsed.nodes.c.permissions).toEqual({ deny: ["shell"], access: "write" });
      expect(parsed.nodes.e.permissions).toBeUndefined();

      const reloaded = loadAndValidateWorkflow(f.path);
      expect(inMemory.ok && reloaded.ok).toBe(true);
      if (inMemory.ok && reloaded.ok) {
        expect(reloaded.warnings).toBeUndefined();
        expect(reloaded.workflow).toEqual(inMemory.workflow);
      }
      expect(upgradeWorkflowFile(f.path).status).toBe("current");
    } finally {
      f.cleanup();
    }
  });

  it("JSON files get the same permissions and return the notes", () => {
    const f = tmpFile("wf.json", JSON.stringify(V1));
    try {
      const r = upgradeWorkflowFile(f.path);
      expect(r.status).toBe("upgraded");
      if (r.status === "upgraded") expect(r.notes.filter((n) => n.warning)).toHaveLength(3);
      const out = JSON.parse(readFileSync(f.path, "utf-8"));
      expect(out.spec_version).toBe("2");
      expect(out.nodes.a.permissions).toBe("write");
    } finally {
      f.cleanup();
    }
  });
});

// ─── execute() ───────────────────────────────────────────────────

function fakeGithub(writes: string[]): Skill {
  const tool = (name: string, access: "read" | "write"): Tool => ({
    name,
    description: name,
    input_schema: { type: "object" },
    access,
    handler: async () => {
      if (access === "write") writes.push(name);
      return { ok: true };
    },
  });
  return {
    id: "github",
    name: "GitHub",
    description: "",
    category: "git",
    config: {},
    tools: [tool("github_get_issue", "read"), tool("github_add_comment", "write")],
  };
}

async function runOne(top: Partial<Workflow>) {
  const writes: string[] = [];
  const runs: Parameters<Claude["run"]>[0][] = [];
  const claude: Claude = {
    async run(opts) {
      runs.push(opts);
      for (const t of opts.tools) await t.handler({}, { config: {}, logger: silent });
      return { status: "success", data: { summary: "ok" }, toolCalls: [] } as NodeResult;
    },
    async evaluate() {
      throw new Error("no routing");
    },
    async ask() {
      return "";
    },
  };
  const workflow: Workflow = {
    id: "w",
    name: "W",
    description: "",
    entry: "n",
    nodes: { n: { name: "N", instruction: "Do it", skills: ["github"] } },
    edges: [],
    ...top,
  };
  await execute(workflow, {}, { skills: createSkillMap([fakeGithub(writes)]), claude, config: {}, logger: silent });
  return { opts: runs[0], writes };
}

describe("execute(): a node with nothing declared", () => {
  it("spec v2: read-only, with a read-only policy for the harness and no write tool", async () => {
    const { opts, writes } = await runOne({ spec_version: "2" });
    expect(opts.tools.map((t) => t.name)).toEqual(["github_get_issue"]);
    expect(opts.readOnly).toBe(true);
    expect(opts.policy?.readOnly).toBe(true);
    expect(writes).toEqual([]);
  });

  it("no spec_version (v1): unchanged, write tools and no policy", async () => {
    const { opts, writes } = await runOne({});
    expect(opts.tools.map((t) => t.name)).toEqual(["github_get_issue", "github_add_comment"]);
    expect(opts.readOnly).toBeUndefined();
    expect(opts.policy).toBeUndefined();
    expect(writes).toEqual(["github_add_comment"]);
  });
});

// ─── Bundled templates ───────────────────────────────────────────

/**
 * The nodes in each template that may write. Every other node is read-only.
 * A new template must be added here, with its writers named on purpose.
 */
const WRITERS: Record<string, string[]> = {
  "explain-repo": [],
  "weekly-digest": ["publish"],
  "dependency-drift": [],
  "pr-risk-review": [],
  "pr-review": [],
  "issue-triage": [],
  "security-scan": [],
  "release-notes": [],
  "content-pipeline": [],
  "url-monitor": ["compare-baseline", "alert-on-change"],
  "data-sync": ["fetch-records", "sync-target"],
  "seed-content": ["generate", "validate"],
};

const GITHUB_WRITE_TOOLS = github.tools.filter((t) => t.access !== "read").map((t) => t.name);

function load(yaml: string): Workflow {
  const r = validateParsed(parseYaml(yaml));
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  expect(r.warnings, "a bundled template loads with no warning").toBeUndefined();
  return r.workflow;
}

function ownAccess(node: Node): unknown {
  return typeof node.permissions === "string" ? node.permissions : node.permissions?.access;
}

describe("bundled templates are safe by default", () => {
  it("the writers table covers every template", () => {
    expect(Object.keys(WRITERS).sort()).toEqual(WORKFLOW_TEMPLATES.map((t) => t.id).sort());
  });

  describe.each(WORKFLOW_TEMPLATES.map((t) => [t.id, t] as const))("%s", (id, template) => {
    it("is spec_version 2 and loads without migration", () => {
      expect(parseYaml(template.yaml).spec_version).toBe("2");
      expect(load(template.yaml).spec_version).toBe("2");
    });

    it("writes only from the nodes in the table, and each of those declares write itself", () => {
      const wf = load(template.yaml);
      const writers = Object.entries(wf.nodes)
        .filter(([, node]) => resolveNodePermissions(node, wf).access === "write")
        .map(([nodeId]) => nodeId);
      expect(writers.sort()).toEqual([...WRITERS[id]].sort());
      for (const nodeId of writers) expect(ownAccess(wf.nodes[nodeId]), nodeId).toBe("write");
    });

    it("every GitHub write is a declared output: no write node can reach a GitHub write tool", () => {
      const wf = load(template.yaml);
      for (const [nodeId, node] of Object.entries(wf.nodes)) {
        if (resolveNodePermissions(node, wf).access !== "write" || !node.skills.includes("github")) continue;
        const allow = node.tools?.allow;
        expect(allow, `${nodeId} must restrict its tools`).toBeDefined();
        expect(
          allow!.filter((t) => GITHUB_WRITE_TOOLS.includes(t)),
          nodeId,
        ).toEqual([]);
      }
    });

    it("every output pinned to an issue or PR pins its repository too", () => {
      const wf = load(template.yaml);
      for (const [nodeId, node] of Object.entries(wf.nodes)) {
        for (const out of node.outputs ?? []) {
          if (out.number !== undefined) expect(out.target, `${nodeId} ${out.type}`).toEqual({ input: "repo" });
        }
      }
    });

    it("no node holds an agent credential", () => {
      const wf = load(template.yaml);
      for (const node of Object.values(wf.nodes)) expect(node.agent_env ?? []).toEqual([]);
    });
  });
});

describe("pr-review never approves", () => {
  const template = WORKFLOW_TEMPLATES.find((t) => t.id === "pr-review")!;

  it("every node is read-only", () => {
    const wf = load(template.yaml);
    expect(wf.permissions).toBe("read");
    for (const [nodeId, node] of Object.entries(wf.nodes)) {
      expect(resolveNodePermissions(node, wf).access, nodeId).toBe("read");
    }
  });

  it("its only write is one comment, pinned to the pull request input", () => {
    const wf = load(template.yaml);
    expect(wf.safe_outputs?.allow).toEqual(["comment"]);
    const outputs = Object.values(wf.nodes).flatMap((n) => n.outputs ?? []);
    expect(outputs).toEqual([{ type: "comment", max: 1, number: { input: "pr_number" }, target: { input: "repo" } }]);
  });

  it("never tells the agent to approve, and the github skill has no approve tool", () => {
    const mentions = template.yaml.split("\n").filter((l) => /approv/i.test(l));
    expect(mentions.length).toBeGreaterThan(0);
    for (const line of mentions) expect(line, line).toMatch(/never/i);
    expect(github.tools.filter((t) => /approv|review/i.test(t.name))).toEqual([]);
  });
});

// ─── Journal binding ─────────────────────────────────────────────

describe("the journal hash binds the version the policy runs as", () => {
  const base = { id: "w", name: "W", description: "", entry: "a", nodes: {}, edges: [] } as unknown as Workflow;
  it.each([
    ["missing", undefined, "1", "write"],
    ['"1"', "1", "1", "write"],
    ['"2"', "2", "2", "read"],
  ])("spec_version %s: hashed as %s, default access %s", (_label, declared, hashed, access) => {
    const wf = declared === undefined ? base : { ...base, spec_version: declared };
    expect(String(effectiveSpecVersion(wf))).toBe(hashed);
    expect(workflowHashOf(wf)).toBe(canonicalHash({ ...wf, spec_version: hashed }));
    expect(defaultNodeAccess(wf)).toBe(access);
  });
  it("a missing version and v1 are the same workflow for resume; v2 is not", () => {
    expect(workflowHashOf(base)).toBe(workflowHashOf({ ...base, spec_version: "1" }));
    expect(workflowHashOf(base)).not.toBe(workflowHashOf({ ...base, spec_version: "2" }));
  });
});

// ─── Shipped and linked workflow files ───────────────────────────

const REPO = join(__dirname, "..", "..", "..", "..");
const SHIPPED_DIRS = [join(REPO, "examples"), join(__dirname, "..", "workflows")];

describe("every workflow file we ship or link loads with zero warnings", () => {
  const files = SHIPPED_DIRS.flatMap((dir) =>
    readdirSync(dir)
      .filter((f) => /\.ya?ml$/.test(f))
      .map((f) => join(dir, f)),
  );
  it("finds the examples and the bundled workflows", () => {
    expect(files.length).toBeGreaterThanOrEqual(6);
  });
  it.each(files)("%s", (file) => {
    const r = loadAndValidateWorkflow(file);
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
    expect(r.workflow.spec_version).toBe("2");
    expect(r.warnings).toBeUndefined();
  });

  /** The nodes in each shipped file that may write. Every other node is read-only. */
  const SHIPPED_WRITERS: Record<string, string[]> = {
    "file-ops.yml": ["write", "delete"],
    "monitor.yml": ["compare-baseline"],
    "data-sync.yml": [],
    "triage.yml": ["implement", "create_pr", "notify"],
    "implement.yml": ["implement", "create_pr", "notify"],
    "seed-content.yml": ["generate", "validate"],
  };

  it("the writers table covers every shipped file", () => {
    expect(Object.keys(SHIPPED_WRITERS).sort()).toEqual(files.map((f) => f.split("/").pop()!).sort());
  });

  it.each(files)("%s: writes only from the nodes in the table, each declaring write itself", (file) => {
    const r = loadAndValidateWorkflow(file);
    if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
    const wf = r.workflow;
    const writers = Object.entries(wf.nodes)
      .filter(([, node]) => resolveNodePermissions(node, wf).access === "write")
      .map(([nodeId]) => nodeId);
    expect(writers.sort()).toEqual([...SHIPPED_WRITERS[file.split("/").pop()!]].sort());
    for (const nodeId of writers) expect(ownAccess(wf.nodes[nodeId]), nodeId).toBe("write");
  });

  it.each(["triage.yml", "implement.yml"])(
    "%s: notify writes only its notification (no shell, network, subagents)",
    (name) => {
      const r = loadAndValidateWorkflow(join(__dirname, "..", "workflows", name));
      if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
      const notify = r.workflow.nodes.notify;
      expect(notify.skills.sort()).toEqual(["notification", "slack"]);
      expect(resolveNodePermissions(notify, r.workflow).deny.sort()).toEqual(["net", "shell", "subagent"]);
    },
  );
});

// ─── Approve directives in old review workflows ──────────────────

/** The pr-review template as `sweny new` wrote it before #598. */
const OLD_PR_REVIEW = `id: pr-review
name: PR Review Bot
description: Review pull requests for code quality, security issues, and best practices.
workflow_type: pr_review
entry: fetch-diff

nodes:
  fetch-diff:
    name: Fetch PR Changes
    instruction: |
      Fetch the pull request diff. Identify which files changed,
      what was added, modified, or removed. Summarize the scope
      of the change.
    skills: [github]

  post-review:
    name: Post Review Comment
    instruction: |
      Post a structured review comment on the pull request.
      Lead with a summary, then list findings by severity.
      If no issues found, approve with a brief note.
    skills: [github]

edges:
  - from: fetch-diff
    to: post-review
`;

describe("a review node told to approve", () => {
  it("the old pr-review template warns once, naming the node and the line, and still does after upgrade", () => {
    const f = tmpFile("pr-review.yml", OLD_PR_REVIEW);
    try {
      for (const stage of ["v1", "upgraded"]) {
        if (stage === "upgraded") expect(upgradeWorkflowFile(f.path).status).toBe("upgraded");
        const r = loadAndValidateWorkflow(f.path);
        if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
        const approve = (r.warnings ?? []).filter((w) => w.includes("tells the agent to approve"));
        expect(approve, stage).toHaveLength(1);
        expect(approve[0]).toContain('Node "post-review"');
        expect(approve[0]).toContain("If no issues found, approve with a brief note.");
      }
    } finally {
      f.cleanup();
    }
  });

  const node = (instruction: string, permissions?: "read" | "write") => ({
    name: "N",
    instruction,
    skills: ["github"],
    ...(permissions ? { permissions } : {}),
  });
  const workflowWith = (n: Node, type?: string): Workflow =>
    ({
      id: "w",
      name: "W",
      description: "",
      spec_version: "2",
      ...(type ? { workflow_type: type } : {}),
      entry: "n",
      nodes: { n },
      edges: [],
    }) as Workflow;

  it.each([
    ["a read node", workflowWith(node("Approve the pull request."), "pr_review"), 0],
    ["a negated line", workflowWith(node("Never approve the pull request.", "write"), "pr_review"), 0],
    ["no review context", workflowWith(node("Approve the expense report.", "write")), 0],
    ["a write review node", workflowWith(node("Review the PR.\nApprove it if clean.", "write")), 1],
    ["inline source", workflowWith(node({ inline: "Approve it." } as never, "write"), "pr_review"), 1],
  ])("%s -> %i warning(s)", (_label, wf, count) => {
    expect(approveDirectiveWarnings(wf)).toHaveLength(count);
  });

  it("no bundled template warns", () => {
    for (const t of WORKFLOW_TEMPLATES) expect(approveDirectiveWarnings(load(t.yaml)), t.id).toEqual([]);
  });
});

// ─── AI-generated workflows ──────────────────────────────────────

describe("workflows the builder generates", () => {
  const generated = {
    id: "gen",
    name: "Generated",
    description: "",
    entry: "a",
    nodes: { a: { name: "A", instruction: "Look at the repo.", skills: [] } },
    edges: [],
  };
  const claudeReturning = (data: Record<string, unknown>): Claude => ({
    async run() {
      return { status: "success", data, toolCalls: [] } as NodeResult;
    },
    async evaluate() {
      throw new Error("no routing");
    },
    async ask() {
      return "";
    },
  });

  it("a new workflow is the current spec version, whatever the model said, so it starts read-only", async () => {
    for (const data of [generated, { ...generated, spec_version: "1" }]) {
      const wf = await buildWorkflow("explain the repo", { claude: claudeReturning(data), skills: [] });
      expect(wf.spec_version).toBe(String(CURRENT_SPEC_VERSION));
      expect(resolveNodePermissions(wf.nodes.a, wf).access).toBe("read");
    }
  });

  it("a refined workflow keeps the version it had", async () => {
    const v1 = { ...generated } as Workflow;
    const refined = await refineWorkflow(v1, "rename it", {
      claude: claudeReturning({ ...generated, spec_version: "2" }),
      skills: [],
    });
    expect(refined.spec_version).toBeUndefined();
    expect(resolveNodePermissions(refined.nodes.a, refined).access).toBe("write");
  });

  it("the builder prompt says nodes are read-only unless they declare a write", () => {
    expect(buildSystemPrompt([])).toMatch(/read-only unless they declare otherwise/);
  });
});
