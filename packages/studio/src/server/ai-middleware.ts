/**
 * Vite dev server middleware that proxies AI requests through Claude Code.
 *
 * Endpoints:
 *   POST /api/generate-workflow    — buildWorkflow() via ClaudeClient
 *   POST /api/refine-workflow      — refineWorkflow() via ClaudeClient
 *   POST /api/generate-instruction — instruction generation via ClaudeClient
 *
 * Dev-only: this middleware runs inside Vite's configureServer hook.
 * The production SPA build does not include a server — AI features are
 * gated behind import.meta.env.DEV on the client side.
 *
 * No API key needed in the browser — ClaudeClient uses the local Claude Code
 * auth (ANTHROPIC_API_KEY env var or ~/.claude config).
 */

import type { Connect } from "vite";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { isIP } from "node:net";
import type { TLSSocket } from "node:tls";
import type { IncomingMessage, ServerResponse } from "http";
import type { Claude, Skill, Workflow } from "@sweny-ai/core";

// ─── Lazy singleton state ────────────────────────────────────────

let _claude: Claude | null = null;
let _buildWorkflow: ((desc: string, opts: { claude: Claude; skills: Skill[] }) => Promise<Workflow>) | null = null;
let _refineWorkflow:
  ((wf: Workflow, instr: string, opts: { claude: Claude; skills: Skill[] }) => Promise<Workflow>) | null = null;
let _allSkills: Skill[] = [];
let _initPromise: Promise<void> | null = null;

async function ensureInitialized(): Promise<void> {
  if (_claude) return;
  if (_initPromise) return _initPromise;

  _initPromise = (async () => {
    const { createHarness, buildWorkflow, refineWorkflow, builtinSkills } = await import("@sweny-ai/core");

    _claude = createHarness("claude-code", { maxTurns: 3 });
    _buildWorkflow = buildWorkflow;
    _refineWorkflow = refineWorkflow;
    _allSkills = builtinSkills;
  })();

  return _initPromise;
}

// ─── Helpers ─────────────────────────────────────────────────────

const MAX_BODY_BYTES = 1024 * 1024; // 1 MB

function isLoopbackPeer(address: string | undefined): boolean {
  if (!address) return false;
  if (address === "::1") return true;
  // Dual-stack listeners expose IPv4 peers as IPv4-mapped IPv6 addresses.
  const ipv4 = address.startsWith("::ffff:") ? address.slice(7) : address;
  return isIP(ipv4) === 4 && ipv4.startsWith("127.");
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > MAX_BODY_BYTES) {
        req.destroy();
        reject(new Error("Request body too large"));
      }
    });
    req.on("end", () => resolve(data));
    req.on("error", reject);
  });
}

function parseBody(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    throw new SyntaxError("Invalid JSON in request body");
  }
}

function sendJson(res: ServerResponse, status: number, data: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(data));
}

// ─── Route handlers ──────────────────────────────────────────────

async function handleGenerateWorkflow(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInitialized();
    const body = parseBody(await readBody(req)) as { description?: string };
    const { description } = body;

    if (!description?.trim()) {
      return sendJson(res, 400, { error: "description is required" });
    }

    const workflow = await _buildWorkflow!(description, {
      claude: _claude!,
      skills: _allSkills,
    });

    sendJson(res, 200, { workflow });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof SyntaxError ? 400 : 500;
    console.error("[ai-middleware] generate-workflow error:", message);
    sendJson(res, status, { error: message });
  }
}

async function handleRefineWorkflow(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInitialized();
    const body = parseBody(await readBody(req)) as { workflow?: Workflow; instruction?: string };
    const { workflow, instruction } = body;

    if (!workflow || !instruction?.trim()) {
      return sendJson(res, 400, { error: "workflow and instruction are required" });
    }

    const refined = await _refineWorkflow!(workflow, instruction, {
      claude: _claude!,
      skills: _allSkills,
    });

    sendJson(res, 200, { workflow: refined });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof SyntaxError ? 400 : 500;
    console.error("[ai-middleware] refine-workflow error:", message);
    sendJson(res, status, { error: message });
  }
}

