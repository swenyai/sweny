# Task: Studio — Recipe Permalink / Shareable URL

## Goal
Encode the current recipe into the URL hash so users can share a link that reopens
the exact recipe. Add a "Copy link" button to the toolbar.

## Design
- URL format: `http://localhost:5173/#def=<base64url-encoded-JSON>`
- On mount, if `#def=` is present, decode and load the recipe
- "Copy link" button encodes the current recipe and writes the URL to clipboard
- Loading from permalink clears undo history (no going back to a "blank" state)

## Implementation

### 1. Create `packages/studio/src/lib/permalink.ts`

```typescript
import type { RecipeDefinition } from "@sweny-ai/engine";
import { validateDefinition } from "@sweny-ai/engine";

const HASH_KEY = "def";

/**
 * Encode a RecipeDefinition as a URL-safe base64 string.
 */
export function encodeRecipe(definition: RecipeDefinition): string {
  const json = JSON.stringify(definition);
  // btoa requires latin1 — use encodeURIComponent + escape for unicode safety
  return btoa(encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1: string) =>
    String.fromCharCode(parseInt(p1, 16))
  ));
}

/**
 * Decode a base64 string from the URL hash back to a RecipeDefinition.
 * Returns null if the hash is missing, malformed, or fails validation.
 */
export function decodeRecipe(encoded: string): RecipeDefinition | null {
  try {
    const json = decodeURIComponent(
      Array.from(atob(encoded))
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    );
    const def = JSON.parse(json) as RecipeDefinition;
    if (validateDefinition(def).some(e => e.code === "MISSING_INITIAL")) return null;
    return def;
  } catch {
    return null;
  }
}

/**
 * Read the recipe from the current URL hash, if present.
 * Returns null if no #def= found or if decode fails.
 */
export function readPermalinkFromHash(): RecipeDefinition | null {
  const hash = window.location.hash.slice(1); // remove leading #
  const params = new URLSearchParams(hash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) return null;
  return decodeRecipe(encoded);
}

/**
 * Build a shareable URL for the given definition.
 */
export function buildPermalinkUrl(definition: RecipeDefinition): string {
  const encoded = encodeRecipe(definition);
  const url = new URL(window.location.href);
  url.hash = `${HASH_KEY}=${encoded}`;
  return url.toString();
}
```

### 2. Load from permalink on app mount in `App.tsx`

In the `App` component, add a `useEffect` that runs once on mount:

```tsx
import { readPermalinkFromHash } from "./lib/permalink.js";

useEffect(() => {
  const fromLink = readPermalinkFromHash();
  if (fromLink) {
    setDefinition(fromLink);
    // Clear undo history so the user doesn't undo back to the default recipe
    useEditorStore.temporal.getState().clear();
  }
}, []); // eslint-disable-line react-hooks/exhaustive-deps
```

### 3. Add "Copy link" button to `Toolbar.tsx`

```tsx
import { buildPermalinkUrl } from "../lib/permalink.js";

// In the toolbar, near the Export buttons:
const [copied, setCopied] = useState(false);

function handleCopyLink() {
  const { definition } = useEditorStore.getState();
  const url = buildPermalinkUrl(definition);
  navigator.clipboard.writeText(url).then(() => {
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  });
}

// JSX:
<button
  onClick={handleCopyLink}
  className="px-3 py-1 text-xs bg-gray-700 text-gray-200 rounded hover:bg-gray-600"
>
  {copied ? "Copied!" : "Share link"}
</button>
```

### 4. Keep hash in sync as user edits (optional but nice)

Subscribe to definition changes and update the URL hash silently:
```tsx
useEffect(() => {
  const encoded = encodeRecipe(definition);
  const newHash = `#def=${encoded}`;
  if (window.location.hash !== newHash) {
    window.history.replaceState(null, "", newHash);
  }
}, [definition]);
```

This keeps the URL always shareable without clicking "Copy link". Use `replaceState` (not `pushState`) so Back button doesn't navigate through every keystroke.

## Files to change
- `packages/studio/src/lib/permalink.ts` — new pure utility
- `packages/studio/src/App.tsx` — mount effect to load from hash + sync hash on change
- `packages/studio/src/components/Toolbar.tsx` — "Share link" / "Copied!" button

## Typecheck & build
Run `npm run typecheck` and `npm run build` in `packages/studio`.

## Commit when done
```
git add packages/studio/src/
git commit -m "feat(studio): recipe permalink — shareable URL with base64-encoded definition"
```
Then rename: `mv studio-permalink.todo.md studio-permalink.done.md`
