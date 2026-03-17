import { useState, useRef, useCallback, useEffect } from "react";
import { WorkflowViewer } from "@sweny-ai/studio/viewer";
import { triageDefinition, implementDefinition } from "@sweny-ai/engine/browser";
import "@sweny-ai/studio/style.css";
import type { WorkflowDefinition, StepDefinition } from "@sweny-ai/engine/browser";

// ── Inline provider catalog (browser-safe subset) ────────────────────────────

interface EnvVarSpec {
  key: string;
  description: string;
  required: boolean;
  secret: boolean;
  example?: string;
}
interface ProviderOption {
  id: string;
  name: string;
  category: string;
  color: string;
  envVars: EnvVarSpec[];
  importPath: string;
  factoryFn: string;
}

const CATALOG: ProviderOption[] = [
  // observability
  {
    id: "datadog",
    name: "Datadog",
    category: "observability",
    color: "#8b5cf6",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "datadog",
    envVars: [
      { key: "DATADOG_API_KEY", description: "API key", required: true, secret: true },
      { key: "DATADOG_APP_KEY", description: "Application key", required: true, secret: true },
      {
        key: "DATADOG_SITE",
        description: "Site (default: datadoghq.com)",
        required: false,
        secret: false,
        example: "datadoghq.eu",
      },
    ],
  },
  {
    id: "sentry",
    name: "Sentry",
    category: "observability",
    color: "#362D59",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "sentry",
    envVars: [
      { key: "SENTRY_AUTH_TOKEN", description: "Auth token", required: true, secret: true },
      { key: "SENTRY_ORG", description: "Organization slug", required: true, secret: false, example: "my-company" },
      { key: "SENTRY_PROJECT", description: "Project slug (blank = all)", required: false, secret: false },
    ],
  },
  {
    id: "cloudwatch",
    name: "CloudWatch",
    category: "observability",
    color: "#FF9900",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "cloudwatch",
    envVars: [
      { key: "AWS_ACCESS_KEY_ID", description: "AWS access key ID", required: true, secret: true },
      { key: "AWS_SECRET_ACCESS_KEY", description: "AWS secret access key", required: true, secret: true },
      { key: "AWS_REGION", description: "Region", required: true, secret: false, example: "us-east-1" },
      { key: "CLOUDWATCH_LOG_GROUP", description: "Default log group", required: false, secret: false },
    ],
  },
  {
    id: "elastic",
    name: "Elasticsearch",
    category: "observability",
    color: "#005571",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "elastic",
    envVars: [
      { key: "ELASTICSEARCH_URL", description: "Endpoint URL", required: true, secret: false },
      { key: "ELASTICSEARCH_API_KEY", description: "API key", required: true, secret: true },
      { key: "ELASTICSEARCH_INDEX", description: "Index pattern", required: false, secret: false, example: "logs-*" },
    ],
  },
  {
    id: "newrelic",
    name: "New Relic",
    category: "observability",
    color: "#008C99",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "newrelic",
    envVars: [
      { key: "NEW_RELIC_API_KEY", description: "User API key", required: true, secret: true },
      { key: "NEW_RELIC_ACCOUNT_ID", description: "Account ID", required: true, secret: false },
    ],
  },
  {
    id: "loki",
    name: "Grafana Loki",
    category: "observability",
    color: "#F05A28",
    importPath: "@sweny-ai/providers/observability",
    factoryFn: "loki",
    envVars: [
      { key: "LOKI_URL", description: "Loki endpoint", required: true, secret: false, example: "http://loki:3100" },
      { key: "LOKI_USERNAME", description: "Grafana Cloud username", required: false, secret: false },
      { key: "LOKI_PASSWORD", description: "Grafana Cloud API key", required: false, secret: true },
    ],
  },
  // issueTracking
  {
    id: "linear",
    name: "Linear",
    category: "issueTracking",
    color: "#5E6AD2",
    importPath: "@sweny-ai/providers/issue-tracking",
    factoryFn: "linear",
    envVars: [
      { key: "LINEAR_API_KEY", description: "Personal API key", required: true, secret: true },
      { key: "LINEAR_TEAM_ID", description: "Default team ID", required: true, secret: false },
      { key: "LINEAR_PROJECT_ID", description: "Default project ID", required: false, secret: false },
    ],
  },
  {
    id: "github-issues",
    name: "GitHub Issues",
    category: "issueTracking",
    color: "#24292F",
    importPath: "@sweny-ai/providers/issue-tracking",
    factoryFn: "githubIssues",
    envVars: [
      { key: "GITHUB_TOKEN", description: "Personal access token", required: true, secret: true },
      { key: "GITHUB_OWNER", description: "Owner (org or user)", required: true, secret: false },
      { key: "GITHUB_REPO", description: "Repository name", required: true, secret: false },
    ],
  },
  {
    id: "jira",
    name: "Jira",
    category: "issueTracking",
    color: "#0052CC",
    importPath: "@sweny-ai/providers/issue-tracking",
    factoryFn: "jira",
    envVars: [
      { key: "JIRA_URL", description: "Instance URL", required: true, secret: false },
      { key: "JIRA_EMAIL", description: "Account email", required: true, secret: false },
      { key: "JIRA_API_TOKEN", description: "API token", required: true, secret: true },
      { key: "JIRA_PROJECT_KEY", description: "Project key", required: true, secret: false, example: "ENG" },
    ],
  },
  // sourceControl
  {
    id: "github",
    name: "GitHub",
    category: "sourceControl",
    color: "#24292F",
    importPath: "@sweny-ai/providers/source-control",
    factoryFn: "github",
    envVars: [
      { key: "GITHUB_TOKEN", description: "Token (repo + workflow scopes)", required: true, secret: true },
      { key: "GITHUB_OWNER", description: "Owner (org or user)", required: true, secret: false },
      { key: "GITHUB_REPO", description: "Repository name", required: true, secret: false },
    ],
  },
  {
    id: "gitlab",
    name: "GitLab",
    category: "sourceControl",
    color: "#FC6D26",
    importPath: "@sweny-ai/providers/source-control",
    factoryFn: "gitlab",
    envVars: [
      { key: "GITLAB_TOKEN", description: "Personal access token", required: true, secret: true },
      { key: "GITLAB_URL", description: "Instance URL", required: false, secret: false },
      { key: "GITLAB_PROJECT_ID", description: "Project ID or path", required: true, secret: false },
    ],
  },
  // codingAgent
  {
    id: "claude-code",
    name: "Claude Code",
    category: "codingAgent",
    color: "#D97706",
    importPath: "@sweny-ai/providers/coding-agent",
    factoryFn: "claudeCode",
    envVars: [
      {
        key: "ANTHROPIC_API_KEY",
        description: "Anthropic API key",
        required: true,
        secret: true,
        example: "sk-ant-...",
      },
    ],
  },
  {
    id: "openai-codex",
    name: "OpenAI Codex",
    category: "codingAgent",
    color: "#10A37F",
    importPath: "@sweny-ai/providers/coding-agent",
    factoryFn: "openaiCodex",
    envVars: [{ key: "OPENAI_API_KEY", description: "OpenAI API key", required: true, secret: true }],
  },
  // notification
  {
    id: "slack-webhook",
    name: "Slack Webhook",
    category: "notification",
    color: "#4A154B",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "slackWebhook",
    envVars: [{ key: "SLACK_WEBHOOK_URL", description: "Incoming webhook URL", required: true, secret: true }],
  },
  {
    id: "discord-webhook",
    name: "Discord Webhook",
    category: "notification",
    color: "#5865F2",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "discordWebhook",
    envVars: [{ key: "DISCORD_WEBHOOK_URL", description: "Webhook URL", required: true, secret: true }],
  },
  {
    id: "teams-webhook",
    name: "Microsoft Teams",
    category: "notification",
    color: "#6264A7",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "teamsWebhook",
    envVars: [{ key: "TEAMS_WEBHOOK_URL", description: "Incoming webhook URL", required: true, secret: true }],
  },
  {
    id: "email",
    name: "Email (SMTP)",
    category: "notification",
    color: "#EA4335",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "email",
    envVars: [
      { key: "SMTP_HOST", description: "SMTP server hostname", required: true, secret: false },
      { key: "SMTP_PORT", description: "Port (default: 587)", required: false, secret: false, example: "587" },
      { key: "SMTP_USER", description: "SMTP username", required: true, secret: false },
      { key: "SMTP_PASS", description: "SMTP password or API key", required: true, secret: true },
      { key: "SMTP_FROM", description: "Sender address", required: true, secret: false },
      { key: "SMTP_TO", description: "Recipient address(es)", required: true, secret: false },
    ],
  },
  {
    id: "github-summary",
    name: "GitHub Step Summary",
    category: "notification",
    color: "#24292F",
    importPath: "@sweny-ai/providers/notification",
    factoryFn: "githubSummary",
    envVars: [],
  },
];

