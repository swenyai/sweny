# Task 03: README Overhaul with Visual Examples

## Goal
Rewrite the root `README.md` to lead with "what does this do?" → visual example → one-command quickstart. Make it compelling for casual GitHub browsers.

## Context
- Current README covers: overview, get started, usage approaches, built-in actions, real-world examples, packages
- It's informative but leads with installation/config — loses casual browsers
- Need to hook readers in the first 5 seconds with a clear value prop and visual

## Structure

### 1. Hero Section (above the fold)
```markdown
# SWEny — AI Workflows for Software Teams

> Define AI workflows as simple YAML DAGs. Triage alerts, review PRs, generate docs, run security audits — all orchestrated by your rules.

[One-line install command or npx create-sweny]
```

### 2. Quick Visual (what does it produce?)
Show a before/after or a sample workflow YAML → what it actually does:
- A 5-line YAML snippet
- Arrow or "produces" separator
- Screenshot or text output showing the result (e.g., a PR comment, a triage report)

### 3. Quickstart (3 steps max)
```
1. npx create-sweny (or sweny init)
2. sweny triage --issue 42
3. See the result
```

### 4. Why SWEny?
- Composable: mix and match skills in a DAG
- Extensible: custom skills, MCP servers, cross-tool compatible
- Open: YAML spec, open source, works with any AI coding tool
- Production-ready: GitHub Action, CLI, Claude Code plugin

### 5. Surfaces (how to use it)
Keep the existing table but make it more visual

### 6. Built-in Workflows
Brief list with one-line descriptions

### 7. Custom Skills (NEW — highlight this)
Brief mention of the custom skills system, link to docs

### 8. Packages
Keep existing package list but more compact

### 9. Links
docs.sweny.ai, marketplace.sweny.ai, spec.sweny.ai

## Key Principles
- Lead with value, not installation
- Show, don't tell — visual examples
- 3-step quickstart above the fold
- Custom skills as a differentiator
- Cross-tool compatibility as a selling point
- Keep it under 200 lines

## Files to Modify
- `README.md` (root of the repo)

## Acceptance Criteria
- [ ] README leads with value prop + visual
- [ ] Quickstart in ≤3 steps
- [ ] Custom skills highlighted
- [ ] Cross-tool compatibility mentioned
- [ ] Under 200 lines
- [ ] All links valid
