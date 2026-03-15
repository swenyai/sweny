import type { WorkflowDefinition } from "@sweny-ai/engine";
import { validateWorkflow } from "@sweny-ai/engine";

const HASH_KEY = "def";

/**
 * Encode a WorkflowDefinition as a URL-safe base64 string.
 */
export function encodeWorkflow(definition: WorkflowDefinition): string {
  const json = JSON.stringify(definition);
  // btoa requires latin1 — use encodeURIComponent + escape for unicode safety
  return btoa(
    encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1: string) => String.fromCharCode(parseInt(p1, 16))),
  );
}

/**
 * Decode a base64 string from the URL hash back to a WorkflowDefinition.
 * Returns null if the hash is missing, malformed, or fails validation.
 */
export function decodeWorkflow(encoded: string): WorkflowDefinition | null {
  try {
    const json = decodeURIComponent(
      Array.from(atob(encoded))
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const raw: unknown = JSON.parse(json);
    // Guard the minimum required fields before treating as WorkflowDefinition
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof (raw as Record<string, unknown>).id !== "string" ||
      typeof (raw as Record<string, unknown>).name !== "string" ||
      typeof (raw as Record<string, unknown>).version !== "string" ||
      typeof (raw as Record<string, unknown>).initial !== "string" ||
      typeof (raw as Record<string, unknown>).steps !== "object" ||
      (raw as Record<string, unknown>).steps === null
    ) {
      return null;
    }
    const def = raw as WorkflowDefinition;
    // Reject only structural errors (MISSING_INITIAL); allow UNKNOWN_TARGET so users
    // can load and fix broken workflows in the editor.
    if (validateWorkflow(def).some((e) => e.code === "MISSING_INITIAL")) return null;
    return def;
  } catch {
    return null;
  }
}

/**
 * Read the workflow from the current URL hash, if present.
 * Returns null if no #def= found or if decode fails.
 */
export function readPermalinkFromHash(): WorkflowDefinition | null {
  const hash = window.location.hash.slice(1); // remove leading #
  const params = new URLSearchParams(hash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) return null;
  return decodeWorkflow(encoded);
}

/**
 * Build a shareable URL for the given definition.
 */
export function buildPermalinkUrl(definition: WorkflowDefinition): string {
  const encoded = encodeWorkflow(definition);
  const url = new URL(window.location.href);
  url.hash = `${HASH_KEY}=${encoded}`;
  return url.toString();
}
