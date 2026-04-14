import { describe, it, expect, vi } from "vitest";

import {
  compareVersions,
  detectPackageManager,
  resolveInstallRoot,
  installCommandFor,
  runUpgrade,
  fetchLatestFromNpm,
  type UpgradeDeps,
} from "../upgrade.js";

// In-memory writable stream for pure assertions on output. Cheaper and
// simpler than a real Node stream and identical to the helper used by
// diagram.test.ts — keeps test utilities consistent across the cli/ dir.
function captureStream() {
  const chunks: string[] = [];
  const stream = {
    write: (chunk: string | Uint8Array) => {
      chunks.push(typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8"));
      return true;
    },
  } as unknown as NodeJS.WritableStream;
  return {
    stream,
    get text() {
      return chunks.join("");
    },
  };
}

/**
 * Build an UpgradeDeps object with sensible defaults. Tests override only
 * the bits relevant to the behavior they're asserting — keeps each case
 * focused on its condition rather than plumbing.
 */
function makeDeps(over: Partial<UpgradeDeps> = {}): {
  deps: UpgradeDeps;
  stdout: ReturnType<typeof captureStream>;
  stderr: ReturnType<typeof captureStream>;
  exit: ReturnType<typeof vi.fn>;
  runInstall: ReturnType<typeof vi.fn>;
} {
  const stdout = captureStream();
  const stderr = captureStream();
  const exit = vi.fn<(code: number) => void>();
  const runInstall = vi.fn<(cmd: string, args: string[]) => number>(() => 0);
  const deps: UpgradeDeps = {
    currentVersion: "0.1.65",
    installPath: "/Users/x/.nvm/versions/node/v22/lib/node_modules/@sweny-ai/core/dist/cli/main.js",
    fetchLatestVersion: vi.fn(async () => "0.1.66"),
    runInstall,
    canWrite: () => true,
    stdout: stdout.stream,
    stderr: stderr.stream,
    exit,
    ...over,
  };
  return { deps, stdout, stderr, exit, runInstall };
}

describe("compareVersions", () => {
  it("ranks by numeric core segments", () => {
    expect(compareVersions("0.1.10", "0.1.9")).toBeGreaterThan(0);
    expect(compareVersions("0.1.9", "0.1.10")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "0.9.999")).toBeGreaterThan(0);
    expect(compareVersions("0.1.65", "0.1.65")).toBe(0);
  });

  it("handles missing segments as zero", () => {
    expect(compareVersions("1", "1.0.0")).toBe(0);
    expect(compareVersions("1.0", "1.0.1")).toBeLessThan(0);
  });

  it("ranks pre-releases below their release", () => {
    expect(compareVersions("1.0.0-alpha.1", "1.0.0")).toBeLessThan(0);
    expect(compareVersions("1.0.0", "1.0.0-beta.3")).toBeGreaterThan(0);
    expect(compareVersions("1.0.0-alpha", "1.0.0-beta")).toBeLessThan(0);
  });

  it("treats non-numeric core segments as zero (defensive)", () => {
    // Malformed numeric segments shouldn't throw or return NaN — they
    // collapse to 0 so the comparison still returns a deterministic ordering.
    expect(compareVersions("1.x.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.0.y", "1.0.0")).toBe(0);
  });
});

describe("detectPackageManager", () => {
  it("detects npm from nvm-style layout", () => {
    expect(
      detectPackageManager("/Users/x/.nvm/versions/node/v22.22.0/lib/node_modules/@sweny-ai/core/dist/cli/main.js"),
    ).toBe("npm");
  });

  it("detects npm from fnm / asdf / vanilla Node paths", () => {
    expect(detectPackageManager("/usr/lib/node_modules/@sweny-ai/core/dist/cli/main.js")).toBe("npm");
    expect(
      detectPackageManager(
        "/home/x/.fnm/node-versions/v22/installation/lib/node_modules/@sweny-ai/core/dist/cli/main.js",
      ),
    ).toBe("npm");
  });

  it("detects pnpm global installs", () => {
    expect(
      detectPackageManager("/Users/x/.local/share/pnpm/global/5/node_modules/@sweny-ai/core/dist/cli/main.js"),
    ).toBe("pnpm");
    expect(detectPackageManager("/Users/x/Library/pnpm-global/5/node_modules/@sweny-ai/core/dist/cli/main.js")).toBe(
      "pnpm",
    );
  });

  it("detects homebrew", () => {
    expect(detectPackageManager("/opt/homebrew/Cellar/sweny/0.1.65/libexec/bin/sweny")).toBe("brew");
    expect(detectPackageManager("/usr/local/Cellar/sweny/0.1.65/libexec/bin/sweny")).toBe("brew");
  });

  it("detects volta-managed installs", () => {
    expect(detectPackageManager("/Users/x/.volta/tools/image/packages/@sweny-ai/core/bin/sweny")).toBe("volta");
  });

  it("detects bun global installs", () => {
    expect(detectPackageManager("/Users/x/.bun/install/global/node_modules/@sweny-ai/core/dist/cli/main.js")).toBe(
      "bun",
    );
  });

  it("detects yarn global", () => {
    expect(detectPackageManager("/Users/x/.yarn/global/node_modules/@sweny-ai/core/dist/cli/main.js")).toBe("yarn");
  });

  it("normalizes Windows paths (forward-slash rules)", () => {
    const win = "C:\\Users\\x\\AppData\\Roaming\\npm\\node_modules\\@sweny-ai\\core\\dist\\cli\\main.js";
    expect(detectPackageManager(win)).toBe("npm");
  });

  it("returns 'unknown' for paths that don't look like a package-manager install", () => {
    expect(detectPackageManager("/tmp/some-random-path/main.js")).toBe("unknown");
  });
});

