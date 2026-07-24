/**
 * Per-request MCP Server reference for elicitation support.
 *
 * Avoids circular imports by decoupling the server instance from domain
 * handlers, without leaking that reference across concurrent requests.
 *
 * SECURITY (cross-tenant misroute): this used to be a module-level
 * `let _server` singleton, set synchronously per request via `setServerRef`
 * and read back later via `getServerRef` — including after `await` gaps
 * inside async tool handlers (e.g. after awaiting an IT Glue API call,
 * before sending an elicitation/confirmation prompt back through "the"
 * server).
 *
 * In gateway (multi-tenant HTTP) mode a fresh `Server` is created per
 * request, so two concurrent requests race through that shared global:
 * tenant A's request sets the ref and starts awaiting async work; before A
 * resumes, tenant B's request runs and overwrites the module-level ref with
 * B's server/transport; when A's awaited work resolves and it reads the ref
 * back to call `elicitInput`, it gets B's server and A's confirmation prompt
 * is sent down B's connection instead of A's.
 *
 * Fixed by binding the server reference to an AsyncLocalStorage context
 * instead of a shared mutable variable. ALS scopes the value to the async
 * call graph it was entered from, and correctly restores it after arbitrary
 * `await` gaps, so concurrent requests can never observe each other's
 * server.
 *
 * There is intentionally no module-level mutable server/transport state in
 * this file.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";

/**
 * Per-request server store.
 */
const serverRefStore = new AsyncLocalStorage<Server>();

/**
 * Run a callback with `server` bound to the async context for the duration
 * of that callback — including anything it `await`s or schedules (promise
 * chains, timers, etc). Use this for transports that create a fresh
 * `Server` per inbound request (HTTP, Workers), one call per request, so
 * concurrent requests never observe each other's server reference.
 */
export function runWithServerRef<T>(server: Server, fn: () => T): T {
  return serverRefStore.run(server, fn);
}

/**
 * Bind `server` for the remainder of the current synchronous execution and
 * all following async work, without requiring a wrapping callback.
 *
 * Only safe for single-session transports (stdio) where exactly one
 * `Server` instance lives for the whole process and there are no
 * concurrent tenants to isolate from each other. Do NOT use this for
 * per-request transports (HTTP / Workers) — use `runWithServerRef` there,
 * since `enterWith` has no natural "scope end" and would leak across
 * requests just like the old module-level singleton.
 */
export function bindServerRef(server: Server): void {
  serverRefStore.enterWith(server);
}

/**
 * Get the server bound to the current request's async context, or `null`
 * if none is bound (e.g. called outside of a request/session, before a
 * server ref has been established).
 */
export function getServerRef(): Server | null {
  return serverRefStore.getStore() ?? null;
}
