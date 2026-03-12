export const triageDefinition = {
    id: "triage",
    version: "1.0.0",
    name: "triage",
    description: "Investigate production issues, implement fixes, and report results",
    initial: "dedup-check",
    states: {
        // Pre-flight — deterministic dedup before any provider/LLM calls
        "dedup-check": {
            phase: "learn",
            description: "Check recent issue labels to skip duplicates before calling any external service.",
            provider: "observability",
            next: "verify-access",
            on: { duplicate: "notify" },
        },
        // Learn phase — gather data
        "verify-access": {
            phase: "learn",
            description: "Verify connectivity to every configured provider (observability, issue tracker, source control).",
            critical: true,
            next: "build-context",
        },
        "build-context": {
            phase: "learn",
            description: "Query logs, aggregate error patterns, and build a structured context object for the AI investigator.",
            provider: "observability",
            critical: true,
            next: "investigate",
        },
        investigate: {
            phase: "learn",
            description: "Run Claude Code against the codebase with the error context. Produces root-cause analysis and an implementation plan.",
            provider: "codingAgent",
            critical: true,
            next: "novelty-gate",
        },
        // Act phase — novelty gate routes to create-issue or directly to notify
        "novelty-gate": {
            phase: "act",
            description: "Decide whether this error is novel (implement), already known (skip), or unactionable (failed).",
            provider: "issueTracking",
            on: {
                skip: "notify",
                implement: "create-issue",
                failed: "notify",
            },
        },
        "create-issue": {
            phase: "act",
            description: "Open a ticket in the issue tracker with the root-cause analysis and AI-generated description.",
            provider: "issueTracking",
            next: "cross-repo-check",
            on: { failed: "notify" },
        },
        // Cross-repo check routes to implement-fix or to notify
        "cross-repo-check": {
            phase: "act",
            description: "Determine whether the fix belongs in this repo or a dependency. Dispatches a cross-repo workflow if needed.",
            provider: "sourceControl",
            on: {
                local: "implement-fix",
                dispatched: "notify",
                failed: "notify",
            },
        },
        "implement-fix": {
            phase: "act",
            description: "Write and commit the fix using Claude Code, guided by the investigation output.",
            provider: "codingAgent",
            next: "create-pr",
            on: { failed: "notify" },
        },
        "create-pr": {
            phase: "act",
            description: "Push the branch and open a pull request. Links the PR to the issue. Optionally enables auto-merge.",
            provider: "sourceControl",
            next: "notify",
            on: { failed: "notify" },
        },
        // Report phase — notify stakeholders
        notify: {
            phase: "report",
            description: "Send a structured summary to the configured notification channel (Slack, Teams, Discord, email, etc.).",
            provider: "notification",
        },
    },
};
//# sourceMappingURL=definition.js.map