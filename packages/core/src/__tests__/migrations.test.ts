import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { parse as parseYaml } from "yaml";

import {
  CURRENT_SPEC_VERSION,
  MIGRATIONS,
  assertRegistryValid,
  migrateWorkflow,
  type Migration,
  type MigrationConfig,
} from "../migrations.js";
import { loadAndValidateWorkflow, validateParsed } from "../loader.js";
import { upgradeWorkflowFile } from "../cli/workflow-upgrade.js";

/**
 * Pattern for the next breaking change: append a Migration to MIGRATIONS, bump
 * CURRENT_SPEC_VERSION, and copy the "chain" tests below against the real
 * registry. The fake registry here (v1 had `title`, v2 renamed it `name`, v3
 * added a default `description`) exercises the machinery without a real break.
 */
const v1to2: Migration = {
  from: 1,
  to: 2,
  description: "rename `title` to `name`",
  migrate: (raw) => {
    const { title, ...rest } = raw;
    return { ...rest, name: title };
  },
};
const v2to3: Migration = {
  from: 2,
  to: 3,
  description: "default `description` to the workflow name",
  migrate: (raw) => ({ ...raw, description: raw.description ?? `About ${String(raw.name)}` }),
};
const FAKE: MigrationConfig = { current: 3, migrations: [v1to2, v2to3] };
const IDENTITY: MigrationConfig = {
  current: 2,
  migrations: [{ from: 1, to: 2, description: "identity", migrate: (raw) => ({ ...raw }) }],
};

const BODY = `entry: a
nodes:
  a:
    name: A
    instruction: do a
    skills: []
edges: []
`;
const V1_FILE = `# Header comment
id: demo
title: Demo # trailing note
${BODY}`;

function tmpFile(name: string, content: string) {
  const dir = mkdtempSync(join(tmpdir(), "sweny-migrations-"));
  const path = join(dir, name);
  writeFileSync(path, content, "utf-8");
  return { path, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

describe("registry", () => {
  it("built-in registry is a valid chain to the current version", () => {
    expect(() => assertRegistryValid({ current: CURRENT_SPEC_VERSION, migrations: MIGRATIONS })).not.toThrow();
  });
  it("fake and identity registries are valid; a gap is rejected", () => {
    expect(() => assertRegistryValid(FAKE)).not.toThrow();
    expect(() => assertRegistryValid(IDENTITY)).not.toThrow();
    expect(() => assertRegistryValid({ current: 3, migrations: [v2to3] })).toThrow();
  });
});

describe("spec_version default", () => {
  const base = { id: "d", name: "D", entry: "a", nodes: { a: { name: "A", instruction: "x", skills: [] } }, edges: [] };

  it("a file without spec_version loads as v1 with no warning", () => {
    const r = validateParsed(base);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.warnings).toBeUndefined();
      expect(r.workflow.spec_version).toBeUndefined();
    }
  });
  it("accepts spec_version as string or YAML number and normalizes to a string", () => {
    for (const v of ["1", 1]) {
      const r = validateParsed({ ...base, spec_version: v });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.workflow.spec_version).toBe("1");
    }
  });
  it("rejects a malformed spec_version", () => {
    for (const v of ["abc", "0", "1.5", -1, 0, "v1"]) {
      const r = validateParsed({ ...base, spec_version: v });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors[0].code).toBe("SPEC_VERSION");
    }
  });
});

describe("migration chain", () => {
  it("applies v1 -> v2 -> v3 in order and stamps the final version", () => {
    const r = migrateWorkflow({ id: "d", title: "Demo" }, FAKE);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.from).toBe(1);
      expect(r.to).toBe(3);
      expect(r.applied.map((m) => m.to)).toEqual([2, 3]);
      expect(r.workflow).toEqual({ id: "d", name: "Demo", description: "About Demo", spec_version: "3" });
    }
  });
  it("starts mid-chain and does not mutate its input", () => {
    const input = { id: "d", name: "Demo", spec_version: "2" };
    const r = migrateWorkflow(input, FAKE);
    expect(r.ok && r.applied.map((m) => m.to)).toEqual([3]);
    expect(input).toEqual({ id: "d", name: "Demo", spec_version: "2" });
  });
  it("identity migration leaves content untouched apart from spec_version", () => {
    const input = { id: "d", name: "D", extra: { k: [1, 2] } };
    const r = migrateWorkflow(input, IDENTITY);
    expect(r.ok && r.workflow).toEqual({ ...input, spec_version: "2" });
  });
  it("loader migrates in memory and emits exactly one warning naming the version and the upgrade command", () => {
    const f = tmpFile("wf.yml", V1_FILE);
    try {
      const r = loadAndValidateWorkflow(f.path, { migration: FAKE });
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.workflow.name).toBe("Demo");
        expect(r.workflow.spec_version).toBe("3");
        expect(r.warnings).toHaveLength(1);
        expect(r.warnings![0]).toContain('spec_version "1"');
        expect(r.warnings![0]).toContain("sweny workflow upgrade");
        expect(r.warnings![0]).toContain(f.path);
      }
      expect(readFileSync(f.path, "utf-8")).toBe(V1_FILE); // loader never writes
    } finally {
      f.cleanup();
    }
  });
  it("a failing migration surfaces as a SPEC_VERSION error, not a throw", () => {
    const boom: MigrationConfig = {
      current: 2,
      migrations: [
        {
          from: 1,
          to: 2,
          description: "boom",
          migrate: () => {
            throw new Error("nope");
          },
        },
      ],
    };
    const r = validateParsed({ id: "d" }, { migration: boom });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain("nope");
  });
});