function getCatalogForCategory(category: string): ProviderOption[] {
  return CATALOG.filter((p) => p.category === category);
}

// ── Workflow data ─────────────────────────────────────────────────────────────

const WORKFLOWS: { id: string; label: string; description: string; definition: WorkflowDefinition }[] = [
  {
    id: "triage",
    label: "Triage",
    description: "Monitors production logs, investigates novel errors, implements fixes, and opens PRs — autonomously.",
    definition: triageDefinition as WorkflowDefinition,
  },
  {
    id: "implement",
    label: "Implement",
    description: "Takes an existing issue identifier and produces a reviewed PR with a working fix.",
    definition: implementDefinition as WorkflowDefinition,
  },
];

const PHASE_META = {
  learn: { label: "Learn", color: "#3b82f6", bg: "rgba(59,130,246,0.12)" },
  act: { label: "Act", color: "#f59e0b", bg: "rgba(245,158,11,0.12)" },
  report: { label: "Report", color: "#22c55e", bg: "rgba(34,197,94,0.12)" },
} as const;

const CATEGORY_LABELS: Record<string, string> = {
  observability: "Observability",
  issueTracking: "Issue Tracking",
  sourceControl: "Source Control",
  codingAgent: "Coding Agent",
  notification: "Notification",
};

const CATEGORY_META: Record<string, { icon: string; color: string }> = {
  observability: { icon: "◉", color: "#818cf8" },
  issueTracking: { icon: "◈", color: "#f472b6" },
  sourceControl: { icon: "⎇", color: "#34d399" },
  codingAgent: { icon: "⬡", color: "#fb923c" },
  notification: { icon: "◎", color: "#a78bfa" },
};

// Hardcoded category→stepIds fallback for built-in workflows (used when
// engine dist doesn't carry provider fields e.g. cached older build).
const WORKFLOW_CATEGORIES: Record<string, Array<{ category: string; stateIds: string[] }>> = {
  triage: [
    { category: "observability", stateIds: ["dedup-check", "build-context"] },
    { category: "codingAgent", stateIds: ["investigate", "implement-fix"] },
    { category: "issueTracking", stateIds: ["novelty-gate", "create-issue"] },
    { category: "sourceControl", stateIds: ["cross-repo-check", "create-pr"] },
    { category: "notification", stateIds: ["notify"] },
  ],
  implement: [
    { category: "issueTracking", stateIds: ["fetch-issue"] },
    { category: "codingAgent", stateIds: ["implement"] },
    { category: "sourceControl", stateIds: ["create-pr"] },
    { category: "notification", stateIds: ["notify"] },
  ],
};

