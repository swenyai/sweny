import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";
import { WORKFLOW_TEMPLATES } from "../cli/templates.js";
import { PACK_TEMPLATES } from "../cli/packs.js";
import { parseWorkflow, validateWorkflow } from "../schema.js";
import { builtinSkills } from "../skills/index.js";
import { resolveNodePermissions } from "../node-policy.js";
import type { Tool, Workflow } from "../types.js";

/**
 * #338: three recurring packs. Each must validate with no credentials, carry an
 * output schema and a gate on every node, stay read-only except its declared
 * delivery node, and be reachable from `sweny new` right after explain-repo.
 * #365: GitHub writes are declared safe outputs, never tools a node holds.
 */

const EM_DASH = String.fromCharCode(0x2014);
const PACK_IDS = ["weekly-digest", "dependency-drift", "pr-risk-review"];

const repoRoot = (() => {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    if (existsSync(join(dir, "PRIVACY.md")) && existsSync(join(dir, "ARCHITECTURE.md"))) return dir;
    dir = dirname(dir);
  }
  throw new Error("could not locate repo root from test file");
})();

const readme = readFileSync(join(repoRoot, "README.md"), "utf-8");
const docsPage = readFileSync(join(repoRoot, "packages/web/src/content/docs/workflows/packs.md"), "utf-8");

const skillTools = new Map<string, Tool[]>(builtinSkills.map((s) => [s.id, s.tools]));

/** The skill tools a node can actually call after `tools.allow` / `tools.deny`. */
function effectiveTools(node: Workflow["nodes"][string]): Tool[] {
  const all = node.skills.flatMap((id) => skillTools.get(id) ?? []);
  const allow = node.tools?.allow ? new Set(node.tools.allow) : null;
  const deny = new Set(node.tools?.deny ?? []);
  return all.filter((t) => (allow ? allow.has(t.name) : true) && !deny.has(t.name));
}

describe("recurring packs: registry", () => {
  it("ships exactly the three packs", () => {
    expect(PACK_TEMPLATES.map((t) => t.id)).toEqual(PACK_IDS);
  });

  it("appear in sweny new directly after explain-repo, in order", () => {
    const ids = WORKFLOW_TEMPLATES.map((t) => t.id);
    expect(ids[0]).toBe("explain-repo");
    expect(ids.slice(1, 1 + PACK_IDS.length)).toEqual(PACK_IDS);
  });

  it("every pack carries a trigger, a sample, and a token range", () => {
    for (const t of PACK_TEMPLATES) {
      expect(t.pack, t.id).toBeDefined();
      expect(t.pack!.trigger.trim().length, `${t.id} trigger`).toBeGreaterThan(0);
      expect(t.pack!.sample.trim().length, `${t.id} sample`).toBeGreaterThan(0);
      expect(t.pack!.tokens, `${t.id} tokens`).toMatch(/\d+k to \d+k/);
    }
  });
});

