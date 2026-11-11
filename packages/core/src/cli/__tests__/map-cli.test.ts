/**
 * Map nodes through the real CLI entry (#575): `sweny workflow run` passes a
 * journal-backed child-run host, and `sweny workflow resume` after a mid-map
 * kill replays the finished child, resumes the running one in place and
 * launches the rest. The harness is a fake; no agent or network runs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { AgentHarness, HarnessRunRequest, HarnessRunResult } from "../../harness/types.js";

type Act = "ok" | "hang";
const fake = vi.hoisted(() => ({
  /** Per item key, what each call does (the last repeats). */
  plan: {} as Record<string, Act[]>,
  calls: [] as string[],
  inputs: [] as unknown[],
  readOnly: [] as boolean[],
  aborted: [] as string[],
  harnesses: 0,
}));

vi.mock("../../harness/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../harness/index.js")>();
  const { CLAUDE_CODE_CAPABILITIES } = await import("../../harness/capabilities.js");
  const make = (): AgentHarness => {
    fake.harnesses++;
    return {
      id: "mock",
      capabilities: CLAUDE_CODE_CAPABILITIES,
      preflight: async () => ({ ok: true, version: "test" }),
      complete: async () => null,
      run: async (req: HarnessRunRequest): Promise<HarnessRunResult> => {
        const key = (req.context as { input?: { item_key?: string } }).input?.item_key ?? "?";
        const n = fake.calls.filter((c) => c === key).length;
        fake.calls.push(key);
        fake.inputs.push((req.context as { input?: unknown }).input);
        fake.readOnly.push(req.readOnly === true);
        const acts = fake.plan[key] ?? ["ok"];
        if (acts[Math.min(n, acts.length - 1)] === "hang") {
          await new Promise<void>((resolve) => req.signal?.addEventListener("abort", () => resolve(), { once: true }));
          fake.aborted.push(key);
          throw new Error("aborted");
        }
        return {
          status: "success",
          data: { prompt: `p-${key}` },
          toolCalls: [],
          harness: { id: "mock", version: "test" },
          degraded: [],
          contained: true,
        };
      },
    };
  };
  return { ...actual, createHarness: () => make() };
});
vi.mock("../config-file.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config-file.js")>()),
  loadDotenv: () => {},
  loadConfigFile: () => ({}),
  applyAgentFileConfig: () => {},
}));
vi.mock("../../skills/custom-loader.js", () => ({
  configuredSkills: () => [],
  configuredSkillsWithDiagnostics: () => ({ skills: [], warnings: [] }),
}));
vi.mock("../cloud-lifecycle.js", () => ({
  beginCloudLifecycle: async () => null,
  finishCloudLifecycle: async () => {},
  createCloudStreamObserver: () => undefined,
}));
vi.mock("../cloud-report.js", () => ({ reportToCloud: async () => {} }));
vi.mock("../version-check.js", () => ({ maybeNudge: async () => {}, defaultCachePath: () => "unused" }));

vi.setConfig({ testTimeout: 30_000 });

const dirs: string[] = [];
let state = "";
/** Everything the CLI printed, shown when an exit code is not the expected one. */
let printed: string[] = [];
let exitCode: number | undefined;
const keep = (...args: unknown[]) => void printed.push(args.map(String).join(" "));
beforeEach(() => {
  state = mkdtempSync(join(tmpdir(), "sweny-map-cli-state-"));
  dirs.push(state);
  vi.stubEnv("SWENY_STATE_DIR", state);
  vi.stubEnv("GITHUB_STEP_SUMMARY", "");
  exitCode = undefined;
  // Record the first exit code and carry on: the CLI calls exit inside its own try blocks.
  vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    exitCode ??= code ?? 0;
  }) as never);
  printed = [];
  vi.spyOn(console, "log").mockImplementation(keep);
  vi.spyOn(console, "error").mockImplementation(keep);
  vi.spyOn(console, "warn").mockImplementation(keep);
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => (keep(chunk), true));
  vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => (keep(chunk), true));
  fake.plan = {};
  fake.calls = [];
  fake.inputs = [];
  fake.readOnly = [];
  fake.aborted = [];
  fake.harnesses = 0;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const WORKFLOW = `spec_version: "3"
id: todo-prompts
name: Todo prompts
entry: draft_all
nodes:
  draft_all:
    kind: map
    name: Draft all
    items: [{ id: a }, { id: b }, { id: c }, { id: d }]
    key: id
    with: { team: input.team }
    concurrency: 1
    workflow:
      entry: draft
      nodes:
        draft:
          name: Draft
          instruction: Draft a prompt for the item.
          output:
            type: object
            required: [prompt]
            properties: { prompt: { type: string } }
      edges: []
    result: draft
edges: []
`;

function workflowFile(): string {
  const dir = mkdtempSync(join(tmpdir(), "sweny-map-cli-wf-"));
  dirs.push(dir);
  const file = join(dir, "todo-prompts.yml");
  writeFileSync(file, WORKFLOW, "utf-8");
  return file;
}

/** Run the CLI entry (it parses process.argv on import); resolves with the exit code. */
async function cli(...args: string[]): Promise<number> {
  vi.resetModules();
  const argv = process.argv;
  process.argv = ["node", "sweny", ...args];
  try {
    await import("../main.js");
    return exitCode ?? -1;
  } finally {
    process.argv = argv;
  }
}

/** The one run journaled for this workspace, and its map slots' generation dirs. */
async function journaled() {
  const { listJournalRuns, journalDir } = await import("../../journal.js");
  const [runId] = listJournalRuns(process.cwd());
  const children = join(journalDir(process.cwd(), runId), "children");
  const gens = readdirSync(children)
    .flatMap((slot) => readdirSync(join(children, slot)).filter((g) => /^g\d+$/.test(g)))
    .sort();
  return { runId, gens };
}

describe("sweny workflow run with a map node", () => {
  it("runs every item as a read-only, journaled child with a fresh harness", async () => {
    const code = await cli("workflow", "run", workflowFile(), "--no-history", "--input", '{"team":"T"}');
    expect(code, printed.join("\n")).toBe(0);
    expect(fake.calls).toEqual(["a", "b", "c", "d"]);
    // --input reaches the run, and a child gets exactly its item, its key and the with values.
    expect(fake.inputs[0]).toEqual({ item: { id: "a" }, item_key: "a", team: "T" });
    expect(fake.readOnly).toEqual([true, true, true, true]);
    // The parent's harness plus one per child.
    expect(fake.harnesses).toBe(5);
    const { gens } = await journaled();
    expect(gens).toEqual(["g1", "g1", "g1", "g1"]);
  });

  it("resumes after a mid-map kill: the finished child replays, the running one resumes in place, the rest launch", async () => {
    const file = workflowFile();
    fake.plan = { b: ["hang", "ok"] };
    // The wall-clock budget stops the run while b is running.
    const first = await cli("workflow", "run", file, "--no-history", "--timeout", "500", "--input", '{"team":"T"}');
    expect(first, printed.join("\n")).toBe(1);
    await vi.waitFor(() => expect(fake.aborted).toEqual(["b"]));
    await new Promise((r) => setTimeout(r, 50));
    expect(fake.calls).toEqual(["a", "b"]);
    const { runId } = await journaled();

    fake.calls = [];
    const second = await cli("workflow", "resume", runId, "--no-history");
    expect(second, printed.join("\n")).toBe(0);
    expect(fake.calls).toEqual(["b", "c", "d"]);
    const { gens } = await journaled();
    expect(gens).toEqual(["g1", "g1", "g1", "g1"]);
  });
});
