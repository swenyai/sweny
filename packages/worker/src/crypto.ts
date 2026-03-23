/**
 * AES-256-GCM credential decryption for the open-source SWEny worker.
 *
 * Encrypted credential format: "ivHex:authTagHex:ciphertextHex"
 *   - ivHex        — 12-byte IV (24 hex chars)
 *   - authTagHex   — 16-byte GCM auth tag (32 hex chars)
 *   - ciphertextHex — encrypted credential value (variable length hex)
 *
 * The Bundle Encryption Key (BEK) is a 32-byte key delivered as a hex string
 * from the internal API (/internal/jobs/:jobId/secrets). It is fetched once
 * per job, used in memory, and never persisted to disk.
 */

import { createDecipheriv } from "node:crypto";

/**
 * Decrypt a single credential value that was encrypted with AES-256-GCM.
 *
 * @param encrypted - "ivHex:authTagHex:ciphertextHex" (all hex-encoded)
 * @param bek       - 32-byte bundle encryption key as a Buffer
 * @returns         - Plaintext credential value
 * @throws          - If the format is invalid or decryption fails (wrong key / tampered)
 */
export function decryptCredential(encrypted: string, bek: Buffer): string {
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error(`Invalid encrypted credential format: expected "iv:authTag:ciphertext", got ${parts.length} parts`);
  }

  const [ivHex, authTagHex, ciphertextHex] = parts as [string, string, string];

  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  if (iv.length === 0 || authTag.length === 0) {
    throw new Error("Invalid encrypted credential: iv or authTag is empty");
  }

  const decipher = createDecipheriv("aes-256-gcm", bek, iv);
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  return decrypted.toString("utf8");
}

/**
 * Decrypt a full credential bundle.
 *
 * @param encryptedBundle - JSON string of Record<string, "iv:authTag:ciphertext">
 * @param bekHex          - Hex-encoded 32-byte bundle encryption key from the API
 * @returns               - Record<string, string> of plaintext credential key/value pairs
 */
export function decryptBundle(encryptedBundle: string, bekHex: string): Record<string, string> {
  const bek = Buffer.from(bekHex, "hex");

  if (bek.length !== 32) {
    throw new Error(`Invalid BEK length: expected 32 bytes, got ${bek.length} (hex length ${bekHex.length})`);
  }

  let bundle: Record<string, unknown>;
  try {
    bundle = JSON.parse(encryptedBundle) as Record<string, unknown>;
  } catch {
    throw new Error("encryptedBundle is not valid JSON");
  }

  const credentials: Record<string, string> = {};
  for (const [key, value] of Object.entries(bundle)) {
    if (typeof value !== "string") {
      throw new Error(`Credential "${key}" has non-string value in encrypted bundle`);
    }
    credentials[key] = decryptCredential(value, bek);
  }

  return credentials;
}
