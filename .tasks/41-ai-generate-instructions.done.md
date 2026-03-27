# AI-Generated Node Instructions

## Why this matters
Writing good node instructions is the hardest part of building a workflow. Most users will write
shallow one-liners like "check sentry for errors" when they need detailed, actionable prompts.
An AI assist button that expands a brief description into a thorough instruction — using the node's
context (name, skills, position in the workflow) — dramatically lowers the barrier to building
effective workflows.

## What to do

### 1. Create AI instruction generation utility
Create `packages/studio/src/lib/generate-instruction.ts`.

**API:**
```ts
export async function generateInstruction(opts: {
  apiKey: string;
  nodeName: string;
  nodeId: string;
  skills: string[];
  existingInstruction: string;  // empty string or user's draft
  workflowContext: {
    workflowName: string;
    workflowDescription: string;
    nodeNames: string[];         // all node names for context
  };
}): Promise<string>
```

**Implementation:**
- Call the Anthropic Messages API directly (`POST https://api.anthropic.com/v1/messages`)
- Use `claude-haiku-4-5-20251001` for speed/cost (instruction generation is a small task)
- System prompt explains:
  - The user is building a SWEny workflow node
  - The instruction will be executed autonomously by Claude with access to the listed skills/tools
  - Generate a detailed, actionable instruction (reference the guidance from the workflow-builder spec)
  - If `existingInstruction` is non-empty, improve/expand it rather than replacing from scratch
- User message: the node name, skills, and workflow context
- Return the generated text content

### 2. Add API key configuration
- Read API key from `ANTHROPIC_API_KEY` environment variable
- In the studio, since it's a browser app, we need a different approach:
  - Add an "AI Settings" section to the toolbar or a settings popover
  - Store API key in `localStorage` under `sweny-studio-api-key`
  - Show a small input field (password type) where users paste their key
  - Key is never sent anywhere except directly to api.anthropic.com

### 3. Add "Generate with AI" button to PropertiesPanel
- Below the instruction textarea, add a button: "Generate with AI" (or sparkle icon + "AI Assist")
- Only visible in design mode
- If no API key is configured, clicking shows a popover/tooltip: "Set your Anthropic API key in Settings to use AI assist"
- When clicked with a valid key:
  1. Button shows loading state (spinner + "Generating...")
  2. Calls `generateInstruction()` with the node's context
  3. On success: replaces the instruction textarea content and calls `updateNode()`
  4. On error: shows inline error message (e.g. "Invalid API key" or "Rate limited")
- If the textarea already has content, the button label changes to "Improve with AI"

### 4. Add API key settings UI
- Add a small settings gear icon to the Toolbar (right side, near Help)
- Clicking opens a dropdown/popover with:
  - "Anthropic API Key" label
  - Password input field
  - "Save" button (stores to localStorage)
  - "Clear" button (removes from localStorage)
  - Small note: "Used for AI-assisted instruction generation. Key is stored locally and sent only to api.anthropic.com."

## Files to modify
- `packages/studio/src/lib/generate-instruction.ts` (new)
- `packages/studio/src/components/PropertiesPanel.tsx` (add AI button)
- `packages/studio/src/components/Toolbar.tsx` (add settings gear + API key popover)

## Acceptance criteria
- Users can paste an Anthropic API key in the settings UI
- "Generate with AI" produces a detailed, multi-paragraph instruction from a node's context
- "Improve with AI" enhances an existing instruction without replacing it entirely
- Loading and error states are handled gracefully
- No API key = graceful degradation (button explains what to do)
- API key stored in localStorage only, never logged or sent to any other endpoint
- `npm run build` passes in packages/studio
