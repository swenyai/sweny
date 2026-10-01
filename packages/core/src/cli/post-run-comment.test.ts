import { describe, it, expect, beforeEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

// Shell-level check of the Action's comment poster, with a stub `gh` on PATH.
const repoRoot = path.resolve(__dirname, "../../../..");
const script = path.join(repoRoot, "scripts/post-run-comment.sh");
const MARKER = "<!-- sweny-run-comment:pr-review -->";

let dir: string;
let log: string;

function run(env: Record<string, string>, opts: { list?: unknown; listFails?: boolean; writeFails?: boolean } = {}) {
  const listFile = path.join(dir, "list.json");
  fs.writeFileSync(listFile, JSON.stringify(opts.list ?? []));
  const gh = path.join(dir, "bin", "gh");
  fs.mkdirSync(path.dirname(gh), { recursive: true });
  fs.writeFileSync(
    gh,
    `#!/bin/sh
echo "$@" >> "${log}"
case "$*" in
  *"-X PATCH"*|*"-X POST"*) ${opts.writeFails ? 'echo "HTTP 403: Resource not accessible" >&2; exit 1' : "exit 0"} ;;
  *) ${opts.listFails ? 'echo "HTTP 403" >&2; exit 1' : `cat "${listFile}"`} ;;
esac
`,
    { mode: 0o755 },
  );
  const commentFile = path.join(dir, "comment.md");
  if (!fs.existsSync(commentFile)) fs.writeFileSync(commentFile, `${MARKER}\n## hi\n`);
  return spawnSync("bash", [script], {
    encoding: "utf8",
    env: {
      PATH: `${path.dirname(gh)}:${process.env.PATH}`,
      COMMENT_FILE: commentFile,
      PR_NUMBER: "7",
      GITHUB_REPOSITORY: "o/r",
      GH_TOKEN: "x",
      ...env,
    },
  });
}

const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-post-"));
  log = path.join(dir, "gh.log");
});

