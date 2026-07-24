/**
 * Cloudflare Workers entry point for the IT Glue MCP Server.
 *
 * Serves the full MCP server over the Streamable HTTP transport using the SDK's
 * Web Standard transport (Request/Response), which runs natively on Workers.
 * It reuses the exact same `createMcpServer()` factory as the stdio / Node HTTP
 * entrypoints (see `mcp-server.ts`), so there is no second tool implementation
 * to maintain.
 *
 * IT Glue is called directly over the global `fetch` API (no vendor SDK), so
 * the server runs natively on the Workers runtime.
 *
 * Credentials are resolved per request, in order:
 * 1. Gateway headers (when AUTH_MODE=gateway):
 *    - X-ITGlue-API-Key (or X-API-Key)
 *    - X-ITGlue-JWT
 *    - X-ITGlue-Region  (optional; us, eu, au)
 *    - X-ITGlue-Base-URL (optional)
 * 2. Worker secrets / vars (env mode):
 *    - ITGLUE_API_KEY / X_API_KEY
 *    - ITGLUE_JWT
 *    - ITGLUE_REGION (optional)
 *    - ITGLUE_BASE_URL (optional)
 *
 * `tools/list` and `initialize` work without credentials; only `tools/call`
 * requires them.
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import {
  createMcpServer,
  type GatewayCredentials,
  type ITGlueRegion,
} from "./mcp-server.js";
import { runWithServerRef } from "./utils/server-ref.js";

export interface Env {
  ITGLUE_API_KEY?: string;
  X_API_KEY?: string;
  ITGLUE_JWT?: string;
  ITGLUE_REGION?: string;
  ITGLUE_BASE_URL?: string;
  AUTH_MODE?: string;
  LOG_LEVEL?: string;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Accept, Authorization, Mcp-Session-Id, MCP-Protocol-Version, X-ITGlue-API-Key, X-API-Key, X-ITGlue-JWT, X-ITGlue-Region, X-ITGlue-Base-URL",
  "Access-Control-Expose-Headers": "Mcp-Session-Id",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    // Shallow, unauthenticated liveness probe.
    if (url.pathname === "/health" || url.pathname === "/healthz") {
      return json({ status: "ok" });
    }

    if (url.pathname === "/mcp") {
      const isGatewayMode = (env.AUTH_MODE ?? "env") === "gateway";

      let credOverrides: GatewayCredentials | undefined;
      if (isGatewayMode) {
        const h = (name: string) => request.headers.get(name) ?? undefined;
        const apiKey = h("x-itglue-api-key") || h("x-api-key");
        const jwt = h("x-itglue-jwt");

        if (!apiKey && !jwt) {
          return json(
            {
              error: "Missing credentials",
              message:
                "Gateway mode requires X-ITGlue-API-Key or X-ITGlue-JWT header",
              required: ["X-ITGlue-API-Key OR X-ITGlue-JWT"],
              optional: ["X-ITGlue-Region", "X-ITGlue-Base-URL"],
            },
            401
          );
        }

        credOverrides = {
          apiKey,
          jwt,
          region: (h("x-itglue-region") || "us") as ITGlueRegion,
          baseUrl: h("x-itglue-base-url"),
        };
      } else {
        // env mode: build credentials from Worker secrets if present.
        // (Absent creds are fine — tools/list still works, tools/call errors.)
        const apiKey = env.ITGLUE_API_KEY || env.X_API_KEY;
        const jwt = env.ITGLUE_JWT;
        if (apiKey || jwt) {
          credOverrides = {
            apiKey,
            jwt,
            region: (env.ITGLUE_REGION || "us") as ITGlueRegion,
            baseUrl: env.ITGLUE_BASE_URL,
          };
        }
      }

      // Fresh server + transport per request (stateless). The server is
      // bound to the per-request async context (not a module-level
      // global) so elicitation helpers resolve *this* request's server
      // even after await gaps, and never a concurrent request's — see
      // utils/server-ref.ts.
      const server = createMcpServer(credOverrides);
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      return runWithServerRef(server, async () => {
        await server.connect(transport);

        try {
          const response = await transport.handleRequest(request);
          return withCors(response);
        } finally {
          await transport.close();
          await server.close();
        }
      });
    }

    return json({ error: "Not found", endpoints: ["/mcp", "/health"] }, 404);
  },
};
