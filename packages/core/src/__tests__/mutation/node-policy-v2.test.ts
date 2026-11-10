/**
 * #611: node-policy.ts after spec v2 safe defaults (#607). Pins the v1 vs v2
 * default access, hasNodePolicy, outputs-imply-read, the workflow ceiling, the
 * deny/strict/native merge and the approve-directive warning with exact values.
 * Lives in mutation/ so the Stryker run (vitest.mutation.config.ts) executes it.
 */
import { describe, expect, it } from "vitest";
import {
  approveDirectiveWarnings,
  defaultNodeAccess,
  hasNodePolicy,
  resolveNodePermissions,
} from "../../node-policy.js";
import type { Workflow } from "../../types.js";

const OUT = [{ type: "comment" }] as never;

describe("defaultNodeAccess", () => {
  it("is write with no spec_version and for v1", () => {
    expect(defaultNodeAccess({})).toBe("write");
    expect(defaultNodeAccess()).toBe("write");
    expect(defaultNodeAccess({ spec_version: "1" })).toBe("write");
  });

  it("is read for v2 exactly and for later versions", () => {
    expect(defaultNodeAccess({ spec_version: "2" })).toBe("read");
    expect(defaultNodeAccess({ spec_version: "3" })).toBe("read");
  });
});

describe("hasNodePolicy", () => {
  it("is false only for a v1 / unversioned node declaring nothing", () => {
    expect(hasNodePolicy({})).toBe(false);
    expect(hasNodePolicy({}, {})).toBe(false);
    expect(hasNodePolicy({}, { spec_version: "1" })).toBe(false);
    expect(hasNodePolicy({ outputs: [] }, { spec_version: "1" })).toBe(false);
  });

  it("is true for a v2 node declaring nothing (the read default is a policy)", () => {
    expect(hasNodePolicy({}, { spec_version: "2" })).toBe(true);
    expect(hasNodePolicy({ outputs: [] }, { spec_version: "2" })).toBe(true);
  });

  it("is true when the node declares permissions, even v1", () => {
    expect(hasNodePolicy({ permissions: "write" }, { spec_version: "1" })).toBe(true);
    expect(hasNodePolicy({ permissions: { deny: [] } }, {})).toBe(true);
  });

  it("is true when the workflow declares permissions, even v1", () => {
    expect(hasNodePolicy({}, { spec_version: "1", permissions: "write" })).toBe(true);
    expect(hasNodePolicy({}, { permissions: { strict: false } })).toBe(true);
  });

  it("is true when the node declares outputs, even v1", () => {
    expect(hasNodePolicy({ outputs: OUT }, { spec_version: "1" })).toBe(true);
    expect(hasNodePolicy({ outputs: OUT })).toBe(true);
  });
});

describe("resolveNodePermissions: spec version defaults", () => {
  it("v1 and unversioned nodes with nothing declared are write", () => {
    expect(resolveNodePermissions({}, {})).toStrictEqual({ access: "write", deny: [], strict: false });
    expect(resolveNodePermissions({}, { spec_version: "1" }).access).toBe("write");
  });

  it("v2 nodes with nothing declared are read", () => {
    expect(resolveNodePermissions({}, { spec_version: "2" })).toStrictEqual({
      access: "read",
      deny: [],
      strict: false,
    });
  });

  it("a v2 node that only narrows deny is still read", () => {
    const r = resolveNodePermissions({ permissions: { deny: ["shell"] } }, { spec_version: "2" });
    expect(r).toStrictEqual({ access: "read", deny: ["shell"], strict: false });
  });

  it("v2 still honors an explicit node or workflow write", () => {
    expect(resolveNodePermissions({ permissions: "write" }, { spec_version: "2" }).access).toBe("write");
    expect(resolveNodePermissions({}, { spec_version: "2", permissions: "write" }).access).toBe("write");
    expect(resolveNodePermissions({}, { spec_version: "2", permissions: { access: "write" } }).access).toBe("write");
  });

  it("a workflow object without access falls through to the version default", () => {
    expect(resolveNodePermissions({}, { spec_version: "2", permissions: { deny: ["net"] } }).access).toBe("read");
    expect(resolveNodePermissions({}, { spec_version: "1", permissions: { deny: ["net"] } }).access).toBe("write");
  });
});

