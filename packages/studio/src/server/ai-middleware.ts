/**
 * Vite dev server middleware that proxies AI requests through Claude Code.
 *
 * Endpoints:
 *   POST /api/generate-workflow    — buildWorkflow() via ClaudeClient
 *   POST /api/refine-workflow      — refineWorkflow() via ClaudeClient
 *   POST /api/generate-instruction — instruction generation via ClaudeClient
 *
 * No API key needed in the browser — ClaudeClient uses the local Claude Code
 * auth (ANTHROPIC_API_KEY env var or ~/.claude config).
 */

import type { Connect } from "vite";
import type { IncomingMessage, ServerResponse } from "http";

let _claude: any = null;
let _buildWorkflow: any = null;
let _refineWorkflow: any = null;
let _allSkills: any[] = [];

async function ensureInitialized() {
  if (_claude) return;

  // Dynamic import — these are Node-only modules
  const { ClaudeClient, buildWorkflow, refineWorkflow, builtinSkills } = await import("@sweny-ai/core");

  _claude = new ClaudeClient({ maxTurns: 3 });
  _buildWorkflow = buildWorkflow;
  _refineWorkflow = refineWorkflow;
  _allSkills = builtinSkills;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

async function handleGenerateWorkflow(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInitialized();
    const body = JSON.parse(await readBody(req));
    const { description } = body as { description: string };

    if (!description?.trim()) {
      return sendJson(res, 400, { error: "description is required" });
    }

    const workflow = await _buildWorkflow(description, {
      claude: _claude,
      skills: _allSkills,
    });

    sendJson(res, 200, { workflow });
  } catch (err: any) {
    console.error("[ai-middleware] generate-workflow error:", err.message);
    sendJson(res, 500, { error: err.message });
  }
}

async function handleRefineWorkflow(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInitialized();
    const body = JSON.parse(await readBody(req));
    const { workflow, instruction } = body as { workflow: any; instruction: string };

    if (!workflow || !instruction?.trim()) {
      return sendJson(res, 400, { error: "workflow and instruction are required" });
    }

    const refined = await _refineWorkflow(workflow, instruction, {
      claude: _claude,
      skills: _allSkills,
    });

    sendJson(res, 200, { workflow: refined });
  } catch (err: any) {
    console.error("[ai-middleware] refine-workflow error:", err.message);
    sendJson(res, 500, { error: err.message });
  }
}

async function handleGenerateInstruction(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInitialized();
    const body = JSON.parse(await readBody(req));
    const { nodeName, nodeId, skills, existingInstruction, workflowContext } = body as {
      nodeName: string;
      nodeId: string;
      skills: string[];
      existingInstruction: string;
      workflowContext: { workflowName: string; workflowDescription: string; nodeNames: string[] };
    };

    const skillList = skills.length > 0 ? skills.join(", ") : "none (general purpose)";
    const instruction = [
      `Generate a detailed instruction for a workflow node.`,
      `Node: "${nodeName}" (${nodeId})`,
      `Available skills: ${skillList}`,
      `Workflow: "${workflowContext.workflowName}" — ${workflowContext.workflowDescription}`,
      `Other nodes: ${workflowContext.nodeNames.join(", ")}`,
      "",
      existingInstruction
        ? `Improve and expand this draft instruction:\n${existingInstruction}`
        : `Write a detailed instruction from scratch.`,
      "",
      `Write instructions as if briefing a skilled engineer. Be specific about what to query, how to interpret results, what output to produce, and how to handle edge cases.`,
      `Return ONLY the instruction text — no markdown fences, no explanation.`,
    ].join("\n");

    const result = await _claude.run({
      instruction,
      context: {},
      tools: [],
    });

    const text = result.data?.summary ?? "";
    if (!text) {
      return sendJson(res, 500, { error: "No instruction generated" });
    }

    sendJson(res, 200, { instruction: text.trim() });
  } catch (err: any) {
    console.error("[ai-middleware] generate-instruction error:", err.message);
    sendJson(res, 500, { error: err.message });
  }
}

/**
 * Vite plugin that adds AI middleware to the dev server.
 */
export function aiMiddlewarePlugin() {
  return {
    name: "sweny-ai-middleware",
    configureServer(server: { middlewares: Connect.Server }) {
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method !== "POST") return next();

        if (req.url === "/api/generate-workflow") {
          return handleGenerateWorkflow(req, res);
        }
        if (req.url === "/api/refine-workflow") {
          return handleRefineWorkflow(req, res);
        }
        if (req.url === "/api/generate-instruction") {
          return handleGenerateInstruction(req, res);
        }

        next();
      });
    },
  };
}
