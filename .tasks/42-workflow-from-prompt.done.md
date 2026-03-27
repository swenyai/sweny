# Generate Workflow from Prompt (Studio)

## Why this matters
The CLI spec (`docs/superpowers/specs/2026-03-26-workflow-builder-design.md`) defines `buildWorkflow()`
and `refineWorkflow()` for creating workflows from natural language. The Studio needs the same
capability — a user should be able to type "monitor sentry, investigate with datadog, create linear
tickets for real bugs, notify slack" and get a complete workflow rendered on the canvas.
This is the GUI equivalent of `sweny workflow create`.

## What to do

### 1. Ensure `buildWorkflow()` and `refineWorkflow()` exist in core
Check if `packages/core/src/workflow-builder.ts` exists. If not, create it following the spec exactly:

```ts
export interface BuildWorkflowOptions {
  description: string;
  skills: { id: string; name: string; description: string }[];
  apiKey: string;
}

export async function buildWorkflow(opts: BuildWorkflowOptions): Promise<Workflow>
export async function refineWorkflow(
  workflow: Workflow,
  instruction: string,
  opts: Omit<BuildWorkflowOptions, "description">,
): Promise<Workflow>
```

**Implementation (browser-compatible, no Claude SDK needed):**
- Call `POST https://api.anthropic.com/v1/messages` directly with `fetch()`
- Model: `claude-haiku-4-5-20251001` (fast + cheap for structured generation)
- System prompt includes:
  - The Workflow JSON schema (nodes, edges, entry, id, name, description)
  - Available skill IDs with descriptions
  - Instruction quality guidance from the spec
  - Rules: snake_case node IDs, set entry to first node, reference only provided skills
- Request JSON response format
- Parse response, validate with `workflowZ.parse()` + `validateWorkflow()`
- For `refineWorkflow`: include current workflow JSON in the system prompt as context

### 2. Create WorkflowPromptBar component
Create `packages/studio/src/components/WorkflowPromptBar.tsx`.

**Layout:** A prompt bar that appears above the canvas (below the validation errors bar).
- Text input field (full width, single line) with placeholder: "Describe your workflow..."
- "Generate" button (right side of input)
- Loading state: input disabled, spinner in button, "Generating..." text
- Error state: red border + error message below input
- Success: generated workflow loads into the editor, prompt bar stays visible for refinement

**Refinement mode:**
- After a workflow is generated, the placeholder changes to: "Describe changes..."
- Submitting calls `refineWorkflow()` with the current workflow + the new instruction
- This creates a natural iterate-in-place loop

### 3. Wire into App.tsx
- Show WorkflowPromptBar in design mode, between the validation bar and the main content area
- Only visible when an API key is configured (check localStorage `sweny-studio-api-key`)
- On successful generation:
  1. Call `setWorkflow()` with the generated workflow
  2. Clear undo history
  3. Set `activeId` to "custom"

### 4. Add keyboard shortcut
- `Cmd+K` or `/` (when not in an input) focuses the prompt bar input
- Enter submits the prompt

## Dependencies
- Requires Task 41 (AI Settings / API key in localStorage) for the API key
- Uses `getSkillCatalog()` from `@sweny-ai/core/studio` for available skills
- Uses `validateWorkflow()` from `@sweny-ai/core/schema` for validation

## Files to modify
- `packages/core/src/workflow-builder.ts` (new — or verify it exists)
- `packages/studio/src/components/WorkflowPromptBar.tsx` (new)
- `packages/studio/src/App.tsx` (wire in prompt bar)

## Acceptance criteria
- User can type a workflow description and get a valid workflow rendered on the canvas
- Generated workflows have detailed, multi-paragraph instructions (not one-liners)
- Refinement mode lets users iterate on the generated workflow
- Invalid API key shows a clear error message
- Validation errors from the generated workflow are displayed normally
- Cmd+K focuses the prompt bar
- `npm run build` passes in both packages/core and packages/studio
