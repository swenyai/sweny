import type { WorkflowPhase } from "@sweny-ai/engine";

export interface StepTypeEntry {
  type: string;
  label: string;
  description: string;
  phase: WorkflowPhase;
  uses?: string[];
}

export const BUILTIN_STEP_TYPES: StepTypeEntry[] = [
  {
    type: "sweny/verify-access",
    label: "Verify Access",
    description: "Verify all required provider credentials",
    phase: "learn",
  },
  {
    type: "sweny/dedup-check",
    label: "Dedup Check",
    description: "Check for duplicate events (idempotency)",
    phase: "learn",
    uses: ["observability"],
  },
  {
    type: "sweny/build-context",
    label: "Build Context",
    description: "Gather logs and context from observability",
    phase: "learn",
    uses: ["observability"],
  },
  {
    type: "sweny/investigate",
    label: "Investigate",
    description: "Run agent to investigate root cause",
    phase: "learn",
    uses: ["codingAgent"],
  },
  {
    type: "sweny/fetch-issue",
    label: "Fetch Issue",
    description: "Fetch issue details from the issue tracker",
    phase: "learn",
    uses: ["issueTracker"],
  },
  {
    type: "sweny/novelty-gate",
    label: "Novelty Gate",
    description: "Check if issue is novel or a duplicate",
    phase: "act",
    uses: ["issueTracker"],
  },
  {
    type: "sweny/create-issue",
    label: "Create Issue",
    description: "Create a ticket in the issue tracker",
    phase: "act",
    uses: ["issueTracker"],
  },
  {
    type: "sweny/implement-fix",
    label: "Implement Fix",
    description: "Run agent to implement the fix",
    phase: "act",
    uses: ["codingAgent"],
  },
  {
    type: "sweny/create-pr",
    label: "Create PR",
    description: "Create a pull request",
    phase: "act",
    uses: ["sourceControl"],
  },
  {
    type: "sweny/cross-repo-check",
    label: "Cross-Repo Check",
    description: "Check if fix should be in another repo",
    phase: "act",
    uses: ["sourceControl"],
  },
  {
    type: "sweny/notify",
    label: "Notify",
    description: "Send notification (Slack, email, etc.)",
    phase: "report",
    uses: ["notification"],
  },
  { type: "custom", label: "Custom Step", description: "Custom step — implement in code", phase: "act" },
];

export function findStepType(type: string): StepTypeEntry | undefined {
  return BUILTIN_STEP_TYPES.find((e) => e.type === type);
}
