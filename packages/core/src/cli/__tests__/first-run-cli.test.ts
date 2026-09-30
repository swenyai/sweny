import { describe, it, expect, afterEach, vi } from "vitest";
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYaml } from "yaml";
import { triageWorkflow } from "../../workflows/index.js";

// First-run contract (#379 #381 #382 #384), exercised through the built CLI.
// No workflow here ever reaches an LLM: every case fails or finishes before
// a node runs. Skipped when dist/ has not been built.

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI_BIN = path.resolve(__dirname, "..", "..", "..", "dist", "cli", "main.js");
const HAS_BUILD = fs.existsSync(CLI_BIN);
const PLUGIN_SKILLS = path.resolve(__dirname, "..", "..", "..", "..", "plugin", "skills");

// Each case spawns the CLI; allow for a loaded machine.
vi.setConfig({ testTimeout: 30_000 });

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  dirs.length = 0;
});

function tmp(prefix: string): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `sweny-firstrun-${prefix}-`));
  dirs.push(d);
  return d;
}

/** Fresh cwd + fresh HOME so neither the dev's .env nor Claude Code login leaks in. */
function sandbox(opts: { login?: boolean } = {}) {
  const cwd = tmp("cwd");
  const home = tmp("home");
  if (opts.login) {
    fs.mkdirSync(path.join(home, ".claude"));
    fs.writeFileSync(path.join(home, ".claude", ".credentials.json"), "{}");
  }
  const run = (args: string[]) => {
    const r = spawnSync("node", [CLI_BIN, ...args], {
      cwd,
      encoding: "utf-8",
      timeout: 30_000,
      // Deliberately minimal: no tokens, no API keys. stdin is a pipe (non-TTY).
      env: { PATH: process.env.PATH ?? "", HOME: home, NO_COLOR: "1", FORCE_COLOR: "0" },
    });
    return { status: r.status, stdout: r.stdout ?? "", stderr: r.stderr ?? "", timedOut: r.error != null };
  };
  return { cwd, home, run };
}

/** Collapse box-drawing wraps so assertions match the words, not the layout. */
const flat = (s: string) => s.replace(/[│\s]+/g, " ");

const GITHUB_WORKFLOW = `id: needs-gh
name: Needs GitHub
description: d
entry: a
nodes:
  a:
    name: A
    instruction: do a
    skills: [github]
  b:
    name: B
    instruction: do b
    skills: [github]
  c:
    name: C
    instruction: do c
    skills: [github]
edges:
  - from: a
    to: b
  - from: b
    to: c
`;

describe("triage workflow_type (#384)", () => {
  it("is a valid enum value and is not pr_review", () => {
    expect(triageWorkflow.workflow_type).toBe("monitor");
  });
});

describe("plugin slash command count (#384)", () => {
  it("quick-start states the real number of plugin skills", () => {
    const count = fs.readdirSync(PLUGIN_SKILLS, { withFileTypes: true }).filter((e) => e.isDirectory()).length;
    const doc = fs.readFileSync(
      path.resolve(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "web",
        "src",
        "content",
        "docs",
        "getting-started",
        "quick-start.md",
      ),
      "utf-8",
    );
    const m = /get (\d+) slash commands/.exec(doc);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(count);
  });
});

describe.runIf(HAS_BUILD)("missing skill credentials (#381)", () => {
  it("run prints 'needs GITHUB_TOKEN' once and never 'unknown skill'", () => {
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.cwd, "wf.yml"), GITHUB_WORKFLOW);
    const r = sb.run(["workflow", "run", "wf.yml"]);
    expect(r.status).toBe(1);
    const needs = 'skill "github" needs GITHUB_TOKEN (set it in .env)';
    expect(r.stderr.split(needs).length - 1).toBe(1);
    expect(r.stderr).not.toMatch(/unknown skill/);
  });

  it("run still rejects a genuinely unknown skill id", () => {
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.cwd, "wf.yml"), GITHUB_WORKFLOW.replace(/\[github\]/g, "[gtihub]"));
    const r = sb.run(["workflow", "run", "wf.yml"]);
    expect(r.status).toBe(1);
    expect(r.stderr).toMatch(/unknown skill "gtihub"/);
  });

  it("validate passes but warns about the missing env", () => {
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.cwd, "wf.yml"), GITHUB_WORKFLOW);
    const r = sb.run(["workflow", "validate", "wf.yml"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/is valid/);
    expect(r.stderr).toContain('skill "github" needs GITHUB_TOKEN (set it in .env)');
  });

  it("validate --json carries warnings and stays valid", () => {
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.cwd, "wf.yml"), GITHUB_WORKFLOW);
    const r = sb.run(["workflow", "validate", "wf.yml", "--json"]);
    expect(r.status).toBe(0);
    const parsed = JSON.parse(r.stdout);
    expect(parsed.valid).toBe(true);
    expect(parsed.warnings).toEqual(['skill "github" needs GITHUB_TOKEN (set it in .env)']);
  });
});

