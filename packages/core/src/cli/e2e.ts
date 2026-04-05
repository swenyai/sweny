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
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";

import { execute } from "../executor.js";
import { ClaudeClient } from "../claude.js";
import { createSkillMap, configuredSkills } from "../skills/index.js";
import { consoleLogger } from "../types.js";
import type { Workflow, Node, Edge, ExecutionEvent, Observer, NodeResult } from "../types.js";
import { validateWorkflow } from "../schema.js";

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

// ── Flow type labels ───────────────────────────────────────────────────

const FLOW_TYPE_LABELS: Record<FlowType, string> = {
  registration: "Registration / Signup",
  login: "Login / Auth",
  purchase: "Purchase / Checkout",
  onboarding: "Onboarding",
  upgrade: "User Upgrade / Plan Change",
  cancellation: "Cancellation",
  custom: "Custom (describe it)",
};

// ── Cancel helper ──────────────────────────────────────────────────────

function cancel(): never {
  p.cancel("Setup cancelled.");
  process.exit(0);
}

// ── Per-flow follow-up questions ───────────────────────────────────────

async function askFlowQuestions(type: FlowType): Promise<FlowConfig> {
  const defaultPaths: Record<FlowType, string> = {
    registration: "/signup",
    login: "/login",
    purchase: "/pricing",
    onboarding: "/onboarding",
    upgrade: "/upgrade",
    cancellation: "/cancel",
    custom: "/",
  };

  const flowPath = await p.text({
    message: `URL path for ${FLOW_TYPE_LABELS[type]}?`,
    placeholder: defaultPaths[type],
    validate: (v) => (!v.startsWith("/") ? "Path must start with /" : undefined),
  });
  if (p.isCancel(flowPath)) cancel();

  const config: FlowConfig = { type, path: flowPath as string };

  if (type === "registration") {
    const fieldsRaw = await p.text({
      message: "Required form fields (comma-separated)?",
      placeholder: "email, password, name",
      initialValue: "email, password, name",
    });
    if (p.isCancel(fieldsRaw)) cancel();
    config.fields = (fieldsRaw as string)
      .split(",")
      .map((f) => f.trim())
      .filter(Boolean);

    const successRedirect = await p.text({
      message: "Success redirect path?",
      placeholder: "/dashboard",
      initialValue: "/dashboard",
    });
    if (p.isCancel(successRedirect)) cancel();
    config.successRedirect = successRedirect as string;
  }

  if (type === "purchase") {
    const provider = await p.text({
      message: "Payment provider?",
      placeholder: "Stripe",
      initialValue: "Stripe",
    });
    if (p.isCancel(provider)) cancel();
    config.paymentProvider = provider as string;
  }

  if (type === "custom") {
    const desc = await p.text({
      message: "Describe the flow in a sentence or two:",
      validate: (v) => (!v ? "Description is required" : undefined),
    });
    if (p.isCancel(desc)) cancel();
    config.description = desc as string;
  }

  if (type !== "registration") {
    const criteria = await p.text({
      message: "What does success look like?",
      placeholder: "Redirected to confirmation page",
    });
    if (p.isCancel(criteria)) cancel();
    if (criteria) config.successCriteria = criteria as string;
  }

  return config;
}

// ── Interactive wizard ─────────────────────────────────────────────────

/**
 * Interactive E2E setup wizard — prompts through flow selection,
 * then generates .sweny/e2e/*.yml and .env additions.
 */
