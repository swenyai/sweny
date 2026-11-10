/**
 * #573: a nested output violation fails the node the same way on every
 * harness. Each case runs the real adapter (Claude Code, Codex, pi) through
 * execute() over its scripted fake (no model is called), with the same
 * answer, and expects the same repair request and the same node error.
 */
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { execute } from "../executor.js";
import { createSkillMap } from "../skills/index.js";
import {
  createClaudeSdkFake,
  createCodexProcessFake,
  createPiProcessFake,
  type HarnessFakes,
} from "../harness/__contract__/fakes.js";
import { CodexHarness } from "../harness/codex.js";
import { PiHarness } from "../harness/pi.js";
import type { AgentHarness } from "../harness/types.js";
import type { JSONSchema, Logger, Workflow } from "../types.js";

// The process fakes spawn real (fake) processes, several per case; give a loaded CI runner room.
vi.setConfig({ testTimeout: 60_000 });

const silent: Logger = { info() {}, warn() {}, error() {}, debug() {} };

const OUTPUT: JSONSchema = {
  type: "object",
  properties: {
    findings: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
        },
        required: ["title", "severity"],
      },
    },
    verdict: { type: "string", enum: ["pass", "fail"] },
  },
  required: ["findings", "verdict"],
};

const workflow: Workflow = {
  id: "parity",
  name: "Parity",
  description: "",
  entry: "review",
  nodes: { review: { name: "Review", instruction: "Review the change", skills: [], output: OUTPUT } },
  edges: [],
};

const GOOD = { findings: [{ title: "t", severity: "high" }], verdict: "fail" };
const BAD = {
  findings: [
    { title: "t", severity: "high" },
    { severity: "urgent", owner: "me" },
  ],
  verdict: "fail",
};

const EXPECTED_ERROR =
  "output schema violation: " +
  "findings[1].title: required but missing; " +
  "findings[1].owner: not allowed (additionalProperties: false); " +
  'findings[1].severity: expected one of ["low","medium","high"], got "urgent"';

const claudeFakes = createClaudeSdkFake();
const codexFakes = createCodexProcessFake();
const piFakes = createPiProcessFake();
afterAll(() => {
  codexFakes.destroy();
  piFakes.destroy();
});

let active: HarnessFakes | undefined;
afterEach(async () => {
  vi.unstubAllEnvs();
  await active?.dispose();
  active = undefined;
});

type Make = () => Promise<{ h: AgentHarness; fakes: HarnessFakes }>;

const HARNESSES: Array<[string, Make]> = [
  [
    "claude-code",
    async () => {
      await claudeFakes.reset();
      const { ClaudeCodeHarness } = await import("../harness/claude-code.js");
      const h = new ClaudeCodeHarness({
        logger: silent,
        envScope: true,
        authProbe: () => ({ ok: true, via: "test" }),
        sandbox: "off",
      });
      return { h, fakes: claudeFakes };
    },
  ],
  [
    "codex",
    async () => {
      codexFakes.reset();
      const h = new CodexHarness({
        logger: silent,
        envScope: true,
        sandbox: "off",
        policy: "warn",
        codexCommand: codexFakes.command,
        killGraceMs: 500,
        authProbe: () => ({ ok: true, via: "test" }),
        sandboxWrapper: null,
      });
      return { h, fakes: codexFakes };
    },
  ],
  [
    "pi",
    async () => {
      piFakes.reset();
      const h = new PiHarness({
        logger: silent,
        envScope: true,
        policy: "warn",
        piCommand: piFakes.command,
        cwd: piFakes.projectDir,
        abortGraceMs: 500,
        killGraceMs: 500,
        sandboxWrapper: null,
        sandbox: "off",
      });
      return { h, fakes: piFakes };
    },
  ],
];

/** The agent's final answer, on the harness's structured channel when it has one, else as the final text. */
function answer(fakes: HarnessFakes, data: unknown) {
  fakes.script([
    {
      kind: "final",
      text: JSON.stringify(data),
      ...(fakes.structuredChannel !== false ? { structured: data } : {}),
    },
  ]);
}

describe.each(HARNESSES)("nested output validation on %s (#573)", (_label, make) => {
  it("a nested violation gets one repair request naming each path, then fails the node identically", async () => {
    const { h, fakes } = await make();
    active = fakes;
    answer(fakes, BAD);
    const { results } = await execute(
      workflow,
      {},
      { skills: createSkillMap([]), harness: h, config: {}, logger: silent },
    );
    expect(fakes.captured().invocations).toBe(2);
    expect(fakes.captured().prompt).toContain(
      "- findings[1].title: required but missing\n" +
        "- findings[1].owner: not allowed (additionalProperties: false)\n" +
        '- findings[1].severity: expected one of ["low","medium","high"], got "urgent"',
    );
    const r = results.get("review")!;
    expect(r.status).toBe("failed");
    expect(r.data.error).toBe(EXPECTED_ERROR);
    expect(r.evals).toEqual([{ name: "output_schema", kind: "value", pass: false, reasoning: EXPECTED_ERROR }]);
  });

  it("a conforming answer passes with no repair request", async () => {
    const { h, fakes } = await make();
    active = fakes;
    answer(fakes, GOOD);
    const { results } = await execute(
      workflow,
      {},
      { skills: createSkillMap([]), harness: h, config: {}, logger: silent },
    );
    expect(fakes.captured().invocations).toBe(1);
    expect(results.get("review")?.status).toBe("success");
    expect(results.get("review")?.data).toMatchObject(GOOD);
  });
});
