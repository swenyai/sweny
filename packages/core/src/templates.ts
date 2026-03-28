/**
 * Template loading for issues and PRs.
 *
 * Templates can come from:
 *   1. Local file path (relative to repo root)
 *   2. URL (fetched at runtime)
 *   3. Built-in defaults
 */

import * as fs from "node:fs";
import * as path from "node:path";

export const DEFAULT_ISSUE_TEMPLATE = `## Summary
<!-- One-line description of the issue -->

## Root Cause
<!-- What caused this issue -->

## Impact
- **Severity**: <!-- critical / high / medium / low -->
- **Affected Services**: <!-- list affected services or components -->
- **User Impact**: <!-- description of how users are affected -->

## Steps to Reproduce
1. ...

## Recommended Fix
<!-- Proposed solution -->

## Related
- Commits: <!-- relevant commits -->
- PRs: <!-- related PRs -->
`;

export const DEFAULT_PR_TEMPLATE = `## Summary
<!-- What does this PR do? -->

## Root Cause
<!-- What caused the issue this fixes? -->

## Changes
<!-- Bullet list of changes -->

## Testing
- [ ] Tested locally
- [ ] No breaking changes

## Related Issues
Fixes #
`;

export interface Templates {
  issueTemplate: string;
  prTemplate: string;
}

/**
 * Load a template from a file path or URL.
 * Returns the default if source is empty or loading fails.
 */
export async function loadTemplate(
  source: string | undefined,
  fallback: string,
  cwd: string = process.cwd(),
): Promise<string> {
  if (!source || source.trim() === "") return fallback;

  const trimmed = source.trim();

  // URL
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    try {
      const res = await fetch(trimmed, { signal: AbortSignal.timeout(10_000) });
      if (!res.ok) {
        console.warn(`[templates] Failed to fetch ${trimmed} (HTTP ${res.status}), using default`);
        return fallback;
      }
      return await res.text();
    } catch (err: any) {
      console.warn(`[templates] Failed to fetch ${trimmed}: ${err.message}, using default`);
      return fallback;
    }
  }

  // Local file
  const resolved = path.resolve(cwd, trimmed);
  try {
    return fs.readFileSync(resolved, "utf-8");
  } catch {
    console.warn(`[templates] Template file not found: ${resolved}, using default`);
    return fallback;
  }
}

/**
 * Resolve issue and PR templates from config.
 */
export async function resolveTemplates(
  config: { issueTemplate?: string; prTemplate?: string },
  cwd?: string,
): Promise<Templates> {
  const [issueTemplate, prTemplate] = await Promise.all([
    loadTemplate(config.issueTemplate, DEFAULT_ISSUE_TEMPLATE, cwd),
    loadTemplate(config.prTemplate, DEFAULT_PR_TEMPLATE, cwd),
  ]);
  return { issueTemplate, prTemplate };
}

/**
 * Classify a source entry as URL, file path, or inline text.
 */
function classifySource(source: string): "url" | "file" | "inline" {
  if (source.startsWith("http://") || source.startsWith("https://")) return "url";
  if (source.startsWith("./") || source.startsWith("../") || source.startsWith("/")) return "file";
  return "inline";
}

/**
 * Load additional context documents (local files, URLs, or inline text).
 * Each source is loaded and wrapped with a header.
 * Returns { resolved, urls } — resolved text for files/inline, urls for agent to fetch.
 */
export async function loadAdditionalContext(
  sources: string[],
  cwd: string = process.cwd(),
): Promise<{ resolved: string; urls: string[] }> {
  if (sources.length === 0) return { resolved: "", urls: [] };

  const parts: string[] = [];
  const urls: string[] = [];

  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) continue;

    const kind = classifySource(trimmed);
    if (kind === "url") {
      urls.push(trimmed);
    } else if (kind === "file") {
      const content = await loadTemplate(trimmed, "", cwd);
      if (content) {
        parts.push(`### ${path.basename(trimmed)}\n\n${content}`);
      }
    } else {
      // Inline text — use as-is
      parts.push(trimmed);
    }
  }

  return {
    resolved: parts.length > 0 ? parts.join("\n\n---\n\n") : "",
    urls,
  };
}
