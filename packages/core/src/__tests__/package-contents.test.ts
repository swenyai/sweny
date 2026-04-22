import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

// Fix #19 completion: verify the published npm tarball contents don't
// include compiled tests or source maps with test references. If this
// test fails, someone changed tsconfig.build.json / the build script /
// the files list in a way that leaks test artifacts into the published
// package.
//
// Uses `npm pack --dry-run --json` which lists what would ship without
// actually writing a tarball.

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_DIR = resolve(__dirname, "..", "..");

interface NpmPackFile {
  path: string;
  size: number;
  mode: number;
}

interface NpmPackResult {
  files: NpmPackFile[];
  entryCount: number;
  name: string;
  version: string;
}

function getPackFileList(): string[] {
  // npm pack --dry-run --json prints JSON to stdout; needs the build to
  // be up to date. The test suite's default run rebuilds dist, so we rely
  // on that.
  const out = execFileSync("npm", ["pack", "--dry-run", "--json"], {
    cwd: CORE_DIR,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  const parsed = JSON.parse(out) as NpmPackResult[];
  return parsed[0].files.map((f) => f.path);
}

describe("published package contents (npm pack --dry-run)", () => {
  let files: string[];

  // Rebuild is required for this test; the CI build step runs before vitest
  // and populates dist. In local dev, run `npm run build --workspace=packages/core`
  // before running this test.
  it.runIf(process.env.SKIP_PACK_TEST !== "true")("does not include any compiled test files", () => {
    files ??= getPackFileList();
    const testFiles = files.filter((f) => /\.test\.(js|d\.ts|js\.map)$/.test(f));
    expect(testFiles, "published package must not contain .test.* files").toEqual([]);
  });

  it.runIf(process.env.SKIP_PACK_TEST !== "true")("does not include __tests__ directories", () => {
    files ??= getPackFileList();
    const testDirFiles = files.filter((f) => f.includes("/__tests__/") || f.includes("__tests__"));
    expect(testDirFiles, "published package must not contain __tests__ contents").toEqual([]);
  });

  it.runIf(process.env.SKIP_PACK_TEST !== "true")("does not include vitest config files", () => {
    files ??= getPackFileList();
    const vitestFiles = files.filter((f) => /vitest(\.|-).*(\.js|\.ts)$/.test(f));
    expect(vitestFiles, "published package must not contain vitest configs").toEqual([]);
  });

  it.runIf(process.env.SKIP_PACK_TEST !== "true")("ships the expected top-level artifacts", () => {
    files ??= getPackFileList();
    // Spot-check a few known entry points so a regression that accidentally
    // drops dist/ entirely fails loudly.
    expect(files).toContain("dist/index.js");
    expect(files).toContain("dist/browser.js");
    expect(files).toContain("dist/studio.js");
    expect(files).toContain("dist/cli/main.js");
    expect(files).toContain("package.json");
  });
});
