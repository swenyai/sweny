/**
 * Harness contract suite (#413): one shared set of cases every adapter runs.
 *
 *   runContractSuite(make, fakes, "claude-code");
 *
 * `make` builds the adapter under test, wired to the adapter's fake; `fakes`
 * scripts that fake and reports what it received (see fakes.ts). No case calls
 * a model. Design: research/2026-09-30-sota/harness-design.md, section 4.
 *
 * Each case passes, or is skipped only where the adapter's declared
 * `capabilities` say the opinion is not native (the skip must match the
 * declaration). Twenty-two cases, one `it` each, so a report reads "22 passed".
 * Cases 16 to 18 (#365) prove the node policy reaches the agent, which safe
 * outputs depend on. Case 19 (#442) proves a staged run cannot push through
 * the env it hands the agent. Case 20 (#449) proves live usage reaches
 * `onUsage` and that stopping on it stops the agent. Case 21 (security review
 * 2026-09-30) proves skill credentials never reach the agent unless a node
 * grants one with `agent_env`. Case 22 (#473) proves a git credential the
 * checkout persisted is unreadable to read-only and staged nodes wherever the
 * harness (natively or through the process wrapper) can enforce it, and is
 * reported, or refused under strict, where it cannot.
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import * as path from "node:path";
import type { Logger, NodeUsage, Tool } from "../../types.js";
import { AGENT_ENV_ALLOWLIST, AGENT_ENV_PREFIXES } from "../../agent-env.js";
import { UNTRUSTED_DATA_NOTICE } from "../../untrusted.js";
import { ask as coreAsk, evaluate as coreEvaluate } from "../prompts.js";
import { nativeDenyClasses, policyGate } from "../policy.js";
import type { AgentHarness, HarnessRunRequest, NodePolicy, ToolClass } from "../types.js";
import type { SandboxWrapper } from "../sandbox-wrapper.js";
import { AMBIENT_MCP_CANARY, type FakeCapture, type HarnessFakes } from "./fakes.js";
import { createRecordingWrapper, sandboxWrapperCase } from "./sandbox.js";
import {
  EXIT_CASES,
  FULL_USAGE,
  INJECTION,
  OUTPUT_SCHEMA,
  PARTIAL_USAGE,
  STRUCTURED_CASES,
  TOOL_TRACE_SCRIPT,
  type FakeScript,
  type FakeUsage,
} from "./scenarios.js";

export interface MakeOptions {
  logger: Logger;
  /** Turn the harness's native sandbox on (default off, so cases never depend on the host). */
  sandbox?: boolean;
  /**
   * The host's process sandbox wrapper (#360 step 2). `null` = none available;
   * `undefined` = the adapter's default. Only case 15 sets it.
   */
  sandboxWrapper?: SandboxWrapper | null;
  /** The adapter's working directory (case 22 points it at a checkout). Default: the adapter's own. */
  cwd?: string;
}

/**
 * Build the adapter under test. It must scope the agent env (as CI does), keep
 * the sandbox off unless `sandbox` is set, and be wired to the fake, which has
 * already been reset.
 */
export type MakeHarness = (opts: MakeOptions) => AgentHarness | Promise<AgentHarness>;

const TOOL_CLASSES: ToolClass[] = ["shell", "write", "edit", "net", "subagent"];

const DONE: FakeScript = [{ kind: "final", text: "done" }];

const lookupTool: Tool = {
  name: "lookup",
  description: "Look something up.",
  input_schema: { type: "object", properties: { q: { type: "number" } } },
  handler: async () => ({}),
};

const readOnlyPolicy: NodePolicy = { readOnly: true, deny: [], egress: [], strict: false };

function mkLogger() {
  return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
}

function req(over: Partial<HarnessRunRequest> = {}): HarnessRunRequest {
  return { instruction: "Do the thing.", context: {}, tools: [], ...over };
}

function count(text: string, re: RegExp): number {
  return (text.match(re) ?? []).length;
}

type Skip = (note?: string) => void;

/**
 * Read-only expectation for one tool class. Write, edit, net and subagent must
 * be denied. A shell must be denied too, unless the harness keeps it confined
 * to an OS read-only sandbox (Codex), where it can read but not write or reach
 * the network.
 */
function expectDeniedInReadOnly(cap: FakeCapture, c: ToolClass, label: string): void {
  if (c === "shell" && cap.shellConfinedReadOnly === true) return;
  expect(cap.allows(c), label).toBe(false);
}
type CaseFn = (skip: Skip) => Promise<void>;

