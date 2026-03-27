export interface GenerateInstructionOptions {
  apiKey: string;
  nodeName: string;
  nodeId: string;
  skills: string[];
  existingInstruction: string;
  workflowContext: {
    workflowName: string;
    workflowDescription: string;
    nodeNames: string[];
  };
}

const SYSTEM_PROMPT = `You are helping a user build a SWEny workflow node instruction. SWEny is a workflow automation platform where each node's instruction is executed autonomously by Claude with access to specific tools/skills.

Write instructions as if briefing a skilled engineer who has access to the node's tools but no other context. Be specific about:

- WHAT to query/search/create (not just "check for errors" — specify filters, time ranges, grouping)
- HOW to interpret results (what counts as actionable? what thresholds matter?)
- WHAT output to produce (structured findings, not just "summarize")
- HOW to handle edge cases (no results found, too many results, ambiguous data)

Bad:  "Query Sentry for errors"
Good: "Query Sentry for unresolved errors from the last 24 hours. Group by issue fingerprint. For each group, note: error count, affected services, first/last seen timestamps, and stack trace summary. Prioritize by frequency × recency. If no errors found, report that explicitly so downstream nodes can skip."

Return ONLY the instruction text — no markdown fences, no explanation, no preamble.`;

export async function generateInstruction(opts: GenerateInstructionOptions): Promise<string> {
  const userMessage = [
    `Node name: ${opts.nodeName}`,
    `Node ID: ${opts.nodeId}`,
    `Available skills/tools: ${opts.skills.length > 0 ? opts.skills.join(", ") : "none (general purpose)"}`,
    `Workflow: "${opts.workflowContext.workflowName}" — ${opts.workflowContext.workflowDescription}`,
    `Other nodes in workflow: ${opts.workflowContext.nodeNames.join(", ")}`,
    "",
    opts.existingInstruction
      ? `The user has drafted this instruction — improve and expand it:\n${opts.existingInstruction}`
      : `Write a detailed instruction for this node from scratch.`,
  ].join("\n");

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": opts.apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    if (response.status === 401) throw new Error("Invalid API key");
    if (response.status === 429) throw new Error("Rate limited — try again in a moment");
    throw new Error(`API error ${response.status}: ${body.slice(0, 200)}`);
  }

  const data = (await response.json()) as { content: { type: string; text: string }[] };
  const text = data.content.find((c) => c.type === "text")?.text;
  if (!text) throw new Error("No text in API response");
  return text.trim();
}

const STORAGE_KEY = "sweny-studio-api-key";

export function getStoredApiKey(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setStoredApiKey(key: string): void {
  try {
    if (key) {
      localStorage.setItem(STORAGE_KEY, key);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable
  }
}