// ── Types ─────────────────────────────────────────────────────────────────────

type ViewMode = "visual" | "split" | "source" | "configure";
type ProviderConfig = Record<string, string>; // category → providerId

// ── Helpers ───────────────────────────────────────────────────────────────────

type StepDefWithProvider = StepDefinition & { provider?: string };

function workflowStats(definition: WorkflowDefinition) {
  const steps = Object.values(definition.steps);
  return {
    total: steps.length,
    learn: steps.filter((s) => s.phase === "learn").length,
    act: steps.filter((s) => s.phase === "act").length,
    report: steps.filter((s) => s.phase === "report").length,
  };
}

function outboundTransitions(state: StepDefinition) {
  const transitions: { label: string; target: string }[] = [];
  if (state.on) {
    for (const [outcome, target] of Object.entries(state.on)) {
      transitions.push({ label: outcome, target });
    }
  }
  if (state.next && !transitions.some((t) => t.target === state.next)) {
    transitions.push({ label: "→", target: state.next });
  }
  return transitions;
}

/** Derive used provider categories from the definition.
 *  First tries step.provider fields; falls back to WORKFLOW_CATEGORIES. */
function getUsedCategories(
  definition: WorkflowDefinition,
  workflowId: string,
): Array<{ category: string; stateIds: string[] }> {
  const catMap: Record<string, string[]> = {};
  for (const [id, state] of Object.entries(definition.steps)) {
    const prov = (state as StepDefWithProvider).provider;
    if (prov) {
      catMap[prov] = [...(catMap[prov] ?? []), id];
    }
  }
  if (Object.keys(catMap).length > 0) {
    return Object.entries(catMap).map(([category, stateIds]) => ({ category, stateIds }));
  }
  return WORKFLOW_CATEGORIES[workflowId] ?? [];
}

/** Collect all env vars needed given a category→providerId config, deduped by key. */
function collectEnvVars(categoryConfig: ProviderConfig): Array<{
  key: string;
  description: string;
  required: boolean;
  secret: boolean;
  example?: string;
  category: string;
  providerName: string;
}> {
  const seen = new Set<string>();
  const result: ReturnType<typeof collectEnvVars> = [];
  for (const [category, providerId] of Object.entries(categoryConfig)) {
    const provider = CATALOG.find((p) => p.id === providerId);
    if (!provider) continue;
    for (const ev of provider.envVars) {
      if (!seen.has(ev.key)) {
        seen.add(ev.key);
        result.push({ ...ev, category, providerName: provider.name });
      }
    }
  }
  return result;
}

/** Generate .env template string. */
function generateEnvTemplate(categoryConfig: ProviderConfig): string {
  const vars = collectEnvVars(categoryConfig);
  if (vars.length === 0) return "# No providers configured yet.\n# Select a provider for each category above.";

  const byCategory: Record<string, typeof vars> = {};
  for (const v of vars) {
    byCategory[v.category] = byCategory[v.category] ?? [];
    byCategory[v.category].push(v);
  }

  const lines: string[] = [];
  for (const [cat, entries] of Object.entries(byCategory)) {
    const providerName = entries[0].providerName;
    lines.push(`# ${CATEGORY_LABELS[cat] ?? cat} — ${providerName}`);
    for (const e of entries) {
      if (e.example) lines.push(`${e.key}=${e.example}`);
      else lines.push(`${e.key}=`);
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}

/** Generate runWorkflow TypeScript snippet. */
function generateCodeSnippet(definition: WorkflowDefinition, categoryConfig: ProviderConfig): string {
  const entries = Object.entries(categoryConfig)
    .map(([category, providerId]) => ({ category, provider: CATALOG.find((p) => p.id === providerId) }))
    .filter((x): x is { category: string; provider: ProviderOption } => !!x.provider);

  if (entries.length === 0) return "// Select providers above to generate setup code.";

  const importLines = entries
    .map(({ provider }) => `import { ${provider.factoryFn} } from "${provider.importPath}";`)
    .join("\n");

  const registrations = entries.map(({ category, provider }) => {
    const vars = provider.envVars
      .filter((v) => v.required)
      .map((v) => `process.env.${v.key}!`)
      .join(", ");
    return `registry.set("${category}", ${provider.factoryFn}(${vars ? `{ /* ${vars} */ }` : "{}"}));`;
  });

  const workflowId = definition.id === "triage" ? "triageWorkflow" : "implementWorkflow";
  const workflowImport = `import { ${workflowId} } from "@sweny-ai/engine";`;

  return [
    `import { runWorkflow, createProviderRegistry } from "@sweny-ai/engine";`,
    workflowImport,
    importLines,
    "",
    `const registry = createProviderRegistry();`,
    ...registrations,
    "",
    `const result = await runWorkflow(${workflowId}, config, registry);`,
    `console.log(result.status); // "completed" | "failed" | "partial"`,
  ].join("\n");
}

// ── Sub-components ────────────────────────────────────────────────────────────

function PhasePill({ phase }: { phase: keyof typeof PHASE_META }) {
  const { label, color, bg } = PHASE_META[phase];
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 4,
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: "0.7rem",
        fontWeight: 600,
        letterSpacing: "0.04em",
        textTransform: "uppercase",
        color,
        background: bg,
        border: `1px solid ${color}33`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: "50%", background: color, flexShrink: 0 }} />
      {label}
    </span>
  );
}