for (const template of PACK_TEMPLATES) {
  describe(`pack: ${template.id}`, () => {
    const raw = parse(template.yaml);
    const workflow = parseWorkflow(raw);
    const nodes = Object.entries(workflow.nodes);

    it("validates with no credentials (no env needed)", () => {
      expect(validateWorkflow(workflow)).toEqual([]);
      expect(workflow.id).toBe(template.id);
      expect(workflow.workflow_type).toBeDefined();
    });

    it("only references built-in skills that exist", () => {
      const known = new Set(builtinSkills.map((s) => s.id));
      for (const [id, node] of nodes) {
        for (const skill of node.skills) expect(known.has(skill), `${id} uses unknown skill ${skill}`).toBe(true);
      }
    });

    it("declares an output schema on every node", () => {
      for (const [id, node] of nodes) {
        const out = node.output as Record<string, any> | undefined;
        expect(out, `${id} has no output schema`).toBeDefined();
        expect(out!.type, `${id} output type`).toBe("object");
        expect(Object.keys(out!.properties ?? {}).length, `${id} output properties`).toBeGreaterThan(0);
        expect(Array.isArray(out!.required) && out!.required.length > 0, `${id} output required`).toBe(true);
        for (const key of out!.required as string[]) {
          expect(out!.properties, `${id}.${key} is required but not declared`).toHaveProperty(key);
        }
      }
    });

    it("gates every node with at least one value or function eval; at most one judge per pack", () => {
      let judges = 0;
      for (const [id, node] of nodes) {
        const evals = node.eval ?? [];
        expect(evals.length, `${id} has no eval`).toBeGreaterThan(0);
        expect(
          evals.some((e) => e.kind === "value" || e.kind === "function"),
          `${id} has only judge evals`,
        ).toBe(true);
        judges += evals.filter((e) => e.kind === "judge").length;
      }
      expect(judges).toBeLessThanOrEqual(1);
    });

    it("eval paths only name properties the output schema declares", () => {
      // A gate that names a path the schema never declares can never pass.
      for (const [id, node] of nodes) {
        const props = (node.output as any).properties as Record<string, any>;
        for (const e of node.eval ?? []) {
          const paths = [...(e.rule?.output_required ?? []), ...(e.rule?.output_matches ?? []).map((m) => m.path)];
          for (const p of paths) {
            const top = p
              .replace(/^(all|any):/, "")
              .split(".")[0]
              .replace(/\[\*\]$/, "");
            expect(props, `${id} eval '${e.name}' path '${p}' has no schema property '${top}'`).toHaveProperty(top);
          }
        }
      }
    });

    it("uses only read tools, except the declared delivery nodes", () => {
      const declared = template.pack!.writes;
      for (const [id, node] of nodes) {
        const writes = effectiveTools(node)
          .filter((t) => t.access === "write")
          .map((t) => t.name);
        if (declared[id]) {
          // A node allowed to write must say exactly which tools, via tools.allow.
          expect(node.tools?.allow, `${id} writes but has no tools.allow`).toBeDefined();
          for (const w of writes) expect(declared[id], `${id} may call undeclared write tool ${w}`).toContain(w);
        } else {
          expect(writes, `${id} is not a declared output node but can write`).toEqual([]);
        }
      }
    });

    it("declares a workflow permission ceiling and a safe_outputs policy (#365)", () => {
      expect(workflow.permissions, "workflow permissions ceiling").toBeDefined();
      expect(workflow.safe_outputs?.allow?.length, "safe_outputs.allow").toBeGreaterThan(0);
      expect(workflow.safe_outputs?.max, "safe_outputs.max").toBeGreaterThan(0);
    });

    it("holds no GitHub write tool anywhere: GitHub writes are declared outputs only (#365)", () => {
      const githubWrites = (skillTools.get("github") ?? []).filter((t) => t.access === "write").map((t) => t.name);
      for (const [id, node] of nodes) {
        const names = effectiveTools(node).map((t) => t.name);
        for (const w of githubWrites) expect(names, `${id} can call ${w}`).not.toContain(w);
      }
      const outputs = nodes.flatMap(([, n]) => n.outputs ?? []);
      expect(outputs.length).toBeGreaterThan(0);
      for (const o of outputs) {
        expect(o.max, `${o.type} max`).toBeDefined();
        if (o.type === "issue") {
          expect(o.title_prefix, "issue title_prefix").toBeDefined();
          expect(o.labels?.length, "issue labels").toBeGreaterThan(0);
        }
        expect(workflow.safe_outputs!.allow).toContain(o.type);
      }
    });

    it("every node is read-only except the declared delivery nodes (#365)", () => {
      const declared = template.pack!.writes;
      for (const [id, node] of nodes) {
        const access = resolveNodePermissions(node, workflow).access;
        expect(access, `${id} access`).toBe(declared[id] ? "write" : "read");
      }
    });

    it("declared write tools are real write tools on skills the node uses", () => {
      for (const [id, tools] of Object.entries(template.pack!.writes)) {
        const node = workflow.nodes[id];
        expect(node, `declared node ${id} does not exist`).toBeDefined();
        const available = new Map(node.skills.flatMap((s) => skillTools.get(s) ?? []).map((t) => [t.name, t]));
        for (const name of tools) {
          expect(available.get(name)?.access, `${id}.${name}`).toBe("write");
        }
      }
    });

    it("never opens a pull request or edits code", () => {
      for (const [id, node] of nodes) {
        expect(
          effectiveTools(node).map((t) => t.name),
          id,
        ).not.toContain("github_create_pr");
      }
    });

    it("is harness-agnostic: no agent-specific tool names or fields", () => {
      expect(template.yaml).not.toMatch(/\b(Bash|MultiEdit|NotebookEdit|WebFetch|WebSearch|Glob|Grep|TodoWrite)\b/);
      expect(template.yaml).not.toMatch(/claude/i);
      expect(template.yaml).not.toMatch(/disallowed_tools/);
    });

    it("bounds spend: every node sets max_turns", () => {
      for (const [id, node] of nodes) expect(node.max_turns, `${id} max_turns`).toBeGreaterThan(0);
    });

    it("has no em dashes anywhere in its copy", () => {
      const text = [template.yaml, template.pack!.trigger, template.pack!.sample, template.description].join("\n");
      expect(text).not.toContain(EM_DASH);
    });
  });
}

