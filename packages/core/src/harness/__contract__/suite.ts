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
 * declaration). Fourteen cases, one `it` each, so a report reads "14 passed".
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import type { Logger, Tool } from "../../types.js";
import { AGENT_ENV_ALLOWLIST, AGENT_ENV_PREFIXES } from "../../agent-env.js";
import { UNTRUSTED_DATA_NOTICE } from "../../untrusted.js";
import { ask as coreAsk, evaluate as coreEvaluate } from "../prompts.js";
import { policyGate } from "../policy.js";
import type { AgentHarness, HarnessRunRequest, NodePolicy, ToolClass } from "../types.js";
import { AMBIENT_MCP_CANARY, type HarnessFakes } from "./fakes.js";
import {
  EXIT_CASES,
  FULL_USAGE,
  INJECTION,
  OUTPUT_SCHEMA,
  PARTIAL_USAGE,
  STRUCTURED_CASES,
  TOOL_TRACE_SCRIPT,
  type FakeScript,
} from "./scenarios.js";

export interface MakeOptions {
  logger: Logger;
  /** Turn the harness's native sandbox on (default off, so cases never depend on the host). */
  sandbox?: boolean;
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
type CaseFn = (skip: Skip) => Promise<void>;

export const CONTRACT_CASE_NAMES = [
  "01 env: only the allowlist, the node's vars and auth reach the agent",
  "02 mcp exclusive: only injected servers load, never the user's own config",
  "03 read-only: no write, edit, shell or net tool is granted",
  "04 deny compile: every tool class maps natively or degrades/refuses",
  "05 structured output: valid, fenced, prose, invalid and missing-field results",
  "06 tool trace: parallel same-name calls pair by id, errors and orphans keep status",
  "07 usage: fields map one to one, absent stays absent",
  "08 timeout: fails fast and the agent is stopped",
  "09 abort: the caller's signal stops the run, same guarantees",
  "10 exit semantics: nonzero exit, crash and aborted final are failed, never success",
  "11 fencing: context is fenced as untrusted and cannot close the fence",
  "12 complete(): no tools, no MCP, null on failure, evaluate fails closed",
  "13 capabilities honesty: every native declaration reaches the agent",
  "14 cleanup: nothing is left running or on disk after success, failure and abort",
] as const;

export function runContractSuite(make: MakeHarness, fakes: HarnessFakes, label = "harness"): void {
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
              !nodeVars.includes(k),
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
        if (h.capabilities.mcp.exclusive !== "native") return skip("mcp exclusive is not native");
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
          expect(cap.allows(c), `${c} must be denied in a read-only run`).toBe(false);
        }
        expect(r.degraded).toEqual([]);
      },

      // 4
      async (skip) => {
        const { h } = await fresh();
        const caps = h.capabilities;
        for (const c of TOOL_CLASSES) {
          const mappable =
            caps.builtinDeny === "by-name" ||
            caps.builtinDeny === "by-class" ||
            (caps.builtinDeny === "shell-only" && c === "shell");
          const policy: NodePolicy = { readOnly: false, deny: [c], egress: [], strict: false };
          const warn = policyGate(caps, policy);
          const strict = policyGate(caps, { ...policy, strict: true });
          if (mappable) {
            expect(warn.degraded, `${c} warn`).toEqual([]);
            expect(strict.refuse, `${c} strict`).toBeUndefined();
          } else {
            expect(warn.degraded.length, `${c} warn`).toBeGreaterThan(0);
            expect(warn.refuse, `${c} warn never refuses`).toBeUndefined();
            expect(strict.refuse, `${c} strict`).toBeTypeOf("string");
          }
        }
        // The legacy native-name passthrough reaches the agent.
        if (caps.builtinDeny !== "by-name") return skip("builtinDeny is not by-name");
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
        if (!h.capabilities.usage.tokens) return skip("usage is not captured");
        fakes.script([{ kind: "final", text: "done", usage: FULL_USAGE }]);
        const full = await h.run(req());
        expect(full.usage).toMatchObject(FULL_USAGE);

        fakes.script([{ kind: "final", text: "done", usage: PARTIAL_USAGE }]);
        const partial = await h.run(req());
        expect(partial.usage).toMatchObject(PARTIAL_USAGE);
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
            expect(fakes.captured().allows(c), c).toBe(false);
          }
        }

        // turnLimit native: the per-node limit reaches the agent.
        if (caps.turnLimit === "native") {
          fakes.script(DONE);
          await h.run(req({ maxTurns: 3 }));
          expect(fakes.captured().maxTurns).toBe(3);
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
          ["success", DONE, {}],
          [
            "failure",
            [
              { kind: "tool-call", id: "c1", name: "lookup", input: {} },
              { kind: "exit", code: 1 },
            ],
            {},
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
        await h.run(req({ signal: ac.signal }));
        clearTimeout(timer);
        expect(fakes.captured().stopped, "abort: stopped").toBe(true);
        expect(fakes.leftovers(), "abort: leftovers").toEqual([]);
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
