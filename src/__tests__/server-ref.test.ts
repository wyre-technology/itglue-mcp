/**
 * Regression test: cross-tenant "server reference" misrouting.
 *
 * Historically the server reference used by elicitation helpers
 * (`utils/elicitation.ts`) was stored in a module-level `let _server`
 * singleton in `utils/server-ref.ts` (`setServerRef` / `getServerRef`),
 * set synchronously per request and read back later — including after
 * `await` gaps inside async tool handlers (e.g. after awaiting an IT Glue
 * API call, before sending an elicitation/confirmation prompt back through
 * "the" server).
 *
 * In gateway (multi-tenant HTTP) mode a fresh `Server` is created per
 * request, so two concurrent requests raced through that shared global:
 * tenant A's request sets the ref and starts awaiting async work; before A
 * resumes, tenant B's request runs to completion and overwrites the
 * module-level ref with B's server/transport; when A's awaited work
 * resolves and it reads the ref back to call `elicitInput`, it gets B's
 * server — so A's confirmation prompt is sent down B's connection instead
 * of A's (or vice versa, depending on timing).
 *
 * The fix replaces the module-level singleton with an AsyncLocalStorage
 * context (`runWithServerRef` / `bindServerRef` / `getServerRef`), scoped
 * per request and correctly restored across await gaps.
 *
 * This test forces the exact interleave deterministically — via a
 * manually-resolved "gate" promise, not a timing-based stagger — and
 * asserts, BY VALUE, which tenant's mock server actually received the
 * elicitation call. (Verified by temporarily reinstating a module-singleton
 * implementation behind the same function names: this test fails with
 * tenant A's prompt observed on tenant B's mock `elicitInput`, and passes
 * again once the ALS-based fix is restored — see the PR description.)
 */
import { describe, it, expect, vi } from "vitest";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { runWithServerRef, bindServerRef, getServerRef } from "../utils/server-ref.js";
import { elicitConfirmation } from "../utils/elicitation.js";

/** A deferred promise the test can resolve on demand, for a deterministic forced interleave. */
function createDeferred<T = void>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

type FakeServer = Server & { tenantId: string; elicitInput: ReturnType<typeof vi.fn> };

/** Minimal fake MCP Server whose elicitInput is a per-instance spy (per-tenant mock). */
function createFakeServer(tenantId: string): FakeServer {
  const elicitInput = vi.fn().mockImplementation(async () => ({
    action: "accept" as const,
    content: { confirm: true },
  }));
  return { tenantId, elicitInput } as unknown as FakeServer;
}

describe("server-ref cross-tenant isolation", () => {
  it("getServerRef returns null outside of any bound context", () => {
    expect(getServerRef()).toBeNull();
  });

  it("getServerRef resolves the server bound by runWithServerRef within its scope", async () => {
    const server = createFakeServer("tenant-X");
    await runWithServerRef(server, async () => {
      expect(getServerRef()).toBe(server);
    });
  });

  it(
    "routes each tenant's elicitation through its OWN server, even when a " +
      "second tenant's request runs to completion while the first is still " +
      "in flight (forced deterministic interleave, not a timing stagger)",
    async () => {
      const serverA = createFakeServer("tenant-A");
      const serverB = createFakeServer("tenant-B");
      const gate = createDeferred<void>();

      // Tenant A: binds its server, then suspends on an await gap
      // (simulating an in-flight IT Glue API call inside a tool handler)
      // BEFORE sending its elicitation/confirmation prompt.
      const tenantA = runWithServerRef(serverA, async () => {
        await gate.promise; // the exact await gap the original bug lost the ref across
        expect((getServerRef() as FakeServer | null)?.tenantId).toBe("tenant-A"); // must still be A's server after resuming
        return elicitConfirmation("Confirm tenant A's sensitive action?");
      });

      // Force the interleave: tenant B's ENTIRE request — bind, elicit,
      // resolve — runs to completion while tenant A is still suspended
      // above, exactly like a second concurrent HTTP request racing in.
      const tenantB = runWithServerRef(serverB, async () => {
        return elicitConfirmation("Confirm tenant B's sensitive action?");
      });
      await tenantB;

      // Only now let tenant A resume.
      gate.resolve();
      const resultA = await tenantA;
      expect(resultA).toBe(true);

      // --- Per-tenant VALUE assertions -----------------------------------
      // Each tenant's prompt must have gone out through THAT tenant's mock
      // server specifically, not the other tenant's.
      expect(serverA.elicitInput).toHaveBeenCalledTimes(1);
      expect(serverA.elicitInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Confirm tenant A's sensitive action?",
        })
      );

      expect(serverB.elicitInput).toHaveBeenCalledTimes(1);
      expect(serverB.elicitInput).toHaveBeenCalledWith(
        expect.objectContaining({
          message: "Confirm tenant B's sensitive action?",
        })
      );

      // Explicit negative checks: A's message must never have reached B's
      // transport, and B's must never have reached A's.
      for (const call of serverA.elicitInput.mock.calls) {
        expect(call[0].message).not.toBe(
          "Confirm tenant B's sensitive action?"
        );
      }
      for (const call of serverB.elicitInput.mock.calls) {
        expect(call[0].message).not.toBe(
          "Confirm tenant A's sensitive action?"
        );
      }
    }
  );

  it("bindServerRef binds for the remainder of the current async execution (stdio single-session mode)", async () => {
    const server = createFakeServer("tenant-X");
    bindServerRef(server);
    // Simulate work continuing across an await gap in the same "session".
    await Promise.resolve();
    expect(getServerRef()).toBe(server);
  });
});
