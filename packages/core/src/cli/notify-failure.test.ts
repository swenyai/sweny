import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";

// Shell-level check of the Action's failure notifier (#474), with stub `gh` and `curl` on PATH.
const repoRoot = path.resolve(__dirname, "../../../..");
const script = path.join(repoRoot, "scripts/notify-failure.sh");
const RUN_URL = "https://github.com/o/r/actions/runs/99";
const HOOK = "https://hooks.slack.com/services/T000/B000/SECRETSECRET";

let dir: string;
let log: string;

function record(over: Record<string, unknown> = {}, ageSeconds = 0) {
  const runs = path.join(dir, "runs");
  fs.mkdirSync(runs, { recursive: true });
  const file = path.join(runs, "20260930-120000-abc123.json");
  fs.writeFileSync(
    file,
    JSON.stringify({
      workflow_id: "weekly-digest",
      status: "failed",
      nodes: [
        { id: "collect", status: "success" },
        { id: "analyze", status: "failed" },
      ],
      ...over,
    }),
  );
  const t = new Date(Date.now() - ageSeconds * 1000);
  fs.utimesSync(file, t, t);
  return file;
}

function run(
  env: Record<string, string>,
  opts: { list?: unknown; ghFails?: boolean; curlFails?: boolean; cwd?: string } = {},
) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, "list.json"), JSON.stringify(opts.list ?? []));
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh
{ printf "gh "; printf "%s " "$@"; } | tr "\\n" "~" >> "${log}"; echo >> "${log}"
${opts.ghFails ? 'echo "HTTP 403: Resource not accessible" >&2; exit 1' : ""}
case "$*" in
  *"-X POST"*) exit 0 ;;
  *) cat "${path.join(dir, "list.json")}" ;;