export const CONTRACT_CASE_NAMES = [
  "01 env: only the allowlist, the node's vars and auth reach the agent",
  "02 mcp exclusive: only injected servers load, never the user's own config",
  "03 read-only: no write, edit or net tool is granted; a shell only inside an OS read-only sandbox",
  "04 deny compile: every tool class maps natively or degrades/refuses",
  "05 structured output: valid, fenced, prose, invalid and missing-field results",
  "06 tool trace: parallel same-name calls pair by id, errors and orphans keep status",
  "07 usage: fields map one to one, absent stays absent",
  "08 timeout: fails fast and the agent is stopped",
  "09 abort: the caller's signal stops the run, same guarantees",
  "10 exit semantics: nonzero exit, crash, aborted final and a missing result are failed, never success",
  "11 fencing: context is fenced as untrusted and cannot close the fence",
  "12 complete(): no tools, no MCP, null on failure, evaluate fails closed",
  "13 capabilities honesty: every native declaration reaches the agent",
  "14 cleanup: nothing is left running or on disk after success, failure and abort",
  "15 sandbox wrapper: no native sandbox means the agent runs only inside the wrapper, and strict refuses without one",
  "16 policy deny: every class in policy.deny reaches the agent natively, or degrades and strict refuses",
  "17 strict policy: MCP is exclusive for a write-capable node too, or strict refuses",
  "18 policy read-only: policy.readOnly alone is enforced and the skill tool channel survives",
  "19 stage no push: under noPush a git push from the agent's env fails and write tokens are withheld; normal mode pushes",
  "20 live usage: onUsage gets cumulative usage while the node runs, and aborting on it stops the agent",
  "21 credentials: skill credentials never reach a read, staged or default write node; agent_env grants one to that node only",
  "22 checkout token: a persisted git credential is unreadable to read-only and staged nodes where enforceable, else degraded or refused",
  "23 staged MCP: a staged write node loads no injected or skill MCP server, only sweny's own tool channel",
] as const;

export interface ContractSuiteOptions {
  /** Env var names the adapter declares for its own auth (Codex: CODEX_API_KEY, CODEX_HOME, ...). */
  authVars?: readonly string[];
}

