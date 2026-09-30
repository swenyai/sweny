# DRAFT: social posts (not posted)

Status: draft for owner review. Owner posts from his own accounts. Links use the UTM set in `utm-links.md`.
Refs swenyai/sweny#351.

## 1. X / Bluesky

Turned my Claude Code "explain this repo" prompt into a two-step workflow I can commit and run in CI.

SWEny scopes the agent's secrets, fences untrusted input, fails a step that skips its output contract, and
prints a receipt: nodes, tool calls, time, tokens, cost.

MIT. https://github.com/swenyai/sweny?utm_source=x&utm_medium=social&utm_campaign=sweny-launch

## 2. LinkedIn

Coding agents are good at the work. What I wanted was the rules around the work: which secrets the agent can
see, what a dry run is allowed to touch, and a record of what each run did.

SWEny runs coding-agent workflows from YAML, locally or in any CI, and holds every run to the same rules. Each
run ends with a receipt, and on a pull request the GitHub Action posts it with the run's DAG.

Five-minute tutorial: https://nateross.dev/blog/claude-code-workflows-you-can-check-in?utm_source=linkedin&utm_medium=social&utm_campaign=sweny-launch

## 3. r/ClaudeAI

Title: I turned my repeat Claude Code prompts into workflows I can run in CI

Body:

I kept typing the same prompts into Claude Code (review this PR, explain this repo), so I built a small runner
that keeps them as YAML DAGs next to the code. Each node is its own Claude Code run.

What it adds around the agent:
- in CI, secrets scoped to what each node needs
- `--dry-run` that withholds shell, write and edit tools
- output schemas that fail a step instead of guessing
- a receipt per run, and a PR comment from the GitHub Action

Zero-token starter: `sweny new --template explain-repo --yes`, then
`sweny workflow run .sweny/workflows/explain-repo.yml`.

MIT, CLI is free: https://github.com/swenyai/sweny?utm_source=reddit&utm_medium=social&utm_campaign=sweny-launch

Happy to answer questions, and tell me what it gets wrong 🙂

OWNER: the "I kept typing" line in 3 is a guess at your story. Keep it only if it's true.
