/**
 * RFC 6238 TOTP generator — dependency-free, Node-only (uses `node:crypto`).
 *
 * IT Glue's MFA secret (the `ITG_TOTP_SECRET` env var) is the same base32 seed
 * you would scan into an authenticator app. This turns that seed into the
 * current 6-digit code so the headless-login flow can answer the OTP prompt
 * without a human. See `jwt-acquisition.ts` for the caller.
 *
 * This file is pure and runtime-agnostic *except* for the `node:crypto`
 * dependency, so it is only ever imported from the Node entrypoint, never from
 * the Cloudflare Workers bundle.
 */
import { createHmac } from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/**
 * Decode an RFC 4648 base32 string into bytes. Tolerant of lowercase,
 * whitespace, and `=` padding (all of which appear in secrets copied from
 * various UIs). Throws on characters outside the base32 alphabet so a
 * mistyped secret fails loudly rather than producing silently-wrong codes.
 */
export function base32Decode(input: string): Buffer {
  const cleaned = input.replace(/[\s=]/g, "").toUpperCase();
  if (cleaned.length === 0) {
    throw new Error("TOTP secret is empty after stripping padding/whitespace");
  }

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const idx = BASE32_ALPHABET.indexOf(char);
    if (idx === -1) {
      throw new Error(`Invalid base32 character in TOTP secret: "${char}"`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 0xff);
    }
  }

  return Buffer.from(bytes);
}

export interface TotpOptions {
  /** Step size in seconds. RFC default and IT Glue's value is 30. */
  period?: number;
  /** Number of digits in the code. RFC default and IT Glue's value is 6. */
  digits?: number;
  /** HMAC algorithm. RFC default and IT Glue's value is SHA-1. */
  algorithm?: "sha1" | "sha256" | "sha512";
  /** Unix time in milliseconds. Defaults to `Date.now()`; injectable for tests. */
  nowMs?: number;
}

/**
 * Generate the current TOTP code for a base32 secret.
 *
 * Verified against the RFC 6238 Appendix B test vectors (see totp.test.ts).
 */
export function generateTotp(secret: string, options: TotpOptions = {}): string {
  const period = options.period ?? 30;
  const digits = options.digits ?? 6;
  const algorithm = options.algorithm ?? "sha1";
  const nowMs = options.nowMs ?? Date.now();

  const key = base32Decode(secret);
  const counter = Math.floor(nowMs / 1000 / period);

  // 8-byte big-endian counter.
  const counterBuf = Buffer.alloc(8);
  counterBuf.writeBigUInt64BE(BigInt(counter));

  const hmac = createHmac(algorithm, key).update(counterBuf).digest();

  // RFC 4226 dynamic truncation.
  const offset = hmac[hmac.length - 1] & 0x0f;
  const binary =
    ((hmac[offset] & 0x7f) << 24) |
    ((hmac[offset + 1] & 0xff) << 16) |
    ((hmac[offset + 2] & 0xff) << 8) |
    (hmac[offset + 3] & 0xff);

  const code = binary % 10 ** digits;
  return code.toString().padStart(digits, "0");
}
