/**
 * Starter workflow templates offered during `sweny new`.
 *
 * Each template is a valid SWEny workflow YAML. Templates are self-contained
 * strings — no filesystem reads needed, works from npm install.
 */

export interface WorkflowTemplate {
  id: string;
  name: string;
  description: string;
  yaml: string;
}

export const WORKFLOW_TEMPLATES: WorkflowTemplate[] = [
  {
    id: "pr-review",
    name: "PR Review Bot",
    description: "Automated code review on pull requests",
    yaml: `id: pr-review
name: PR Review Bot
description: Review pull requests for code quality, security issues, and best practices.
entry: fetch-diff

nodes:
  fetch-diff:
    name: Fetch PR Changes
    instruction: |
      Fetch the pull request diff. Identify which files changed,
      what was added, modified, or removed. Summarize the scope
      of the change.
    skills: [github]

  review-code:
    name: Review Code
    instruction: |
      Review the code changes for:
      - Security vulnerabilities (injection, auth issues, secrets)
      - Logic errors and edge cases
      - Code style and readability
      - Test coverage gaps

      Be specific — reference file names and line numbers.
      Categorize findings as critical, important, or minor.
    skills: [github]

  post-review:
    name: Post Review Comment
    instruction: |
      Post a structured review comment on the pull request.
      Lead with a summary, then list findings by severity.
      If no issues found, approve with a brief note.
    skills: [github]

edges:
  - from: fetch-diff
    to: review-code
  - from: review-code
    to: post-review
`,
  },
  {
    id: "issue-triage",
    name: "Issue Triage",
    description: "Classify, prioritize, and label incoming issues",
    yaml: `id: issue-triage
name: Issue Triage
description: Automatically classify, prioritize, and label new issues.
entry: classify

nodes:
  classify:
    name: Classify Issue
    instruction: |
      Read the issue title and body. Classify it as one of:
      - bug: Something is broken
      - feature: A new capability request
      - question: Asking for help or clarification
      - chore: Maintenance, refactoring, docs

      Also assess priority:
      - P0: Production is down or data loss
      - P1: Major feature broken, workaround exists
      - P2: Minor issue, low impact
      - P3: Nice to have, no urgency
    skills: [github]

  label-and-assign:
    name: Apply Labels
    instruction: |
      Based on the classification, apply the appropriate labels
      to the issue (e.g. "bug", "P1", "needs-triage").
      Add a comment explaining the classification rationale.
    skills: [github]

edges:
  - from: classify
    to: label-and-assign
`,
  },
  {
    id: "security-scan",
    name: "Security Audit",
    description: "Scan code and dependencies for security issues",
    yaml: `id: security-scan
name: Security Audit
description: Scan repository code and dependencies for security vulnerabilities.
entry: scan-code

nodes:
  scan-code:
    name: Scan Code for Secrets
    instruction: |
      Search the repository for exposed secrets, API keys,
      passwords, and tokens in code, config files, and
      environment templates. Check for common patterns:
      hardcoded credentials, leaked keys, insecure defaults.
    skills: [github]

  scan-deps:
    name: Scan Dependencies
    instruction: |
      Review dependency manifests (package.json, requirements.txt,
      go.mod, etc.) for known vulnerable versions. Check for
      outdated packages with security advisories.
    skills: [github]

  compile-report:
    name: Compile Security Report
    instruction: |
      Compile findings from the code and dependency scans into
      a structured security report. Categorize by severity
      (critical, high, medium, low). Include remediation steps
      for each finding.
    skills: [github]

edges:
  - from: scan-code
    to: scan-deps
  - from: scan-deps
    to: compile-report
`,
  },
  {
    id: "release-notes",
    name: "Release Notes",
    description: "Generate release notes from commits and PRs",
    yaml: `id: release-notes
name: Release Notes Generator
description: Generate structured release notes from recent commits and merged PRs.
entry: gather

nodes:
  gather:
    name: Gather Changes
    instruction: |
      List all commits and merged pull requests since the last
      release tag. For each, extract: title, author, PR number,
      and a brief description of what changed.
    skills: [github]

  categorize:
    name: Categorize Changes
    instruction: |
      Group the changes into categories:
      - Features: New capabilities
      - Fixes: Bug fixes
      - Improvements: Performance, refactoring, DX
      - Breaking Changes: Anything that requires migration

      Flag any breaking changes prominently.
    skills: [github]

  write-notes:
    name: Write Release Notes
    instruction: |
      Write polished release notes in markdown. Lead with
      highlights, then list changes by category. Credit
      contributors. Keep it concise but informative.
    skills: [github]

edges:
  - from: gather
    to: categorize
  - from: categorize
    to: write-notes
`,
  },
];
