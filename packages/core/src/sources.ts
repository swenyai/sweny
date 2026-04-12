/**
 * Source type — unified shape for every content-bearing field in a workflow
 * (instructions, rules, context, templates). Supports inline text, relative or
 * absolute file paths, and HTTP(S) URLs via a single ergonomic form.
 *
 * See docs/superpowers/specs/2026-04-12-unified-source-type-design.md.
 */

export type Source = string | { inline: string } | { file: string } | { url: string; type?: string };

export type SourceKind = "inline" | "file" | "url";

/**
 * Classify a plain-string Source by prefix. Throws on empty strings.
 */
export function classifySource(raw: string): SourceKind {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error("source error: empty string is not a valid Source");
  }
  if (trimmed.startsWith("http://") || trimmed.startsWith("https://")) {
    return "url";
  }
  if (trimmed.startsWith("./") || trimmed.startsWith("../") || trimmed.startsWith("/")) {
    return "file";
  }
  return "inline";
}
