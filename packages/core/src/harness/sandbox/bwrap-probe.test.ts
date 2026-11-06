/**
 * The bubblewrap host probes (core's `bwrapWorks` and the Action's
 * `scripts/sandbox-userns.sh probe`) run real binaries, so they must never run
 * one an agent could plant: a fake `bwrap` and `unshare` first on PATH, holding
 * a canary from the parent's env, must not execute, and must not change the
 * verdict. Under SWENY_REQUIRE_SANDBOX_WRAPPER=1 (the `sandbox-wrapper` CI job,
 * whose host is relaxed) the real probe must also pass.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bwrapWorks } from "../../agent-env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../..");
const script = path.join(repoRoot, "scripts/sandbox-userns.sh");
const CANARY = "sweny-probe-canary-7f3a9c";

describe.skipIf(process.platform !== "linux")("bwrap probes ignore binaries planted on PATH", () => {
  let dir: string;
  let marker: string;
  let plantedPath: string;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "sweny-planted-"));
    marker = path.join(dir, "ran");
    for (const bin of ["bwrap", "unshare"]) {
      const p = path.join(dir, bin);
      await writeFile(
        p,
        `#!/bin/sh\necho "${bin} $SWENY_PROBE_CANARY" >> '${marker}'\necho "canary $SWENY_PROBE_CANARY" >&2\nexit 1\n`,
      );
      await chmod(p, 0o755);
    }
    plantedPath = `${dir}${path.delimiter}${process.env.PATH ?? ""}`;
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("core: bwrapWorks never runs the planted binaries and reaches the same verdict", () => {
    const clean = bwrapWorks();
    const savedPath = process.env.PATH;
    process.env.PATH = plantedPath;
    process.env.SWENY_PROBE_CANARY = CANARY;
    let planted: string | undefined;
    try {
      planted = bwrapWorks();
    } finally {
      process.env.PATH = savedPath;
      delete process.env.SWENY_PROBE_CANARY;
    }
    expect(existsSync(marker)).toBe(false);
    expect(planted ?? "").not.toContain(CANARY);
    expect(planted).toBe(clean);
    if (process.env.SWENY_REQUIRE_SANDBOX_WRAPPER === "1") expect(planted).toBeUndefined();
  });

  it("Action: sandbox-userns.sh probe never runs the planted binaries and reaches the same verdict", () => {
    const probe = (env: Record<string, string>) =>
      spawnSync("bash", [script, "probe"], { env, encoding: "utf8", timeout: 30_000 }).status;
    const clean = probe({ PATH: process.env.PATH ?? "" });
    const planted = probe({ PATH: plantedPath, SWENY_PROBE_CANARY: CANARY });
    expect(existsSync(marker)).toBe(false);
    expect(planted).toBe(clean);
    if (process.env.SWENY_REQUIRE_SANDBOX_WRAPPER === "1") expect(planted).toBe(0);
  });
});