function NodeDetail({
  stateId,
  state,
  isInitial,
  onClose,
}: {
  stateId: string;
  state: StepDefWithProvider;
  isInitial: boolean;
  onClose: () => void;
}) {
  const transitions = outboundTransitions(state);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: "16px",
        height: "100%",
        boxSizing: "border-box",
        overflowY: "auto",
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 8 }}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
            <PhasePill phase={state.phase} />
            {isInitial && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: "#6366f1",
                  background: "rgba(99,102,241,0.1)",
                  border: "1px solid rgba(99,102,241,0.2)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                INITIAL
              </span>
            )}
            {state.critical && (
              <span
                style={{
                  fontSize: "0.65rem",
                  fontWeight: 600,
                  color: "#ef4444",
                  background: "rgba(239,68,68,0.1)",
                  border: "1px solid rgba(239,68,68,0.2)",
                  padding: "2px 6px",
                  borderRadius: 4,
                }}
              >
                CRITICAL
              </span>
            )}
          </div>
          <div
            style={{
              fontFamily: "var(--sl-font-mono, monospace)",
              fontSize: "0.9rem",
              fontWeight: 700,
              color: "#f1f5f9",
              wordBreak: "break-all",
            }}
          >
            {stateId}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          style={{
            flexShrink: 0,
            background: "none",
            border: "none",
            cursor: "pointer",
            color: "#94a3b8",
            padding: 2,
            lineHeight: 1,
            fontSize: "1.1rem",
          }}
        >
          ✕
        </button>
      </div>
      {state.description ? (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#cbd5e1", lineHeight: 1.5 }}>{state.description}</p>
      ) : (
        <p style={{ margin: 0, fontSize: "0.8rem", color: "#475569", fontStyle: "italic" }}>No description.</p>
      )}
      {state.provider && (
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#475569",
            }}
          >
            Provider
          </span>
          <span
            style={{
              fontSize: "0.7rem",
              fontWeight: 600,
              padding: "2px 8px",
              borderRadius: 5,
              background: "rgba(255,255,255,0.05)",
              color: "#94a3b8",
              border: "1px solid rgba(255,255,255,0.1)",
            }}
          >
            {(
              {
                observability: "◉ Observability",
                issueTracking: "◈ Issue Tracking",
                sourceControl: "⎇ Source Control",
                codingAgent: "⬡ Coding Agent",
                notification: "◎ Notification",
              } as Record<string, string>
            )[state.provider] ?? state.provider}
          </span>
        </div>
      )}
      {transitions.length > 0 && (
        <div>
          <div
            style={{
              fontSize: "0.65rem",
              fontWeight: 700,
              letterSpacing: "0.08em",
              textTransform: "uppercase",
              color: "#94a3b8",
              marginBottom: 8,
            }}
          >
            Transitions
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
            {transitions.map(({ label, target }) => (
              <div
                key={label}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  fontSize: "0.75rem",
                  background: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.08)",
                  borderRadius: 6,
                  padding: "4px 8px",
                }}
              >
                <span
                  style={{
                    fontFamily: "var(--sl-font-mono, monospace)",
                    color: label === "failed" ? "#f87171" : label === "→" ? "#94a3b8" : "#a78bfa",
                    fontWeight: 600,
                    minWidth: 60,
                  }}
                >
                  {label}
                </span>
                <span style={{ color: "#94a3b8" }}>→</span>
                <span style={{ fontFamily: "var(--sl-font-mono, monospace)", color: "#f1f5f9" }}>
                  {target === "end" ? <em style={{ color: "#94a3b8" }}>end</em> : target}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
      {transitions.length === 0 && (
        <div style={{ fontSize: "0.75rem", color: "#94a3b8", fontStyle: "italic" }}>
          Terminal step — workflow ends here.
        </div>
      )}
    </div>
  );
}

function WorkflowOverview({
  workflow,
  definition,
}: {
  workflow: (typeof WORKFLOWS)[number];
  definition: WorkflowDefinition;
}) {
  const stats = workflowStats(definition);
  return (
    <div style={{ padding: "16px", display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#94a3b8",
            marginBottom: 6,
          }}
        >
          Workflow
        </div>
        <div style={{ fontSize: "0.95rem", fontWeight: 700, color: "#f1f5f9", marginBottom: 6 }}>{workflow.label}</div>
        <p style={{ margin: 0, fontSize: "0.78rem", color: "#cbd5e1", lineHeight: 1.55 }}>{workflow.description}</p>
      </div>
      <div>
        <div
          style={{
            fontSize: "0.65rem",
            fontWeight: 700,
            letterSpacing: "0.08em",
            textTransform: "uppercase",
            color: "#94a3b8",
            marginBottom: 8,
          }}
        >
          Phases
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {(["learn", "act", "report"] as const).map((phase) => {
            const { label, color } = PHASE_META[phase];
            const count = stats[phase];
            const pct = Math.round((count / stats.total) * 100);
            return (
              <div key={phase}>
                <div
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 3 }}
                >
                  <span style={{ fontSize: "0.72rem", fontWeight: 600, color }}>{label}</span>
                  <span style={{ fontSize: "0.72rem", color: "#94a3b8" }}>{count}</span>
                </div>
                <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 2, overflow: "hidden" }}>
                  <div style={{ width: `${pct}%`, height: "100%", background: color, borderRadius: 2, opacity: 0.7 }} />
                </div>
              </div>
            );
          })}
        </div>
      </div>
      <div
        style={{
          fontSize: "0.72rem",
          color: "#64748b",
          lineHeight: 1.6,
          padding: "10px 12px",
          borderRadius: 7,
          background: "rgba(99,102,241,0.07)",
          border: "1px solid rgba(99,102,241,0.15)",
          marginTop: 4,
        }}
      >
        <div
          style={{
            fontWeight: 700,
            color: "#a5b4fc",
            marginBottom: 3,
            fontSize: "0.7rem",
            letterSpacing: "0.04em",
            textTransform: "uppercase",
          }}
        >
          How to use
        </div>
        <span style={{ color: "#94a3b8" }}>{stats.total} steps</span> · scroll to zoom · drag to pan
        <br />
        <span style={{ color: "#6366f1", fontWeight: 600 }}>Click any node</span> to inspect its phase, provider,
        routing, and transitions.
      </div>
    </div>
  );
}