export function runContractSuite(
  make: MakeHarness,
  fakes: HarnessFakes,
  label = "harness",
  suiteOpts: ContractSuiteOptions = {},
): void {
  const authVars = suiteOpts.authVars ?? [];
  describe(`harness contract: ${label}`, () => {
    afterEach(async () => {
      vi.unstubAllEnvs();
      await fakes.dispose();
    });

    /** A fresh adapter over a reset fake. */
    async function fresh(opts: { sandbox?: boolean } = {}) {
      await fakes.reset();
      const logger = mkLogger();
      const h = await make({ logger, ...opts });
      return { h, logger };
    }

    const cases: CaseFn[] = [
      // 1
      async () => {
        vi.stubEnv("SWENY_CANARY_SECRET", "canary-secret-value");
        vi.stubEnv("UNRELATED_SECRET", "unrelated-secret-value");
        vi.stubEnv("NODE_SKILL_TOKEN", "node-token-value");
        const nodeVars = ["NODE_SKILL_TOKEN"];

        const assertScoped = () => {
          const env = fakes.captured().env;
          expect(env).not.toHaveProperty("SWENY_CANARY_SECRET");
          expect(env).not.toHaveProperty("UNRELATED_SECRET");
          expect(Object.values(env)).not.toContain("canary-secret-value");
          const offenders = Object.keys(env).filter(
            (k) =>
              !AGENT_ENV_ALLOWLIST.includes(k) &&
              !AGENT_ENV_PREFIXES.some((p) => k.startsWith(p)) &&
              !nodeVars.includes(k) &&
              !authVars.includes(k),
          );
          expect(offenders).toEqual([]);
        };

        const { h } = await fresh();
        fakes.script(DONE);
        await h.run(req({ agentAccess: { envVars: nodeVars, domains: [] } }));
        assertScoped();
        expect(fakes.captured().env.NODE_SKILL_TOKEN).toBe("node-token-value");

        fakes.script(DONE);
        await h.complete({ prompt: "p" });
        assertScoped();
      },

      // 2
      async (skip) => {
        const { h } = await fresh();
        if (h.capabilities.mcp.exclusive === "none") return skip("mcp exclusive is not declared");
        fakes.script(DONE);
        await h.run(
          req({
            readOnly: true,
            policy: readOnlyPolicy,
            tools: [lookupTool],
            mcpServers: { injected: { type: "stdio", command: "injected-server" } },
          }),
        );
        const loaded = fakes.captured().mcpServersLoaded;
        expect(loaded).not.toContain(AMBIENT_MCP_CANARY);
        // Only servers sweny injected: skill tools travel in an adapter-owned server whose name starts with "sweny".
        expect(loaded.filter((n) => n !== "injected" && !n.startsWith("sweny"))).toEqual([]);
      },

      // 3
      async () => {
        const { h } = await fresh();
        fakes.script(DONE);
        const r = await h.run(req({ readOnly: true, policy: readOnlyPolicy }));
        if (h.capabilities.readOnly === "none") {
          // Cannot enforce it, so the run must say so.
          expect(r.degraded.length).toBeGreaterThan(0);
          return;
        }
        const cap = fakes.captured();
        for (const c of TOOL_CLASSES) {
          expectDeniedInReadOnly(cap, c, `${c} must be denied in a read-only run`);
        }
        // Read-only is honored natively, so nothing about it is degraded. A
        // harness with no native turn limit still reports that, and only that.
        const expected = h.capabilities.turnLimit === "native" ? [] : [expect.stringMatching(/^max_turns: /)];
        expect(r.degraded).toEqual(expected);
      },

      // 4
      async () => {
        const { h } = await fresh();
        const caps = h.capabilities;
        const native = nativeDenyClasses(caps);
        for (const c of TOOL_CLASSES) {
          const mappable = native.includes(c);
          const policy: NodePolicy = { readOnly: false, deny: [c], egress: [], strict: false };
          const warn = policyGate(caps, policy);
          const strict = policyGate(caps, { ...policy, strict: true });
          if (mappable) {
            expect(warn.degraded, `${c} warn`).toEqual([]);
            expect(strict.refuse, `${c} strict`).toBeUndefined();
            // Declared native, so the denial must actually reach the agent.
            fakes.script(DONE);
            await h.run(req({ policy }));
            expect(fakes.captured().allows(c), `${c} denied at the agent`).toBe(false);
          } else {
            expect(warn.degraded.length, `${c} warn`).toBeGreaterThan(0);
            expect(warn.refuse, `${c} warn never refuses`).toBeUndefined();
            expect(strict.refuse, `${c} strict`).toBeTypeOf("string");
          }
        }
        // The legacy native-name passthrough reaches the agent. Only a by-name
        // harness takes names verbatim; the class checks above ran for every harness.
        if (caps.builtinDeny !== "by-name") return;
        fakes.script(DONE);
        await h.run(
          req({ disallowedTools: ["Bash"], policy: { readOnly: false, deny: [], egress: [], strict: false } }),
        );
        expect(fakes.captured().nativeDisallowed).toContain("Bash");
      },

      // 5
      async (skip) => {
        let ran = 0;
        for (const sc of STRUCTURED_CASES) {
          const { h, logger } = await fresh();
          if (sc.needsNative && h.capabilities.structuredOutput !== "native") continue;
          // A structured result next to prose needs a separate channel on the wire (Codex has none).
          if (sc.needsNative && fakes.structuredChannel === false) continue;
          fakes.script(sc.script);
          const r = await h.run(req({ outputSchema: OUTPUT_SCHEMA }));
          ran++;
          const final = sc.script.find((s) => s.kind === "final");
          const text = final && final.kind === "final" ? final.text : "";
          // Golden: a finished run is success even when the output is unusable; `data` carries what parsed.
          expect(r.status, sc.label).toBe("success");
          expect(r.data.summary, sc.label).toBe(text);
          expect(Object.keys(r.data).sort(), sc.label).toEqual(["summary", ...Object.keys(sc.fields)].sort());
          expect(r.data, sc.label).toMatchObject(sc.fields);
          const warned = logger.warn.mock.calls.some((c) => /schema/i.test(String(c[0])));
          expect(warned, `${sc.label}: schema warning`).toBe(sc.warns === true);
          if (h.capabilities.structuredOutput === "native") {
            expect(fakes.captured().structuredSchema, sc.label).toEqual(OUTPUT_SCHEMA);
          }
        }
        if (ran === 0) skip("no structured case ran");
      },

      // 6
      async (skip) => {
        const { h } = await fresh();
        if (h.capabilities.toolTrace !== "full") return skip("tool trace is skill-only");
        fakes.script(TOOL_TRACE_SCRIPT);
        const r = await h.run(req());
        expect(r.toolCalls).toHaveLength(3);
        expect(r.toolCalls[0]).toMatchObject({
          tool: "lookup",
          input: { q: 1 },
          status: "error",
          output: { error: "boom" },
        });
        expect(r.toolCalls[1]).toMatchObject({ tool: "lookup", input: { q: 2 }, status: "success", output: { n: 2 } });
        expect(r.toolCalls[2].tool).toBe("never-finishes");
        // Orphaned: no result ever arrived, so it is neither success nor error.
        expect(r.toolCalls[2].status).toBeUndefined();
      },

      // 7
      async (skip) => {
        const { h } = await fresh();
        if (!h.capabilities.usage.tokens && !h.capabilities.usage.costUsd) return skip("usage is not captured");
        // Only fields the wire format carries can arrive; the rest must stay absent (never a guessed 0).
        const carried = new Set<keyof FakeUsage>(fakes.usageFields ?? (Object.keys(FULL_USAGE) as (keyof FakeUsage)[]));
        const pick = (u: FakeUsage) =>
          Object.fromEntries(Object.entries(u).filter(([k]) => carried.has(k as keyof FakeUsage))) as FakeUsage;

        fakes.script([{ kind: "final", text: "done", usage: FULL_USAGE }]);
        const full = await h.run(req());
        expect(full.usage).toMatchObject(pick(FULL_USAGE));
        for (const k of Object.keys(FULL_USAGE) as (keyof FakeUsage)[]) {
          if (!carried.has(k)) expect(full.usage?.[k], `${k} is not on the wire`).toBeUndefined();
        }
        if (!h.capabilities.usage.costUsd) expect(full.usage?.costUsd).toBeUndefined();

        fakes.script([{ kind: "final", text: "done", usage: PARTIAL_USAGE }]);
        const partial = await h.run(req());
        expect(partial.usage).toMatchObject(pick(PARTIAL_USAGE));
        // Absent stays absent, never 0.
        expect(partial.usage?.cacheReadTokens).toBeUndefined();
        expect(partial.usage?.cacheCreationTokens).toBeUndefined();
        expect(partial.usage?.numTurns).toBeUndefined();

        fakes.script(DONE);
        const none = await h.run(req());
        expect(none.usage).toBeUndefined();
      },

      // 8
      async () => {
        const { h } = await fresh();
        fakes.script([{ kind: "tool-call", id: "h1", name: "lookup", input: {} }, { kind: "hang" }]);
        const t0 = Date.now();
        const r = await h.run(req({ timeoutMs: 100 }));
        expect(Date.now() - t0).toBeLessThan(100 + 2000);
        expect(r.status).toBe("failed");
        expect(String(r.data.error)).toMatch(/time/i);
        expect(fakes.captured().stopped).toBe(true);
        expect(fakes.leftovers()).toEqual([]);

        fakes.script([{ kind: "hang" }]);
        const t1 = Date.now();
        expect(await h.complete({ prompt: "p", timeoutMs: 100 })).toBeNull();
        expect(Date.now() - t1).toBeLessThan(100 + 2000);
        expect(fakes.captured().stopped).toBe(true);
        expect(fakes.leftovers()).toEqual([]);
      },

      // 9
      async () => {
        const { h } = await fresh();
        fakes.script([{ kind: "tool-call", id: "a1", name: "lookup", input: {} }, { kind: "hang" }]);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 50);
        const t0 = Date.now();
        const r = await h.run(req({ signal: ac.signal }));
        clearTimeout(timer);
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(r.status).toBe("failed");
        expect(fakes.captured().stopped).toBe(true);
        expect(fakes.leftovers()).toEqual([]);

        fakes.script([{ kind: "hang" }]);
        const ac2 = new AbortController();
        const timer2 = setTimeout(() => ac2.abort(), 50);
        expect(await h.complete({ prompt: "p", signal: ac2.signal })).toBeNull();
        clearTimeout(timer2);
        expect(fakes.captured().stopped).toBe(true);
        expect(fakes.leftovers()).toEqual([]);
      },

      // 10
      async () => {
        for (const ec of EXIT_CASES) {
          const { h } = await fresh();
          fakes.script(ec.script);
          const r = await h.run(req());
          if (ec.ok) {
            expect(r.status, ec.label).toBe("success");
            continue;
          }
          expect(r.status, ec.label).toBe("failed");
          expect(r.data.error, ec.label).toBeTypeOf("string");
          if (ec.toolCalls !== undefined) expect(r.toolCalls, `${ec.label} (toolCalls)`).toHaveLength(ec.toolCalls);

          fakes.script(ec.script);
          expect(await h.complete({ prompt: "p" }), `${ec.label} (complete)`).toBeNull();
        }
      },

      // 11
      async () => {
        const assertFenced = (prompt: string, before: string, label: string) => {
          expect(prompt, label).toContain(UNTRUSTED_DATA_NOTICE);
          expect(count(prompt, /<untrusted-data /g), `${label}: one opening fence`).toBe(1);
          expect(count(prompt, /<\/untrusted-data/g), `${label}: one closing fence`).toBe(1);
          expect(prompt, label).not.toContain(INJECTION);
          expect(prompt.indexOf(before), label).toBeGreaterThanOrEqual(0);
          expect(prompt.indexOf(before), label).toBeLessThan(prompt.indexOf("<untrusted-data "));
        };

        const { h } = await fresh();
        fakes.script(DONE);
        await h.run(req({ instruction: "Triage the issue.", context: { issue: INJECTION } }));
        assertFenced(fakes.captured().prompt, "Triage the issue.", "run");

        fakes.script(DONE);
        await coreAsk(h, { instruction: "Judge the result.", context: { issue: INJECTION } });
        assertFenced(fakes.captured().prompt, "Judge the result.", "ask");
      },

      // 12
      async () => {
        const choices = [
          { id: "a", description: "A" },
          { id: "b", description: "B" },
        ];
        const evalOpts = { question: "Which?", context: { n: 1 }, choices };
        const { h } = await fresh();

        fakes.script([{ kind: "final", text: "b" }]);
        expect(await h.complete({ prompt: "p" })).toBe("b");
        const cap = fakes.captured();
        expect(cap.mcpServersLoaded).toEqual([]);
        for (const c of TOOL_CLASSES) expect(cap.allows(c), `${c} in complete()`).toBe(false);
        if (h.capabilities.turnLimit === "native") expect(cap.maxTurns).toBe(1);

        fakes.script([{ kind: "final", text: "b" }]);
        expect(await coreEvaluate(h, evalOpts)).toBe("b");

        // Failure is null, never a guess (golden: executor.ts fails closed on a null route decision).
        for (const failing of [
          [{ kind: "final", text: "boom", ok: false }],
          [{ kind: "crash", message: "agent down" }],
        ] as FakeScript[]) {
          fakes.script(failing);
          expect(await h.complete({ prompt: "p" })).toBeNull();
          fakes.script(failing);
          expect(await coreEvaluate(h, evalOpts)).toBeNull();
          fakes.script(failing);
          expect(await coreAsk(h, { instruction: "x", context: {} })).toBe("");
        }

        // An answer that names no valid choice is no decision either.
        fakes.script([{ kind: "final", text: "zzz" }]);
        expect(await coreEvaluate(h, evalOpts)).toBeNull();
      },

      // 13
      async () => {
        const { h } = await fresh();
        const caps = h.capabilities;
        expect(await h.preflight()).toMatchObject({ ok: true });

        // Tagging: the result names the harness that produced it.
        fakes.script(DONE);
        const tagged = await h.run(req());
        expect(tagged.harness.id).toBe(h.id);
        expect(tagged.harness.version).toBeTypeOf("string");
        expect(Array.isArray(tagged.degraded)).toBe(true);

        // mcp.inject: an injected server reaches the agent.
        if (caps.mcp.inject) {
          fakes.script(DONE);
          await h.run(req({ mcpServers: { injected: { type: "stdio", command: "injected-server" } } }));
          expect(fakes.captured().mcpServersLoaded).toContain("injected");
        }

        // structuredOutput native: the schema is handed to the agent.
        if (caps.structuredOutput === "native") {
          fakes.script(DONE);
          await h.run(req({ outputSchema: OUTPUT_SCHEMA }));
          expect(fakes.captured().structuredSchema).toEqual(OUTPUT_SCHEMA);
        }

        // builtinDeny by-name: the native names reach the agent.
        if (caps.builtinDeny === "by-name") {
          fakes.script(DONE);
          await h.run(req({ disallowedTools: ["WebFetch"] }));
          expect(fakes.captured().nativeDisallowed).toContain("WebFetch");
        }

        // readOnly native: a dry run strips every write-capable class.
        if (caps.readOnly === "native") {
          fakes.script(DONE);
          await h.run(req({ readOnly: true, policy: readOnlyPolicy }));
          for (const c of ["shell", "write", "edit"] as ToolClass[]) {
            expectDeniedInReadOnly(fakes.captured(), c, c);
          }
        }

        // turnLimit native: the per-node limit reaches the agent.
        if (caps.turnLimit === "native") {
          fakes.script(DONE);
          await h.run(req({ maxTurns: 3 }));
          expect(fakes.captured().maxTurns).toBe(3);
        }

        // turnLimit watchdog: sweny stops a run that goes past the budget, fails it
        // the way a native max_turns stop does, and says the limit was not native.
        if (caps.turnLimit === "watchdog") {
          fakes.script([
            { kind: "tool-call", id: "w1", name: "lookup", input: {} },
            { kind: "tool-result", id: "w1", content: "{}" },
            { kind: "tool-call", id: "w2", name: "lookup", input: {} },
            { kind: "tool-result", id: "w2", content: "{}" },
            { kind: "final", text: "done" },
          ]);
          const r = await h.run(req({ maxTurns: 1 }));
          expect(r.status).toBe("failed");
          expect(String(r.data.error)).toMatch(/max_turns/);
          expect(r.degraded.some((d) => d.startsWith("max_turns"))).toBe(true);
          expect(fakes.captured().stopped).toBe(true);
        }

        // cancel: a timeout gives the agent a way to be stopped.
        fakes.script(DONE);
        await h.run(req({ timeoutMs: 60_000 }));
        expect(fakes.captured().cancelWired).toBe(true);

        // sandbox: asking for it reaches the agent.
        if (caps.sandbox.fs || caps.sandbox.network) {
          const sandboxed = await fresh({ sandbox: true });
          fakes.script(DONE);
          await sandboxed.h.run(req());
          expect(fakes.captured().sandboxed).toBe(true);
        }

        // usage: declared tokens and cost are captured.
        if (caps.usage.tokens) {
          const again = await fresh();
          fakes.script([{ kind: "final", text: "done", usage: { inputTokens: 1, outputTokens: 2 } }]);
          const r = await again.h.run(req());
          expect(r.usage).toMatchObject({ inputTokens: 1, outputTokens: 2 });
        }
      },

      // 14
      async () => {
        const scenarios: [string, FakeScript, Partial<HarnessRunRequest>][] = [
          // Skill tools and an output schema, so any bridge socket or schema file the adapter makes is checked too.
          ["success", DONE, { tools: [lookupTool], outputSchema: OUTPUT_SCHEMA }],
          [
            "failure",
            [
              { kind: "tool-call", id: "c1", name: "lookup", input: {} },
              { kind: "exit", code: 1 },
            ],
            { tools: [lookupTool], outputSchema: OUTPUT_SCHEMA },
          ],
        ];
        for (const [label, script, over] of scenarios) {
          const { h } = await fresh();
          fakes.script(script);
          await h.run(req(over));
          expect(fakes.captured().stopped, `${label}: stopped`).toBe(true);
          expect(fakes.leftovers(), `${label}: leftovers`).toEqual([]);
        }

        const { h } = await fresh();
        fakes.script([{ kind: "hang" }]);
        const ac = new AbortController();
        const timer = setTimeout(() => ac.abort(), 50);
        await h.run(req({ signal: ac.signal, tools: [lookupTool], outputSchema: OUTPUT_SCHEMA }));
        clearTimeout(timer);
        expect(fakes.captured().stopped, "abort: stopped").toBe(true);
        expect(fakes.leftovers(), "abort: leftovers").toEqual([]);
      },

      // 15
      async (skip) => {
        await sandboxWrapperCase(make, fakes, skip);
      },

      // 16 (#365): case 4 checks the gate; this checks the deny actually reaches the agent.
      async () => {
        const { h } = await fresh();
        const native = nativeDenyClasses(h.capabilities);
        const denyGaps = (d: string[]) => d.filter((x) => x.startsWith("deny "));
        for (const c of TOOL_CLASSES) {
          const mappable = native.includes(c);
          const policy: NodePolicy = { readOnly: false, deny: [c], egress: [], strict: false };

          fakes.script(DONE);
          const warn = await h.run(req({ policy }));
          if (mappable) {
            expect(fakes.captured().allows(c), `${c} must be denied`).toBe(false);
            expect(denyGaps(warn.degraded), c).toEqual([]);
          } else {
            expect(denyGaps(warn.degraded).length, `${c} degraded`).toBeGreaterThan(0);
          }

          fakes.script(DONE);
          const before = fakes.captured().invocations;
          const strict = await h.run(req({ policy: { ...policy, strict: true } }));
          if (mappable) {
            expect(strict.status, `${c} strict`).toBe("success");
            expect(fakes.captured().allows(c), `${c} strict`).toBe(false);
          } else {
            // Refused before the agent ever starts.
            expect(strict.status, `${c} strict`).toBe("failed");
            expect(fakes.captured().invocations, `${c} strict: agent not started`).toBe(before);
          }
        }
      },

      // 17 (#365): `permissions.strict` asks for exclusive MCP. A harness that
      // cannot exclude the user's own servers refuses before the agent starts.
      async () => {
        const { h } = await fresh();
        fakes.script(DONE);
        const before = fakes.captured().invocations;
        const r = await h.run(
          req({
            policy: { readOnly: false, deny: [], egress: [], strict: true, exclusiveMcp: true },
            tools: [lookupTool],
            mcpServers: { injected: { type: "stdio", command: "injected-server" } },
          }),
        );
        if (h.capabilities.mcp.exclusive === "none") {
          expect(r.status).toBe("failed");
          expect(fakes.captured().invocations, "agent not started").toBe(before);
          return;
        }
        expect(r.status).toBe("success");
        const loaded = fakes.captured().mcpServersLoaded;
        expect(loaded).toContain("injected");
        expect(loaded).not.toContain(AMBIENT_MCP_CANARY);
      },

      // 18 (#365): safe outputs rely on this. A read-only node still needs its
      // skill tools (emit_output among them), and nothing that can write.
      async () => {
        const { h } = await fresh();
        fakes.script(DONE);
        const r = await h.run(req({ policy: readOnlyPolicy, tools: [lookupTool] }));
        if (h.capabilities.readOnly === "none") {
          expect(r.degraded.length).toBeGreaterThan(0);
          return;
        }
        const cap = fakes.captured();
        for (const c of TOOL_CLASSES) {
          expectDeniedInReadOnly(cap, c, `${c} must be denied under policy.readOnly`);
        }
        expect(cap.mcpServersLoaded.some((n) => n.startsWith("sweny"))).toBe(true);
        if (h.capabilities.mcp.exclusive !== "none") expect(cap.mcpServersLoaded).not.toContain(AMBIENT_MCP_CANARY);
        expect(r.degraded.filter((d) => d.startsWith("read-only"))).toEqual([]);
      },

      // 19 (#442): --stage / --dry-run mark the node noPush. The agent's shell
      // inherits the env the adapter hands it, so a real `git push` run with
      // that exact env is what the agent's own push would do.
      async (skip) => {
        if (process.platform === "win32") return skip("posix git fixture");
        vi.stubEnv("GITHUB_TOKEN", "stage-write-token");
        vi.stubEnv("GH_TOKEN", "stage-gh-token");
        const nodeVars = ["GITHUB_TOKEN"];
        const root = mkdtempSync(path.join(tmpdir(), "sweny-contract-442-"));
        try {
          const remote = path.join(root, "remote.git");
          const work = path.join(root, "work");
          const hostEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: path.join(root, "gc") };
          writeFileSync(hostEnv.GIT_CONFIG_GLOBAL, "");
          const sh = (args: string[], cwd: string, env: NodeJS.ProcessEnv) =>
            spawnSync("git", args, { cwd, env, encoding: "utf8", timeout: 30_000 });
          expect(sh(["init", "-q", "--bare", remote], root, hostEnv).status).toBe(0);
          expect(sh(["init", "-q", work], root, hostEnv).status).toBe(0);
          const c = ["-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "x"];
          expect(sh(c, work, hostEnv).status).toBe(0);
          expect(sh(["remote", "add", "origin", remote], work, hostEnv).status).toBe(0);
          const refs = () => (sh(["for-each-ref", "--format=%(refname)"], remote, hostEnv).stdout ?? "").trim();
          // The agent's env, isolated from the host's global git config.
          const agentEnv = (env: Record<string, string>) => ({
            ...env,
            PATH: env.PATH ?? process.env.PATH ?? "",
            GIT_CONFIG_NOSYSTEM: "1",
            GIT_CONFIG_GLOBAL: hostEnv.GIT_CONFIG_GLOBAL,
          });

          const { h } = await fresh();
          fakes.script(DONE);
          await h.run(req({ agentAccess: { envVars: nodeVars, domains: [], noPush: true } }));
          const staged = fakes.captured().env;
          expect(staged, "write token withheld even when the node declares it").not.toHaveProperty("GITHUB_TOKEN");
          expect(Object.values(staged)).not.toContain("stage-write-token");
          expect(Object.values(staged)).not.toContain("stage-gh-token");
          for (const args of [
            ["push", "origin", "HEAD:refs/heads/a"],
            ["push", "--no-verify", "--force", "origin", "HEAD:refs/heads/b"],
            ["push"],
          ]) {
            const r = sh(args, work, agentEnv(staged));
            expect(r.status, `staged git ${args.join(" ")}`).not.toBe(0);
          }
          expect(refs(), "nothing reached the remote").toBe("");

          fakes.script(DONE);
          await h.run(req({ agentAccess: { envVars: nodeVars, domains: [] } }));
          const normal = fakes.captured().env;
          expect(normal.GITHUB_TOKEN).toBe("stage-write-token");
          const ok = sh(["push", "-q", "origin", "HEAD:refs/heads/ok"], work, agentEnv(normal));
          expect(ok.status, `normal push: ${ok.stderr}`).toBe(0);
          expect(refs()).toBe("refs/heads/ok");
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },

      // 20
      async (skip) => {
        const { h } = await fresh();
        const caps = h.capabilities.usage;
        if (!caps.live) return skip("live usage is not declared");
        const unit = caps.liveUnits?.[0] ?? (caps.tokens ? "tokens" : "costUsd");
        const report = (n: number): FakeUsage =>
          unit === "tokens" ? { inputTokens: n, outputTokens: 1 } : { costUsd: n };
        const total = (u: NodeUsage): number =>
          unit === "tokens" ? (u.inputTokens ?? 0) + (u.outputTokens ?? 0) : (u.costUsd ?? 0);

        // Reports arrive before the run ends, cumulative, never going backwards.
        fakes.script([
          { kind: "usage", usage: report(10) },
          { kind: "usage", usage: report(30) },
          { kind: "final", text: "done", usage: report(30) },
        ]);
        const seen: number[] = [];
        const ok = await h.run(req({ onUsage: (u) => seen.push(total(u)) }));
        expect(ok.status).toBe("success");
        expect(seen.length).toBeGreaterThan(0);
        expect(seen).toEqual([...seen].sort((a, b) => a - b));
        expect(Math.max(...seen)).toBeGreaterThanOrEqual(30);

        // A caller that aborts on a report (what a spend budget does) stops the agent.
        fakes.script([{ kind: "usage", usage: report(500) }, { kind: "hang" }]);
        const ac = new AbortController();
        const t0 = Date.now();
        const r = await h.run(
          req({
            signal: ac.signal,
            onUsage: (u) => {
              if (total(u) >= 100) ac.abort();
            },
          }),
        );
        expect(Date.now() - t0).toBeLessThan(2000);
        expect(r.status).toBe("failed");
        expect(fakes.captured().stopped).toBe(true);
        expect(fakes.leftovers()).toEqual([]);
      },

      // 21 (security review 2026-09-30, findings 1 and 3): skill tools run in
      // sweny, so the agent process never holds a skill credential: not on a
      // read node, not on a staged node (even with a grant), not on a write
      // node that did not opt in, not in complete(). `agent_env` grants one
      // name to exactly that node.
      async () => {
        vi.stubEnv("GITHUB_TOKEN", "canary-github-token");
        vi.stubEnv("GH_TOKEN", "canary-gh-token");
        vi.stubEnv("LINEAR_API_KEY", "canary-linear-key");
        vi.stubEnv("SLACK_BOT_TOKEN", "canary-slack-token");
        vi.stubEnv("CUSTOM_SKILL_SECRET", "canary-custom-secret");
        const withhold = ["GITHUB_TOKEN", "LINEAR_API_KEY", "SLACK_BOT_TOKEN", "CUSTOM_SKILL_SECRET"];
        const canaries = [
          "canary-github-token",
          "canary-gh-token",
          "canary-linear-key",
          "canary-slack-token",
          "canary-custom-secret",
        ];
        const leaked = () => Object.values(fakes.captured().env).filter((v) => canaries.includes(v));
        const { h } = await fresh();

        const nodes: [string, Partial<HarnessRunRequest>][] = [
          [
            "read node",
            { readOnly: true, policy: readOnlyPolicy, agentAccess: { envVars: [], domains: [], withhold } },
          ],
          [
            "staged node with a grant",
            { agentAccess: { envVars: ["GITHUB_TOKEN"], domains: [], withhold, noPush: true } },
          ],
          ["write node without opt-in", { agentAccess: { envVars: [], domains: [], withhold } }],
          ["no access declared", {}],
        ];
        for (const [label, over] of nodes) {
          fakes.script(DONE);
          const before = fakes.captured().invocations;
          await h.run(req(over));
          expect(fakes.captured().invocations, `${label}: agent started`).toBe(before + 1);
          expect(leaked(), label).toEqual([]);
        }
        fakes.script(DONE);
        const beforeComplete = fakes.captured().invocations;
        await h.complete({ prompt: "p" });
        expect(fakes.captured().invocations, "complete(): agent started").toBe(beforeComplete + 1);
        expect(leaked(), "complete()").toEqual([]);

        // Opt-in: the granted name only, on that node only.
        fakes.script(DONE);
        await h.run(req({ agentAccess: { envVars: ["GITHUB_TOKEN"], domains: [], withhold } }));
        const granted = fakes.captured().env;
        expect(granted.GITHUB_TOKEN).toBe("canary-github-token");
        expect(Object.values(granted).filter((v) => canaries.includes(v))).toEqual(["canary-github-token"]);
        fakes.script(DONE);
        await h.run(req({ agentAccess: { envVars: [], domains: [], withhold } }));
        expect(leaked(), "the next node does not inherit the grant").toEqual([]);
      },
      // 22 (#473): actions/checkout persists the job token in the checkout
      // (`persist-credentials: true`, the default). Env scoping cannot reach a
      // file, so a read-only or staged node's agent must be denied the file
      // itself: natively (the fake reports `unreadable`) or by the process
      // wrapper (`denyRead` on the wrap request). Where neither holds, the node
      // is reported degraded and refused under strict. A default write node is
      // left as it was. The canary value never appears in any result.
      async (skip) => {
        if (process.platform === "win32") return skip("posix paths");
        const CANARY = "contract-473-canary-token";
        const root = mkdtempSync(path.join(tmpdir(), "sweny-contract-473-"));
        try {
          const repo = path.join(root, "checkout");
          mkdirSync(path.join(repo, ".git"), { recursive: true });
          const configPath = path.join(repo, ".git", "config");
          writeFileSync(
            configPath,
            `[core]\n\trepositoryformatversion = 0\n[http "https://github.com/"]\n\textraheader = AUTHORIZATION: basic ${CANARY}\n`,
          );
          const config = realpathSync(configPath);
          const gap = (d: string[]) => d.filter((x) => x.startsWith("git credential"));
          const masked = (cap: FakeCapture, denyRead?: readonly string[]) =>
            cap.unreadable?.(config) === true || (denyRead ?? []).some((p) => realpathSync(p) === config);
          const build = async (o: { sandbox?: boolean; sandboxWrapper?: SandboxWrapper | null } = {}) => {
            await fakes.reset();
            return make({ logger: mkLogger(), cwd: repo, sandboxWrapper: o.sandboxWrapper ?? null, ...o });
          };
          const write: NodePolicy = { readOnly: false, deny: [], egress: [], strict: false };
          const nodes: [string, Partial<HarnessRunRequest>, NodePolicy][] = [
            ["read-only node", { readOnly: true }, readOnlyPolicy],
            ["staged node", { agentAccess: { envVars: [], domains: [], noPush: true } }, write],
          ];

          // 1. No wrapper, no sandbox: masked natively, or reported (and refused under strict).
          const bare = await build();
          for (const [label, over, policy] of nodes) {
            fakes.script(DONE);
            const r = await bare.run(req({ ...over, policy }));
            expect(JSON.stringify(r), `${label}: canary in the result`).not.toContain(CANARY);
            const native = masked(fakes.captured());
            if (native) {
              expect(gap(r.degraded), `${label}: masked natively`).toEqual([]);
              continue;
            }
            expect(gap(r.degraded).length, `${label}: unmasked must be reported`).toBeGreaterThan(0);
            expect(gap(r.degraded).join(" "), `${label}: names the file`).toContain(config);
            fakes.script(DONE);
            const before = fakes.captured().invocations;
            const strict = await bare.run(req({ ...over, policy: { ...policy, strict: true } }));
            expect(strict.status, `${label}: strict refuses`).toBe("failed");
            expect(fakes.captured().invocations, `${label}: strict, agent not started`).toBe(before);
          }

          // 2. With containment (the native sandbox, or the process wrapper): masked, strict passes.
          const native = bare.capabilities.sandbox.fs && bare.capabilities.sandbox.network;
          const rec = createRecordingWrapper();
          const contained = native ? await build({ sandbox: true }) : await build({ sandboxWrapper: rec });
          for (const [label, over, policy] of nodes) {
            fakes.script(DONE);
            const p: NodePolicy = { ...policy, strict: true, sandbox: "strict" };
            const r = await contained.run(req({ ...over, policy: p }));
            expect(r.status, `${label} contained: ${JSON.stringify(r.data)}`).toBe("success");
            expect(masked(fakes.captured(), rec.requests.at(-1)?.denyRead), `${label}: unreadable`).toBe(true);
            expect(gap(r.degraded), `${label}: nothing to report`).toEqual([]);
            expect(JSON.stringify(r)).not.toContain(CANARY);
          }

          // 3. A default write node keeps today's behavior: no mask, nothing reported.
          fakes.script(DONE);
          const before = rec.requests.length;
          const w = await contained.run(req({ policy: { ...write, sandbox: native ? undefined : "strict" } }));
          expect(w.status).toBe("success");
          expect(gap(w.degraded)).toEqual([]);
          if (!native) expect(rec.requests.slice(before).every((q) => !q.denyRead?.length)).toBe(true);
        } finally {
          rmSync(root, { recursive: true, force: true });
        }
      },

      // 23: a staged run (--stage, safe_outputs.staged, dry run) marks every
      // node noMcp. An MCP server cannot be classified per tool, so it may
      // write: none reaches a staged write node. Skill tools still travel in
      // sweny's own channel, already filtered to reads by the executor.
      async () => {
        const injected = { injected: { type: "stdio" as const, command: "injected-write-server" } };
        const { h } = await fresh();
        fakes.script(DONE);
        await h.run(
          req({
            tools: [lookupTool],
            mcpServers: injected,
            agentAccess: { envVars: [], domains: [], noPush: true, noMcp: true },
          }),
        );
        const loaded = fakes.captured().mcpServersLoaded;
        expect(loaded).not.toContain("injected");
        expect(loaded.filter((n) => !n.startsWith("sweny") && n !== AMBIENT_MCP_CANARY)).toEqual([]);
        expect(loaded.some((n) => n.startsWith("sweny"))).toBe(true);
        if (h.capabilities.mcp.exclusive !== "none") expect(loaded).not.toContain(AMBIENT_MCP_CANARY);

        // Control: the same write node, not staged, gets the injected server.
        if (h.capabilities.mcp.inject) {
          fakes.script(DONE);
          await h.run(req({ tools: [lookupTool], mcpServers: injected }));
          expect(fakes.captured().mcpServersLoaded).toContain("injected");
        }
      },
    ];

    if (cases.length !== CONTRACT_CASE_NAMES.length) throw new Error("contract case list out of sync with names");
    cases.forEach((fn, i) => {
      it(CONTRACT_CASE_NAMES[i], async (ctx) => {
        await fn(() => ctx.skip());
      });
    });
  });
}
