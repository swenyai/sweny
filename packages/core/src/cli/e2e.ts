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

// ── Flow types that require authentication first ───────────────────────

const AUTH_REQUIRED_FLOWS: FlowType[] = ["purchase", "onboarding", "upgrade", "cancellation"];

// ── Login node (shared by auth-dependent flows) ────────────────────────

function buildLoginNode(loginPath: string): Node {
  return {
    name: "Test: Login",
    instruction: `Log in to the application.

1. Navigate to {base_url}${loginPath}
   Run: agent-browser open {base_url}${loginPath}
2. Take a snapshot to see the login form:
   Run: agent-browser snapshot
3. Find the email/username input and fill it:
   Run: agent-browser fill @<ref> "{email}"
4. Find the password input and fill it:
   Run: agent-browser fill @<ref> "{password}"
5. Click the login/submit button:
   Run: agent-browser click @<ref>
6. Wait 3 seconds for login to process
7. Take a snapshot to see the result
8. Check the URL: agent-browser get url

Success: URL no longer contains ${loginPath} (redirected to authenticated page).
Failure: Still on ${loginPath} or error visible in snapshot.

Take a screenshot as evidence:
Run: agent-browser screenshot results/login-result.png

Report status "pass" if login succeeded, "fail" otherwise.`,
    skills: [],
    output: TEST_OUTPUT_SCHEMA,
  };
}

// ── Flow-specific test node instructions ───────────────────────────────

function buildRegistrationInstruction(config: FlowConfig): string {
  const fields = config.fields?.length ? config.fields.map((f) => `- ${f}`).join("\n") : "- email\n- password";
  const successRedirect = config.successRedirect || "/dashboard";

  return `Test the registration/signup flow.

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the signup form:
   Run: agent-browser snapshot
3. Fill in the registration form fields:
${fields}
   For email, use: {test_email}
   For password, use: {test_password}
   For name fields, use: E2E Test User
   For other fields, use reasonable test values.
   Use agent-browser fill @<ref> "<value>" for each field.
4. Click the submit/signup button:
   Run: agent-browser click @<ref>
5. Wait 3 seconds for registration to process
6. Take a snapshot to see the result
7. Check the URL: agent-browser get url

Success: URL contains ${successRedirect} or a welcome/confirmation page.
Failure: Still on ${config.path} or error visible in snapshot.

Take a screenshot as evidence:
Run: agent-browser screenshot results/registration-result.png

Report status "pass" if registration succeeded, "fail" otherwise.`;
}

function buildLoginInstruction(config: FlowConfig): string {
  return `Test the login/authentication flow.

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the login form:
   Run: agent-browser snapshot
3. Find the email/username input and fill it:
   Run: agent-browser fill @<ref> "{email}"
4. Find the password input and fill it:
   Run: agent-browser fill @<ref> "{password}"
5. Click the login/submit button:
   Run: agent-browser click @<ref>
6. Wait 3 seconds for login to process
7. Take a snapshot to see the result
8. Check the URL: agent-browser get url

Success: URL no longer contains ${config.path} (redirected to authenticated page).
Failure: Still on ${config.path} or error visible in snapshot.

Take a screenshot as evidence:
Run: agent-browser screenshot results/login-result.png

Report status "pass" if login succeeded, "fail" otherwise.`;
}

function buildPurchaseInstruction(config: FlowConfig): string {
  const provider = config.paymentProvider || "the payment provider";

  return `Test the purchase/checkout flow.
The browser should already be logged in from the login step.

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the pricing/product page:
   Run: agent-browser snapshot
3. Find a purchase/subscribe/buy button and click it:
   Run: agent-browser click @<ref>
   If the button is not visible, scroll down:
   Run: agent-browser scroll down 500
   Then snapshot again.
4. Wait 5 seconds for the checkout redirect
5. Check the URL: agent-browser get url

${config.successCriteria || `Success: URL redirects to ${provider} checkout page or a confirmation page.\nFailure: Still on ${config.path} or error visible.`}

Take a screenshot as evidence:
Run: agent-browser screenshot results/purchase-result.png

Report status "pass" if checkout initiated successfully, "fail" otherwise.`;
}

