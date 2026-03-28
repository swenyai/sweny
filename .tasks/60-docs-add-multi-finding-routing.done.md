# Task 60: Document multi-finding routing in triage workflow

## Goal
Document how the triage workflow's `investigate` node outputs an array of findings and routes based on `novel_count`.

## Where to add/update
1. **`workflows/triage.md`** — Update the investigate node section and routing logic
2. **`getting-started/walkthrough.md`** — If the walkthrough shows old single-finding output, update it

## What to document
The `investigate` node produces structured output (verify schema against source code):
```json
{
  "findings": [
    {
      "title": "...",
      "root_cause": "...",
      "severity": "critical|high|medium|low",
      "is_duplicate": true/false,
      "duplicate_of": "existing issue ID or null",
      "fix_complexity": "simple|moderate|complex",
      "fix_approach": "description or null"
    }
  ],
  "novel_count": 2,
  "highest_severity": "high",
  "recommendation": "..."
}
```

Routing logic:
- `investigate → create_issue`: when `novel_count > 0 AND highest_severity >= medium`
- `investigate → skip`: when `novel_count == 0 OR highest_severity == low`
- `create_issue → implement`: when at least one novel finding has `fix_complexity` simple/moderate AND `fix_approach` is provided
- `create_issue → notify`: when all novel findings are complex or no clear fix approach

Key points:
- Multiple findings per triage run (not just one error)
- Each finding independently classified as novel or duplicate
- Duplicate detection requires searching BOTH open AND closed issues
- `novel_count` drives the routing, not a single boolean

## Verification
- Check `packages/core/src/workflows/triage.ts` for actual edge conditions
- Check the output schema definition
- Make sure the walkthrough example is consistent
