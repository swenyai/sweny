import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "yaml";
import { resolveSandboxMode } from "../agent-env.js";
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

const SANDBOX_USERNS = "${{ github.action_path }}/scripts/sandbox-userns.sh";

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
    expect(step.run).toContain('srt --settings "$SETTINGS" -- true');
    expect(step.run).toContain("::error title=SWEny sandbox wrapper::");
  });

  it("relaxes the host through the shared script, with the same env", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.env.SANDBOX_USERNS).toBe(SANDBOX_USERNS);
    expect(step.run).toContain('bash "$SANDBOX_USERNS" relax');
    expect(step.run).not.toContain("sysctl");
    expect(step.run).not.toContain("apparmor_parser");
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

  it("probes and relaxes through the shared script, never under off", () => {
    expect(step.env.RUNNER_ENVIRONMENT).toBe("${{ runner.environment }}");
    expect(step.env.SANDBOX_USERNS).toBe(SANDBOX_USERNS);
    expect(step.run).toContain('[ "$SANDBOX_MODE" != "off" ]');
    expect(step.run).toContain('! bash "$SANDBOX_USERNS" probe');
    expect(step.run).toContain('bash "$SANDBOX_USERNS" relax');
    expect(step.run).not.toContain("sysctl");
    expect(step.run).not.toContain("apparmor_parser");
    expect(step.run).toContain("::notice title=SWEny agent sandbox::");
    expect(step.run).toContain("::warning title=SWEny agent sandbox::bubblewrap still cannot");
  });
});

describe("scripts/sandbox-userns.sh", () => {
  const script = path.join(repoRoot, "scripts/sandbox-userns.sh");
  const text = fs.readFileSync(script, "utf8");
  const relax = (env: Record<string, string>) =>
    spawnSync("bash", [script, "relax"], { env: { PATH: process.env.PATH ?? "", ...env }, encoding: "utf8" });

  it("relaxes the sysctl and unloads bwrap-userns-restrict (anthropics/sandbox-runtime#429)", () => {
    expect(text).toContain("sysctl -w kernel.apparmor_restrict_unprivileged_userns=0");
    expect(text).toContain("apparmor_parser -R /etc/apparmor.d/bwrap-userns-restrict");
    expect(text).toContain("https://github.com/anthropics/sandbox-runtime/issues/429");
  });

  it("probes a user namespace nested inside bwrap", () => {
    expect(text).toContain("bwrap --ro-bind / / --dev /dev --proc /proc true");
    expect(text).toContain("bwrap --ro-bind / / --dev /dev --proc /proc unshare --user --map-root-user true");
  });

  it("relaxes nothing on self-hosted without strict, or under off", () => {
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted", SWENY_SANDBOX: "auto" }).status).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted" }).status).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "github-hosted", SWENY_SANDBOX: "off" }).status).toBe(3);
    expect(relax({ RUNNER_ENVIRONMENT: "self-hosted", SWENY_SANDBOX: "off" }).status).toBe(3);
  });

  it("reads SWENY_SANDBOX exactly as core does, for every alias", () => {
    const mode = (env: Record<string, string>) =>
      spawnSync("bash", [script, "mode"], {
        env: { PATH: process.env.PATH ?? "", ...env },
        encoding: "utf8",
      }).stdout.trim();
    const values = [
      "off",
      "OFF",
      " Off ",
      "false",
      "FALSE",
      "0",
      "no",
      "No",
      "strict",
      "STRICT",
      "on",
      "true",
      "1",
      "auto",
      "Auto",
      "",
      "bogus",
    ];
    for (const ci of ["true", ""]) {
      for (const v of values) {
        const env = { SWENY_SANDBOX: v, CI: ci };
        expect(`${JSON.stringify(v)} CI=${ci}: ${mode(env)}`).toBe(
          `${JSON.stringify(v)} CI=${ci}: ${resolveSandboxMode(env)}`,
        );
      }
    }
    expect(mode({ CI: "true" })).toBe(resolveSandboxMode({ CI: "true" }));
  });

  it("never relaxes the host when sandboxing is off under any alias", () => {
    for (const v of ["off", "OFF", "false", "False", "0", "no", "NO", " off "]) {
      expect(relax({ RUNNER_ENVIRONMENT: "github-hosted", SWENY_SANDBOX: v }).status).toBe(3);
    }
  });

  it("the Action steps read the mode from the script, not the raw variable", () => {
    for (const name of ["Install agent sandbox dependencies", "Install and probe the agent sandbox wrapper (srt)"]) {
      const run = steps.find((s) => s.name === name)!.run as string;
      expect(run).toContain('bash "$SANDBOX_USERNS" mode');
      expect(run).not.toMatch(/\$\{SWENY_SANDBOX:-\}" (!=|=) "off"/);
    }
  });

  it("is what CI's sandbox jobs run, not a copy", () => {
    const ci = fs.readFileSync(path.join(repoRoot, ".github/workflows/ci.yml"), "utf8");
    expect(ci).toContain("bash scripts/sandbox-userns.sh relax");
    expect(ci).not.toContain("apparmor_parser");
    expect(ci).not.toContain("sysctl -w");
  });
});