describe("resolveNodePermissions: outputs imply read", () => {
  it("in v1, outputs make a node read instead of the write default", () => {
    expect(resolveNodePermissions({ outputs: OUT }, { spec_version: "1" }).access).toBe("read");
    expect(resolveNodePermissions({ outputs: OUT }, {}).access).toBe("read");
  });

  it("beats a workflow write", () => {
    expect(resolveNodePermissions({ outputs: OUT }, { permissions: "write" }).access).toBe("read");
    expect(resolveNodePermissions({ outputs: OUT }, { spec_version: "2", permissions: "write" }).access).toBe("read");
  });

  it("an explicit node write wins over outputs, in v1 and v2", () => {
    expect(resolveNodePermissions({ outputs: OUT, permissions: "write" }, { spec_version: "1" }).access).toBe("write");
    expect(resolveNodePermissions({ outputs: OUT, permissions: "write" }, { spec_version: "2" }).access).toBe("write");
  });

  it("an empty outputs list implies nothing", () => {
    expect(resolveNodePermissions({ outputs: [] }, { spec_version: "1" }).access).toBe("write");
    expect(resolveNodePermissions({ outputs: [] }, { permissions: "write" }).access).toBe("write");
  });
});

describe("resolveNodePermissions: workflow read ceiling", () => {
  it("wins over a node write in v1 and v2, string and object forms", () => {
    for (const spec_version of ["1", "2"]) {
      expect(resolveNodePermissions({ permissions: "write" }, { spec_version, permissions: "read" }).access).toBe(
        "read",
      );
      expect(
        resolveNodePermissions({ permissions: { access: "write" } }, { spec_version, permissions: { access: "read" } })
          .access,
      ).toBe("read");
    }
  });

  it("wins over a node write that also declares outputs", () => {
    expect(resolveNodePermissions({ outputs: OUT, permissions: "write" }, { permissions: "read" }).access).toBe("read");
  });

  it("a workflow write ceiling does not force a node to write", () => {
    expect(resolveNodePermissions({ permissions: "read" }, { permissions: "write" }).access).toBe("read");
  });
});

describe("resolveNodePermissions: deny, strict and native merge", () => {
  it("deny is the de-duplicated union, workflow entries first", () => {
    const r = resolveNodePermissions(
      { permissions: { deny: ["net", "shell"] } },
      { permissions: { deny: ["shell", "write"] } },
    );
    expect(r.deny).toStrictEqual(["shell", "write", "net"]);
  });

  it("deny passes through from one side only", () => {
    expect(resolveNodePermissions({ permissions: { deny: ["edit"] } }).deny).toStrictEqual(["edit"]);
    expect(resolveNodePermissions({}, { permissions: { deny: ["subagent"] } }).deny).toStrictEqual(["subagent"]);
    expect(resolveNodePermissions({ permissions: "read" }, { permissions: "read" }).deny).toStrictEqual([]);
  });

  it("strict is true when only the node, only the workflow, or both say so; false otherwise", () => {
    expect(resolveNodePermissions({ permissions: { strict: true } }).strict).toBe(true);
    expect(resolveNodePermissions({}, { permissions: { strict: true } }).strict).toBe(true);
    expect(resolveNodePermissions({ permissions: { strict: true } }, { permissions: { strict: true } }).strict).toBe(
      true,
    );
    expect(resolveNodePermissions({ permissions: { strict: false } }, { permissions: { strict: false } }).strict).toBe(
      false,
    );
    expect(resolveNodePermissions({}, {}).strict).toBe(false);
  });

  it("native none from either side sets native; otherwise the key is absent", () => {
    expect(resolveNodePermissions({ permissions: { native: "none" } })).toStrictEqual({
      access: "write",
      deny: [],
      strict: false,
      native: "none",
    });
    expect(resolveNodePermissions({}, { permissions: { native: "none" } }).native).toBe("none");
    expect(
      resolveNodePermissions({ permissions: { native: "none" } }, { permissions: { native: "none" } }).native,
    ).toBe("none");
    expect(
      "native" in
        resolveNodePermissions({ permissions: { native: "default" } }, { permissions: { native: "default" } }),
    ).toBe(false);
    expect("native" in resolveNodePermissions({}, {})).toBe(false);
  });
});

