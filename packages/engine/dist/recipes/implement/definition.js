export const implementDefinition = {
    id: "implement",
    version: "1.0.0",
    name: "implement",
    description: "Implement a fix for a specific issue and open a pull request",
    initial: "verify-access",
    steps: {
        "verify-access": {
            phase: "learn",
            description: "Verify connectivity to every configured provider before executing.",
            critical: true,
            next: "create-issue",
        },
        "create-issue": {
            phase: "learn",
            description: "Fetch the full issue details from the tracker to build implementation context.",
            uses: ["issueTracker"],
            critical: true,
            next: "implement-fix",
        },
        "implement-fix": {
            phase: "act",
            description: "Run Claude Code against the codebase. Reads the issue, writes the fix, and commits it.",
            uses: ["codingAgent"],
            next: "create-pr",
            on: { failed: "notify" },
        },
        "create-pr": {
            phase: "act",
            description: "Push the branch and open a pull request linked to the issue. Optionally enables auto-merge.",
            uses: ["sourceControl"],
            next: "notify",
            on: { failed: "notify" },
        },
        notify: {
            phase: "report",
            description: "Send a result summary to the configured notification channel.",
            uses: ["notification"],
        },
    },
};
//# sourceMappingURL=definition.js.map