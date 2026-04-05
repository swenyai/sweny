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
