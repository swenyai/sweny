/**
 * sweny e2e — Generate and run agent-driven end-to-end browser tests.
 *
 * Pure functions for workflow generation + thin @clack/prompts interactive layer.
 * Tests cover the pure functions; the interactive wizard is thin glue.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as p from "@clack/prompts";
import chalk from "chalk";
import { stringify as stringifyYaml } from "yaml";

import { execute } from "../executor.js";
import { ClaudeClient } from "../claude.js";
import { createSkillMap, configuredSkills } from "../skills/index.js";
import { consoleLogger } from "../types.js";
import type { Workflow, Node, Edge, ExecutionEvent, Observer, NodeResult } from "../types.js";
import { loadWorkflowFile } from "./main.js";

// ── Types ──────────────────────────────────────────────────────────────

export type FlowType = "registration" | "login" | "purchase" | "onboarding" | "upgrade" | "cancellation" | "custom";

export interface FlowConfig {
  type: FlowType;
  /** URL path for the flow (e.g. /signup, /login, /pricing) */
  path: string;
  /** Required form fields (registration only) */
  fields?: string[];
  /** Whether email verification is required (registration only) */
  emailVerification?: boolean;
  /** Success redirect path (registration only) */
  successRedirect?: string;
  /** Payment provider name (purchase only) */
  paymentProvider?: string;
  /** Free-text description (custom flow only) */
  description?: string;
  /** What constitutes success (most flow types) */
  successCriteria?: string;
}

export interface CleanupConfig {
  enabled: boolean;
  backend?: string;
}

export interface E2eSelections {
  flows: FlowConfig[];
  baseUrl: string;
  cleanup: CleanupConfig;
}

// ── Template variable resolution ───────────────────────────────────────

/**
 * Replace {var_name} placeholders in text with values from the vars map.
 * Unknown variables are left untouched.
 */
export function resolveTemplateVars(text: string, vars: Record<string, string>): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => vars[key] ?? match);
}

/**
 * Build the template variable map from environment variables.
 * Auto-generates run_id, test_email, test_password.
 * Reads E2E_BASE_URL, E2E_EMAIL, E2E_PASSWORD, and any E2E_* custom vars.
 */
export function buildE2eVars(env: Record<string, string | undefined>): Record<string, string> {
  const runId = env.RUN_ID || Date.now().toString();
  const testEmail = `e2e-${runId}@yourapp.test`;
  const testPassword = `E2eTest!${runId}`;

  const vars: Record<string, string> = {
    run_id: runId,
    base_url: env.E2E_BASE_URL || "http://localhost:3000",
    test_email: testEmail,
    test_password: testPassword,
    email: env.E2E_EMAIL || testEmail,
    password: env.E2E_PASSWORD || testPassword,
  };

  // Pick up any E2E_* custom vars (strip prefix, lowercase)
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith("E2E_") && value && !["E2E_BASE_URL", "E2E_EMAIL", "E2E_PASSWORD"].includes(key)) {
      const varName = key.slice(4).toLowerCase();
      vars[varName] = value;
    }
  }

  return vars;
}

// ── Shared node builders ───────────────────────────────────────────────

const TEST_OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    status: { type: "string", enum: ["pass", "fail"] },
    error: { type: "string" },
  },
  required: ["status"],
};

const REPORT_OUTPUT_SCHEMA = {
  type: "object" as const,
  properties: {
    total: { type: "number" },
    passed: { type: "number" },
    failed: { type: "number" },
    summary: { type: "string" },
  },
  required: ["total", "passed", "failed", "summary"],
};

export function buildSetupNode(): Node {
  return {
    name: "Browser Setup",
    instruction: `You need the agent-browser CLI for browser automation.
Check if it's installed: which agent-browser
If the command is not found, install it: npm install -g @anthropic-ai/agent-browser

Start the daemon in the background: agent-browser &
Wait for it to be ready by polling: agent-browser get url
Retry every 2 seconds, up to 30 seconds. If it doesn't respond after 30 seconds, report status "fail".

Once the daemon is ready, report status "ready".

IMPORTANT: The agent-browser CLI uses an accessibility tree, not screenshots.
After navigating to a page, run: agent-browser snapshot
This returns element references like @e1, @e2, @e3.
Use those refs with: agent-browser click @e5, agent-browser fill @e7 "text", etc.

Available commands:
- agent-browser open <url> — navigate to URL
- agent-browser snapshot — get accessibility tree with @refs
- agent-browser click <ref> — click an element
- agent-browser fill <ref> <text> — clear input and fill with text
- agent-browser press <key> — press keyboard key (Enter, Tab, Escape)
- agent-browser get url — get current page URL
- agent-browser get text <ref> — get element text content
- agent-browser screenshot <path> — save screenshot to file
- agent-browser scroll <direction> <pixels> — scroll page
- agent-browser scrollintoview <ref> — scroll element into view
- agent-browser select <ref> <value> — select dropdown option`,
    skills: [],
    output: {
      type: "object",
      properties: {
        status: { type: "string", enum: ["ready", "fail"] },
      },
      required: ["status"],
    },
  };
}

export function buildReportNode(testNodeIds: string[]): Node {
  const nodeList = testNodeIds.map((id) => `- ${id}`).join("\n");
  return {
    name: "Test Report",
    instruction: `Compile results from all test nodes into a final report.

Test nodes to summarize:
${nodeList}

For each test node:
- Report the status (pass/fail)
- Note any errors or unexpected behavior

Count total passed and total failed.
Format the summary as a single concise paragraph.`,
    skills: [],
    output: REPORT_OUTPUT_SCHEMA,
  };
}

export function buildCleanupNode(backend?: string): Node {
  let instruction: string;

  switch (backend) {
    case "supabase":
      instruction = `Clean up test data created during this E2E run.

Delete any test users matching the pattern e2e-*@yourapp.test using the Supabase Auth Admin API.
The service role key is available in your environment as SUPABASE_SERVICE_ROLE_KEY.
The Supabase URL is available as SUPABASE_URL.

Use curl to call the Supabase Admin API:
1. List users: GET {SUPABASE_URL}/auth/v1/admin/users (with apikey and Authorization: Bearer headers)
2. Filter for emails starting with "e2e-" and ending with "@yourapp.test"
3. Delete each matching user: DELETE {SUPABASE_URL}/auth/v1/admin/users/{user_id}

If no test users are found, that's fine — skip gracefully.
If the service role key is not available, skip cleanup gracefully.`;
      break;

    case "firebase":
      instruction = `Clean up test data created during this E2E run.

Delete any test users matching the pattern e2e-*@yourapp.test using the Firebase Admin SDK or REST API.
Use the FIREBASE_SERVICE_ACCOUNT_KEY environment variable for authentication.

If the service account key is not available, skip cleanup gracefully.`;
      break;

    case "postgres":
      instruction = `Clean up test data created during this E2E run.

Connect to the database using DATABASE_URL from the environment.
Delete any test records matching the pattern e2e-{run_id} or e2e-*@yourapp.test.

If DATABASE_URL is not available, skip cleanup gracefully.`;
      break;

    default:
      instruction = `Clean up test data created during this E2E run.

Delete any test data matching the pattern e2e-{run_id} or e2e-*@yourapp.test.
Use whatever API or database tools are available in your environment.

If cleanup credentials are not available, skip gracefully.`;
      break;
  }

  return {
    name: "Cleanup Test Data",
    instruction,
    skills: [],
  };
}