describe("too-new refusal", () => {
  it("refuses a version newer than supported with an upgrade message", () => {
    const r = validateParsed(
      { id: "d", name: "D", entry: "a", nodes: {}, edges: [], spec_version: "99" },
      { migration: FAKE },
    );
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.errors).toHaveLength(1);
      expect(r.errors[0].code).toBe("SPEC_VERSION");
      expect(r.errors[0].message).toContain('"99"');
      expect(r.errors[0].message).toContain('up to "3"');
      expect(r.errors[0].message).toContain("Upgrade sweny");
    }
  });
  it("refuses v2 on the built-in registry (current is v1)", () => {
    const r = validateParsed({ id: "d", spec_version: "2" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors[0].message).toContain("Upgrade sweny");
  });
});

describe("sweny workflow upgrade", () => {
  it("rewrites the file at the current version and keeps comments", () => {
    const f = tmpFile("wf.yml", V1_FILE);
    try {
      const r = upgradeWorkflowFile(f.path, { migration: FAKE });
      expect(r.status).toBe("upgraded");
      if (r.status === "upgraded") {
        expect(r.from).toBe(1);
        expect(r.to).toBe(3);
        expect(r.steps).toEqual([v1to2.description, v2to3.description]);
      }
      const text = readFileSync(f.path, "utf-8");
      expect(text).toContain("# Header comment");
      expect(text.indexOf("# Header comment")).toBeLessThan(text.indexOf("spec_version"));
      expect(text).toMatch(/spec_version: "3"/);
      expect(text).not.toContain("title:");
      const parsed = parseYaml(text);
      expect(parsed.name).toBe("Demo");
      expect(parsed.description).toBe("About Demo");
      expect(parsed.nodes.a.instruction).toBe("do a");
    } finally {
      f.cleanup();
    }
  });
  it("--dry-run reports the change and leaves the file alone", () => {
    const f = tmpFile("wf.yml", V1_FILE);
    try {
      const r = upgradeWorkflowFile(f.path, { migration: FAKE, dryRun: true });
      expect(r.status).toBe("dry-run");
      expect(readFileSync(f.path, "utf-8")).toBe(V1_FILE);
    } finally {
      f.cleanup();
    }
  });
  it("is a no-op on a file already at the current version", () => {
    const f = tmpFile("wf.yml", `spec_version: "1"\nid: demo\nname: Demo\n${BODY}`);
    try {
      const before = readFileSync(f.path, "utf-8");
      expect(upgradeWorkflowFile(f.path)).toEqual({ status: "current", version: 1 });
      expect(readFileSync(f.path, "utf-8")).toBe(before);
    } finally {
      f.cleanup();
    }
  });
  it("stamps spec_version on a current file that omits it, preserving the rest", () => {
    const f = tmpFile("wf.yml", `# keep me\nid: demo\nname: Demo # inline\n${BODY}`);
    try {
      const r = upgradeWorkflowFile(f.path);
      expect(r.status).toBe("upgraded");
      const text = readFileSync(f.path, "utf-8");
      expect(text.startsWith("# keep me\nspec_version:")).toBe(true);
      expect(text).toContain("name: Demo # inline");
    } finally {
      f.cleanup();
    }
  });
  it("rewrites JSON files", () => {
    const f = tmpFile("wf.json", JSON.stringify({ id: "d", name: "Demo", title: "Demo", ...parseYaml(BODY) }));
    try {
      const r = upgradeWorkflowFile(f.path, { migration: IDENTITY });
      expect(r.status).toBe("upgraded");
      const out = JSON.parse(readFileSync(f.path, "utf-8"));
      expect(out.spec_version).toBe("2");
      expect(out.title).toBe("Demo");
    } finally {
      f.cleanup();
    }
  });
  it("refuses a too-new file and a result that would not validate, leaving the file unchanged", () => {
    const tooNew = tmpFile("a.yml", `spec_version: "9"\nid: d\n`);
    const broken = tmpFile("b.yml", `id: d\ntitle: Demo\n`); // missing nodes/edges/entry
    try {
      expect(upgradeWorkflowFile(tooNew.path, { migration: FAKE }).status).toBe("error");
      const r = upgradeWorkflowFile(broken.path, { migration: FAKE });
      expect(r.status).toBe("error");
      expect(readFileSync(broken.path, "utf-8")).toBe(`id: d\ntitle: Demo\n`);
    } finally {
      tooNew.cleanup();
      broken.cleanup();
    }
  });
});

describe("round-trip", () => {
  it("upgrade then load yields the same workflow as loading the old file with in-memory migration, with no warning", () => {
    const f = tmpFile("wf.yml", V1_FILE);
    try {
      const inMemory = loadAndValidateWorkflow(f.path, { migration: FAKE });
      expect(upgradeWorkflowFile(f.path, { migration: FAKE }).status).toBe("upgraded");
      const reloaded = loadAndValidateWorkflow(f.path, { migration: FAKE });
      expect(inMemory.ok && reloaded.ok).toBe(true);
      if (inMemory.ok && reloaded.ok) {
        expect(reloaded.workflow).toEqual(inMemory.workflow);
        expect(reloaded.warnings).toBeUndefined();
      }
      // a second upgrade changes nothing
      const once = readFileSync(f.path, "utf-8");
      expect(upgradeWorkflowFile(f.path, { migration: FAKE }).status).toBe("current");
      expect(readFileSync(f.path, "utf-8")).toBe(once);
    } finally {
      f.cleanup();
    }
  });
});
