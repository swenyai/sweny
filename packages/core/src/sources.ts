/**
 * Source type — unified shape for every content-bearing field in a workflow
 * (instructions, rules, context, templates). Supports inline text, relative or
 * absolute file paths, and HTTP(S) URLs via a single ergonomic form.
 *
 * See docs/superpowers/specs/2026-04-12-unified-source-type-design.md.
 *
 * This module is browser-safe. Runtime resolution (fs/crypto/fetch helpers)
 * lives in `./source-resolver.ts` so bundlers that target the browser (studio
 * SPA, docs site) can import `sourceZ` and the Source types without dragging
 * in `node:crypto` / `node:fs`.
 */

import { z } from "zod";

import type { Logger } from "./types.js";

export type Source = string | { inline: string } | { file: string } | { url: string; type?: string };

export type SourceKind = "inline" | "file" | "url";

const inlineTagZ = z.object({ inline: z.string().min(1) }).strict();
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

export function normalizeSource(source: Source): [SourceKind, string] {
  if (typeof source === "string") {
    const kind = classifySource(source);
    return [kind, source.trim()];
  }
  if ("inline" in source) return ["inline", source.inline];
  if ("file" in source) return ["file", source.file.trim()];
  if ("url" in source) return ["url", source.url.trim()];
  throw new Error("source error: unrecognised Source shape");
}

/**
 * Result of a DNS lookup: one or more resolved IP addresses for a hostname.
 * Injectable via {@link SourceResolutionContext.dnsLookup} so SSRF host
 * validation is deterministic in tests (no real network).
 */
export type DnsLookup = (hostname: string) => Promise<string[]>;

export type SourceResolutionContext = {
  cwd: string;
  env: NodeJS.ProcessEnv;
  authConfig: Record<string, string>;
  offline: boolean;
  logger: Logger;
  /**
   * Hosts the per-host fetch token (`fetch.auth` mapping) or the
   * `SWENY_FETCH_TOKEN` env var may be sent to. The token is ONLY attached to
   * requests whose host (and every redirect hop's host) appears here. There is
   * deliberately no blanket fallback: a credential is never sent to a host the
   * operator did not explicitly allow. When omitted, the allowlist is derived
   * from the keys of `authConfig`.
   */
  fetchTokenHosts?: string[];
  /**
   * Restrict `file:` source resolution to this directory tree (the repo root,
   * typically `cwd`). Relative and absolute paths that escape it via `..` or
   * symlinks are rejected. Defaults to `cwd`. Set
   * {@link allowFileOutsideRoot} to opt out.
   */
  fileRoot?: string;
  /**
   * Opt out of the {@link fileRoot} sandbox, permitting `file:` sources to read
   * anywhere on disk (legacy behavior). Defaults to `false`.
   */
  allowFileOutsideRoot?: boolean;
  /**
   * Injected DNS resolver for SSRF host validation. Defaults to a
   * `node:dns`-backed lookup. Tests inject a stub to assert IP-blocking without
   * touching the network.
   */
  dnsLookup?: DnsLookup;
};

// Runtime resolvers (hashContent, resolveSource, resolveSources) live in
// `./source-resolver.ts`. They are Node-only (fs, crypto, fetch). Importing
// them from here would drag `node:crypto` into browser bundles that only
// need `sourceZ`/types from this file.
