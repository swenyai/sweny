import { describe, it, expect, beforeEach } from "vitest";
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
}

function run(env: Record<string, string>, opts: { list?: unknown; ghFails?: boolean; curlFails?: boolean } = {}) {
  const bin = path.join(dir, "bin");
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(dir, "list.json"), JSON.stringify(opts.list ?? []));
  fs.writeFileSync(
    path.join(bin, "gh"),
    `#!/bin/sh
printf "gh %s " "$@" | tr "\\n" "~" >> "${log}"; echo >> "${log}"
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
printf "curl %s " "$@" | tr "\\n" "~" >> "${log}"; echo >> "${log}"
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
    expect(steps.indexOf(step)).toBeGreaterThan(steps.findIndex((s) => s.name === "Run workflow"));
    const runStep = steps.find((s) => s.name === "Run workflow")!;
    expect(runStep.run).not.toContain("notify");
  });

  it("marks the run start only when the input is set", () => {
    const mark = steps.find((s) => s.name === "Mark run start")!;
    expect(mark.if).toContain("inputs.notify-on-failure != ''");
    expect(steps.indexOf(mark)).toBeLessThan(steps.findIndex((s) => s.name === "Run workflow"));
  });
});