function buildOnboardingInstruction(config: FlowConfig): string {
  return `Test the onboarding flow.
The browser should already be logged in from the login step.

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the onboarding page:
   Run: agent-browser snapshot
3. Follow the onboarding steps:
   - Read the snapshot to understand each step
   - Fill any required fields using agent-browser fill
   - Click next/continue buttons using agent-browser click
   - Take a snapshot after each step to see the result
4. After completing all onboarding steps, check the URL:
   Run: agent-browser get url

${config.successCriteria || "Success: Onboarding completes and redirects to the main app.\nFailure: Stuck on an onboarding step or error visible."}

Take a screenshot as evidence:
Run: agent-browser screenshot results/onboarding-result.png

Report status "pass" if onboarding completed, "fail" otherwise.`;
}

function buildUpgradeInstruction(config: FlowConfig): string {
  return `Test the plan upgrade flow.
The browser should already be logged in from the login step.

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the upgrade/plan page:
   Run: agent-browser snapshot
3. Find and click the upgrade button or select a higher plan:
   Run: agent-browser click @<ref>
4. If there's a confirmation dialog, confirm it:
   Run: agent-browser snapshot
   Then: agent-browser click @<confirm-ref>
5. Wait 3 seconds for the upgrade to process
6. Take a snapshot to see the result

${config.successCriteria || "Success: Upgrade confirmation shown or plan updated.\nFailure: Error visible or still on same page without change."}

Take a screenshot as evidence:
Run: agent-browser screenshot results/upgrade-result.png

Report status "pass" if upgrade succeeded, "fail" otherwise.`;
}

function buildCancellationInstruction(config: FlowConfig): string {
  return `Test the cancellation flow.
The browser should already be logged in from the login step.

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the cancellation/account page:
   Run: agent-browser snapshot
3. Find and click the cancel button:
   Run: agent-browser click @<ref>
4. If there's a confirmation dialog, confirm the cancellation:
   Run: agent-browser snapshot
   Then: agent-browser click @<confirm-ref>
5. Wait 3 seconds for cancellation to process
6. Take a snapshot to see the result

${config.successCriteria || "Success: Cancellation confirmed, subscription/account status updated.\nFailure: Error visible or cancellation not processed."}

Take a screenshot as evidence:
Run: agent-browser screenshot results/cancellation-result.png

Report status "pass" if cancellation succeeded, "fail" otherwise.`;
}

function buildCustomInstruction(config: FlowConfig): string {
  const description = config.description || "Perform the custom test flow";
  const criteria = config.successCriteria || "The expected outcome is achieved without errors";

  return `Test a custom flow: ${description}

1. Navigate to {base_url}${config.path}
   Run: agent-browser open {base_url}${config.path}
2. Take a snapshot to see the page:
   Run: agent-browser snapshot
3. Follow the flow described above. Use the accessibility tree from snapshots to find and interact with elements:
   - agent-browser click @<ref> to click
   - agent-browser fill @<ref> "<text>" to fill inputs
   - agent-browser press Enter/Tab to press keys
   - agent-browser snapshot to see updated page state
4. After completing the flow, take a final snapshot.

Success criteria: ${criteria}

Take a screenshot as evidence:
Run: agent-browser screenshot results/custom-result.png

Report status "pass" if the success criteria are met, "fail" otherwise.`;
}

// ── Build flow nodes ───────────────────────────────────────────────────

interface FlowNodes {
  nodes: Record<string, Node>;
  testNodeIds: string[];
}

/**
 * Build the test nodes for a given flow type.
 * Auth-dependent flows (purchase, onboarding, upgrade, cancellation)
 * automatically include a login node.
 */
export function buildFlowNodes(config: FlowConfig): FlowNodes {
  const nodes: Record<string, Node> = {};
  const testNodeIds: string[] = [];
  const needsAuth = AUTH_REQUIRED_FLOWS.includes(config.type);

  // Add login node for auth-dependent flows
  if (needsAuth) {
    nodes.login = buildLoginNode("/login");
    testNodeIds.push("login");
  }

  // Build the flow-specific test instruction
  let instruction: string;
  switch (config.type) {
    case "registration":
      instruction = buildRegistrationInstruction(config);
      break;
    case "login":
      instruction = buildLoginInstruction(config);
      break;
    case "purchase":
      instruction = buildPurchaseInstruction(config);
      break;
    case "onboarding":
      instruction = buildOnboardingInstruction(config);
      break;
    case "upgrade":
      instruction = buildUpgradeInstruction(config);
      break;
    case "cancellation":
      instruction = buildCancellationInstruction(config);
      break;
    case "custom":
      instruction = buildCustomInstruction(config);
      break;
  }

  const nodeId = `test_${config.type}`;
  nodes[nodeId] = {
    name: `Test: ${config.type.charAt(0).toUpperCase() + config.type.slice(1)}`,
    instruction,
    skills: [],
    output: TEST_OUTPUT_SCHEMA,
  };
  testNodeIds.push(nodeId);

  return { nodes, testNodeIds };
}