describe("resolveInstallRoot", () => {
  it("returns the prefix above node_modules for a typical npm layout", () => {
    const p = "/Users/x/.nvm/versions/node/v22/lib/node_modules/@sweny-ai/core/dist/cli/main.js";
    expect(resolveInstallRoot(p)).toBe("/Users/x/.nvm/versions/node/v22/lib");
  });

  it("returns null when @sweny-ai is not in the parent chain", () => {
    expect(resolveInstallRoot("/tmp/random/main.js")).toBeNull();
  });
});

describe("installCommandFor", () => {
  it("emits the correct CLI invocation per package manager", () => {
    expect(installCommandFor("npm", "latest")).toEqual({
      cmd: "npm",
      args: ["install", "-g", "@sweny-ai/core@latest"],
    });
    expect(installCommandFor("pnpm", "latest")).toEqual({ cmd: "pnpm", args: ["add", "-g", "@sweny-ai/core@latest"] });
    expect(installCommandFor("yarn", "latest")).toEqual({
      cmd: "yarn",
      args: ["global", "add", "@sweny-ai/core@latest"],
    });
    expect(installCommandFor("bun", "latest")).toEqual({ cmd: "bun", args: ["add", "-g", "@sweny-ai/core@latest"] });
    expect(installCommandFor("volta", "latest")).toEqual({ cmd: "volta", args: ["install", "@sweny-ai/core@latest"] });
  });

  it("passes through non-default tags", () => {
    expect(installCommandFor("npm", "beta")).toEqual({ cmd: "npm", args: ["install", "-g", "@sweny-ai/core@beta"] });
  });

  it("returns null for brew / unknown (can't drive automatically)", () => {
    expect(installCommandFor("brew", "latest")).toBeNull();
    expect(installCommandFor("unknown", "latest")).toBeNull();
  });
});

