import type { Workflow } from "@sweny-ai/core";
import { validateWorkflow } from "@sweny-ai/core/schema";

const HASH_KEY = "def";

/**
 * Encode a Workflow as a URL-safe base64 string.
 */
export function encodeWorkflow(workflow: Workflow): string {
  const json = JSON.stringify(workflow);
  return btoa(
    encodeURIComponent(json).replace(/%([0-9A-F]{2})/g, (_, p1: string) => String.fromCharCode(parseInt(p1, 16))),
  );
}

/**
 * Decode a base64 string from the URL hash back to a Workflow.
 * Returns null if the hash is missing, malformed, or fails validation.
 */
export function decodeWorkflow(encoded: string): Workflow | null {
  try {
    const json = decodeURIComponent(
      Array.from(atob(encoded))
        .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join(""),
    );
    const raw: unknown = JSON.parse(json);
    if (
      !raw ||
      typeof raw !== "object" ||
      typeof (raw as Record<string, unknown>).id !== "string" ||
      typeof (raw as Record<string, unknown>).name !== "string" ||
      typeof (raw as Record<string, unknown>).entry !== "string" ||
      typeof (raw as Record<string, unknown>).nodes !== "object" ||
      (raw as Record<string, unknown>).nodes === null
    ) {
      return null;
    }
    const wf = raw as Workflow;
    if (validateWorkflow(wf).some((e) => e.code === "MISSING_ENTRY")) return null;
    return wf;
  } catch {
    return null;
  }
}

/**
 * Read the workflow from the current URL hash, if present.
 */
export function readPermalinkFromHash(): Workflow | null {
  const hash = window.location.hash.slice(1);
  const params = new URLSearchParams(hash);
  const encoded = params.get(HASH_KEY);
  if (!encoded) return null;
  return decodeWorkflow(encoded);
}

/**
 * Build a shareable URL for the given workflow.
 */
export function buildPermalinkUrl(workflow: Workflow): string {
  const encoded = encodeWorkflow(workflow);
  const url = new URL(window.location.href);
  url.hash = `${HASH_KEY}=${encoded}`;
  return url.toString();
}
