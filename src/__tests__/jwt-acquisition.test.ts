import { describe, it, expect, vi } from "vitest";
import { decodeJwtExpMs, JwtManager } from "../utils/jwt-acquisition.js";

/** Build a structurally-valid JWT carrying the given `exp` (epoch seconds). */
function makeJwt(expSeconds: number | null): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(
    JSON.stringify(expSeconds === null ? { sub: "x" } : { sub: "x", exp: expSeconds })
  ).toString("base64url");
  return `${header}.${payload}.sig`;
}

describe("decodeJwtExpMs", () => {
  it("returns the exp claim in milliseconds", () => {
    expect(decodeJwtExpMs(makeJwt(1_700_000_000))).toBe(1_700_000_000_000);
  });

  it("returns null when there is no exp claim", () => {
    expect(decodeJwtExpMs(makeJwt(null))).toBeNull();
  });

  it("returns null for a malformed token", () => {
    expect(decodeJwtExpMs("not-a-jwt")).toBeNull();
    expect(decodeJwtExpMs("a.!!!.c")).toBeNull();
  });
});

describe("JwtManager", () => {
  it("acquires once and serves the cached token while valid", async () => {
    const t = 1_000_000;
    const exp = Math.floor((t + 60 * 60_000) / 1000); // 1h out
    const acquire = vi.fn(async () => makeJwt(exp));
    const mgr = new JwtManager({ acquire, now: () => t });

    expect(await mgr.getJwt()).toBe(makeJwt(exp));
    expect(await mgr.getJwt()).toBe(makeJwt(exp));
    expect(acquire).toHaveBeenCalledTimes(1);
    mgr.stop();
  });

  it("refreshes once the token is within the skew window of expiry", async () => {
    const t = 1_000_000;
    const exp = Math.floor((t + 4 * 60_000) / 1000); // 4 min out; skew is 5 min
    const acquire = vi.fn(async () => makeJwt(exp));
    const mgr = new JwtManager({ acquire, now: () => t, refreshSkewMs: 5 * 60_000 });

    await mgr.getJwt();
    await mgr.getJwt();
    // Already inside the skew window, so every access re-acquires.
    expect(acquire).toHaveBeenCalledTimes(2);
    mgr.stop();
  });

  it("single-flights concurrent refreshes into one acquisition", async () => {
    const exp = Math.floor((Date.now() + 60 * 60_000) / 1000);
    const acquire = vi.fn(
      () => new Promise<string>((r) => setTimeout(() => r(makeJwt(exp)), 10))
    );
    const mgr = new JwtManager({ acquire });

    const [a, b, c] = await Promise.all([mgr.getJwt(), mgr.getJwt(), mgr.getJwt()]);
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(acquire).toHaveBeenCalledTimes(1);
    mgr.stop();
  });

  it("re-acquires after invalidate()", async () => {
    const exp = Math.floor((Date.now() + 60 * 60_000) / 1000);
    const acquire = vi.fn(async () => makeJwt(exp));
    const mgr = new JwtManager({ acquire });

    await mgr.getJwt();
    mgr.invalidate();
    await mgr.getJwt();
    expect(acquire).toHaveBeenCalledTimes(2);
    mgr.stop();
  });

  it("fires onJwt with every freshly-acquired token", async () => {
    const exp = Math.floor((Date.now() + 60 * 60_000) / 1000);
    const onJwt = vi.fn();
    const mgr = new JwtManager({ acquire: async () => makeJwt(exp), onJwt });

    await mgr.getJwt();
    expect(onJwt).toHaveBeenCalledWith(makeJwt(exp));
    mgr.stop();
  });

  it("keeps serving a token that has no exp claim without re-acquiring", async () => {
    const acquire = vi.fn(async () => makeJwt(null));
    const mgr = new JwtManager({ acquire });

    await mgr.getJwt();
    await mgr.getJwt();
    expect(acquire).toHaveBeenCalledTimes(1);
    mgr.stop();
  });

  it("start() resolves false (not reject) when acquisition fails", async () => {
    const mgr = new JwtManager({
      acquire: async () => {
        throw new Error("login blew up");
      },
    });
    await expect(mgr.start()).resolves.toBe(false);
    mgr.stop();
  });
});