describe("runUpgrade — no-op paths", () => {
  it("reports already-latest and exits 0", async () => {
    const { deps, stdout, exit, runInstall } = makeDeps({
      currentVersion: "0.1.66",
      fetchLatestVersion: vi.fn(async () => "0.1.66"),
    });
    await runUpgrade({}, deps);
    expect(stdout.text).toMatch(/already the latest/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("reports when running ahead of the registry (local build) and exits 0", async () => {
    const { deps, stdout, exit, runInstall } = makeDeps({
      currentVersion: "0.2.0",
      fetchLatestVersion: vi.fn(async () => "0.1.66"),
    });
    await runUpgrade({}, deps);
    expect(stdout.text).toMatch(/newer than the published/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("installs anyway when --force is set even if already latest", async () => {
    const { deps, runInstall, exit } = makeDeps({
      currentVersion: "0.1.66",
      fetchLatestVersion: vi.fn(async () => "0.1.66"),
    });
    await runUpgrade({ force: true }, deps);
    expect(runInstall).toHaveBeenCalledWith("npm", ["install", "-g", "@sweny-ai/core@latest"]);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("downgrades when --force is set against a local-dev build ahead of the registry", async () => {
    const { deps, runInstall, exit } = makeDeps({
      currentVersion: "0.2.0",
      fetchLatestVersion: vi.fn(async () => "0.1.66"),
    });
    await runUpgrade({ force: true }, deps);
    // --force explicitly overrides the "ahead" short-circuit — this is how
    // someone pins back to the published train from a stale local build.
    expect(runInstall).toHaveBeenCalledWith("npm", ["install", "-g", "@sweny-ai/core@latest"]);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("runUpgrade — install dispatch", () => {
  it("invokes the detected package manager and exits 0 on success", async () => {
    const { deps, stdout, runInstall, exit } = makeDeps();
    await runUpgrade({}, deps);
    expect(runInstall).toHaveBeenCalledWith("npm", ["install", "-g", "@sweny-ai/core@latest"]);
    expect(stdout.text).toMatch(/Upgrading sweny 0\.1\.65 → 0\.1\.66/);
    expect(stdout.text).toMatch(/✓ Upgraded sweny to 0\.1\.66/);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("uses pnpm when the install path is a pnpm global root", async () => {
    const { deps, runInstall } = makeDeps({
      installPath: "/Users/x/.local/share/pnpm/global/5/node_modules/@sweny-ai/core/dist/cli/main.js",
    });
    await runUpgrade({}, deps);
    expect(runInstall).toHaveBeenCalledWith("pnpm", ["add", "-g", "@sweny-ai/core@latest"]);
  });

  it("forwards a non-default --tag to the install command", async () => {
    const { deps, runInstall } = makeDeps({
      fetchLatestVersion: vi.fn(async (tag: string) => (tag === "beta" ? "0.2.0-beta.1" : "0.1.66")),
    });
    await runUpgrade({ tag: "beta" }, deps);
    expect(runInstall).toHaveBeenCalledWith("npm", ["install", "-g", "@sweny-ai/core@beta"]);
  });

  it("propagates a non-zero install exit code", async () => {
    const { deps, stderr, exit } = makeDeps({
      runInstall: vi.fn(() => 42),
    });
    await runUpgrade({}, deps);
    expect(stderr.text).toMatch(/exited with code 42/);
    expect(exit).toHaveBeenCalledWith(42);
  });
});

describe("runUpgrade — permissions + platform edges", () => {
  it("prints sudo hint and exits 1 when the install prefix isn't writable", async () => {
    const { deps, stderr, exit, runInstall } = makeDeps({
      canWrite: () => false,
    });
    await runUpgrade({}, deps);
    expect(stderr.text).toMatch(/no write permission/);
    expect(stderr.text).toMatch(/sudo npm install -g @sweny-ai\/core@latest/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("defers to brew for homebrew installs (doesn't try to npm-install over it)", async () => {
    const { deps, stdout, stderr, exit, runInstall } = makeDeps({
      installPath: "/opt/homebrew/Cellar/sweny/0.1.65/libexec/bin/sweny",
    });
    await runUpgrade({}, deps);
    expect(stdout.text).toMatch(/0\.1\.66 is available/);
    expect(stderr.text).toMatch(/brew upgrade sweny/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });

  it("prints a manual-install hint for unknown layouts", async () => {
    const { deps, stdout, stderr, exit, runInstall } = makeDeps({
      installPath: "/tmp/some-random-path/main.js",
    });
    await runUpgrade({}, deps);
    expect(stdout.text).toMatch(/0\.1\.66 is available/);
    expect(stderr.text).toMatch(/npm install -g @sweny-ai\/core@latest/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("runUpgrade — --check (dry run)", () => {
  it("reports the command without running it", async () => {
    const { deps, stdout, runInstall, exit } = makeDeps();
    await runUpgrade({ check: true }, deps);
    expect(stdout.text).toMatch(/0\.1\.66 is available/);
    expect(stdout.text).toMatch(/npm install -g @sweny-ai\/core@latest/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(0);
  });

  it("still short-circuits on already-latest under --check", async () => {
    const { deps, stdout, exit } = makeDeps({
      currentVersion: "0.1.66",
      fetchLatestVersion: vi.fn(async () => "0.1.66"),
    });
    await runUpgrade({ check: true }, deps);
    expect(stdout.text).toMatch(/already the latest/);
    expect(exit).toHaveBeenCalledWith(0);
  });
});

describe("runUpgrade — error handling", () => {
  it("exits 1 with a helpful message when the registry fetch fails", async () => {
    const { deps, stderr, exit, runInstall } = makeDeps({
      fetchLatestVersion: vi.fn(async () => {
        throw new Error("ENETDOWN");
      }),
    });
    await runUpgrade({}, deps);
    expect(stderr.text).toMatch(/couldn't reach the npm registry/);
    expect(stderr.text).toMatch(/ENETDOWN/);
    expect(runInstall).not.toHaveBeenCalled();
    expect(exit).toHaveBeenCalledWith(1);
  });
});

describe("fetchLatestFromNpm", () => {
  it("parses the dist-tag JSON and returns the version", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ version: "9.9.9" }), { status: 200 }));
    try {
      expect(await fetchLatestFromNpm("latest")).toBe("9.9.9");
      expect(fetchSpy).toHaveBeenCalledWith(
        "https://registry.npmjs.org/@sweny-ai/core/latest",
        expect.objectContaining({ headers: expect.objectContaining({ accept: "application/json" }) }),
      );
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("throws a clear error when the registry returns non-2xx", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response("not found", { status: 404, statusText: "Not Found" }));
    try {
      await expect(fetchLatestFromNpm("bogus-tag")).rejects.toThrow(/404/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("throws when the registry payload is missing `version`", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({}), { status: 200 }));
    try {
      await expect(fetchLatestFromNpm("latest")).rejects.toThrow(/version/);
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it("URL-encodes the tag so custom tags don't break the path", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async () => new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 }));
    try {
      await fetchLatestFromNpm("next beta");
      expect(fetchSpy).toHaveBeenCalledWith("https://registry.npmjs.org/@sweny-ai/core/next%20beta", expect.anything());
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
