/**
 * Headless JWT auto-acquisition for IT Glue (issue #55) — SPIKE.
 *
 * IT Glue gates document-folder enumeration behind a short-lived (~2h)
 * user-session JWT that the public API key cannot mint. On a headless Docker
 * deployment there is no human to paste a fresh token every couple of hours,
 * which makes folder navigation impractical. This module is an exploratory
 * attempt to have the container acquire and refresh that JWT itself by driving
 * a real browser through the IT Glue web login (email + password + TOTP).
 *
 * ────────────────────────────────────────────────────────────────────────
 * STATUS: prototype. Not wired into a release. Carries real security weight —
 * it requires the container to hold full login credentials plus the MFA seed,
 * which together can bypass the account's own MFA. Use a dedicated,
 * least-privilege IT Glue service account. See README for the loud warning.
 * ────────────────────────────────────────────────────────────────────────
 *
 * Runtime: Node-only. The browser driver (`playwright-core`) is an OPTIONAL
 * dependency, imported dynamically only when acquisition actually runs, so the
 * default image and the Cloudflare Workers bundle never pull it in. This module
 * is therefore only ever imported from `index.ts` (the Node entrypoint).
 */
import { generateTotp } from "./totp.js";

/** Decode a JWT's `exp` claim into epoch-milliseconds, or null if absent/unparseable. */
export function decodeJwtExpMs(jwt: string): number | null {
  const parts = jwt.split(".");
  if (parts.length < 2) return null;
  try {
    const payloadJson = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(payloadJson) as { exp?: number };
    if (typeof payload.exp !== "number") return null;
    return payload.exp * 1000;
  } catch {
    return null;
  }
}

/** Selectors for the IT Glue login form. Overridable via env so the flow can be
 * tuned against the live page without a code change — the DOM is the part most
 * likely to drift, and this is a spike. */
export interface LoginSelectors {
  email: string;
  password: string;
  submit: string;
  totp: string;
}

export const DEFAULT_LOGIN_SELECTORS: LoginSelectors = {
  email: 'input[type="email"], input[name="email"], #user_email',
  password: 'input[type="password"], input[name="password"], #user_password',
  submit: 'button[type="submit"], input[type="submit"]',
  totp: 'input[name="otp_attempt"], input[autocomplete="one-time-code"], input[name="code"]',
};

export interface BrowserAcquireOptions {
  loginUrl: string;
  email: string;
  password: string;
  totpSecret: string;
  /** Host fragment the JWT-bearing API requests hit. IT Glue's SPA calls
   * `itg-api-*.itglue.com`; we capture the Authorization header off those. */
  apiHostMatch?: string;
  selectors?: LoginSelectors;
  timeoutMs?: number;
}

// Minimal structural types for the slice of the playwright-core API this spike
// uses. Declaring them locally lets the module type-check and ship without the
// optional `playwright-core` dependency installed (it is imported dynamically
// through a non-literal specifier below).
interface PwRequest {
  url(): string;
  headers(): Record<string, string>;
}
interface PwLocator {
  count(): Promise<number>;
  waitFor(opts: { state?: string; timeout?: number }): Promise<void>;
  fill(value: string): Promise<void>;
}
interface PwPage {
  goto(url: string, opts?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
  fill(selector: string, value: string): Promise<void>;
  click(selector: string): Promise<void>;
  locator(selector: string): PwLocator;
  waitForSelector(selector: string, opts?: { timeout?: number }): Promise<unknown>;
}
interface PwContext {
  newPage(): Promise<PwPage>;
  on(event: "request", handler: (req: PwRequest) => void): void;
}
interface PwBrowser {
  newContext(): Promise<PwContext>;
  close(): Promise<void>;
}
interface PwChromium {
  launch(opts: { headless: boolean; executablePath?: string }): Promise<PwBrowser>;
}

/**
 * Drive a headless browser through the IT Glue login and capture the
 * `Authorization: Bearer <jwt>` header the SPA attaches to its API calls.
 *
 * The DOM steps are best-effort and selector-driven (see DEFAULT_LOGIN_SELECTORS)
 * because they could not be validated against the live login page in this spike.
 * The token-capture strategy — sniffing the outbound Authorization header rather
 * than scraping localStorage — is the robust part and is independent of layout.
 */
export async function acquireJwtViaBrowser(
  opts: BrowserAcquireOptions
): Promise<string> {
  const timeoutMs = opts.timeoutMs ?? 60_000;
  const selectors = opts.selectors ?? DEFAULT_LOGIN_SELECTORS;
  const apiHostMatch = opts.apiHostMatch ?? "itg-api";

  // Dynamic import keeps playwright-core out of the default build/bundle. The
  // non-literal specifier stops the compiler from requiring the optional
  // dependency at build time; a clear error beats a module-not-found trace.
  const specifier = "playwright-core";
  let chromium: PwChromium;
  try {
    ({ chromium } = (await import(specifier)) as { chromium: PwChromium });
  } catch {
    throw new Error(
      "JWT auto-acquisition needs the optional 'playwright-core' dependency and a Chromium binary. " +
        "Install it (npm install playwright-core) and provide a browser, or set ITGLUE_JWT manually."
    );
  }

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.ITG_BROWSER_PATH || undefined,
  });

  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    // Resolve as soon as any request carries a Bearer token to the API host.
    const jwtPromise = new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error("Timed out waiting for IT Glue to issue a JWT")),
        timeoutMs
      );
      context.on("request", (req) => {
        if (!req.url().includes(apiHostMatch)) return;
        const auth = req.headers()["authorization"];
        if (auth && auth.toLowerCase().startsWith("bearer ")) {
          clearTimeout(timer);
          resolve(auth.slice("bearer ".length).trim());
        }
      });
    });

    await page.goto(opts.loginUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });

    await page.fill(selectors.email, opts.email);
    // IT Glue may use a one-step or two-step (email-then-password) form. Fill
    // the password if it's present now; otherwise advance and fill it next.
    if (await page.locator(selectors.password).count()) {
      await page.fill(selectors.password, opts.password);
    } else {
      await page.click(selectors.submit);
      await page.waitForSelector(selectors.password, { timeout: timeoutMs });
      await page.fill(selectors.password, opts.password);
    }
    await page.click(selectors.submit);

    // Answer the OTP challenge if one appears.
    const totpField = page.locator(selectors.totp);
    try {
      await totpField.waitFor({ state: "visible", timeout: 10_000 });
      await totpField.fill(generateTotp(opts.totpSecret));
      await page.click(selectors.submit);
    } catch {
      // No OTP step surfaced — either MFA is off or the layout differs. The
      // JWT may still be issued; fall through to the capture promise.
    }

    return await jwtPromise;
  } finally {
    await browser.close();
  }
}

