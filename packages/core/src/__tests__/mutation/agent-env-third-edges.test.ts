/**
 * Edge assertions found by mutation testing of agent-env.ts: when MCP is
 * withheld, sandbox mode words, executable lookup, harness env overlays, the
 * pi provider read from a model id, and the no-push ssh wrapper's behavior.
 */
import { afterEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  agentEnvOverlay,
  mcpWithheld,
  noPushDir,
  resolveExecutable,
  resolvePiProvider,
  resolveSandboxMode,
} from "../../agent-env.js";

const dirs: string[] = [];
function tmp(): string {
  const d = mkdtempSync(join(tmpdir(), "sweny-agent-env-third-"));
  dirs.push(d);
  return d;
}
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe("mcpWithheld", () => {
  it("withholds MCP for a read-only run or a node that asked for none, and only then", () => {
    expect(mcpWithheld(true, undefined)).toBe(true);
    expect(mcpWithheld(true, { noMcp: false })).toBe(true);
    expect(mcpWithheld(false, { noMcp: true })).toBe(true);
    expect(mcpWithheld(false, { noMcp: false })).toBe(false);
    expect(mcpWithheld(false, undefined)).toBe(false);
    expect(mcpWithheld(false, {})).toBe(false);
  });
});

describe("resolveSandboxMode", () => {
  it("each off word turns the sandbox off, even in CI", () => {
    for (const word of ["off", "false", "0", "no"]) {
      expect(resolveSandboxMode({ CI: "true" }, word), word).toBe("off");
    }
  });
});

describe("resolveExecutable", () => {
  const script = (dir: string, name: string, mode: number) => {
    const p = join(dir, name);
    writeFileSync(p, "#!/bin/sh\nexit 0\n");
    chmodSync(p, mode);
    return p;
  };

  it("a path command must be an executable file", () => {
    const dir = tmp();
    const exe = script(dir, "tool", 0o755);
    script(dir, "plain", 0o644);
    mkdirSync(join(dir, "sub"));
    expect(resolveExecutable("./tool", {}, dir)).toBe(exe);
    expect(resolveExecutable("./plain", {}, dir)).toBeUndefined();
    expect(resolveExecutable("./sub", {}, dir)).toBeUndefined();
  });

  it("an empty PATH entry never means the working directory", () => {
    const cwd = tmp();
    script(cwd, "tool", 0o755);
    const bin = tmp();
    expect(resolveExecutable("tool", { PATH: `:${bin}:` }, cwd)).toBeUndefined();
    const found = script(bin, "tool", 0o755);
    expect(resolveExecutable("tool", { PATH: `:${bin}:` }, cwd)).toBe(found);
  });
});

describe("agentEnvOverlay", () => {
  it("accepts a null-prototype object as plain", () => {
    const env = Object.assign(Object.create(null) as Record<string, string>, { FOO: "1" });
    expect(agentEnvOverlay({ env })).toStrictEqual({ env: { FOO: "1" }, remove: [] });
  });

  it("an undefined value says how to unset it; another type does not", () => {
    expect(() => agentEnvOverlay({ env: { FOO: undefined as never } })).toThrow(
      new Error(
        "env: value for FOO must be a string, got undefined (leave the key out, or name it in envRemove to unset it)",
      ),
    );
    expect(() => agentEnvOverlay({ env: { FOO: 5 as never } })).toThrow(
      new Error("env: value for FOO must be a string, got number"),
    );
  });

  it("refuses an envRemove that is not an array", () => {
    expect(() => agentEnvOverlay({ envRemove: "FOO" as never })).toThrow(
      new Error("envRemove: must be an array of env var names"),
    );
  });
});

describe("resolvePiProvider", () => {
  it("a model id without a provider prefix names no provider, even when it is a provider's name", () => {
    expect(resolvePiProvider({}, "anthropic")).toStrictEqual({ explicit: false, vars: [] });
  });
});

describe("noPushDir ssh wrapper", () => {
  const run = (args: string[], env: Record<string, string>) =>
    spawnSync(join(noPushDir(), "ssh"), args, { encoding: "utf8", env: { PATH: process.env.PATH ?? "", ...env } });

  it("is created once per process", () => {
    expect(noPushDir()).toBe(noPushDir());
  });

  it("refuses a push", () => {
    const r = run(["github.com", "git-receive-pack 'o/r.git'"], {});
    expect(r.error).toBeUndefined();
    expect(r.status).toBe(1);
    expect(r.stderr).not.toBe("");
  });

  it("hands anything else to the operator's ssh command, else to ssh on PATH", () => {
    const viaOverride = run(["github.com", "git-upload-pack 'o/r.git'"], { SWENY_NO_PUSH_SSH: "echo override" });
    expect(viaOverride.status).toBe(0);
    expect(viaOverride.stdout).toBe("override github.com git-upload-pack 'o/r.git'\n");
    const bin = tmp();
    writeFileSync(join(bin, "ssh"), '#!/bin/sh\necho "plain $*"\n', { mode: 0o755 });
    const plain = run(["github.com", "git-upload-pack x"], { PATH: `${bin}:/usr/bin:/bin` });
    expect(plain.status).toBe(0);
    expect(plain.stdout).toBe("plain github.com git-upload-pack x\n");
  });
});
