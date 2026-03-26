import { describe, it, expect, beforeEach } from "vitest";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import * as path from "node:path";
import { tmpdir } from "node:os";

import { MockClaude, createFileSkill } from "../testing.js";
import type { Workflow } from "../types.js";

// ─── Fixtures ────────────────────────────────────────────────────

const tmpBase = path.join(tmpdir(), "sweny-testing-test");

function freshDir(name: string): string {
  const dir = path.join(tmpBase, `${name}-${Date.now()}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  return dir;
}

const testWorkflow: Workflow = {
  id: "test",
  name: "Test",
  description: "",
  entry: "first",
  nodes: {
    first: { name: "First", instruction: "Do the first thing", skills: [] },
    second: { name: "Second", instruction: "Do the second thing", skills: [] },
    alt: { name: "Alt", instruction: "Alternative path", skills: [] },
  },
  edges: [
    { from: "first", to: "second" },
    { from: "first", to: "alt", when: "needs alternative" },
  ],
};

// ─── MockClaude tests ────────────────────────────────────────────

describe("MockClaude", () => {
  it("returns scripted responses in order", async () => {
    const claude = new MockClaude({
      responses: {
        first: { data: { step: 1 } },
        second: { data: { step: 2 } },
      },
    });

    const r1 = await claude.run({ instruction: "Do first", context: {}, tools: [] });
    expect(r1.data.step).toBe(1);

    const r2 = await claude.run({ instruction: "Do second", context: {}, tools: [] });
    expect(r2.data.step).toBe(2);
  });

  it("matches nodes by instruction when workflow is provided", async () => {
    const claude = new MockClaude({
      workflow: testWorkflow,
      responses: {
        first: { data: { step: "first" } },
        alt: { data: { step: "alt" } },
      },
    });

    // Call in non-sequential order using exact instructions
    const r1 = await claude.run({
      instruction: "Alternative path",
      context: {},
      tools: [],
    });
    expect(r1.data.step).toBe("alt");

    const r2 = await claude.run({
      instruction: "Do the first thing",
      context: {},
      tools: [],
    });
    expect(r2.data.step).toBe("first");
  });

  it("tracks execution order", async () => {
    const claude = new MockClaude({
      responses: {
        a: { data: {} },
        b: { data: {} },
      },
    });

    await claude.run({ instruction: "x", context: {}, tools: [] });
    await claude.run({ instruction: "y", context: {}, tools: [] });

    expect(claude.executedNodes).toEqual(["a", "b"]);
  });

  it("returns default response for unknown nodes", async () => {
    const claude = new MockClaude({ responses: {} });
    const result = await claude.run({ instruction: "anything", context: {}, tools: [] });
    expect(result.status).toBe("success");
    expect(result.data.summary).toContain("no scripted response");
  });

  it("executes scripted tool calls", async () => {
    const dir = freshDir("mock-tools");
    const fileSkill = createFileSkill(dir);

    const claude = new MockClaude({
      responses: {
        node1: {
          toolCalls: [{ tool: "fs_write_json", input: { path: "test.json", data: { ok: true } } }],
          data: { wrote: true },
        },
      },
    });

    const result = await claude.run({
      instruction: "Write file",
      context: {},
      tools: fileSkill.tools,
    });

    expect(result.toolCalls).toHaveLength(1);
    expect(result.toolCalls[0].tool).toBe("fs_write_json");
    expect(existsSync(path.join(dir, "test.json"))).toBe(true);
  });

  it("records tool not found errors", async () => {
    const claude = new MockClaude({
      responses: {
        node1: {
          toolCalls: [{ tool: "nonexistent_tool", input: {} }],
          data: {},
        },
      },
    });

    const result = await claude.run({ instruction: "x", context: {}, tools: [] });
    expect(result.toolCalls[0].output).toEqual({ error: "tool not found" });
  });

  describe("evaluate", () => {
    it("follows scripted routes", async () => {
      const claude = new MockClaude({
        responses: { first: { data: {} } },
        routes: { first: "alt" },
      });

      await claude.run({ instruction: "x", context: {}, tools: [] });

      const chosen = await claude.evaluate({
        question: "Which path?",
        context: {},
        choices: [
          { id: "second", description: "Normal path" },
          { id: "alt", description: "Alternative path" },
        ],
      });

      expect(chosen).toBe("alt");
    });

    it("defaults to first choice when no route is scripted", async () => {
      const claude = new MockClaude({ responses: { a: { data: {} } } });
      await claude.run({ instruction: "x", context: {}, tools: [] });

      const chosen = await claude.evaluate({
        question: "Where?",
        context: {},
        choices: [
          { id: "x", description: "First" },
          { id: "y", description: "Second" },
        ],
      });

      expect(chosen).toBe("x");
    });

    it("ignores invalid scripted routes", async () => {
      const claude = new MockClaude({
        responses: { a: { data: {} } },
        routes: { a: "nonexistent" },
      });
      await claude.run({ instruction: "x", context: {}, tools: [] });

      const chosen = await claude.evaluate({
        question: "Where?",
        context: {},
        choices: [{ id: "valid", description: "Valid" }],
      });

      expect(chosen).toBe("valid"); // falls back to first choice
    });
  });
});

// ─── File skill tests ────────────────────────────────────────────

describe("createFileSkill", () => {
  let dir: string;

  beforeEach(() => {
    dir = freshDir("fileskill");
  });

  it("reads and writes JSON", async () => {
    const skill = createFileSkill(dir);
    const write = skill.tools.find((t) => t.name === "fs_write_json")!;
    const read = skill.tools.find((t) => t.name === "fs_read_json")!;

    const ctx: any = { config: {}, logger: console };
    await write.handler({ path: "test.json", data: { hello: "world" } }, ctx);
    const result = await read.handler({ path: "test.json" }, ctx);
    expect(result).toEqual({ hello: "world" });
  });

  it("reads text files", async () => {
    const skill = createFileSkill(dir);
    writeFileSync(path.join(dir, "hello.txt"), "hello world");
    const read = skill.tools.find((t) => t.name === "fs_read_text")!;
    const ctx: any = { config: {}, logger: console };
    const result = await read.handler({ path: "hello.txt" }, ctx);
    expect(result).toBe("hello world");
  });

  it("writes markdown with nested dirs", async () => {
    const skill = createFileSkill(dir);
    const write = skill.tools.find((t) => t.name === "fs_write_markdown")!;
    const ctx: any = { config: {}, logger: console };
    await write.handler({ path: "issues/ISSUE-1.md", content: "# Bug\n\nBroken" }, ctx);

    const content = readFileSync(path.join(dir, "issues/ISSUE-1.md"), "utf-8");
    expect(content).toContain("# Bug");
  });

  it("lists directory contents", async () => {
    const skill = createFileSkill(dir);
    writeFileSync(path.join(dir, "a.txt"), "a");
    writeFileSync(path.join(dir, "b.txt"), "b");
    const list = skill.tools.find((t) => t.name === "fs_list_dir")!;
    const ctx: any = { config: {}, logger: console };
    const result = await list.handler({}, ctx);
    expect(result).toContain("a.txt");
    expect(result).toContain("b.txt");
  });

  it("returns error info for non-existent directory", async () => {
    const skill = createFileSkill(dir);
    const list = skill.tools.find((t) => t.name === "fs_list_dir")!;
    const ctx: any = { config: {}, logger: console };
    const result = await list.handler({ path: "nonexistent" }, ctx);
    expect(result).toHaveProperty("error");
  });

  it("creates deeply nested directories for JSON", async () => {
    const skill = createFileSkill(dir);
    const write = skill.tools.find((t) => t.name === "fs_write_json")!;
    const ctx: any = { config: {}, logger: console };
    await write.handler({ path: "deep/nested/dir/file.json", data: { deep: true } }, ctx);
    expect(existsSync(path.join(dir, "deep/nested/dir/file.json"))).toBe(true);
  });

  it("has correct skill metadata", () => {
    const skill = createFileSkill(dir);
    expect(skill.id).toBe("filesystem");
    expect(skill.tools).toHaveLength(5);
    expect(skill.tools.map((t) => t.name)).toContain("fs_read_json");
    expect(skill.tools.map((t) => t.name)).toContain("fs_read_text");
    expect(skill.tools.map((t) => t.name)).toContain("fs_write_json");
    expect(skill.tools.map((t) => t.name)).toContain("fs_write_markdown");
    expect(skill.tools.map((t) => t.name)).toContain("fs_list_dir");
  });
});