// ── Configure panel ───────────────────────────────────────────────────────────

function ConfigurePanel({
  definition,
  usedCategories,
  providerConfig,
  onProviderChange,
}: {
  definition: WorkflowDefinition;
  usedCategories: Array<{ category: string; stateIds: string[] }>;
  providerConfig: ProviderConfig;
  onProviderChange: (category: string, providerId: string) => void;
}) {
  const [outputTab, setOutputTab] = useState<"env" | "code">("env");
  const [copied, setCopied] = useState(false);

  const configuredCount = usedCategories.filter(({ category }) => !!providerConfig[category]).length;
  const total = usedCategories.length;
  const allConfigured = total > 0 && configuredCount === total;

  const envText = generateEnvTemplate(providerConfig);
  const codeText = generateCodeSnippet(definition, providerConfig);
  const outputText = outputTab === "env" ? envText : codeText;

  async function copyOutput() {
    await navigator.clipboard.writeText(outputText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div style={{ padding: "12px 14px 10px", borderBottom: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#3d4f6a",
            }}
          >
            Provider Setup
          </span>
          <span
            style={{
              fontSize: 11,
              fontWeight: 600,
              color: allConfigured ? "#22c55e" : configuredCount > 0 ? "#f59e0b" : "#3d4f6a",
            }}
          >
            {allConfigured ? "✓ Ready to run" : `${configuredCount} / ${total} configured`}
          </span>
        </div>
        {/* Progress bar */}
        <div style={{ height: 3, background: "rgba(255,255,255,0.06)", borderRadius: 2, overflow: "hidden" }}>
          <div
            style={{
              width: total > 0 ? `${(configuredCount / total) * 100}%` : "0%",
              height: "100%",
              background: allConfigured ? "#22c55e" : "#6366f1",
              borderRadius: 2,
              transition: "width 0.3s ease",
            }}
          />
        </div>
        <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "#2d3f58", lineHeight: 1.5 }}>
          Pick one provider per category. Env vars and setup code update automatically.
        </p>
      </div>

      {/* Category cards */}
      <div
        style={{ flex: 1, overflowY: "auto", padding: "10px 12px", display: "flex", flexDirection: "column", gap: 8 }}
      >
        {usedCategories.map(({ category, stateIds }) => {
          const meta = CATEGORY_META[category];
          const options = getCatalogForCategory(category);
          const selectedId = providerConfig[category];
          const selected = CATALOG.find((p) => p.id === selectedId);
          const isConfigured = !!selectedId;

          return (
            <div
              key={category}
              style={{
                borderRadius: 9,
                border: `1px solid ${isConfigured ? (meta?.color ?? "#6366f1") + "44" : "rgba(255,255,255,0.07)"}`,
                background: isConfigured ? (meta?.color ?? "#6366f1") + "0a" : "rgba(255,255,255,0.02)",
                transition: "border-color 0.2s, background 0.2s",
              }}
            >
              {/* Card header */}
              <div style={{ padding: "9px 12px 7px", borderBottom: "1px solid rgba(255,255,255,0.05)" }}>
                <div
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 5 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ fontSize: 14, color: meta?.color ?? "#818cf8", lineHeight: 1 }}>
                      {meta?.icon ?? "◆"}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 700, color: "#c8d8e8" }}>
                      {CATEGORY_LABELS[category] ?? category}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 600,
                      padding: "1px 6px",
                      borderRadius: 4,
                      background: "rgba(255,255,255,0.05)",
                      color: "#3d4f6a",
                      letterSpacing: "0.04em",
                    }}
                  >
                    {stateIds.length} step{stateIds.length !== 1 ? "s" : ""}
                  </span>
                </div>
                {/* Step name chips */}
                <div style={{ display: "flex", flexWrap: "wrap", gap: 3 }}>
                  {stateIds.map((id) => (
                    <span
                      key={id}
                      style={{
                        fontSize: 9.5,
                        fontFamily: "monospace",
                        color: "#3d4f6a",
                        background: "rgba(255,255,255,0.04)",
                        border: "1px solid rgba(255,255,255,0.07)",
                        borderRadius: 4,
                        padding: "1px 5px",
                      }}
                    >
                      {id}
                    </span>
                  ))}
                </div>
              </div>

              {/* Provider dropdown + env vars */}
              <div style={{ padding: "8px 12px 10px" }}>
                <select
                  value={selectedId ?? ""}
                  onChange={(e) => onProviderChange(category, e.target.value)}
                  style={{
                    width: "100%",
                    background: "#060c18",
                    color: selectedId ? "#e2e8f0" : "#3d4f6a",
                    border: `1px solid ${isConfigured ? (meta?.color ?? "#6366f1") + "55" : "rgba(255,255,255,0.1)"}`,
                    borderRadius: 7,
                    padding: "6px 28px 6px 10px",
                    fontSize: 12,
                    fontWeight: 500,
                    cursor: "pointer",
                    outline: "none",
                    appearance: "none",
                    backgroundImage:
                      "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='6' fill='none'%3E%3Cpath d='M1 1l4 4 4-4' stroke='%2364748b' stroke-width='1.5' stroke-linecap='round'/%3E%3C/svg%3E\")",
                    backgroundRepeat: "no-repeat",
                    backgroundPosition: "right 9px center",
                  }}
                >
                  <option value="">— choose {CATEGORY_LABELS[category] ?? category} provider —</option>
                  {options.map((opt) => (
                    <option key={opt.id} value={opt.id}>
                      {opt.name}
                    </option>
                  ))}
                </select>

                {/* Env vars for selected provider */}
                {selected && selected.envVars.length > 0 && (
                  <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 3 }}>
                    {selected.envVars.map((ev) => (
                      <div
                        key={ev.key}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 6,
                          padding: "3px 6px",
                          borderRadius: 5,
                          background: "rgba(255,255,255,0.03)",
                          fontSize: 10.5,
                        }}
                      >
                        <code
                          style={{ color: ev.required ? "#93c5fd" : "#3d4f6a", fontFamily: "monospace", flexShrink: 0 }}
                        >
                          {ev.key}
                        </code>
                        <span
                          style={{
                            color: "#2d3f58",
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {ev.description}
                        </span>
                        <span
                          style={{
                            fontSize: 8.5,
                            fontWeight: 700,
                            padding: "1px 4px",
                            borderRadius: 3,
                            background: ev.required ? "rgba(239,68,68,0.15)" : "rgba(100,116,139,0.1)",
                            color: ev.required ? "#fca5a5" : "#3d4f6a",
                            flexShrink: 0,
                          }}
                        >
                          {ev.required ? "req" : "opt"}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
                {selected && selected.envVars.length === 0 && (
                  <p style={{ margin: "6px 0 0", fontSize: 10.5, color: "#2d3f58", fontStyle: "italic" }}>
                    No environment variables required.
                  </p>
                )}
              </div>
            </div>
          );
        })}

        {usedCategories.length === 0 && (
          <div style={{ textAlign: "center", padding: "40px 16px", color: "#2d3f58", fontSize: 12, lineHeight: 1.6 }}>
            No provider categories detected.
            <br />
            <span style={{ fontSize: 11, opacity: 0.6 }}>Try switching to the Triage or Implement workflow.</span>
          </div>
        )}
      </div>

      {/* Output section */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", flexShrink: 0 }}>
        <div style={{ display: "flex", alignItems: "center", padding: "5px 10px 0", gap: 2 }}>
          {(["env", "code"] as const).map((tab) => (
            <button
              key={tab}
              onClick={() => setOutputTab(tab)}
              style={{
                padding: "3px 10px",
                border: "none",
                borderBottom: `2px solid ${outputTab === tab ? "#6366f1" : "transparent"}`,
                background: "transparent",
                cursor: "pointer",
                fontSize: 10.5,
                fontWeight: 600,
                color: outputTab === tab ? "#a5b4fc" : "#3d4f6a",
              }}
            >
              {tab === "env" ? ".env template" : "TypeScript setup"}
            </button>
          ))}
          <button
            onClick={copyOutput}
            style={{
              marginLeft: "auto",
              padding: "2px 8px",
              borderRadius: 4,
              border: "1px solid rgba(255,255,255,0.08)",
              background: "transparent",
              cursor: "pointer",
              fontSize: 9.5,
              color: copied ? "#22c55e" : "#3d4f6a",
            }}
          >
            {copied ? "✓ Copied" : "Copy"}
          </button>
        </div>
        <pre
          style={{
            margin: 0,
            padding: "10px 12px",
            fontSize: 10.5,
            fontFamily: "monospace",
            color: "#4a6180",
            lineHeight: 1.7,
            overflowX: "auto",
            maxHeight: 175,
            overflowY: "auto",
            background: "#020814",
            borderTop: "1px solid rgba(255,255,255,0.04)",
          }}
        >
          {outputText}
        </pre>
      </div>
    </div>
  );
}

