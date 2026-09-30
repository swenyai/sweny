---
name: sweny-ship
description: The SWEny delivery loop, from picking the next item on the tracking issue to a verified npm release. Use when working on swenyai/sweny and the user says "ship", "drive the next item", "next phase", "land these", "what's next", "sweny-ship", or asks to implement, review, merge or release sweny work. Covers lane briefs, brain verification, landing order, release proof, and closing the loop.
---

# sweny-ship

One loop, run the same way every time. The plan lives in the tracking issue; the bus says who is doing what; git and npm are the proof.

## 0. Orient (every session)

```bash
export AGENTBUS_AGENT=claude-sweny-brain      # lanes: claude-sweny-lane-<issue>, pass --as on every call
agentbus join --tool claude --model <model> --branch "$(git branch --show-current)" --role "<what you own>"
agentbus inbox; agentbus claims
gh issue view 366 -R swenyai/sweny           # the plan: phases, unchecked items, deferred list
gh pr list -R swenyai/sweny --state open
```

Pick the next unchecked item in the current phase. Anything labelled `deferred` waits for launch evidence or an owner decision. Work that serves no phase in #366 needs the owner's go first.

## 1. Brief a lane (one issue, one worktree, one PR)

**The dev machine is shared and often overloaded. No local test suites, builds, or tsc runs, by anyone. CI is the test gate.** Keep 2 to 3 lanes in flight at most.

Every brief carries: the issue number and "read it first"; `git fetch origin && git checkout -b <branch> origin/main` in an isolated worktree; the agentbus name, `read --topic ruling`, and claims before edits; **test-first** (write the failing spec and the fix; CI proves both); push, open the PR, and wait for `gh pr checks <pr> --watch`, fixing red CI from the logs (`gh run view <id> --log-failed`); PR title, `Closes #N`, the Claude Code footer; **do not merge**; a handoff post on topic `landing`; a Findings section for anything out of scope (reported, not fixed). Lanes never widen scope.

Tier: sonnet for code to a clear spec, opus for security, executor semantics, or anything adversarial.

## 2. Verify (the brain, before any merge)

A lane's report is a claim. Before landing:
- Read the whole diff. Check the new specs actually exercise the fix (a spec asserting its own constant proves nothing).
- CI green on the PR's current head (`gh pr checks <pr>`); read failures from `gh run view --log-failed`, never guess.
- More than one PR in flight: land them one at a time with `scripts/land-pr.sh`, which re-runs CI on each updated head, so the combined tree is tested in CI, not locally.
- **action.yml changes ship instantly** (every main push moves `v5`) while the CLI ships through npm. A new CLI flag in action.yml must be passed only when the user sets the input, or feature-detected via `sweny workflow run --help`.
- **Cloud payloads are metadata only**: enums, counts, ids, durations. No code, diffs, logs, prompts, or model prose.
- **Local behavior stays back-compatible**: heavier sandboxing and env scoping default on in CI only.
- Behavior changes get one line in the PR body saying who is affected.

Send defects back to the same lane (it keeps its context). Merge only reviewed PRs the owner has approved to land.

## 3. Land (one at a time)

```bash
scripts/land-pr.sh <pr>          # update branch, wait for clean, squash-merge; exits 2 on conflicts
```

On exit 2 send the lane back to `git merge origin/main`, keep both sides, rerun gates. Order: correctness first, then the PRs that others rebase onto.

## 4. Prove it shipped

```bash
scripts/verify-release.sh                                   # release run for main head + npm versions
scripts/verify-release.sh "" --expect '--comment-file' --help-args 'workflow run'
```

Failure hints: E404 = NPM_TOKEN expired, E422 = a publishable package.json lacks `repository`, EOTP = token is not an Automation token.

## 5. Close the loop

- Tick the item in #366 (`gh issue view 366 --json body -q .body`, edit, `gh issue edit 366 --body-file`).
- `agentbus post "<pr> landed <sha>: <what changed>" --kind done --topic landing`; `agentbus ctx set baseline_sha <sha>`.
- A lesson that will matter next month goes to memory; a gap in this loop goes into this file.
- Tell the owner: what shipped (version), what is next, what needs their decision. Short.
