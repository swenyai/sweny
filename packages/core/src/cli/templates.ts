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
    id: "explain-repo",
    name: "Explain this repo",
    description: "Read the local checkout and explain it. Needs no tokens, no network beyond Claude.",
    yaml: `id: explain-repo
name: Explain This Repo
description: Read the local checkout and explain what it does, how it is laid out, and how to run it.
workflow_type: generic
entry: survey

nodes:
  survey:
    name: Survey the Repo
    instruction: |
      Look at the current directory. Read the README, the package or
      build manifests, and the top-level layout. Identify the main
      languages, the entry points, and the key directories.
      Only read files. Do not modify anything.

  explain:
    name: Explain It
    instruction: |
      From the survey, write a short plain-English explanation:
      what this project does, how it is organized, how to build and
      run it, and where a new contributor should start.
      Keep it under 300 words.

edges:
  - from: survey
    to: explain
`,
  },
  {
    id: "pr-review",
    name: "PR Review Bot",
    description: "Automated code review on pull requests",
    yaml: `id: pr-review
name: PR Review Bot
description: Review pull requests for code quality, security issues, and best practices.
workflow_type: pr_review
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
workflow_type: generic
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
workflow_type: generic
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
workflow_type: generic
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
  {
    id: "content-pipeline",
    name: "Content Generation Pipeline",
    description: "Plan, generate, and validate a batch of content, then hand it off for publishing",
    yaml: `id: content-pipeline
name: Content Generation Pipeline
description: Plan a content batch, generate it, validate quality, and hand off for publishing.
workflow_type: content_generation
entry: plan

nodes:
  plan:
    name: Plan Content
    instruction: |
      Decide what content to generate this run. If the input specifies a
      topic, format, or count, honor it directly. Otherwise propose a
      sensible small batch (2-3 pieces) covering distinct, useful topics.

      Return a plan: for each item, the topic, the target format (e.g.
      article, social post, FAQ entry), and a one-line reason it's worth
      generating.
    output:
      type: object
      properties:
        plan:
          type: array
          items:
            type: object
            properties:
              topic:
                type: string
              format:
                type: string
              reason:
                type: string
            required:
              - topic
              - format
      required:
        - plan

  generate:
    name: Generate Content
    instruction: |
      For each item in the plan from the previous step, write the content
      directly. Match the requested format, keep facts accurate, and make
      it genuinely useful, no filler.
    output:
      type: object
      properties:
        generated:
          type: array
          items:
            type: object
            properties:
              topic:
                type: string
              format:
                type: string
              content:
                type: string
            required:
              - topic
              - content
      required:
        - generated

  validate:
    name: Validate Quality
    instruction: |
      Review each generated piece from the previous step. Flag anything
      that's off-topic, factually wrong, too thin, or otherwise not
      publish-ready. Everything else is approved.
    output:
      type: object
      properties:
        approved:
          type: array
          items:
            type: string
        flagged:
          type: array
          items:
            type: object
            properties:
              topic:
                type: string
              issue:
                type: string
            required:
              - topic
              - issue
      required:
        - approved

  publish:
    name: Hand Off for Publishing
    instruction: |
      Compile the approved content into a publish-ready summary. Call out
      anything flagged for manual review before it goes live.
    output:
      type: object
      properties:
        summary:
          type: string
      required:
        - summary

edges:
  - from: plan
    to: generate
  - from: generate
    to: validate
  - from: validate
    to: publish
`,
  },
  {
    id: "url-monitor",
    name: "URL Change Monitor",
    description: "Watch a set of URLs for content or status changes and alert when something changes",
    yaml: `id: url-monitor
name: URL Change Monitor
description: Watch a set of URLs for content or status changes and alert when something changes.
workflow_type: monitor
entry: check-sources

nodes:
  check-sources:
    name: Fetch Monitored URLs
    instruction: |
      The current content of each monitored URL is provided above as
      context. For each URL, produce a short fingerprint: a handful of key
      facts or values that would change if the page's meaningful content
      changed (ignore timestamps, ads, and other noise).

      Edit the context sources below to point at the URLs you actually want
      to monitor.
    context:
      - url: https://example.com/status
      - url: https://example.com/changelog
    output:
      type: object
      properties:
        snapshot:
          type: array
          items:
            type: object
            properties:
              url:
                type: string
              fingerprint:
                type: string
              notes:
                type: string
            required:
              - url
              - fingerprint
      required:
        - snapshot

  compare-baseline:
    name: Compare Against Last Known State
    instruction: |
      Read the last known snapshot from .sweny/monitor-baseline.json if it
      exists. Compare it against the current snapshot from the previous
      step. If no baseline file exists yet, this is the first run: treat
      everything as unchanged and just record the baseline.

      Write the current snapshot back to .sweny/monitor-baseline.json so
      the next run has something to compare against. Report which URLs
      changed, if any.
    output:
      type: object
      properties:
        changed:
          type: array
          items:
            type: string
        firstRun:
          type: boolean
        summary:
          type: string
      required:
        - changed
        - summary

  alert-on-change:
    name: Alert on Change
    instruction: |
      If the previous step found any changed URLs, send a notification
      summarizing exactly what changed and why it matters. If nothing
      changed (and it wasn't the first run), skip the notification and
      just report that no alert was needed.
    skills:
      - notification

edges:
  - from: check-sources
    to: compare-baseline
  - from: compare-baseline
    to: alert-on-change
`,
  },
  {
    id: "data-sync",
    name: "Data Sync Pipeline",
    description: "Sync structured records from a source to a target, judged for mapping fidelity",
    yaml: `id: data-sync
name: Data Sync Pipeline
description: Sync structured records from a source to a target, with a judge checking every mapping for fidelity.
workflow_type: data_sync
entry: fetch-records

nodes:
  fetch-records:
    name: Fetch Source Records
    instruction: |
      Fetch the source records to sync (from a URL, API, or file referenced
      in your context or input). Normalize them into a structured JSON
      array with clear, consistent field names.
    output:
      type: object
      properties:
        records:
          type: array
          items:
            type: object
        sourceCount:
          type: number
      required:
        - records
        - sourceCount

  transform-records:
    name: Transform Records
    instruction: |
      Map each source record from the previous step onto the target
      schema. For any record that can't be cleanly mapped, leave it out of
      "mapped" and log it in "unmapped" with a specific reason.
    output:
      type: object
      properties:
        mapped:
          type: array
          items:
            type: object
        unmapped:
          type: array
          items:
            type: object
            properties:
              record: {}
              reason:
                type: string
            required:
              - reason
      required:
        - mapped
    eval:
      - name: mapping_is_faithful
        kind: judge
        rubric: |
          Read result.data.mapped and result.data.unmapped, and compare
          them against the source records produced by the fetch-records
          step.

          PASS only if every mapped record preserves the source record's
          key identifying fields (no dropped IDs, no fabricated values),
          and every unmapped record has a specific, genuine reason logged.

          FAIL if any record was silently dropped, any value was invented,
          or an "unmapped" reason is vague or missing.

          Respond with a single token: yes or no.
        pass_when: "yes"

  sync-target:
    name: Write to Target
    instruction: |
      Write the mapped records from the previous step to the sync target.
      Report how many records were written, skipped, or failed, and why.
    output:
      type: object
      properties:
        written:
          type: number
        skipped:
          type: number
        summary:
          type: string
      required:
        - written
        - summary

edges:
  - from: fetch-records
    to: transform-records
  - from: transform-records
    to: sync-target
`,
  },
  {
    id: "seed-content",
    name: "Content Seeder (Supabase)",
    description: "Audit content gaps, generate content, validate quality, and publish straight to Supabase",
    yaml: `id: seed-content
name: Content Generation Pipeline
workflow_type: content_generation
description: Audit content gaps, generate educational content, validate quality, and publish to Supabase
entry: audit
nodes:
  audit:
    name: Audit Content Gaps
    instruction: |-
      You are auditing an educational platform's content library.

      Use supabase_count to check how many items exist for each combination of:
      - Content types: worksheets, games, lessons
      - Subjects: math, science, english, history, geography, economics, music, art, life-skills, foreign-language
      - Difficulties: beginner, easy, medium, hard

      Also check the input parameters — if the user specified a subject, topic, difficulty, and count,
      skip the full audit and just report what they want generated.

      Return a structured content plan: what to generate, how many, at what difficulty and grade level.
      Prioritize gaps where a subject has ZERO content of a given type.
    skills:
      - supabase
    output:
      type: object
      properties:
        plan:
          type: array
          items:
            type: object
            properties:
              contentType:
                type: string
              subject:
                type: string
              topic:
                type: string
              difficulty:
                type: string
              gradeLevel:
                type: string
              count:
                type: number
              reason:
                type: string
            required:
              - contentType
              - subject
              - topic
              - difficulty
              - count
        summary:
          type: string
      required:
        - plan
        - summary
  generate:
    name: Generate Content
    instruction: >-
      You are an expert educator creating content for children ages 5-14.


      For each item in the content plan from the previous step, generate the content directly.

      The content must be high-quality, engaging, age-appropriate, and educationally sound.


      **For worksheets:**

      Generate a JSON array of problems. Each problem needs: "problem", "answer", "format" (answer-line |
      multiple-choice | write-on).

      Requirements:

      - Every answer MUST be correct. Double-check math, facts, spelling.

      - Problems must progress in difficulty within the set.

      - Use at least 2 different problem structures (e.g., equations + word problems for math).

      - Vary phrasing — no two problems should feel copy-pasted.

      - For the target grade level, use appropriate vocabulary and complexity.


      **For lessons:**

      Generate complete HTML + CSS + JS for an interactive lesson.

      Requirements:

      - Must have substantial educational content (not just a shell with navigation).

      - Include interactive elements: quizzes, click-to-reveal, drag-and-drop.

      - Must be visually engaging with colors, icons, and clear typography.

      - Include practice exercises with immediate feedback.

      - Minimum 5 teaching sections plus 2 practice activities.


      **For games:**

      Generate a description and educational requirements only (actual game code is generated

      by the platform's Phaser-based generator).


      Use supabase_insert to write each piece of content to the appropriate table.


      Table schemas:

      - worksheets: id (auto), title, subject, topic, difficulty, grade_level, num_questions, problems (jsonb),
      status='published', source='ai-seed'

      - lessons: id (auto), title, subject, difficulty, grade_level, lesson_type, html_code, css_code, js_code,
      status='published', source='ai-seed'

      - games: id (auto), title, subject, difficulty, grade_level, game_type, html_code, css_code, js_code,
      status='published', source='ai-seed'


      Return a summary of what was generated and inserted.
    skills:
      - supabase
    output:
      type: object
      properties:
        generated:
          type: array
          items:
            type: object
            properties:
              contentType:
                type: string
              title:
                type: string
              subject:
                type: string
              id:
                type: string
              status:
                type: string
        totalGenerated:
          type: number
        errors:
          type: array
          items:
            type: string
      required:
        - generated
        - totalGenerated
  validate:
    name: Validate Content Quality
    instruction: |-
      Review the content that was just generated and inserted.

      For each item, use supabase_query to fetch it back and verify:

      **Worksheets:**
      - Parse the problems JSON — are all answers correct?
      - Are problems diverse (not repetitive)?
      - Is difficulty appropriate for the stated grade level?
      - Are there the right number of questions?

      **Lessons:**
      - Is the HTML substantial (> 500 characters)?
      - Does it contain actual educational content (not just navigation shells)?
      - Are there interactive elements?

      **Games:**
      - Does the HTML contain a working game structure?

      Flag any issues. If critical issues are found (wrong answers, empty content),
      use supabase_update to set status='draft' and add a note.

      Return a quality report.
    skills:
      - supabase
    output:
      type: object
      properties:
        totalReviewed:
          type: number
        passed:
          type: number
        flagged:
          type: number
        issues:
          type: array
          items:
            type: object
            properties:
              id:
                type: string
              title:
                type: string
              issue:
                type: string
              severity:
                type: string
              action:
                type: string
        summary:
          type: string
      required:
        - totalReviewed
        - passed
        - flagged
        - summary
  report:
    name: Generate Report
    instruction: |-
      Compile a final report of the content generation run.

      Include:
      - Total content generated by type and subject
      - Quality validation results
      - Any issues found and actions taken
      - Recommendations for next content generation run (what gaps remain)

      Format as a clean markdown summary that a solo operator can scan in 30 seconds.
    skills: []
    output:
      type: object
      properties:
        markdown:
          type: string
        nextPriorities:
          type: array
          items:
            type: string
      required:
        - markdown
edges:
  - from: audit
    to: generate
  - from: generate
    to: validate
  - from: validate
    to: report
`,
  },
];