// ─── approveDirectiveWarnings ────────────────────────────────────

type InstructionNode = { name: string; instruction: unknown; skills: string[]; permissions?: "read" | "write" };

const node = (instruction: unknown, permissions?: "read" | "write"): InstructionNode => ({
  name: "N",
  instruction,
  skills: ["github"],
  ...(permissions ? { permissions } : {}),
});

const wf = (nodes: Record<string, InstructionNode>, extra: Record<string, unknown> = {}): Workflow =>
  ({
    id: "w",
    name: "W",
    description: "",
    entry: Object.keys(nodes)[0],
    nodes,
    edges: [],
    ...extra,
  }) as unknown as Workflow;

const message = (id: string, line: string) =>
  `Node "${id}" can write and its instruction tells the agent to approve ("${line}"). ` +
  "An AI reviewer should never approve: delete that line, and post the review as a comment output " +
  "(see `sweny new --template pr-review`).";

describe("approveDirectiveWarnings: what warns", () => {
  it("warns with the exact message for a write node in a pr_review workflow", () => {
    const w = wf({ n: node("Look at the diff.\nApprove it if clean.", "write") }, { workflow_type: "pr_review" });
    expect(approveDirectiveWarnings(w)).toStrictEqual([message("n", "Approve it if clean.")]);
  });

  it("an unversioned workflow's node defaults to write, so it warns", () => {
    expect(approveDirectiveWarnings(wf({ n: node("Review the PR. Approve it.") }))).toStrictEqual([
      message("n", "Review the PR. Approve it."),
    ]);
  });

  it("reports the trimmed matching line", () => {
    const w = wf({ n: node("Review it.\n    approve when clean   \nDone.", "write") });
    expect(approveDirectiveWarnings(w)).toStrictEqual([message("n", "approve when clean")]);
  });

  it("reports the first non-negated approve line, skipping negated ones and lines without approve", () => {
    const w = wf({
      n: node("Review the PR.\nNever approve a risky change.\nApprove if clean.\nApprove twice.", "write"),
    });
    expect(approveDirectiveWarnings(w)).toStrictEqual([message("n", "Approve if clean.")]);
  });

  it("an inline source is read; a file or url source is not", () => {
    expect(approveDirectiveWarnings(wf({ n: node({ inline: "Review it.\nApprove it." }, "write") }))).toStrictEqual([
      message("n", "Approve it."),
    ]);
    const pr = { workflow_type: "pr_review" };
    expect(approveDirectiveWarnings(wf({ n: node({ file: "approve.md" }, "write") }, pr))).toStrictEqual([]);
    expect(approveDirectiveWarnings(wf({ n: node({ url: "https://x.test/approve" }, "write") }, pr))).toStrictEqual([]);
  });

  it("lists one warning per offending node, in node order, naming each id", () => {
    const w = wf({
      first: node("Review the PR. Approve it.", "write"),
      quiet: node("Review the PR. Approve it.", "read"),
      second: node("Check the pull request.\nI approve.", "write"),
    });
    expect(approveDirectiveWarnings(w)).toStrictEqual([
      message("first", "Review the PR. Approve it."),
      message("second", "I approve."),
    ]);
  });

  it("an empty workflow has no warnings", () => {
    expect(approveDirectiveWarnings(wf({}))).toStrictEqual([]);
  });

  it("matches approve as a whole word only", () => {
    expect(approveDirectiveWarnings(wf({ n: node("Review the PR.\nApproved by the author.", "write") }))).toStrictEqual(
      [],
    );
    expect(approveDirectiveWarnings(wf({ n: node("Review the PR.\nDisapprove nothing.", "write") }))).toStrictEqual([]);
  });
});