export async function runE2eInit(): Promise<void> {
  const cwd = process.cwd();

  // ── Screen 1: Intro ──────────────────────────────────────────
  p.intro("Let's set up end-to-end testing for your app");

  // Check for existing files
  const e2eDir = path.join(cwd, ".sweny", "e2e");
  if (fs.existsSync(e2eDir)) {
    const files = fs.readdirSync(e2eDir).filter((f) => f.endsWith(".yml"));
    if (files.length > 0) {
      const overwrite = await p.confirm({
        message: `.sweny/e2e/ already has ${files.length} workflow file(s). Continue and overwrite?`,
        initialValue: false,
      });
      if (p.isCancel(overwrite)) cancel();
      if (!overwrite) {
        p.cancel("Setup cancelled — existing files preserved.");
        process.exit(0);
      }
    }
  }

  // ── Screen 2: Flow type selection ────────────────────────────
  const flowTypes = await p.multiselect({
    message: "What flows do you want to test?",
    options: (Object.entries(FLOW_TYPE_LABELS) as Array<[FlowType, string]>).map(([value, label]) => ({
      value,
      label,
    })),
    required: true,
  });
  if (p.isCancel(flowTypes)) cancel();
  const selectedTypes = flowTypes as FlowType[];

  // ── Screen 3: Per-flow follow-ups ────────────────────────────
  const flows: FlowConfig[] = [];
  for (const type of selectedTypes) {
    p.log.step(`Configure: ${FLOW_TYPE_LABELS[type]}`);
    const config = await askFlowQuestions(type);
    flows.push(config);
  }

  // ── Screen 4: Base URL ───────────────────────────────────────
  const baseUrl = await p.text({
    message: "App URL for testing?",
    placeholder: "http://localhost:3000",
    initialValue: "http://localhost:3000",
    validate: (v) => {
      try {
        new URL(v);
        return undefined;
      } catch {
        return "Must be a valid URL";
      }
    },
  });
  if (p.isCancel(baseUrl)) cancel();

  // ── Screen 5: Cleanup ───────────────────────────────────────
  const wantCleanup = await p.confirm({
    message: "Auto-cleanup test data after runs?",
    initialValue: false,
  });
  if (p.isCancel(wantCleanup)) cancel();

  let cleanup: CleanupConfig = { enabled: false };

  if (wantCleanup) {
    const backend = await p.select({
      message: "What's your backend?",
      options: [
        { value: "supabase", label: "Supabase" },
        { value: "firebase", label: "Firebase" },
        { value: "postgres", label: "PostgreSQL" },
        { value: "api", label: "REST API" },
        { value: "other", label: "Other" },
      ],
    });
    if (p.isCancel(backend)) cancel();
    cleanup = { enabled: true, backend: backend as string };
  }

  const selections: E2eSelections = {
    flows,
    baseUrl: baseUrl as string,
    cleanup,
  };

  // ── Screen 6: Summary ───────────────────────────────────────
  const fileList = flows.map((f) => `.sweny/e2e/${f.type}.yml`).join(", ");
  p.log.info(`Will generate: ${chalk.cyan(fileList)}`);
  if (cleanup.enabled) {
    p.log.info(`Cleanup: ${chalk.cyan(cleanup.backend)} backend`);
  }

  const proceed = await p.confirm({
    message: "Generate files?",
    initialValue: true,
  });
  if (p.isCancel(proceed) || !proceed) cancel();

  // ── Screen 7: Write files ───────────────────────────────────
  fs.mkdirSync(e2eDir, { recursive: true });

  // Generate workflow files
  for (const flow of flows) {
    const workflow = buildFlowWorkflow(flow, baseUrl as string, cleanup);
    const yamlContent = stringifyYaml(workflow, { indent: 2, lineWidth: 120 });
    const filePath = path.join(e2eDir, `${flow.type}.yml`);
    fs.writeFileSync(filePath, yamlContent, "utf-8");
    p.log.success(`Created ${chalk.cyan(filePath)}`);
  }

  // Append to .env
  const envContent = buildE2eEnvTemplate(selections);
  const envPath = path.join(cwd, ".env");
  if (fs.existsSync(envPath)) {
    const existing = fs.readFileSync(envPath, "utf-8");
    if (!existing.includes("E2E_BASE_URL")) {
      fs.appendFileSync(envPath, "\n" + envContent, "utf-8");
      p.log.success(`Appended E2E vars to ${chalk.cyan(".env")}`);
    } else {
      p.log.warn(".env already has E2E vars — skipped");
    }
  } else {
    fs.writeFileSync(envPath, envContent, "utf-8");
    p.log.success(`Created ${chalk.cyan(".env")}`);
  }

  // ── Next steps ──────────────────────────────────────────────
  p.outro("E2E setup complete!");
  console.log(chalk.dim("\n  Next steps:\n"));
  console.log(chalk.dim("  1. Fill in your .env values"));
  if (selections.flows.some((f) => AUTH_REQUIRED_FLOWS.includes(f.type) || f.type === "login")) {
    console.log(chalk.dim("  2. Set E2E_EMAIL and E2E_PASSWORD to a test account"));
    console.log(chalk.dim(`  3. Run: ${chalk.cyan("sweny e2e run")}\n`));
  } else {
    console.log(chalk.dim(`  2. Run: ${chalk.cyan("sweny e2e run")}\n`));
  }
}

// ── Timeout helper ─────────────────────────────────────────────────────

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms);
    promise
      .then(resolve)
      .catch(reject)
      .finally(() => clearTimeout(timer));
  });
}

// ── E2E Run ────────────────────────────────────────────────────────────

export interface E2eRunOptions {
  file?: string;
  timeout?: number;
}

/**
 * Load and execute e2e workflow files from .sweny/e2e/.
 */
