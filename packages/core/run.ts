#!/usr/bin/env tsx
/**
 * Quick runner — execute a workflow with real credentials.
 *
 * Uses headless Claude Code as the LLM backend, so it picks
 * up your existing CLAUDE_CODE_OAUTH_TOKEN automatically.
 *
 * Usage:
 *   npx tsx run.ts [workflow] [input]
 *
 * Examples:
 *   npx tsx run.ts triage "5xx spike on /api/v1/users"
 *   npx tsx run.ts implement "Fix issue #42"
 */

import { execute, createSkillMap, configuredSkills, validateWorkflowSkills, ClaudeClient } from "./src/index.js";
import { triageWorkflow, implementWorkflow } from "./src/workflows/index.js";
import type { ExecutionEvent } from "./src/types.js";

const workflows: Record<string, typeof triageWorkflow> = {
  triage: triageWorkflow,
  implement: implementWorkflow,
};

const name = process.argv[2] ?? "triage";
const input = process.argv[3] ?? "";

const workflow = workflows[name];
if (!workflow) {
  console.error(`Unknown workflow: "${name}". Available: ${Object.keys(workflows).join(", ")}`);
  process.exit(1);
}

// ─── Provider detection & validation ────────────────────────────

const available = configuredSkills();
const skills = createSkillMap(available);

const validation = validateWorkflowSkills(workflow, skills);

console.log(`\n  Workflow:  ${workflow.name}`);
if (input) {
  console.log(`  Input:     ${input.slice(0, 120)}`);
}
console.log();

// Show configured providers
if (validation.configured.length > 0) {
  console.log("  Configured:");
  for (const s of validation.configured) {
    console.log(`    ✓ ${s.id} (${s.category})`);
  }
}

// Show missing providers
if (validation.missing.length > 0) {
  console.log("  Missing:");
  for (const m of validation.missing) {
    const envHint = m.missingEnv.length > 0 ? ` — set ${m.missingEnv.join(", ")}` : "";
    console.log(`    ✗ ${m.id} (${m.category})${envHint}`);
  }
}

// Show warnings (notification category missing — non-fatal)
for (const w of validation.warnings) {
  console.log(`\n  ⚠ ${w}`);
}

// Show errors (required category missing — fatal)
if (validation.errors.length > 0) {
  console.error("\n  Errors:");
  for (const e of validation.errors) {
    console.error(`    ✗ ${e}`);
  }
  console.error("\n  Cannot proceed — configure the required providers and try again.\n");
  process.exit(1);
}

console.log();

// ─── Execute ────────────────────────────────────────────────────

const claude = new ClaudeClient({ maxTurns: 15 });

const observer = (event: ExecutionEvent) => {
  switch (event.type) {
    case "workflow:start":
      console.log(`▶ Workflow started: ${event.workflow}`);
      break;
    case "node:enter":
      console.log(`\n┌─ ${event.node}`);
      console.log(`│  ${event.instruction.split("\n")[0].slice(0, 80)}`);
      break;
    case "tool:call":
      console.log(`│  ⚡ ${event.tool}(${JSON.stringify(event.input).slice(0, 120)})`);
      break;
    case "tool:result": {
      const out = JSON.stringify(event.output).slice(0, 200);
      console.log(`│  ✓ ${event.tool} → ${out}`);
      break;
    }
    case "route":
      console.log(`│  → routing to: ${event.to} (${event.reason})`);
      break;
    case "node:exit":
      console.log(`└─ ${event.node}: ${event.result.status} (${event.result.toolCalls.length} tool calls)`);
      break;
    case "workflow:end":
      console.log(`\n■ Workflow complete`);
      break;
  }
};

try {
  const { results } = await execute(workflow, input || undefined, {
    skills,
    claude,
    observer,
  });

  console.log("\n── Results ──────────────────────────────────────────────\n");
  for (const [nodeId, result] of results) {
    console.log(`${nodeId}: ${result.status}`);
    if (Object.keys(result.data).length > 0) {
      console.log(JSON.stringify(result.data, null, 2));
    }
    console.log();
  }
} catch (err: any) {
  console.error(`\n✗ Workflow failed: ${err.message}`);
  process.exit(1);
}
