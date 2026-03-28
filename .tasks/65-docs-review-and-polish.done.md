# Task 65: Final review and polish pass

## Goal
After all other doc tasks are done, do a final review pass for consistency, completeness, and quality.

## Checklist

### Terminology consistency
- [ ] "Workflow" (not "recipe") everywhere
- [ ] "Node" (not "step" or "state") everywhere — except in natural language where "step" is fine colloquially
- [ ] "Edge" (not "transition") for graph connections
- [ ] "Skill" (not "provider") for tool groups
- [ ] `@sweny-ai/core` (not `@sweny-ai/cli` or `@sweny-ai/engine`)
- [ ] `swenyai/sweny@v4` for action version — check this is current

### Cross-page consistency
- [ ] Skill tool names match across skills/*.md pages and the walkthrough
- [ ] CLI flags in cli/commands.md match examples in cli/examples.md
- [ ] Action inputs in action/inputs.md match examples in action/examples.md
- [ ] All internal links resolve (no broken `/getting-started/engine/` style links)

### Quality checks
- [ ] No "TODO", "TBD", "coming soon" unless genuinely planned
- [ ] No placeholder content
- [ ] Code blocks have correct language tags (yaml, typescript, bash, json)
- [ ] All YAML examples are valid YAML
- [ ] All TypeScript examples compile conceptually (correct types, imports)

### Build verification
- Run `cd packages/web && npm run build` to confirm the Starlight site builds without errors
- Fix any broken links or missing pages reported by the build

### README.md
- [ ] Verify README matches current state (three entry points, skills table, package table)
- [ ] Links in README point to correct docs.sweny.ai paths

## Verification
- Starlight build succeeds
- No console warnings about broken links
- Manual spot-check of 5 random pages for accuracy
