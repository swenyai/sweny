/**
 * Deterministic content hash for a triage or implement event.
 *
 * Fields are sorted before hashing so the result is stable regardless of
 * object key insertion order. Empty/undefined values are normalized to "".
 *
 * @param fields - Key-value pairs that uniquely identify the event.
 * @returns A 16-character hex string suitable for use as a dedup key.
 */
export declare function fingerprintEvent(fields: Record<string, string | undefined>): string;
//# sourceMappingURL=fingerprint.d.ts.map