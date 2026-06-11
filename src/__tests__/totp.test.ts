import { describe, it, expect } from "vitest";
import { base32Decode, generateTotp } from "../utils/totp.js";

// RFC 6238 Appendix B uses the ASCII seed "12345678901234567890" (20 bytes),
// which is this base32 string. The published codes below are the canonical
// reference values, so matching them proves the HMAC + dynamic-truncation math.
const RFC6238_SHA1_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("base32Decode", () => {
  it("decodes the RFC 6238 SHA1 seed back to the ASCII bytes", () => {
    expect(base32Decode(RFC6238_SHA1_SECRET).toString("utf8")).toBe(
      "12345678901234567890"
    );
  });

  it("tolerates lowercase, whitespace, and padding", () => {
    const a = base32Decode("JBSWY3DPEHPK3PXP");
    const b = base32Decode("jbsw y3dp ehpk 3pxp==");
    expect(b.equals(a)).toBe(true);
  });

  it("throws on invalid characters", () => {
    expect(() => base32Decode("0189!")).toThrow(/invalid base32/i);
  });

  it("throws on an empty secret", () => {
    expect(() => base32Decode("  ==  ")).toThrow(/empty/i);
  });
});

describe("generateTotp", () => {
  // RFC 6238 Appendix B, SHA1, 8 digits. [unix time in seconds, expected code]
  const vectors: Array<[number, string]> = [
    [59, "94287082"],
    [1111111109, "07081804"],
    [1111111111, "14050471"],
    [1234567890, "89005924"],
    [2000000000, "69279037"],
    [20000000000, "65353130"],
  ];

  it.each(vectors)("matches RFC 6238 vector at t=%i", (t, expected) => {
    expect(
      generateTotp(RFC6238_SHA1_SECRET, { nowMs: t * 1000, digits: 8 })
    ).toBe(expected);
  });

  it("defaults to 6 digits (the last 6 of the 8-digit vector)", () => {
    expect(generateTotp(RFC6238_SHA1_SECRET, { nowMs: 59 * 1000 })).toBe(
      "287082"
    );
  });

  it("produces the same code anywhere inside a 30s step", () => {
    const atStart = generateTotp(RFC6238_SHA1_SECRET, { nowMs: 30_000 });
    const midStep = generateTotp(RFC6238_SHA1_SECRET, { nowMs: 59_000 });
    const atEnd = generateTotp(RFC6238_SHA1_SECRET, { nowMs: 59_999 });
    expect(midStep).toBe(atStart);
    expect(atEnd).toBe(atStart);
  });

  it("rolls to a new code at the next step boundary", () => {
    const step1 = generateTotp(RFC6238_SHA1_SECRET, { nowMs: 59_000 });
    const step2 = generateTotp(RFC6238_SHA1_SECRET, { nowMs: 60_000 });
    expect(step2).not.toBe(step1);
  });
});