describe("recurring packs: GitHub Action triggers", () => {
  const byId = Object.fromEntries(PACK_TEMPLATES.map((t) => [t.id, parse(t.pack!.trigger)]));
  // Write scopes each trigger is allowed to request. Everything else must be read or unset.
  const allowedWrites: Record<string, string[]> = {
    "weekly-digest": ["issues"],
    "dependency-drift": ["issues"],
    "pr-risk-review": ["pull-requests"],
  };

  for (const id of PACK_IDS) {
    it(`${id}: least-privilege permissions, runs the pack's workflow file`, () => {
      const wf = byId[id];
      expect(wf.permissions, "top-level permissions block is required").toBeDefined();
      for (const [scope, level] of Object.entries(wf.permissions as Record<string, string>)) {
        if (level === "write") expect(allowedWrites[id], `${id} requests ${scope}: write`).toContain(scope);
      }
      expect((wf.permissions as Record<string, string>).contents).toBe("read");
      const steps = Object.values(wf.jobs as Record<string, any>).flatMap((j) => j.steps as any[]);
      const run = steps.find((s) => typeof s.uses === "string" && s.uses.startsWith("swenyai/sweny@"));
      expect(run, `${id} has no swenyai/sweny step`).toBeDefined();
      expect(run.with.workflow).toBe(`.sweny/workflows/${id}.yml`);
      // #473: the checkout keeps no token on disk for the agents to read.
      const checkout = steps.find((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout@"));
      expect(checkout?.with?.["persist-credentials"], `${id} checkout`).toBe(false);
    });
  }

  it("pins checkout to the SHA ci.yml uses and drops git credentials (#473, #474)", () => {
    const ci = readFileSync(join(repoRoot, ".github/workflows/ci.yml"), "utf-8");
    const sha = /actions\/checkout@([0-9a-f]{40})/.exec(ci)![1];
    for (const id of PACK_IDS) {
      const steps = Object.values(byId[id].jobs as Record<string, any>).flatMap((j) => j.steps as any[]);
      const checkout = steps.find((s) => typeof s.uses === "string" && s.uses.startsWith("actions/checkout@"));
      expect(checkout.uses, id).toBe(`actions/checkout@${sha}`);
      expect(checkout.with["persist-credentials"], id).toBe(false);
      const run = steps.find((s) => String(s.uses).startsWith("swenyai/sweny@"));
      expect(run.uses, id).toBe("swenyai/sweny@v5");
    }
  });

  it("weekly-digest and dependency-drift alert on failure with one sticky issue (#474)", () => {
    for (const id of ["weekly-digest", "dependency-drift"]) {
      const steps = Object.values(byId[id].jobs as Record<string, any>).flatMap((j) => j.steps as any[]);
      const run = steps.find((s) => String(s.uses).startsWith("swenyai/sweny@"));
      expect(run.with["notify-on-failure"], id).toBe("issue");
      expect(byId[id].permissions.issues, `${id} needs issues: write to open the alert`).toBe("write");
    }
  });

  it("weekly-digest and dependency-drift run on a cron schedule", () => {
    for (const id of ["weekly-digest", "dependency-drift"]) {
      expect(byId[id].on.schedule[0].cron, id).toMatch(/^\S+ \S+ \S+ \S+ \S+$/);
    }
  });

  it("pr-risk-review runs on pull_request, skips forks, and cancels superseded runs", () => {
    const wf = byId["pr-risk-review"];
    expect(Object.keys(wf.on)).toContain("pull_request");
    expect(wf.concurrency["cancel-in-progress"]).toBe(true);
    expect(JSON.stringify(wf.jobs)).toContain("head.repo.full_name");
    expect(JSON.stringify(wf)).not.toContain("pull_request_target");
  });
});

describe("recurring packs: README and docs", () => {
  it("README has a Workflows section listing every pack with its sample output", () => {
    expect(readme).toMatch(/^## Workflows/m);
    for (const t of PACK_TEMPLATES) {
      expect(readme, `README missing ${t.id}`).toContain(t.id);
      const firstLine = t.pack!.sample.trim().split("\n")[0];
      expect(readme, `README missing the ${t.id} sample`).toContain(firstLine);
    }
  });

  it("the docs page carries each pack's trigger and sample verbatim, plus its token range", () => {
    for (const t of PACK_TEMPLATES) {
      expect(docsPage, `${t.id} heading`).toContain(`## \`${t.id}\``);
      expect(docsPage, `${t.id} trigger`).toContain(t.pack!.trigger.trim());
      expect(docsPage, `${t.id} sample`).toContain(t.pack!.sample.trim());
      expect(docsPage, `${t.id} tokens`).toContain(t.pack!.tokens);
    }
  });

  it("README and docs page have no em dashes", () => {
    expect(docsPage).not.toContain(EM_DASH);
    const section = readme.slice(readme.indexOf("## Workflows"));
    expect(section.slice(0, section.indexOf("\n## ", 5))).not.toContain(EM_DASH);
  });
});
