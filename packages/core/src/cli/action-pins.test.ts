import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { TESTED_CODEX_VERSION } from "../harness/codex.js";

const repoRoot = path.resolve(__dirname, "../../../..");
const actionText = fs.readFileSync(path.join(repoRoot, "action.yml"), "utf8");
const action = parse(actionText);
const steps = action.runs.steps as Array<Record<string, any>>;

describe("action.yml version pins", () => {
  it("installs the tested Codex by default", () => {
    expect(action.inputs["codex-version"].default).toBe(TESTED_CODEX_VERSION);
  });

  it("keeps cli-version at latest on the floating tag", () => {
    expect(action.inputs["cli-version"].default).toBe("latest");
  });

  it("pins every action it uses to a commit SHA", () => {
    for (const s of steps) {
      if (typeof s.uses === "string") expect(s.uses).toMatch(/@[0-9a-f]{40}$/);
    }
  });
});

describe("release verification checkout", () => {
  it("does not persist credentials while running the agent policy tests", () => {
    const release = parse(fs.readFileSync(path.join(repoRoot, ".github/workflows/release.yml"), "utf8"));
    const checkout = release.jobs.verify.steps.find((step: Record<string, any>) =>
      String(step.uses).startsWith("actions/checkout@"),
    );
    expect(checkout.with?.["persist-credentials"]).toBe(false);
  });
});

describe("scripts/stamp-action-version.mjs", () => {
  const script = path.join(repoRoot, "scripts/stamp-action-version.mjs");

  it("rewrites only the cli-version default", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "sweny-stamp-"));
    const f = path.join(d, "action.yml");
    fs.writeFileSync(f, actionText);
    const r = spawnSync("node", [script, "5.123.4", f], { encoding: "utf8" });
    expect(r.status).toBe(0);
    const stamped = parse(fs.readFileSync(f, "utf8"));
    expect(stamped.inputs["cli-version"].default).toBe("5.123.4");
    // everything else is untouched
    stamped.inputs["cli-version"].default = "latest";
    expect(stamped).toEqual(action);
  });

  it("refuses a non-exact version", () => {
    const r = spawnSync("node", [script, "latest", path.join(repoRoot, "action.yml")], { encoding: "utf8" });
    expect(r.status).toBe(2);
  });
});

describe("agent sandbox wrapper step", () => {
  const step = steps.find((s) => s.name === "Install and probe the agent sandbox wrapper (srt)")!;

  it("runs only for non-Claude agents and sits before the workflow", () => {
    expect(step.if).toBe("inputs.agent != 'claude'");
    expect(steps.indexOf(step)).toBeLessThan(steps.findIndex((s) => s.name === "Run workflow"));
  });

  it("uses the same srt pin as the ci.yml sandbox-wrapper job", () => {
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    const ciPin = /@anthropic-ai\/sandbox-runtime@(\d+\.\d+\.\d+)/.exec(ci)![1];
    expect(step.env.SRT_VERSION).toBe(ciPin);
  });

  it("installs ripgrep, probes srt, and fails with a message", () => {
    expect(step.run).toContain("ripgrep");
    expect(step.run).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
    expect(step.run).toContain('srt --settings "$SETTINGS" -- true');
    expect(step.run).toContain("::error title=SWEny sandbox wrapper::");
  });

  it("relaxes AppArmor only on GitHub-hosted runners or strict, with the same env", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.run).toContain(
      '[ "${SWENY_SANDBOX:-}" = "strict" ] || [ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]',
    );
    expect(step.run).toContain("::notice title=SWEny agent sandbox::");
    expect(step.run).toContain("::warning title=SWEny agent sandbox::srt still cannot");
  });

  it("setup-only skips the run and the PR comment", () => {
    expect(steps.find((s) => s.name === "Run workflow")!.if).toBe("inputs.setup-only != 'true'");
    expect(steps.find((s) => s.name === "Post PR comment")!.if).toContain("inputs.setup-only != 'true'");
  });
});

describe("agent sandbox dependencies step", () => {
  const step = steps.find((s) => s.name === "Install agent sandbox dependencies")!;

  it("relaxes AppArmor on GitHub-hosted runners or strict, never under off", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.run).toContain('[ "${SWENY_SANDBOX:-}" != "off" ]');
    expect(step.run).toContain('[ "${RUNNER_ENVIRONMENT:-}" = "github-hosted" ]');
    expect(step.run).toContain('[ "${SWENY_SANDBOX:-}" = "strict" ]');
    expect(step.run).toContain("kernel.apparmor_restrict_unprivileged_userns=0");
    expect(step.run).toContain("::notice title=SWEny agent sandbox::");
    expect(step.run).toContain("::warning title=SWEny agent sandbox::bubblewrap still cannot");
  });
});
