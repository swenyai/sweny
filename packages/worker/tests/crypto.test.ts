/**
 * Tests for AES-256-GCM credential decryption in crypto.ts.
 *
 * Pattern: encrypt test values using Node's crypto module, format as
 * "iv:authTag:ciphertext" hex strings, then verify decryptBundle recovers
 * the original plaintext values.
 */

import { createCipheriv, randomBytes } from "node:crypto";

// vi.mock hoisted above imports via vitest globals
// (globals: true in vitest.config.ts — no import needed)

const { decryptBundle } = await import("../src/crypto.js");

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function encryptValue(plaintext: string, bek: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", bek, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

function makeEncryptedBundle(entries: Record<string, string>, bek: Buffer): string {
  const bundle: Record<string, string> = {};
  for (const [key, value] of Object.entries(entries)) {
    bundle[key] = encryptValue(value, bek);
  }
  return JSON.stringify(bundle);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("decryptBundle", () => {
  const bek = randomBytes(32);
  const bekHex = bek.toString("hex");

  it("decrypts a bundle of credentials", () => {
    const original = {
      DATADOG_API_KEY: "dd-api-key-abc123",
      LINEAR_API_KEY: "lin_api_xyz789",
      GITHUB_TOKEN: "ghp_tokenXYZ",
    };

    const encryptedBundle = makeEncryptedBundle(original, bek);
    const result = decryptBundle(encryptedBundle, bekHex);

    expect(result).toEqual(original);
  });

  it("decrypts an empty bundle", () => {
    const encryptedBundle = JSON.stringify({});
    const result = decryptBundle(encryptedBundle, bekHex);
    expect(result).toEqual({});
  });

  it("decrypts values with special characters and unicode", () => {
    const original = {
      SECRET: "p@ssw0rd!#$%^&*()_+{}|<>?",
      UNICODE: "こんにちは世界",
      NEWLINES: "line1\nline2\nline3",
    };

    const encryptedBundle = makeEncryptedBundle(original, bek);
    const result = decryptBundle(encryptedBundle, bekHex);

    expect(result).toEqual(original);
  });

  it("throws when given a wrong key", () => {
    const original = { SECRET: "my-secret-value" };
    const encryptedBundle = makeEncryptedBundle(original, bek);

    const wrongBek = randomBytes(32);
    const wrongBekHex = wrongBek.toString("hex");

    expect(() => decryptBundle(encryptedBundle, wrongBekHex)).toThrow();
  });

  it("throws when encryptedBundle is not valid JSON", () => {
    expect(() => decryptBundle("not-json", bekHex)).toThrow("encryptedBundle is not valid JSON");
  });

  it("throws when a credential value has wrong format (not iv:authTag:ciphertext)", () => {
    const bundle = JSON.stringify({ KEY: "only-one-part" });
    expect(() => decryptBundle(bundle, bekHex)).toThrow("Invalid encrypted credential format");
  });

  it("throws when a credential value has too many parts", () => {
    const bundle = JSON.stringify({ KEY: "a:b:c:d" });
    expect(() => decryptBundle(bundle, bekHex)).toThrow("Invalid encrypted credential format");
  });

  it("throws when BEK is not 32 bytes", () => {
    const shortBekHex = randomBytes(16).toString("hex"); // 16 bytes, not 32
    const encryptedBundle = JSON.stringify({});
    expect(() => decryptBundle(encryptedBundle, shortBekHex)).toThrow("Invalid BEK length");
  });

  it("throws when credential value has non-string in bundle", () => {
    const bundle = JSON.stringify({ KEY: 12345 });
    expect(() => decryptBundle(bundle, bekHex)).toThrow();
  });
});