async function handleGenerateInstruction(req: IncomingMessage, res: ServerResponse) {
  try {
    await ensureInitialized();
    const body = parseBody(await readBody(req)) as {
      nodeName?: string;
      nodeId?: string;
      skills?: string[];
      existingInstruction?: string;
      workflowContext?: { workflowName?: string; workflowDescription?: string; nodeNames?: string[] };
    };

    const { nodeName, nodeId, skills, existingInstruction, workflowContext } = body;

    if (!nodeName || !nodeId || !Array.isArray(skills) || !workflowContext?.workflowName) {
      return sendJson(res, 400, { error: "nodeName, nodeId, skills, and workflowContext are required" });
    }

    const skillList = skills.length > 0 ? skills.join(", ") : "none (general purpose)";
    const instruction = [
      `Generate a detailed instruction for a workflow node.`,
      `Node: "${nodeName}" (${nodeId})`,
      `Available skills: ${skillList}`,
      `Workflow: "${workflowContext.workflowName}" — ${workflowContext.workflowDescription ?? ""}`,
      `Other nodes: ${(workflowContext.nodeNames ?? []).join(", ")}`,
      "",
      existingInstruction
        ? `Improve and expand this draft instruction:\n${existingInstruction}`
        : `Write a detailed instruction from scratch.`,
      "",
      `Write instructions as if briefing a skilled engineer. Be specific about what to query, how to interpret results, what output to produce, and how to handle edge cases.`,
      `Return ONLY the instruction text — no markdown fences, no explanation.`,
    ].join("\n");

    const result = await _claude!.run({
      instruction,
      context: {},
      tools: [],
    });

    const text = String((result.data as Record<string, unknown>)?.summary ?? "").trim();
    if (!text) {
      return sendJson(res, 500, { error: "No instruction generated" });
    }

    sendJson(res, 200, { instruction: text });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Internal server error";
    const status = err instanceof SyntaxError ? 400 : 500;
    console.error("[ai-middleware] generate-instruction error:", message);
    sendJson(res, status, { error: message });
  }
}

// ─── Vite plugin ─────────────────────────────────────────────────

/**
 * Vite plugin that adds AI middleware to the dev server.
 */
export function aiMiddlewarePlugin() {
  return {
    name: "sweny-ai-middleware",
    configureServer(server: { middlewares: Connect.Server }) {
      // Kept only in this dev server instance, never embedded in a served module.
      const token = randomBytes(32).toString("hex");
      server.middlewares.use(async (req: IncomingMessage, res: ServerResponse, next: Connect.NextFunction) => {
        if (req.method !== "POST") return next();

        const pathname = new URL(req.url ?? "/", "http://localhost").pathname;

        if (
          !["/api/ai-session", "/api/generate-workflow", "/api/refine-workflow", "/api/generate-instruction"].includes(
            pathname,
          )
        )
          return next();

        // Host/Origin can be forged by non-browser clients. Check the transport
        // peer too, including when Vite listens on all interfaces with --host.
        // A local reverse proxy is a trusted local peer; it must not expose these
        // endpoints remotely. Forwarded headers cannot authenticate its clients.
        if (!isLoopbackPeer(req.socket.remoteAddress)) {
          return sendJson(res, 403, { error: "Local connections only" });
        }

        // Do not trust forwarded headers. These endpoints execute local agents,
        // so only the local Studio origin may bootstrap or use a session.
        const protocol = (req.socket as TLSSocket).encrypted ? "https:" : "http:";
        let expectedOrigin: URL;
        try {
          expectedOrigin = new URL(`${protocol}//${req.headers.host}`);
        } catch {
          return sendJson(res, 403, { error: "Forbidden origin" });
        }
        if (
          !["localhost", "127.0.0.1", "[::1]"].includes(expectedOrigin.hostname) ||
          req.headers.origin !== expectedOrigin.origin ||
          (req.headers["sec-fetch-site"] !== undefined && req.headers["sec-fetch-site"] !== "same-origin")
        ) {
          return sendJson(res, 403, { error: "Forbidden origin" });
        }
        if (req.headers["content-type"]?.split(";", 1)[0].trim().toLowerCase() !== "application/json") {
          return sendJson(res, 415, { error: "Content-Type must be application/json" });
        }
        // The browser sends Origin on this JSON POST. A GET bootstrap would
        // lack Origin on normal same-origin fetches and weaken this boundary.
        if (pathname === "/api/ai-session") {
          res.setHeader("Cache-Control", "no-store");
          return sendJson(res, 200, { token });
        }
        const suppliedToken = req.headers["x-sweny-dev-token"];
        if (
          typeof suppliedToken !== "string" ||
          Buffer.byteLength(suppliedToken) !== Buffer.byteLength(token) ||
          !timingSafeEqual(Buffer.from(suppliedToken), Buffer.from(token))
        ) {
          return sendJson(res, 403, { error: "Invalid development session" });
        }

        if (pathname === "/api/generate-workflow") {
          return handleGenerateWorkflow(req, res);
        }
        if (pathname === "/api/refine-workflow") {
          return handleRefineWorkflow(req, res);
        }
        if (pathname === "/api/generate-instruction") {
          return handleGenerateInstruction(req, res);
        }

        next();
      });
    },
  };
}