esac
`,
    { mode: 0o755 },
  );
  fs.writeFileSync(
    path.join(bin, "curl"),
    `#!/bin/sh
{ printf "curl "; printf "%s " "$@"; } | tr "\\n" "~" >> "${log}"; echo >> "${log}"
${opts.curlFails ? "echo 'curl: (22) The requested URL returned error: 404' >&2; exit 22" : "exit 0"}
`,
    { mode: 0o755 },
  );
  const marker = path.join(dir, "marker");
  fs.writeFileSync(marker, "");
  const t = new Date(Date.now() - 600 * 1000);
  fs.utimesSync(marker, t, t);
  return spawnSync("bash", [script], {
    encoding: "utf8",
    cwd: opts.cwd,
    env: {
      PATH: `${bin}:${process.env.PATH}`,
      WORKFLOW_PATH: ".sweny/workflows/weekly-digest.yml",
      RUNS_DIR: path.join(dir, "runs"),
      MARKER_FILE: marker,
      RUN_URL,
      GITHUB_REPOSITORY: "o/r",
      GH_TOKEN: "x",
      ...env,
    },
  });
}

const calls = () => (fs.existsSync(log) ? fs.readFileSync(log, "utf8").trim().split("\n") : []);

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-notify-"));
  log = path.join(dir, "calls.log");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("scripts/notify-failure.sh: issue", () => {
  it("opens one labelled issue with metadata only", () => {
    record();
    const r = run({ NOTIFY: "issue" });
    expect(r.status).toBe(0);
    const create = calls().find((c) => c.includes("-X POST repos/o/r/issues "))!;
    expect(create).toContain("title=SWEny run failed: weekly-digest");
    expect(create).toContain("labels[]=sweny-failure");
    expect(create).toContain("workflow: weekly-digest");
    expect(create).toContain("failed node: analyze");
    expect(create).toContain("reason: node_failed");
    expect(create).toContain(`run: ${RUN_URL}`);
  });

  it("comments on the open sticky issue instead of opening another", () => {
    record();
    const r = run(
      { NOTIFY: "issue" },
      {
        list: [
          { number: 7, title: "SWEny run failed: weekly-digest" },
          { number: 8, title: "other" },
        ],
      },
    );
    expect(r.status).toBe(0);
    expect(calls().some((c) => c.includes("-X POST repos/o/r/issues/7/comments"))).toBe(true);
    expect(calls().some((c) => c.includes("-X POST repos/o/r/issues "))).toBe(false);
  });

  it("never matches a pull request or a different workflow's issue", () => {
    record();
    run(
      { NOTIFY: "issue" },
      {
        list: [
          { number: 3, title: "SWEny run failed: weekly-digest", pull_request: {} },
          { number: 4, title: "SWEny run failed: dependency-drift" },
        ],
      },
    );
    expect(calls().some((c) => c.includes("-X POST repos/o/r/issues "))).toBe(true);
  });

  it("warns and exits 0 when GitHub refuses", () => {
    record();
    const r = run({ NOTIFY: "issue" }, { ghFails: true });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::sweny notify-on-failure");
  });
});

describe("scripts/notify-failure.sh: Slack webhook", () => {
  it("posts to a webhook URL and masks it", () => {
    record();
    const r = run({ NOTIFY: HOOK });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`::add-mask::${HOOK}`);
    const post = calls().find((c) => c.startsWith("curl"))!;
    expect(post).toContain(HOOK);
    expect(post).toContain("failed node: analyze");
    expect(post).toContain("reason: node_failed");
  });

  it("resolves an env var NAME to the URL", () => {
    record();
    const r = run({ NOTIFY: "SLACK_WEBHOOK_URL", SLACK_WEBHOOK_URL: HOOK });
    expect(r.status).toBe(0);
    expect(calls().find((c) => c.startsWith("curl"))).toContain(HOOK);
  });

  it("warns when the named env var is empty, and never prints a URL on a failed post", () => {
    record();
    const empty = run({ NOTIFY: "SLACK_WEBHOOK_URL" });
    expect(empty.status).toBe(0);
    expect(empty.stdout).toContain("::warning::");
    const failed = run({ NOTIFY: HOOK }, { curlFails: true });
    expect(failed.status).toBe(0);
    expect(failed.stdout).toContain("could not post");
    expect(failed.stdout.replace(`::add-mask::${HOOK}`, "")).not.toContain("SECRETSECRET");
  });

  it("rejects a value that is neither issue, an env name, nor https", () => {
    record();
    const r = run({ NOTIFY: "http://insecure.example/hook" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("::warning::");
    expect(calls()).toEqual([]);
  });
});

describe("scripts/notify-failure.sh: trigger conditions and reason classes", () => {
  it("does nothing when notify-on-failure is unset", () => {
    record();
    const r = run({ NOTIFY: "" });
    expect(r.status).toBe(0);
    expect(calls()).toEqual([]);
  });

  it("does nothing when the newest record is a success", () => {
    record({ status: "success", nodes: [] });
    const r = run({ NOTIFY: "issue" });
    expect(r.status).toBe(0);
    expect(calls()).toEqual([]);
  });

  it.each(["", "missing-marker", "directory-marker"])(
    "does not trust old success without a valid marker: %s",
    (kind) => {
      record({ status: "success", nodes: [] }, 120);
      const marker = kind === "" ? "" : path.join(dir, kind);
      if (kind === "directory-marker") {
        fs.mkdirSync(marker);
        const past = new Date(Date.now() - 300_000);
        fs.utimesSync(marker, past, past);
      }
      const result = run({ NOTIFY: HOOK, MARKER_FILE: marker });
      expect(result.status).toBe(0);
      expect(calls().find((c) => c.startsWith("curl"))).toContain("reason: did_not_start");
    },
  );

  it.each(["success", "failed"])("uses the newest current record when its status is %s", (status) => {
    const older = record({ status: status === "success" ? "failed" : "success", nodes: [] });
    fs.renameSync(older, path.join(dir, "runs", "20260929-120000-old.json"));
    record({ status, nodes: [] });
    const result = run({ NOTIFY: HOOK });
    expect(result.status).toBe(0);
    if (status === "success") expect(calls()).toEqual([]);
    else expect(calls().find((c) => c.startsWith("curl"))).toContain("reason: node_failed");
  });

  it("reads a current failed record from a path containing spaces", () => {
    record();
    const runs = path.join(dir, "runs with spaces");
    fs.renameSync(path.join(dir, "runs"), runs);
    const result = run({ NOTIFY: HOOK, RUNS_DIR: runs });
    expect(result.status).toBe(0);
    expect(calls().find((c) => c.startsWith("curl"))).toContain("reason: node_failed");
  });

  it("a crashed run is class crashed", () => {
    record({ status: "crashed" });
    run({ NOTIFY: HOOK });
    expect(calls().find((c) => c.startsWith("curl"))).toContain("reason: crashed");
  });

  it("no record (refused or setup failed) is class did_not_start, named from the workflow path", () => {
    const r = run({ NOTIFY: HOOK });
    expect(r.status).toBe(0);
    const post = calls().find((c) => c.startsWith("curl"))!;
    expect(post).toContain("reason: did_not_start");
    expect(post).toContain("workflow: weekly-digest");
    expect(post).not.toContain("failed node");
  });

  it("ignores a record older than the run start", () => {
    record({}, 3600);
    run({ NOTIFY: HOOK });
    expect(calls().find((c) => c.startsWith("curl"))).toContain("reason: did_not_start");
  });

  it("strips anything that is not a plain id from the message", () => {
    record({ workflow_id: "wf $(whoami) `id`", nodes: [{ id: "n<script>", status: "failed" }] });
    run({ NOTIFY: HOOK });
    const post = calls().find((c) => c.startsWith("curl"))!;
    expect(post).not.toContain("$(");
    expect(post).not.toContain("<script>");
  });
});

describe("action.yml notify-on-failure wiring (#474)", () => {
  const action = parse(fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8"));
  const steps = action.runs.steps as Array<Record<string, any>>;

  it("defaults off", () => {
    expect(action.inputs["notify-on-failure"].default).toBe("");
  });

  it("notifies only on failure, after the run, and needs no CLI flag", () => {
    const step = steps.find((s) => s.name === "Notify on failure")!;
    expect(step.if).toContain("failure()");
    expect(step.if).toContain("inputs.notify-on-failure != ''");
    // A dry run sends no failure notice (#498).
    expect(step.if).toContain('!contains(fromJSON(\'["true","1","yes"]\'), inputs.dry-run)');
    expect(steps.indexOf(step)).toBeGreaterThan(steps.findIndex((s) => s.name === "Run workflow"));
    const runStep = steps.find((s) => s.name === "Run workflow")!;
    expect(runStep.run).not.toContain("notify");
  });

  it.each(["missing", "existing"])("can notify when the workflow directory is %s", (kind) => {
    const notify = steps.find((s) => s.name === "Notify on failure")!;
    const requested = "checkout with spaces";
    if (kind === "existing") {
      record();
      const swenyDir = path.join(dir, requested, ".sweny");
      fs.mkdirSync(swenyDir, { recursive: true });
      fs.renameSync(path.join(dir, "runs"), path.join(swenyDir, "runs"));
    }
    const render = (value: string) =>
      value.replaceAll("${{ inputs.working-directory }}", requested).replaceAll("${{ github.workspace }}", dir);
    const workingDirectory = render(notify["working-directory"] ?? "${{ github.workspace }}");
    const result = run(
      { NOTIFY: HOOK, RUNS_DIR: render(notify.env.RUNS_DIR ?? ".sweny/runs") },
      { cwd: path.resolve(dir, workingDirectory) },
    );
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(calls().find((c) => c.startsWith("curl"))).toContain(
      kind === "existing" ? "reason: node_failed" : "reason: did_not_start",
    );
  });

  it("marks the invocation before auth validation or dependency setup can fail", () => {
    expect(steps[0].name).toBe("Mark run start");
  });

  it("a second invocation cannot reuse a prior marker or suppress its setup failure", () => {
    const mark = steps.find((s) => s.name === "Mark run start")!;
    const notify = steps.find((s) => s.name === "Notify on failure")!;
    const markInvocation = () => {
      const output = path.join(dir, "step-output");
      fs.writeFileSync(output, "");
      const result = spawnSync("bash", ["-e", "-c", mark.run.replaceAll("${{ runner.temp }}", dir)], {
        encoding: "utf8",
        env: { PATH: process.env.PATH, RUNNER_TEMP: dir, GITHUB_OUTPUT: output },
      });
      expect(result.status, result.stderr).toBe(0);
      const marker = /^marker=(.+)$/m.exec(fs.readFileSync(output, "utf8"))?.[1];
      expect(marker, "the marker must be an invocation-scoped step output").toBeDefined();
      expect(fs.statSync(marker!).isFile()).toBe(true);
      return marker!;
    };

    const first = markInvocation();
    const past = new Date(Date.now() - 300_000);
    fs.utimesSync(first, past, past);
    record({ status: "success", nodes: [] }, 120);
    const second = markInvocation();
    expect(second).not.toBe(first);
    expect(notify.env.MARKER_FILE).toBe("${{ steps." + mark.id + ".outputs.marker }}");
    // Dependency setup fails before the second workflow creates any record.
    const result = run({ NOTIFY: HOOK, MARKER_FILE: second });
    expect(result.status).toBe(0);
    expect(calls().find((c) => c.startsWith("curl"))).toContain("reason: did_not_start");

    // A successful record belonging to the current invocation stays quiet.
    fs.rmSync(log);
    record({ status: "success", nodes: [] }, -1);
    const succeeded = run({ NOTIFY: HOOK, MARKER_FILE: second });
    expect(succeeded.status).toBe(0);
    expect(calls()).toEqual([]);
  });

  it("marks the run start only when the input is set", () => {
    const mark = steps.find((s) => s.name === "Mark run start")!;
    expect(mark.if).toContain("inputs.notify-on-failure != ''");
    expect(steps.indexOf(mark)).toBeLessThan(steps.findIndex((s) => s.name === "Run workflow"));
  });
});