describe("scripts/post-run-comment.sh", () => {
  it("creates the comment when none carries the marker", () => {
    const r = run({}, { list: [{ id: 1, body: "unrelated" }] });
    expect(r.status).toBe(0);
    expect(calls()[1]).toBe(`api -X POST repos/o/r/issues/7/comments -F body=@${path.join(dir, "comment.md")}`);
  });

  it("updates in place when a comment starts with the marker", () => {
    const r = run(
      {},
      {
        list: [
          { id: 1, body: "unrelated" },
          { id: 42, body: `${MARKER}\nold` },
        ],
      },
    );
    expect(r.status).toBe(0);
    expect(calls()[1]).toContain("-X PATCH repos/o/r/issues/comments/42");
    expect(calls().some((c) => c.includes("POST"))).toBe(false);
  });

  it("ignores a comment that only quotes the marker", () => {
    run({}, { list: [{ id: 5, body: `> ${MARKER}` }] });
    expect(calls()[1]).toContain("-X POST");
  });

  it("warns and exits 0 when listing fails", () => {
    const r = run({}, { listFails: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::");
    expect(calls().some((c) => c.includes("POST"))).toBe(false);
  });

  it("warns and exits 0 when the write fails", () => {
    const r = run({}, { writeFails: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::sweny pr-comment: could not create comment");
  });

  it("is a no-op outside a pull request", () => {
    const r = run({ PR_NUMBER: "" });
    expect(r.status).toBe(0);
    expect(calls()).toEqual([]);
  });

  it("warns when the file has no marker", () => {
    fs.writeFileSync(path.join(dir, "comment.md"), "no marker\n");
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::");
    expect(calls()).toEqual([]);
  });
});

describe("action.yml wiring", () => {
  const action = parse(fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8"));
  const steps = action.runs.steps as Array<Record<string, any>>;

  it("documents pr-comment, default true", () => {
    expect(action.inputs["pr-comment"].default).toBe("true");
    expect(action.inputs["pr-comment"].description).toContain("pull-requests: write");
  });

  it("only passes --comment-file on pull_request events and posts on its own step", () => {
    const runStep = steps.find((s) => s.name === "Run workflow")!;
    expect(runStep.run).toContain('FLAGS+=("--comment-file" "$COMMENT_FILE")');
    expect(runStep.run).toContain('[ -n "$PR_NUMBER" ]');
    // feature-detect: old CLIs without --comment-file must not fail the run
    expect(runStep.run).toContain("sweny workflow run --help");
    expect(runStep.run).toContain("grep -q -- '--comment-file'");
    expect(runStep.run).toContain("::notice::installed sweny CLI does not support PR comments yet; skipping");
    expect(runStep.run.indexOf("grep -q -- '--comment-file'")).toBeLessThan(
      runStep.run.indexOf('FLAGS+=("--comment-file"'),
    );
    const post = steps.find((s) => s.name === "Post PR comment")!;
    expect(post.if).toContain("!cancelled()");
    expect(post.if).toContain("inputs.pr-comment != 'false'");
    // A dry run posts nothing (#498).
    expect(post.if).toContain('!contains(fromJSON(\'["true","1","yes"]\'), inputs.dry-run)');
    expect(post.run).toContain("scripts/post-run-comment.sh");
    expect(steps.indexOf(post)).toBeGreaterThan(steps.indexOf(runStep));
  });
});

describe("Run workflow step with a stub sweny", () => {
  const action = parse(fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8"));
  const runScript = (action.runs.steps as Array<Record<string, any>>).find((s) => s.name === "Run workflow")!
    .run as string;

  function runStep(helpText: string, env: Record<string, string>) {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-step-"));
    const argsLog = path.join(d, "args.log");
    const bin = path.join(d, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(
      path.join(bin, "sweny"),
      `#!/bin/sh\nfor a in "$@"; do [ "$a" = "--help" ] && { printf '%s\\n' '${helpText}'; exit 0; }; done\necho "$@" >> "${argsLog}"\n`,
      { mode: 0o755 },
    );
    const r = spawnSync("bash", ["-eo", "pipefail", "-c", runScript], {
      encoding: "utf8",
      env: {
        PATH: `${bin}:${process.env.PATH}`,
        WORKFLOW_PATH: "wf.yml",
        COMMENT_FILE: path.join(d, "c.md"),
        PR_COMMENT: "true",
        PR_NUMBER: "7",
        ...env,
      },
    });
    return { r, args: fs.existsSync(argsLog) ? fs.readFileSync(argsLog, "utf8") : "" };
  }

  it("passes --comment-file when the CLI supports it", () => {
    const { r, args } = runStep("  --comment-file <path>  write comment", {});
    expect(r.status).toBe(0);
    expect(args).toContain("--comment-file");
  });

  it("skips with a notice on an older CLI", () => {
    const { r, args } = runStep("  --json  output json", {});
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::notice::installed sweny CLI does not support PR comments yet; skipping");
    expect(args).not.toContain("--comment-file");
  });

  it("does nothing off pull_request or when opted out", () => {
    expect(runStep("--comment-file", { PR_NUMBER: "" }).args).not.toContain("--comment-file");
    expect(runStep("--comment-file", { PR_COMMENT: "false" }).args).not.toContain("--comment-file");
  });

  describe("agent input (#331)", () => {
    it("passes --agent codex when the CLI supports it", () => {
      const { r, args } = runStep("  --agent <id>  coding agent", { AGENT: "codex", PR_NUMBER: "" });
      expect(r.status).toBe(0);
      expect(args).toContain("--agent codex");
    });

    it("fails instead of running Claude when the CLI has no --agent", () => {
      const { r, args } = runStep("  --json  output json", { AGENT: "codex", PR_NUMBER: "" });
      expect(r.status).not.toBe(0);
      expect(r.stdout).toContain("::error::the installed sweny CLI does not support agent: codex");
      expect(args).toBe("");
    });

    it("never passes --agent for the default agent", () => {
      expect(runStep("  --agent <id>", { AGENT: "claude", PR_NUMBER: "" }).args).not.toContain("--agent");
      expect(runStep("  --agent <id>", { PR_NUMBER: "" }).args).not.toContain("--agent");
    });
  });
});

describe("action.yml agent wiring (#331)", () => {
  const action = parse(fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8"));
  const steps = action.runs.steps as Array<Record<string, any>>;

  it("installs the Codex CLI only for agent: codex", () => {
    const install = steps.find((s) => s.name === "Install Codex CLI")!;
    expect(install.if).toBe("inputs.agent == 'codex'");
    expect(install.run).toContain('npm install -g "@openai/codex@${CODEX_VERSION}"');
    expect(action.inputs.agent.default).toBe("claude");
  });

  it("asks codex runs for an OpenAI key, not a Claude credential", () => {
    const validate = steps.find((s) => s.name === "Validate auth inputs")!;
    const run = (env: Record<string, string>) =>
      spawnSync("bash", ["-c", validate.run as string], { encoding: "utf8", env: { PATH: process.env.PATH, ...env } });
    expect(run({ AGENT: "codex", HAS_OPENAI_KEY: "true" }).status).toBe(0);
    expect(run({ AGENT: "codex", HAS_API_KEY: "true" }).stdout).toContain("agent: codex needs openai-api-key");
    expect(run({ AGENT: "claude", HAS_API_KEY: "true" }).status).toBe(0);
    expect(run({ AGENT: "gemini" }).stdout).toContain("agent must be claude or codex");
  });
});
