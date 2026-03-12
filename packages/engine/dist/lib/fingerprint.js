import { createHash } from "node:crypto";
/**
 * Deterministic content hash for a triage or implement event.
 *
 * Fields are sorted before hashing so the result is stable regardless of
 * object key insertion order. Empty/undefined values are normalized to "".
 *
 * @param fields - Key-value pairs that uniquely identify the event.
 * @returns A 16-character hex string suitable for use as a dedup key.
 */
export function fingerprintEvent(fields) {
    const stable = Object.keys(fields)
        .sort()
        .map((k) => `${k}=${fields[k] ?? ""}`)
        .join("\n");
    return createHash("sha256").update(stable).digest("hex").slice(0, 16);
}
//# sourceMappingURL=fingerprint.js.map