describe("approveDirectiveWarnings: nodes that do not warn", () => {
  it("a node that is read by explicit permissions", () => {
    expect(
      approveDirectiveWarnings(wf({ n: node("Approve the PR.", "read") }, { workflow_type: "pr_review" })),
    ).toStrictEqual([]);
  });

  it("a node that is read by the v2 default", () => {
    expect(
      approveDirectiveWarnings(
        wf({ n: node("Review the PR. Approve it.") }, { spec_version: "2", workflow_type: "pr_review" }),
      ),
    ).toStrictEqual([]);
  });

  it("a node that declares outputs (read), even in v1", () => {
    const n = { ...node("Review the PR. Approve it."), outputs: OUT };
    expect(approveDirectiveWarnings(wf({ n }, { workflow_type: "pr_review" }))).toStrictEqual([]);
  });

  it("a node that asks for write under a workflow read ceiling", () => {
    const w = wf(
      { n: node("Review the PR. Approve it.", "write") },
      { permissions: "read", workflow_type: "pr_review" },
    );
    expect(approveDirectiveWarnings(w)).toStrictEqual([]);
  });

  it("a write node outside a review context (not pr_review, no PR or review words)", () => {
    expect(approveDirectiveWarnings(wf({ n: node("Approve the expense report.", "write") }))).toStrictEqual([]);
    expect(
      approveDirectiveWarnings(wf({ n: node("Approve the expense report.", "write") }, { workflow_type: "e2e_test" })),
    ).toStrictEqual([]);
  });

  it("a write node with no approve line", () => {
    expect(
      approveDirectiveWarnings(
        wf({ n: node("Review the PR and post a comment.", "write") }, { workflow_type: "pr_review" }),
      ),
    ).toStrictEqual([]);
  });
});

describe("approveDirectiveWarnings: review detection", () => {
  it("pr_review type alone is enough, with no review words in the instruction", () => {
    expect(
      approveDirectiveWarnings(wf({ n: node("Approve it.", "write") }, { workflow_type: "pr_review" })),
    ).toStrictEqual([message("n", "Approve it.")]);
  });

  it.each([
    ["pull request", "Approve the pull request."],
    ["pull requests", "Approve all pull requests."],
    ["PR", "Approve the PR."],
    ["PRs", "Approve the PRs."],
    ["review", "Approve after the review."],
    ["reviewer", "Approve as the reviewer."],
    ["Pull Request (case-insensitive)", "Approve the Pull Request."],
  ])("review words alone are enough (%s)", (_label, text) => {
    expect(approveDirectiveWarnings(wf({ n: node(text, "write") }))).toStrictEqual([message("n", text)]);
  });

  it("PR and review are whole words, not substrings", () => {
    expect(approveDirectiveWarnings(wf({ n: node("Approve the sprint.", "write") }))).toStrictEqual([]);
    expect(approveDirectiveWarnings(wf({ n: node("Approve the preview build.", "write") }))).toStrictEqual([]);
  });
});

describe("approveDirectiveWarnings: negation", () => {
  const negated = [
    "Never approve.",
    "Do not approve.",
    "Do not ever approve.",
    "Do not ever  approve.",
    "Never  approve.",
    "Never ever approve.",
    "Don't approve.",
    "Don't ever approve.",
    "Please do NOT approve.",
    "No approve.",
    "Nor approve.",
  ];
  it.each(negated)("a negated line does not warn: %s", (line) => {
    expect(approveDirectiveWarnings(wf({ n: node(`Review the PR.\n${line}`, "write") }))).toStrictEqual([]);
  });

  it("a negation on another line does not hide an approve line", () => {
    const w = wf({ n: node("Review the PR.\nNever merge.\nApprove it.", "write") });
    expect(approveDirectiveWarnings(w)).toStrictEqual([message("n", "Approve it.")]);
  });

  it("a negation of something else does not excuse approve", () => {
    const w = wf({ n: node("Review the PR.\nDo not wait, approve it.", "write") });
    expect(approveDirectiveWarnings(w)).toStrictEqual([message("n", "Do not wait, approve it.")]);
  });
});
