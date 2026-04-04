import { describe, it, expect } from "vitest";
import { available, logAvailability } from "./harness.js";
import { execute } from "../../executor.js";
import { ClaudeClient } from "../../claude.js";
import { createSkillMap } from "../../skills/index.js";
import type { Workflow, ExecutionEvent } from "../../types.js";

logAvailability();

// A minimal 2-node workflow that only uses Claude (no external tools)
const analysisWorkflow: Workflow = {
  id: "e2e-analysis",
  name: "E2E Analysis",
  description: "Two-node workflow using real Claude",
  entry: "analyze",
  nodes: {
    analyze: {
      name: "Analyze Input",
      instruction:
        "Analyze the input data and determine if it represents a critical issue. Return JSON with fields: severity (high/medium/low) and summary (one sentence).",
      skills: [],
      output: {
        type: "object",
        properties: {
          severity: { type: "string", enum: ["high", "medium", "low"] },
          summary: { type: "string" },
        },
        required: ["severity", "summary"],
      },
    },
    report: {
      name: "Generate Report",
      instruction:
        "Based on the analysis, write a brief incident report. Return JSON with fields: title (string) and recommendation (string).",
      skills: [],
      output: {
        type: "object",
        properties: {
          title: { type: "string" },
          recommendation: { type: "string" },
        },
        required: ["title", "recommendation"],
      },
    },
  },
  edges: [{ from: "analyze", to: "report" }],
};

describe.runIf(available.claude)("e2e workflow with real Claude", () => {
  it("executes a 2-node analysis workflow", async () => {
    const claude = new ClaudeClient({
      model: "claude-haiku-4-5-20251001", // Use Haiku for speed/cost in tests
      maxTurns: 3,
    });

    const events: ExecutionEvent[] = [];
    const { results } = await execute(
      analysisWorkflow,
      {
        alert: "CPU usage at 98% for 15 minutes on production server web-03",
        service: "api-gateway",
        timestamp: "2025-03-25T08:00:00Z",
      },
      {
        skills: createSkillMap([]),
        claude,
        observer: (e) => events.push(e),
        config: {},
      },
    );

    // Both nodes executed
    expect(results.size).toBe(2);
    expect(results.get("analyze")?.status).toBe("success");
    expect(results.get("report")?.status).toBe("success");

    // Analysis should have severity
    const analysis = results.get("analyze")!.data;
    expect(analysis).toBeDefined();

    // Report should have title
    const report = results.get("report")!.data;
    expect(report).toBeDefined();

    // Events stream should be complete
    expect(events[0].type).toBe("workflow:start");
    expect(events[events.length - 1].type).toBe("workflow:end");
    expect(events.filter((e) => e.type === "node:enter")).toHaveLength(2);
  }, 60_000); // 60s timeout for real API calls
});
