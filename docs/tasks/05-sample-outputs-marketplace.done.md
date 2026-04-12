# Task 05: Add Sample Outputs to Marketplace Workflow Detail Pages

## Goal
Show users what a workflow *produces* before they install it. Add a "Sample Output" tab or section to the workflow detail page.

## Context
- Marketplace is at `/Users/nate/src/swenyai/marketplace`
- Workflow detail page: `site/src/components/WorkflowDetail.tsx`
- Currently has 3 tabs: skills, yaml, usage
- Route: `site/src/app/workflows/[id]/page.tsx`
- Types: `site/src/lib/types.ts`

## Approach

### 1. Add `sampleOutput` field to workflow YAML schema
In the marketplace workflow YAML format, add an optional `sample_output` field:
```yaml
sample_output: |
  ## Triage Report
  
  **Issue:** #42 — Login fails on Safari
  **Priority:** P1 — High
  **Category:** Bug
  **Recommendation:** Implement fix
  
  ### Root Cause Analysis
  The `sessionStorage` API behaves differently in Safari's private browsing mode...
```

### 2. Update types
In `site/src/lib/types.ts`, add to `MarketplaceWorkflow`:
```typescript
sampleOutput?: string;
```

### 3. Update workflow loader
In `site/src/lib/workflows.ts`, extract `sample_output` from parsed YAML and include in the workflow object.

### 4. Add "Output" tab to WorkflowDetail
In `site/src/components/WorkflowDetail.tsx`:
- Add a 4th tab: "output" (only shown if `sampleOutput` exists)
- Render the sample output as styled markdown

### 5. Add sample outputs to 3-5 official workflows
Update these workflow YAML files in `workflows/official/`:
- `triage.yml` — sample triage report
- `implement.yml` — sample PR description
- `release-notes.yml` — sample release notes

## Files to Modify
- `site/src/lib/types.ts` — add `sampleOutput` field
- `site/src/lib/workflows.ts` — extract `sample_output` from YAML
- `site/src/components/WorkflowDetail.tsx` — add output tab
- `workflows/official/triage.yml` — add sample output
- `workflows/official/implement.yml` — add sample output  
- `workflows/official/release-notes.yml` — add sample output

## Acceptance Criteria
- [ ] `sampleOutput` field added to types
- [ ] Workflow loader extracts `sample_output` from YAML
- [ ] WorkflowDetail shows "Output" tab when sample exists
- [ ] Sample output rendered as markdown
- [ ] At least 3 official workflows have sample outputs
- [ ] Marketplace builds successfully
