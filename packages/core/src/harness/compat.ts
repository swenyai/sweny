/**
 * Bridges between the legacy `Claude` interface and `AgentHarness`.
 * No agent SDK imports: the executor uses this.
 */

import type { Claude } from "../types.js";
import { CLAUDE_CODE_CAPABILITIES } from "./capabilities.js";
import { ask, evaluate, legacyClaudeOf, registerLegacyClaude } from "./prompts.js";
import type { AgentHarness, HarnessCompleteRequest, HarnessRunRequest, HarnessRunResult } from "./types.js";

function isHarness(x: unknown): x is AgentHarness {
  const h = x as Partial<AgentHarness> | null;
  return !!h && typeof h.complete === "function" && typeof h.preflight === "function" && !!h.capabilities;
}

/**
 * Wrap a legacy `Claude` object (`ExecuteOptions.claude`) as an `AgentHarness`.
 * The legacy object's own `ask` / `evaluate` keep winning, so a custom or mock
 * `Claude` behaves exactly as it did before the seam.
 */
export function claudeCompat(claude: Claude): AgentHarness {
  if (isHarness(claude)) return claude;
  const harness: AgentHarness = {
    id: "claude-code",
    capabilities: CLAUDE_CODE_CAPABILITIES,
    defaultJudgeModel: claude.defaultJudgeModel,
    async preflight() {
      return { ok: true, version: "legacy-compat" };
    },
    async run(req: HarnessRunRequest): Promise<HarnessRunResult> {
      const result = await claude.run(req);
      return { ...result, harness: { id: "claude-code", version: "legacy-compat" }, degraded: [] };
    },
    async complete(req: HarnessCompleteRequest): Promise<string | null> {
      // A legacy ask() with an empty context sends the instruction unchanged.
      return claude.ask({
        instruction: req.prompt,
        context: {},
        model: req.model,
        timeoutMs: req.timeoutMs,
        signal: req.signal,
      });
    },
  };
  registerLegacyClaude(harness, claude);
  return harness;
}

/**
 * View a harness as the `Claude` shape the executor, retry and judge code
 * consume: `run` goes to the harness, `ask` / `evaluate` are core prompts over
 * `complete()`. A harness made by {@link claudeCompat} unwraps to the original.
 */
export function asClaude(harness: AgentHarness): Claude {
  const legacy = legacyClaudeOf(harness);
  if (legacy) return legacy;
  // A harness that carries its own ask/evaluate (ClaudeCodeHarness delegates to
  // core; MockHarness scripts them) keeps them. Others get the core prompts.
  const own = harness as Partial<Pick<Claude, "ask" | "evaluate">>;
  return {
    defaultJudgeModel: harness.defaultJudgeModel,
    run: (req) => harness.run(req),
    evaluate: (opts) => (own.evaluate ? own.evaluate(opts) : evaluate(harness, opts)),
    ask: (opts) => (own.ask ? own.ask(opts) : ask(harness, opts)),
  };
}