// ── Workflow assembler ─────────────────────────────────────────────────

/**
 * Build a complete Workflow object for a single e2e flow.
 * Includes setup node, optional login, flow-specific test node,
 * optional cleanup, and report node.
 */
export function buildFlowWorkflow(flow: FlowConfig, baseUrl: string, cleanup?: CleanupConfig): Workflow {
  const { nodes: flowNodes, testNodeIds } = buildFlowNodes(flow);
  const nodes: Record<string, Node> = {};
  const edges: Edge[] = [];

  // 1. Setup node (always first)
  nodes.setup = buildSetupNode();

  // 2. Flow nodes (login + test)
  for (const [id, node] of Object.entries(flowNodes)) {
    nodes[id] = node;
  }

  // 3. Build edges based on flow structure
  const firstTestNode = testNodeIds[0];
  const lastTestNode = testNodeIds[testNodeIds.length - 1];

  // Setup → first test (or login) on success
  edges.push({ from: "setup", to: firstTestNode, when: "setup status is ready" });
  edges.push({ from: "setup", to: "report", when: "setup status is fail" });

  // If there's a login node + test node, chain them
  if (testNodeIds.length > 1) {
    edges.push({
      from: testNodeIds[0],
      to: testNodeIds[1],
      when: `${testNodeIds[0]} status is pass`,
    });
    edges.push({
      from: testNodeIds[0],
      to: "report",
      when: `${testNodeIds[0]} status is fail`,
    });
  }

  // 4. Cleanup node (optional)
  if (cleanup?.enabled) {
    nodes.cleanup = buildCleanupNode(cleanup.backend);
    edges.push({ from: lastTestNode, to: "cleanup" });
    edges.push({ from: "cleanup", to: "report" });
  } else {
    edges.push({ from: lastTestNode, to: "report" });
  }

  // 5. Report node (always last)
  nodes.report = buildReportNode(testNodeIds);

  const typeName = flow.type.charAt(0).toUpperCase() + flow.type.slice(1);

  return {
    id: `e2e-${flow.type}`,
    name: `E2E: ${typeName}`,
    description: `End-to-end test for ${flow.type} flow`,
    entry: "setup",
    nodes,
    edges,
  };
}

// ── Env template builder ───────────────────────────────────────────────

const CLEANUP_ENV_VARS: Record<string, Array<{ key: string; hint?: string }>> = {
  supabase: [
    { key: "SUPABASE_URL", hint: "e.g. https://xxxx.supabase.co" },
    { key: "SUPABASE_SERVICE_ROLE_KEY", hint: "Settings > API > service_role key" },
  ],
  firebase: [{ key: "FIREBASE_SERVICE_ACCOUNT_KEY", hint: "Firebase Console > Project Settings > Service Accounts" }],
  postgres: [{ key: "DATABASE_URL", hint: "e.g. postgresql://user:pass@host:5432/db" }],
};

/**
 * Build .env template content for e2e testing.
 */
export function buildE2eEnvTemplate(selections: E2eSelections): string {
  const lines: string[] = [];
  lines.push("# E2E Testing — SWEny");
  lines.push("# Fill in values, then run: sweny e2e run");
  lines.push("");

  lines.push(`E2E_BASE_URL=${selections.baseUrl}`);
  lines.push("");

  // Add E2E_EMAIL/PASSWORD if any flow needs auth
  const needsAuth = selections.flows.some((f) => AUTH_REQUIRED_FLOWS.includes(f.type) || f.type === "login");
  if (needsAuth) {
    lines.push("# Test account credentials (for login-dependent flows)");
    lines.push("E2E_EMAIL=");
    lines.push("E2E_PASSWORD=");
    lines.push("");
  }

  // Cleanup env vars
  if (selections.cleanup.enabled && selections.cleanup.backend) {
    const vars = CLEANUP_ENV_VARS[selections.cleanup.backend];
    if (vars) {
      lines.push("# Cleanup");
      for (const v of vars) {
        if (v.hint) lines.push(`# ${v.hint}`);
        lines.push(`${v.key}=`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
