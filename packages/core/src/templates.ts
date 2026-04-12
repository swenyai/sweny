/**
 * Template loading for issues and PRs.
 *
 * Templates can come from:
 *   1. Local file path (relative to repo root)
 *   2. URL (fetched at runtime)
 *   3. Built-in defaults
 *
 * Delegates to sources.ts for actual resolution; this module provides
 * backwards-compatible wrappers with fallback semantics.
 */

import * as path from "node:path";

import { resolveSource, classifySource, type SourceResolutionContext } from "./sources.js";
import { consoleLogger } from "./types.js";

export const DEFAULT_ISSUE_TEMPLATE = `## Summary
<!-- One-line description of the issue -->

## Root Cause
<!-- What caused this issue -->

## Impact
- **Severity**: <!-- critical / high / medium / low -->
- **Affected Services**: <!-- list -->
- **User Impact**: <!-- description -->

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

/** Default resolution context used by template helpers. */
function defaultCtx(cwd: string): SourceResolutionContext {
  return {
    cwd,
    env: process.env,
    authConfig: {},
    offline: false,
    logger: consoleLogger,
  };
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

  try {
    const resolved = await resolveSource(source.trim(), "template", defaultCtx(cwd));
    return resolved.content;
  } catch (err: any) {
    console.warn(`[templates] Failed to load template: ${err.message}, using default`);
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
 * Load additional context documents (local files, URLs, or inline text).
 * Each source is resolved eagerly (including URLs) and wrapped with a header.
 * Returns { resolved, urls } — resolved text for all sources; urls is kept
 * for API compat but will be empty since URLs now resolve eagerly.
 */
export async function loadAdditionalContext(
  sources: string[],
  cwd: string = process.cwd(),
): Promise<{ resolved: string; urls: string[] }> {
  if (sources.length === 0) return { resolved: "", urls: [] };

  const parts: string[] = [];
  const ctx = defaultCtx(cwd);

  for (const source of sources) {
    const trimmed = source.trim();
    if (!trimmed) continue;

    const kind = classifySource(trimmed);
    if (kind === "inline") {
      parts.push(trimmed);
    } else {
      try {
        const resolved = await resolveSource(trimmed, "context", ctx);
        if (resolved.content) {
          const label = kind === "file" ? path.basename(trimmed) : trimmed;
          parts.push(`### ${label}\n\n${resolved.content}`);
        }
      } catch (err: any) {
        console.warn(`[templates] Failed to load context source: ${err.message}`);
      }
    }
  }

  return {
    resolved: parts.length > 0 ? parts.join("\n\n---\n\n") : "",
    urls: [],
  };
}