// ── Icons ─────────────────────────────────────────────────────────────────────

function ExpandIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M1 5V1h4M13 5V1H9M1 9v4h4M13 9v4H9" />
    </svg>
  );
}
function CompressIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <path d="M5 1v4H1M9 1v4h4M5 13V9H1M9 13V9h4" />
    </svg>
  );
}
function CopyIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6">
      <rect x="5" y="5" width="8" height="8" rx="1" />
      <path d="M9 5V2a1 1 0 0 0-1-1H2a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h3" />
    </svg>
  );
}

// ── Layout constants ──────────────────────────────────────────────────────────

const TOOLBAR_H = 52;
const FOOTER_H = 30;
const PANEL_W_DETAIL = 240;
const PANEL_W_OVERVIEW = 200;
const JSON_PANEL_W = 380;
const CONFIG_PANEL_W = 380;
const EMBEDDED_HEIGHT = "min(80vh, 800px)";

// ── Main component ────────────────────────────────────────────────────────────

export function WorkflowExplorer() {
  const [activeIdx, setActiveIdx] = useState(0);
  const [selectedStateId, setSelectedStateId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("visual");
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [jsonText, setJsonText] = useState(() => JSON.stringify(WORKFLOWS[0].definition, null, 2));
  const [parseError, setParseError] = useState<string | null>(null);
  const [liveDefinition, setLiveDefinition] = useState<WorkflowDefinition>(WORKFLOWS[0].definition);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig>({});
  const [copied, setCopied] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const workflow = WORKFLOWS[activeIdx];
  const selectedState = selectedStateId ? (liveDefinition.steps[selectedStateId] as StepDefWithProvider) : null;
  const usedCategories = getUsedCategories(liveDefinition, workflow.id);

  function switchWorkflow(idx: number) {
    setActiveIdx(idx);
    setSelectedStateId(null);
    setLiveDefinition(WORKFLOWS[idx].definition);
    setJsonText(JSON.stringify(WORKFLOWS[idx].definition, null, 2));
    setParseError(null);
    setProviderConfig({});
  }

  const handleJsonChange = useCallback((text: string) => {
    setJsonText(text);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      try {
        const parsed = JSON.parse(text) as WorkflowDefinition;
        if (parsed && typeof parsed.initial === "string" && parsed.steps) {
          setLiveDefinition(parsed);
          setParseError(null);
          setSelectedStateId(null);
        } else {
          setParseError("Missing required fields: id, initial, steps");
        }
      } catch (e) {
        setParseError(e instanceof Error ? e.message : "Invalid JSON");
      }
    }, 350);
  }, []);

  async function copyJson() {
    await navigator.clipboard.writeText(jsonText);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function toggleFullscreen() {
    const next = !isFullscreen;
    setIsFullscreen(next);
    document.body.style.overflow = next ? "hidden" : "";
  }

  useEffect(() => {
    if (!isFullscreen) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setIsFullscreen(false);
        document.body.style.overflow = "";
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFullscreen]);

  useEffect(
    () => () => {
      document.body.style.overflow = "";
    },
    [],
  );

  // ── Body layout ────────────────────────────────────────────────────────────

  const bodyHeight = isFullscreen
    ? `calc(100vh - ${TOOLBAR_H + FOOTER_H}px)`
    : `calc(${EMBEDDED_HEIGHT} - ${TOOLBAR_H + FOOTER_H}px)`;

  const graphPane = (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0 }}>
      <WorkflowViewer
        key={activeIdx}
        definition={liveDefinition}
        height={bodyHeight}
        onNodeClick={(id) => setSelectedStateId((prev) => (prev === id ? null : id))}
      />
    </div>
  );

  const jsonPane = (
    <div
      style={{
        width: viewMode === "source" ? "100%" : JSON_PANEL_W,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderLeft: viewMode === "split" ? "1px solid rgba(255,255,255,0.08)" : "none",
        background: "#020617",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "5px 12px",
          borderBottom: "1px solid rgba(255,255,255,0.07)",
          background: "rgba(255,255,255,0.03)",
          flexShrink: 0,
        }}
      >
        <div>
          <span
            style={{
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: "0.07em",
              textTransform: "uppercase",
              color: "#3d4f6a",
            }}
          >
            WorkflowDefinition
          </span>
          {viewMode === "source" && (
            <span style={{ fontSize: 10, color: "#2d3f58", marginLeft: 8 }}>
              Edit the JSON below — the graph updates live
            </span>
          )}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {parseError ? (
            <span style={{ fontSize: 10, color: "#f87171" }}>⚠ invalid</span>
          ) : (
            <span style={{ fontSize: 10, color: "#22c55e" }}>✓ valid</span>
          )}
          <button
            onClick={copyJson}
            style={{
              background: "none",
              border: "1px solid rgba(255,255,255,0.1)",
              borderRadius: 4,
              cursor: "pointer",
              color: copied ? "#22c55e" : "#475569",
              padding: "2px 6px",
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 10,
            }}
          >
            <CopyIcon />
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
      </div>
      <textarea
        value={jsonText}
        onChange={(e) => handleJsonChange(e.target.value)}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="off"
        style={{
          flex: 1,
          width: "100%",
          background: "transparent",
          color: parseError ? "#fca5a5" : "#94a3b8",
          fontFamily: "ui-monospace, monospace",
          fontSize: 12,
          lineHeight: 1.65,
          padding: "12px 14px",
          border: "none",
          outline: "none",
          resize: "none",
          boxSizing: "border-box",
          height: bodyHeight,
        }}
      />
    </div>
  );

  const visualSidePanel = viewMode === "visual" && (
    <div
      style={{
        width: selectedState ? PANEL_W_DETAIL : PANEL_W_OVERVIEW,
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(4,8,18,0.5)",
        overflowY: "auto",
        transition: "width 0.2s ease",
      }}
    >
      {selectedState ? (
        <NodeDetail
          stateId={selectedStateId!}
          state={selectedState}
          isInitial={selectedStateId === liveDefinition.initial}
          onClose={() => setSelectedStateId(null)}
        />
      ) : (
        <WorkflowOverview workflow={workflow} definition={liveDefinition} />
      )}
    </div>
  );

  const configurePanel = viewMode === "configure" && (
    <div
      style={{
        width: CONFIG_PANEL_W,
        flexShrink: 0,
        borderLeft: "1px solid rgba(255,255,255,0.07)",
        background: "rgba(4,8,18,0.5)",
        overflow: "hidden",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <ConfigurePanel
        definition={liveDefinition}
        usedCategories={usedCategories}
        providerConfig={providerConfig}
        onProviderChange={(category, providerId) => setProviderConfig((prev) => ({ ...prev, [category]: providerId }))}
      />
    </div>
  );

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const MODES: [ViewMode, string][] = [
    ["visual", "Visual"],
    ["configure", "Configure"],
    ["split", "Split  ↔  JSON"],
    ["source", "JSON"],
  ];

  const toolbar = (
    <div
      style={{
        height: TOOLBAR_H,
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "0 12px 0 14px",
        borderBottom: "1px solid rgba(255,255,255,0.07)",
        background: "linear-gradient(180deg, rgba(12,20,40,0.98) 0%, rgba(8,13,22,0.98) 100%)",
        flexShrink: 0,
        userSelect: "none",
      }}
    >
      {/* Brand mark */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 5,
          marginRight: 4,
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontSize: 15,
            color: "#6366f1",
            lineHeight: 1,
          }}
        >
          ⬡
        </span>
        <span
          style={{
            fontSize: "0.72rem",
            fontWeight: 700,
            letterSpacing: "0.06em",
            textTransform: "uppercase",
            color: "#4f5f80",
          }}
        >
          sweny
        </span>
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

      {/* Workflow selector */}
      <div style={{ display: "flex", gap: 3, flexShrink: 0 }}>
        {WORKFLOWS.map((r, i) => (
          <button
            key={r.id}
            onClick={() => switchWorkflow(i)}
            style={{
              padding: "4px 14px",
              borderRadius: 6,
              border: "1px solid",
              cursor: "pointer",
              fontSize: "0.77rem",
              fontWeight: 600,
              letterSpacing: "0.01em",
              background: activeIdx === i ? "rgba(99,102,241,0.22)" : "transparent",
              color: activeIdx === i ? "#c7d2fe" : "#4f5f80",
              borderColor: activeIdx === i ? "rgba(99,102,241,0.5)" : "rgba(255,255,255,0.07)",
              transition: "all 0.12s ease",
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Separator */}
      <div style={{ width: 1, height: 18, background: "rgba(255,255,255,0.08)", flexShrink: 0 }} />

      {/* View mode tabs */}
      <div
        style={{
          display: "flex",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.08)",
          borderRadius: 7,
          overflow: "hidden",
          flexShrink: 0,
        }}
      >
        {MODES.map(([mode, label], i) => (
          <button
            key={mode}
            onClick={() => setViewMode(mode)}
            style={{
              padding: "3px 13px",
              border: "none",
              borderLeft: i > 0 ? "1px solid rgba(255,255,255,0.07)" : "none",
              cursor: "pointer",
              fontSize: "0.71rem",
              fontWeight: 600,
              letterSpacing: "0.02em",
              background: viewMode === mode ? "rgba(99,102,241,0.25)" : "transparent",
              color: viewMode === mode ? "#a5b4fc" : "#3d4f6a",
              transition: "all 0.12s ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Phase legend — pushed right */}
      <div style={{ marginLeft: "auto", display: "flex", gap: 10, alignItems: "center", flexShrink: 0 }}>
        {(["learn", "act", "report"] as const).map((phase) => {
          const { label, color } = PHASE_META[phase];
          return (
            <div key={phase} style={{ display: "flex", alignItems: "center", gap: 4 }}>
              <span
                style={{
                  width: 6,
                  height: 6,
                  borderRadius: 2,
                  background: color,
                  opacity: 0.75,
                  flexShrink: 0,
                }}
              />
              <span style={{ fontSize: "0.67rem", fontWeight: 500, color: "#3d4f6a", letterSpacing: "0.02em" }}>
                {label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Fullscreen toggle */}
      <button
        onClick={toggleFullscreen}
        title={isFullscreen ? "Exit fullscreen (Esc)" : "Fullscreen"}
        aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}
        style={{
          marginLeft: 6,
          padding: "5px 7px",
          borderRadius: 6,
          border: "1px solid rgba(255,255,255,0.08)",
          cursor: "pointer",
          background: "transparent",
          color: "#3d4f6a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        {isFullscreen ? <CompressIcon /> : <ExpandIcon />}
      </button>
    </div>
  );

  // ── Footer ─────────────────────────────────────────────────────────────────

  const footerHint =
    viewMode === "visual"
      ? "Scroll to zoom  ·  drag to pan  ·  click a node to inspect"
      : viewMode === "configure"
        ? "Click a node to jump to its config  ·  select a provider to reveal env vars"
        : viewMode === "split"
          ? "Edit JSON on the right to live-update the graph"
          : "Paste or type a WorkflowDefinition JSON to visualize it";

  const footer = (
    <div
      style={{
        height: FOOTER_H,
        padding: "0 14px",
        borderTop: "1px solid rgba(255,255,255,0.05)",
        background: "rgba(4,8,18,0.6)",
        fontSize: "0.65rem",
        color: "#2d3f58",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        flexShrink: 0,
        gap: 8,
        letterSpacing: "0.01em",
      }}
    >
      <span>{footerHint}</span>
      {parseError && viewMode !== "visual" && viewMode !== "configure" && (
        <span
          style={{
            color: "#f87171",
            fontSize: "0.65rem",
            fontFamily: "monospace",
            maxWidth: 400,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            flexShrink: 1,
          }}
        >
          ⚠ {parseError}
        </span>
      )}
      <span style={{ flexShrink: 0, opacity: 0.6 }}>@sweny-ai/engine</span>
    </div>
  );

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div
      className="workflow-explorer-root"
      style={
        isFullscreen
          ? {
              position: "fixed",
              inset: 0,
              zIndex: 9999,
              display: "flex",
              flexDirection: "column",
              background: "#060c18",
              borderRadius: 0,
            }
          : {
              display: "flex",
              flexDirection: "column",
              height: EMBEDDED_HEIGHT,
              background: "#060c18",
              borderRadius: 0,
              overflow: "hidden",
            }
      }
    >
      {toolbar}
      <div style={{ flex: 1, display: "flex", minHeight: 0, overflow: "hidden" }}>
        {viewMode !== "source" && graphPane}
        {viewMode === "split" && jsonPane}
        {viewMode === "source" && jsonPane}
        {viewMode === "visual" && visualSidePanel}
        {viewMode === "configure" && configurePanel}
      </div>
      {footer}
    </div>
  );
}
