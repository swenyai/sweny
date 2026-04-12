import { describe, it, expect, vi, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { randomBytes } from "node:crypto";

import { execute } from "../../executor.js";
import { MockClaude } from "../../testing.js";
import { createSkillMap } from "../../skills/index.js";
import type { Workflow } from "../../types.js";

function freshDir(name: string): string {
  const dir = path.join(tmpdir(), `sweny-sources-int-${name}-${Date.now()}-${randomBytes(4).toString("hex")}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe("integration: Source resolution across a workflow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("resolves inline, file, and url instructions across three nodes", async () => {
    const dir = freshDir("three-kinds");
    writeFileSync(path.join(dir, "b.md"), "Step B instruction from file.");
    vi.spyOn(globalThis, "fetch").mockImplementation(
      async () => new Response("Step C instruction from URL.", { status: 200 }),
    );

    const workflow: Workflow = {
      id: "three-kinds",
      name: "Three Kinds",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: "Step A inline", skills: [] },
        b: { name: "B", instruction: { file: path.join(dir, "b.md") }, skills: [] },
        c: { name: "C", instruction: { url: "https://example.com/c.md" }, skills: [] },
      },
      edges: [
        { from: "a", to: "b" },
        { from: "b", to: "c" },
      ],
    };

    const skills = createSkillMap([]);
    const result = await execute(
      workflow,
      {},
      {
        skills,
        claude: new MockClaude({
          responses: {
            a: { data: {} },
            b: { data: {} },
            c: { data: {} },
          },
        }),
        cwd: dir,
      },
    );

    // All three nodes should have executed
    expect(result.results.size).toBe(3);

    // Trace should have all sources
    expect(result.trace.sources["nodes.a.instruction"].kind).toBe("inline");
    expect(result.trace.sources["nodes.a.instruction"].content).toBe("Step A inline");
    expect(result.trace.sources["nodes.b.instruction"].kind).toBe("file");
    expect(result.trace.sources["nodes.b.instruction"].content).toBe("Step B instruction from file.");
    expect(result.trace.sources["nodes.c.instruction"].kind).toBe("url");
    expect(result.trace.sources["nodes.c.instruction"].content).toBe("Step C instruction from URL.");
    expect(result.trace.sources["nodes.c.instruction"].fetchedAt).toBeDefined();

    // Every source has a hash
    for (const rs of Object.values(result.trace.sources)) {
      expect(rs.hash).toMatch(/^[0-9a-f]{16}$/);
    }
  });

  it("fails fast with SOURCE_OFFLINE_REQUIRES_FETCH when offline and URL present", async () => {
    const workflow: Workflow = {
      id: "offline-fail",
      name: "Offline fail",
      description: "",
      entry: "a",
      nodes: {
        a: { name: "A", instruction: { url: "https://example.com/x" }, skills: [] },
      },
      edges: [],
    };
    await expect(
      execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude: new MockClaude({ responses: { a: { data: {} } } }),
          offline: true,
        },
      ),
    ).rejects.toThrow(/SOURCE_OFFLINE_REQUIRES_FETCH/);
  });

  it("fails fast with SOURCE_FILE_NOT_FOUND and includes field path", async () => {
    const dir = freshDir("missing");
    const workflow: Workflow = {
      id: "file-missing",
      name: "File missing",
      description: "",
      entry: "bad",
      nodes: {
        bad: { name: "Bad", instruction: { file: "./does-not-exist.md" }, skills: [] },
      },
      edges: [],
    };
    await expect(
      execute(
        workflow,
        {},
        {
          skills: createSkillMap([]),
          claude: new MockClaude({ responses: { bad: { data: {} } } }),
          cwd: dir,
        },
      ),
    ).rejects.toThrow(/SOURCE_FILE_NOT_FOUND.*nodes\.bad\.instruction/);
  });

  it("emits sources:resolved event with all sources before workflow:start", async () => {
    const events: any[] = [];
    const workflow: Workflow = {
      id: "evt-test",
      name: "Event test",
      description: "",
      entry: "only",
      nodes: { only: { name: "Only", instruction: "Go.", skills: [] } },
      edges: [],
    };
    await execute(
      workflow,
      {},
      {
        skills: createSkillMap([]),
        claude: new MockClaude({ responses: { only: { data: {} } } }),
        observer: (e) => events.push(e),
      },
    );

    const srcEvt = events.find((e) => e.type === "sources:resolved");
    expect(srcEvt).toBeDefined();
    expect(srcEvt.sources["nodes.only.instruction"].content).toBe("Go.");

    // sources:resolved should come before workflow:start
    const srcIdx = events.findIndex((e) => e.type === "sources:resolved");
    const startIdx = events.findIndex((e) => e.type === "workflow:start");
    expect(srcIdx).toBeLessThan(startIdx);
  });
});
