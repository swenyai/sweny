/**
 * Source type — unified shape for every content-bearing field in a workflow
 * (instructions, rules, context, templates). Supports inline text, relative or
 * absolute file paths, and HTTP(S) URLs via a single ergonomic form.
 *
 * See docs/superpowers/specs/2026-04-12-unified-source-type-design.md.
 */

import { createHash } from "node:crypto";

import { z } from "zod";

export type Source = string | { inline: string } | { file: string } | { url: string; type?: string };

export type SourceKind = "inline" | "file" | "url";

const inlineTagZ = z.object({ inline: z.string() }).strict();
const fileTagZ = z.object({ file: z.string().min(1) }).strict();
const urlTagZ = z
  .object({
    url: z.string().url(),
    type: z.string().optional(),
  })
  .strict();

/**
 * Zod schema for a Source. Accepts either a non-empty string (classified by
 * prefix) or one of three tagged object forms: {inline}, {file}, {url,type?}.
 * Runtime validation of `type` against the resolver registry happens later —
 * the schema stays permissive so new resolvers slot in without schema bumps.
 */
export const sourceZ = z.union([z.string().min(1), inlineTagZ, fileTagZ, urlTagZ]);

/**
 * Classify a plain-string Source by prefix. Throws on empty strings.
 */
export type ResolvedSource = {
  content: string;
  kind: SourceKind;
  origin: Source;
  resolver: "inline" | "file" | "fetch";
  hash: string;
  fetchedAt?: string;
  sourcePath?: string;
};

export type SourceResolutionMap = Record<string, ResolvedSource>;

export function hashContent(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 16);
}

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
