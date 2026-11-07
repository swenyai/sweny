import { describe, it, expect } from "vitest";
import { spawnSync } from "node:child_process";
import path from "node:path";

const script = path.resolve(__dirname, "../../../../scripts/semver-compare.mjs");
const cmp = (a: string, b: string) => spawnSync("node", [script, a, b], { encoding: "utf8" });

describe("scripts/semver-compare.mjs", () => {
  it("orders the SemVer 2.0.0 precedence example (spec item 11)", () => {
    const ordered = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0",
    ];
    for (let i = 0; i < ordered.length - 1; i++) {
      expect(cmp(ordered[i], ordered[i + 1]).stdout.trim(), `${ordered[i]} < ${ordered[i + 1]}`).toBe("-1");
      expect(cmp(ordered[i + 1], ordered[i]).stdout.trim(), `${ordered[i + 1]} > ${ordered[i]}`).toBe("1");
    }
  });

  it("compares numeric fields numerically, not as text", () => {
    expect(cmp("0.1.9", "0.1.10").stdout.trim()).toBe("-1");
    expect(cmp("0.2.0", "0.1.999").stdout.trim()).toBe("1");
    expect(cmp("0.1.201-rc.1", "0.1.201").stdout.trim()).toBe("-1");
    expect(cmp("0.1.201-rc.1", "0.1.200").stdout.trim()).toBe("1");
  });

  it("treats equal versions, and versions differing only in build metadata, as equal", () => {
    expect(cmp("0.1.200", "0.1.200").stdout.trim()).toBe("0");
    expect(cmp("0.1.200+build.1", "0.1.200+build.2").stdout.trim()).toBe("0");
  });

  it("refuses anything that is not a SemVer version", () => {
    for (const [a, b] of [
      ["latest", "0.1.200"],
      ["0.1.200", "v0.1.200"],
      ["0.1", "0.1.200"],
      ["01.1.200", "0.1.200"],
      ["0.1.200-", "0.1.200"],
    ]) {
      const r = cmp(a, b);
      expect(r.status, `${a} vs ${b}`).toBe(2);
      expect(r.stdout).toBe("");
    }
  });
});
