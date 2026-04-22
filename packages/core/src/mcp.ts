import type { McpAutoConfig, McpServerConfig } from "./types.js";
import { MCP_CATALOG } from "./mcp-catalog.js";

// ── Skill-driven MCP wiring ─────────────────────────────────────────
//
// `buildSkillMcpServers` is the engine-driven path: workflow nodes declare
// skills, and the engine wires MCPs for any of those skills whose env vars
// are present. This is the preferred path for `sweny workflow run`.
//
// `buildAutoMcpServers` (below) is the legacy provider-flag-driven path
// used by `sweny triage` / `sweny implement`. It is retained so those
// commands keep working unchanged; over time they should migrate to the
// skill-driven path too.
//
// Both functions are thin projections of MCP_CATALOG (see mcp-catalog.ts).
// Adding a provider is a one-place edit.

export interface SkillMcpOptions {
  /** Skill IDs referenced by the workflow being executed. Only these get MCPs. */
  referencedSkills: Set<string>;
  /** Flat credential map (env vars). MCPs are only wired when their creds are set. */
  credentials: Record<string, string>;
  /** User-supplied MCP servers — always win on key conflict. */
  userMcpServers?: Record<string, McpServerConfig>;
  /** MCP servers declared by custom skills. Only wired when the skill is referenced. */
  skillMcpServers?: Record<string, McpServerConfig>;
}

/**
 * Build MCP server configs for the skills a workflow references.
 *
 * For each entry in MCP_CATALOG whose skill triggers intersect
 * `referencedSkills`, wire its MCP if credentials are present. Skills with
 * no MCP variant (e.g. `notification`, `supabase`) are silently skipped —
 * their in-process tools are wired separately by the executor. Unknown
 * skill IDs pass through; the engine's hard-fail validation handles them.
 *
 * Inline skill-declared servers and user-supplied servers layer on top.
 */
export function buildSkillMcpServers(opts: SkillMcpOptions): Record<string, McpServerConfig> {
  const auto: Record<string, McpServerConfig> = {};
  const refs = opts.referencedSkills;
  const creds = opts.credentials;

  for (const entry of MCP_CATALOG) {
    const skillIds = entry.triggers.skill ?? [];
    if (!skillIds.some((id) => refs.has(id))) continue;
    const wired = entry.wire(creds);
    if (wired) auto[entry.id] = wired;
  }

  // Skill-declared MCP servers — only include for referenced skills.
  if (opts.skillMcpServers) {
    for (const [skillId, mcpConfig] of Object.entries(opts.skillMcpServers)) {
      if (refs.has(skillId) && !auto[skillId]) {
        auto[skillId] = mcpConfig;
      }
    }
  }

  // User-supplied servers always win on key conflict.
  return { ...auto, ...(opts.userMcpServers ?? {}) };
}

/**
 * Auto-configure well-known MCP servers based on which providers
 * and workspace tools the user has enabled.
 *
 * Category A: triggered by sourceControlProvider / issueTrackerProvider / observabilityProvider
 * Category B: workspace tools — explicit opt-in via workspaceTools array
 *
 * User-supplied servers (userMcpServers) always win on key conflicts.
 */
export function buildAutoMcpServers(config: McpAutoConfig): Record<string, McpServerConfig> {
  const auto: Record<string, McpServerConfig> = {};
  const creds = config.credentials;
  const obsProviders = new Set(config.observabilityProviders ?? []);
  const tools = new Set(config.workspaceTools ?? []);

  for (const entry of MCP_CATALOG) {
    const matches =
      (entry.triggers.sourceControl?.includes(config.sourceControlProvider ?? "") ?? false) ||
      (entry.triggers.issueTracker?.includes(config.issueTrackerProvider ?? "") ?? false) ||
      (entry.triggers.observability?.some((o) => obsProviders.has(o)) ?? false) ||
      (entry.triggers.workspaceTool?.some((t) => tools.has(t)) ?? false);
    if (!matches) continue;
    const wired = entry.wire(creds);
    if (wired) auto[entry.id] = wired;
  }

  // User-supplied servers always win on key conflict.
  return { ...auto, ...(config.userMcpServers ?? {}) };
}

// ── Provider context for dynamic instruction injection ─────────────

export interface ProviderContextOptions {
  observabilityProviders?: string[];
  issueTrackerProvider?: string;
  sourceControlProvider?: string;
  /** Which MCP servers were actually injected (keys from buildAutoMcpServers) */
  mcpServers: string[];
  /** Extra details to include (e.g. betterstack source ID) */
  extras?: Record<string, string>;
}

/**
 * Build a human-readable summary of configured providers and MCP tools.
 * Prepended to every node instruction via additionalContext so the agent
 * knows exactly what tools are available and how to use them.
 */
export function buildProviderContext(opts: ProviderContextOptions): string {
  const lines: string[] = ["## Available Providers & Tools", ""];

  // Observability — list all configured providers
  const obsProviders = opts.observabilityProviders ?? [];
  for (const provider of obsProviders) {
    const mcpNote = opts.mcpServers.includes(provider)
      ? ` (available via MCP — use its tools to query logs, errors, and metrics)`
      : "";
    lines.push(`- **Observability**: ${provider}${mcpNote}`);
  }

  // Issue tracker
  if (opts.issueTrackerProvider) {
    const mcpNote = opts.mcpServers.includes(
      opts.issueTrackerProvider === "github-issues" ? "github" : opts.issueTrackerProvider,
    )
      ? ` (available via MCP)`
      : "";
    lines.push(`- **Issue tracker**: ${opts.issueTrackerProvider}${mcpNote}`);
  }

  // Source control
  if (opts.sourceControlProvider) {
    const mcpNote = opts.mcpServers.includes(opts.sourceControlProvider) ? ` (available via MCP)` : "";
    lines.push(`- **Source control**: ${opts.sourceControlProvider}${mcpNote}`);
  }

  // Extras (source IDs, table names, etc.)
  if (opts.extras && Object.keys(opts.extras).length > 0) {
    lines.push("");
    for (const [key, value] of Object.entries(opts.extras)) {
      lines.push(`- **${key}**: ${value}`);
    }
  }

  lines.push("");
  lines.push(
    "Use all available MCP tools to gather data. " + "MCP tools are already connected — just call them directly.",
  );

  return lines.join("\n");
}