export type AcquireFn = () => Promise<string>;

export interface JwtManagerOptions {
  /** How a fresh JWT is obtained. Injectable so the manager is testable
   * without a real browser. */
  acquire: AcquireFn;
  /** Refresh this many ms BEFORE the token's `exp`. Default 5 min. */
  refreshSkewMs?: number;
  /** Fallback refresh interval when a token carries no `exp`. Default 90 min. */
  fallbackTtlMs?: number;
  /** Called with every freshly-acquired JWT (e.g. to set process.env). */
  onJwt?: (jwt: string) => void;
  now?: () => number;
  logger?: (msg: string) => void;
}

/**
 * Holds the current JWT, refreshes it before expiry, and serialises concurrent
 * refreshes into a single in-flight acquisition. Acquisition failures are
 * surfaced to the caller of `getJwt()` but never crash the background loop —
 * folder ops simply degrade to "JWT unavailable" until the next attempt.
 */
export class JwtManager {
  private readonly acquire: AcquireFn;
  private readonly refreshSkewMs: number;
  private readonly fallbackTtlMs: number;
  private readonly onJwt?: (jwt: string) => void;
  private readonly now: () => number;
  private readonly logger: (msg: string) => void;

  private current: string | null = null;
  private expMs: number | null = null;
  private inFlight: Promise<string> | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(opts: JwtManagerOptions) {
    this.acquire = opts.acquire;
    this.refreshSkewMs = opts.refreshSkewMs ?? 5 * 60_000;
    this.fallbackTtlMs = opts.fallbackTtlMs ?? 90 * 60_000;
    this.onJwt = opts.onJwt;
    this.now = opts.now ?? Date.now;
    this.logger = opts.logger ?? (() => {});
  }

  /** Current cached token if still valid, else trigger (single-flight) refresh. */
  async getJwt(): Promise<string> {
    if (this.current && this.expMs !== null && this.now() < this.expMs - this.refreshSkewMs) {
      return this.current;
    }
    if (this.current && this.expMs === null) {
      return this.current;
    }
    return this.refresh();
  }

  /** Force a refresh on the next access — call this when the API rejects the
   * token with a 401 mid-session. */
  invalidate(): void {
    this.current = null;
    this.expMs = null;
  }

  /** Acquire a token now, single-flighting concurrent callers. */
  async refresh(): Promise<string> {
    if (this.inFlight) return this.inFlight;

    this.inFlight = (async () => {
      const jwt = await this.acquire();
      this.current = jwt;
      this.expMs = decodeJwtExpMs(jwt);
      this.onJwt?.(jwt);
      this.logger(
        this.expMs
          ? `Acquired IT Glue JWT (expires ${new Date(this.expMs).toISOString()})`
          : "Acquired IT Glue JWT (no exp claim; using fallback TTL)"
      );
      this.scheduleNext();
      return jwt;
    })();

    try {
      return await this.inFlight;
    } finally {
      this.inFlight = null;
    }
  }

  /** Acquire an initial token and start the background refresh loop. Returns
   * true on success; logs and returns false on failure (server keeps running). */
  async start(): Promise<boolean> {
    try {
      await this.refresh();
      return true;
    } catch (err) {
      this.logger(`Initial JWT acquisition failed: ${(err as Error).message}`);
      return false;
    }
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private scheduleNext(): void {
    if (this.stopped) return;
    if (this.timer) clearTimeout(this.timer);

    const target = this.expMs !== null ? this.expMs - this.refreshSkewMs : this.now() + this.fallbackTtlMs;
    // Clamp: never schedule in the past, never spin faster than 60s.
    const delay = Math.max(60_000, target - this.now());

    this.timer = setTimeout(() => {
      this.refresh().catch((err) => {
        this.logger(`Background JWT refresh failed: ${(err as Error).message}; will retry`);
        // Retry on the fallback cadence rather than giving up.
        this.timer = setTimeout(() => this.scheduleNext(), this.fallbackTtlMs);
      });
    }, delay);

    // Don't keep the event loop alive solely for the refresh timer.
    this.timer.unref?.();
  }
}
