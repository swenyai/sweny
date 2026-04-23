/**
 * Template + rules/context loading for the CLI.
 *
 * Templates and additional-context documents can come from:
 *   1. Local file path (relative to repo root)
 *   2. URL (fetched at runtime)
 *   3. Built-in defaults / inline text
 *
 * Delegates to source-resolver.ts for the actual fetch. Fix #16: both
 * `loadTemplate` and `loadAdditionalContext` now honor `offline` and
 * `fetchAuth` the same way the executor's per-node Sources do, so CLI-level
 * rules/context stay consistent with everything the executor touches later.
 */

import * as path from "node:path";

import { classifySource, type SourceResolutionContext } from "./sources.js";
import { resolveSource } from "./source-resolver.js";
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

/**
 * Options shared by `loadTemplate` and `loadAdditionalContext`.
 *
 * `offline` and `fetchAuth` mirror the same knobs on the executor's
 * `ExecuteOptions`, so CLI-preloaded rules/context resolve under the same
 * policy as Sources resolved later by the executor.
 */
export interface SourceLoadOptions {
  cwd?: string;
  offline?: boolean;
  /** Host → env-var-name map for URL Source authentication (Bearer). */
  fetchAuth?: Record<string, string>;
  /** Environment used to resolve `fetchAuth` env-var names. Defaults to process.env. */
  env?: NodeJS.ProcessEnv;
}

function buildCtx(options: SourceLoadOptions): SourceResolutionContext {
  return {
    cwd: options.cwd ?? process.cwd(),
    env: options.env ?? process.env,
    authConfig: options.fetchAuth ?? {},
    offline: options.offline ?? false,
    logger: consoleLogger,
  };
}

/**
 * Load a template from a file path or URL.
 * Returns the default if source is empty or loading fails.
 *
 * Accepts the legacy `cwd?: string` signature for backward compat.
 */
export async function loadTemplate(
  source: string | undefined,
  fallback: string,
  options: SourceLoadOptions | string = {},
): Promise<string> {
  if (!source || source.trim() === "") return fallback;
  const opts: SourceLoadOptions = typeof options === "string" ? { cwd: options } : options;

  try {
    const resolved = await resolveSource(source.trim(), "template", buildCtx(opts));
    return resolved.content;
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[templates] Failed to load template: ${msg}, using default`);
    return fallback;
  }
}

/**
 * Resolve issue and PR templates from config.
 */
export async function resolveTemplates(
  config: { issueTemplate?: string; prTemplate?: string },
  options: SourceLoadOptions | string = {},
): Promise<Templates> {
  const opts: SourceLoadOptions = typeof options === "string" ? { cwd: options } : options;
  const [issueTemplate, prTemplate] = await Promise.all([
    loadTemplate(config.issueTemplate, DEFAULT_ISSUE_TEMPLATE, opts),
    loadTemplate(config.prTemplate, DEFAULT_PR_TEMPLATE, opts),
  ]);
  return { issueTemplate, prTemplate };
}

/**
 * Load additional context documents (local files, URLs, or inline text).
 * Each source is resolved eagerly (including URLs) and wrapped with a header.
 * Returns { resolved, urls } — resolved text for all sources; urls is kept
 * for API compat but will be empty since URLs now resolve eagerly.
 *
 * Accepts the legacy `cwd?: string` signature for backward compat.
 */
export async function loadAdditionalContext(
  sources: string[],
  options: SourceLoadOptions | string = {},
): Promise<{ resolved: string; urls: string[] }> {
  if (sources.length === 0) return { resolved: "", urls: [] };

  const opts: SourceLoadOptions = typeof options === "string" ? { cwd: options } : options;
  const parts: string[] = [];
  const ctx = buildCtx(opts);

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
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[templates] Failed to load context source: ${msg}`);
      }
    }
  }

  return {
    resolved: parts.length > 0 ? parts.join("\n\n---\n\n") : "",
    urls: [],
  };
}
