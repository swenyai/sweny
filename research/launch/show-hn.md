# DRAFT: Show HN (not posted)

Status: draft for owner review. Owner posts from his own account, US morning, after the blog post is live.
Refs swenyai/sweny#351.

## Title (73 chars)

Show HN: SWEny, YAML workflows for coding agents with a receipt every run

URL field: https://github.com/swenyai/sweny

Use the bare repo URL here. GitHub's traffic page (Insights, Traffic, referring sites) is where HN visits show up.

## First comment

OWNER: the first sentence is a guess at your origin story. Keep it only if it's true.

Hi HN, I built SWEny because I kept pasting the same prompts into Claude Code: review this PR, triage these
errors, explain this repo. I wanted them as files I could commit, run in CI, and trust not to do anything I
didn't allow.

A workflow is a YAML DAG. Each node is one coding-agent run with its own instruction, skills and optional
output schema. SWEny sits around the agent and enforces the same rules on every run:

- In CI the agent sees an allowlist of env vars plus only what its node's skills need, and its commands run in
  the SDK sandbox when the host supports it.
- Inputs are fenced as untrusted data before they reach the model.
- `--dry-run` withholds shell, write and edit tools and external MCP servers.
- A missing required output field fails the node. A step with no result fails. Nothing passes by default.
- Every run ends with a receipt (nodes, tool calls, time, tokens, cost). The GitHub Action posts it as a PR
  comment with the run's DAG, and `sweny runs diff` compares against the previous run in local `.sweny/runs/` history (CI runs are
  ephemeral unless you cache it).

Try it in about a minute with no skill credentials, just your agent login:

    npm install -g @sweny-ai/core
    sweny new --template explain-repo --yes
    sweny workflow run .sweny/workflows/explain-repo.yml

Honest status:
- Claude Code is the supported agent; it passes a 15-case contract suite on every CI run. Codex is shipped and
  its suite is green, but it has not been run against a live Codex yet. pi and ACP agents are experimental.
- The CLI and the GitHub Action are MIT and free. There is a hosted dashboard for run history that is not open
  to sign-ups; there's a waitlist if you care, but nothing here needs it.
- It's mostly a one-person project. Rough edges are likely; issues are very welcome.

I'd especially like to hear where the rules are wrong: what you'd want enforced that isn't, and what is too
strict to be useful.