export async function runE2eRun(options: E2eRunOptions): Promise<void> {
  const cwd = process.cwd();
  const timeoutMs = options.timeout || 15 * 60 * 1000;

  // 1. Discover workflow files
  let files: string[];
  if (options.file) {
    const filePath = path.resolve(cwd, options.file);
    if (!fs.existsSync(filePath)) {
      console.error(chalk.red(`  File not found: ${options.file}`));
      process.exit(1);
    }
    files = [filePath];
  } else {
    const e2eDir = path.join(cwd, ".sweny", "e2e");
    if (!fs.existsSync(e2eDir)) {
      console.error(chalk.red("  No .sweny/e2e/ directory found."));
      console.error(chalk.dim("  Run 'sweny e2e init' to set up e2e testing."));
      process.exit(1);
    }
    files = fs
      .readdirSync(e2eDir)
      .filter((f) => f.endsWith(".yml") || f.endsWith(".yaml"))
      .sort()
      .map((f) => path.join(e2eDir, f));
    if (files.length === 0) {
      console.error(chalk.red("  No workflow files found in .sweny/e2e/"));
      console.error(chalk.dim("  Run 'sweny e2e init' to set up e2e testing."));
      process.exit(1);
    }
  }

  // 2. Build template vars
  const vars = buildE2eVars(process.env as Record<string, string>);

  // 3. Banner
  console.log(`\n${"─".repeat(50)}`);
  console.log("E2E Test Run");
  console.log(`  Target:  ${vars.base_url}`);
  console.log(`  Run ID:  ${vars.run_id}`);
  console.log(`${"─".repeat(50)}\n`);

  // 4. Execute each workflow
  const runResults: Array<{ file: string; passed: boolean }> = [];

  for (const file of files) {
    const fileName = path.basename(file);
    console.log(`▶ ${chalk.bold(fileName)}`);

    let workflow: Workflow;
    try {
      const raw = parseYaml(fs.readFileSync(file, "utf-8"));
      const errors = validateWorkflow(raw as Workflow);
      if (errors.length > 0) {
        throw new Error(`Invalid workflow:\n${errors.map((e) => `  ${e.message}`).join("\n")}`);
      }
      workflow = raw as Workflow;
    } catch (err) {
      console.error(chalk.red(`  Error loading ${fileName}: ${err instanceof Error ? err.message : String(err)}`));
      runResults.push({ file: fileName, passed: false });
      continue;
    }

    // Replace template vars in node instructions
    for (const node of Object.values(workflow.nodes)) {
      node.instruction = resolveTemplateVars(node.instruction, vars);
    }

    // Build skills + Claude client
    const skills = createSkillMap(configuredSkills(process.env, cwd));
    const claude = new ClaudeClient({
      maxTurns: 80,
      cwd,
      logger: consoleLogger,
    });

    // Progress observer
    const nodeEnterTimes = new Map<string, number>();
    const isTTY = process.stderr.isTTY ?? false;

    const observer: Observer = (event: ExecutionEvent) => {
      switch (event.type) {
        case "node:enter":
          nodeEnterTimes.set(event.node, Date.now());
          process.stderr.write(`  ${chalk.dim("○")} ${chalk.dim(event.node)}…\n`);
          break;
        case "node:exit": {
          const icon =
            event.result.status === "success"
              ? chalk.green("✓")
              : event.result.status === "skipped"
                ? chalk.dim("−")
                : chalk.red("✗");
          const enterTime = nodeEnterTimes.get(event.node) ?? Date.now();
          const elapsed = ((Date.now() - enterTime) / 1000).toFixed(1);
          const status = (event.result.data?.status as string) || event.result.status;
          if (isTTY) {
            process.stderr.write(`\x1B[1A\x1B[2K  ${icon} ${event.node} — ${status} (${elapsed}s)\n`);
          } else {
            process.stderr.write(`  ${icon} ${event.node} — ${status} (${elapsed}s)\n`);
          }
          break;
        }
      }
    };

    try {
      const { results } = await withTimeout(
        execute(
          workflow,
          { run_id: vars.run_id, base_url: vars.base_url },
          { skills, claude, observer, logger: consoleLogger },
        ),
        timeoutMs,
        `Workflow ${workflow.name}`,
      );

      // Extract report
      const report = results.get("report");
      if (report?.data) {
        console.log(`  ${report.data.passed}/${report.data.total} tests passed`);
        if (report.data.summary) {
          console.log(chalk.dim(`  ${report.data.summary}`));
        }
      }

      const hasFailed = [...results.values()].some(
        (r: NodeResult) => r.status === "failed" || r.data?.status === "fail",
      );
      runResults.push({ file: fileName, passed: !hasFailed });
    } catch (err) {
      console.error(chalk.red(`  Error: ${err instanceof Error ? err.message : String(err)}`));
      runResults.push({ file: fileName, passed: false });
    }

    console.log("");
  }

  // 5. Summary
  const passed = runResults.filter((r) => r.passed).length;
  const total = runResults.length;
  const summaryColor = passed === total ? chalk.green : chalk.red;
  console.log(summaryColor(`Results: ${passed}/${total} workflows passed`));

  process.exit(passed === total ? 0 : 1);
}