describe.runIf(HAS_BUILD)("sweny new non-interactive (#384, #379)", () => {
  it("non-TTY stdin without --yes prints usage and exits 2 instead of hanging", () => {
    const sb = sandbox();
    const r = sb.run(["new"]);
    expect(r.timedOut).toBe(false);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--template");
    expect(r.stderr).toContain("--yes");
  });

  it("--template explain-repo --yes works offline, ignores .env in git, and validates with no env", () => {
    const sb = sandbox();
    const r = sb.run(["new", "--template", "explain-repo", "--yes"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(sb.cwd, ".sweny", "workflows", "explain-repo.yml"))).toBe(true);
    expect(fs.readFileSync(path.join(sb.cwd, ".gitignore"), "utf-8").split("\n")).toContain(".env");
    const env = fs.readFileSync(path.join(sb.cwd, ".env"), "utf-8");
    expect(env).not.toMatch(/^GITHUB_TOKEN=/m);

    const v = sb.run(["workflow", "validate", ".sweny/workflows/explain-repo.yml"]);
    expect(v.status).toBe(0);
    expect(v.stderr).not.toMatch(/needs/);
  });

  it("appends .env to an existing .gitignore", () => {
    const sb = sandbox();
    fs.writeFileSync(path.join(sb.cwd, ".gitignore"), "node_modules");
    sb.run(["new", "--template", "explain-repo", "--yes"]);
    expect(fs.readFileSync(path.join(sb.cwd, ".gitignore"), "utf-8")).toBe("node_modules\n.env\n");
  });

  it("`new <built-in id> --yes` needs no marketplace", () => {
    const sb = sandbox();
    const r = sb.run(["new", "pr-review", "--yes"]);
    expect(r.status).toBe(0);
    expect(fs.existsSync(path.join(sb.cwd, ".sweny", "workflows", "pr-review.yml"))).toBe(true);
  });

  it("the starter declares no skills", () => {
    const sb = sandbox();
    expect(sb.run(["new", "--template", "explain-repo", "--yes"]).status).toBe(0);
    const doc = parseYaml(fs.readFileSync(path.join(sb.cwd, ".sweny", "workflows", "explain-repo.yml"), "utf-8"));
    expect(doc.nodes.survey.skills).toBeUndefined();
  });
});

describe.runIf(HAS_BUILD)("sweny check (#382)", () => {
  it("with a Claude Code login and a no-skill workflow: passes, asks for no token, leaks no git stderr", () => {
    const sb = sandbox({ login: true });
    expect(sb.run(["new", "--template", "explain-repo", "--yes"]).status).toBe(0);
    const r = sb.run(["check"]);
    const out = flat(r.stdout + r.stderr);
    expect(r.status).toBe(0);
    expect(out).not.toMatch(/fatal: not a git repository/);
    expect(out).not.toMatch(/GITHUB_TOKEN/);
    expect(out).toMatch(/Claude Code login/);
  });

  it("with no login and no key: fails on auth only, still no git stderr", () => {
    const sb = sandbox();
    expect(sb.run(["new", "--template", "explain-repo", "--yes"]).status).toBe(0);
    const r = sb.run(["check"]);
    const out = flat(r.stdout + r.stderr);
    expect(r.status).toBe(1);
    expect(out).toMatch(/ANTHROPIC_API_KEY or CLAUDE_CODE_OAUTH_TOKEN/);
    expect(out).not.toMatch(/fatal: not a git repository/);
    expect(out).not.toMatch(/GITHUB_TOKEN/);
  });

  it("asks for GITHUB_TOKEN when a workflow uses the github skill", () => {
    const sb = sandbox({ login: true });
    expect(sb.run(["new", "--template", "pr-review", "--yes"]).status).toBe(0);
    const r = sb.run(["check"]);
    expect(r.status).toBe(1);
    expect(flat(r.stdout + r.stderr)).toMatch(/GITHUB_TOKEN/);
  });
});
