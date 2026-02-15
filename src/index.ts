#!/usr/bin/env node
/**
 * IT Glue MCP Server
 *
 * This MCP server provides tools for interacting with IT Glue API.
 * It accepts credentials via HTTP headers from the MCP Gateway.
 */

import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { Transport } from "@modelcontextprotocol/sdk/shared/transport.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

// IT Glue region configuration
type ITGlueRegion = "us" | "eu" | "au";

const REGION_URLS: Record<ITGlueRegion, string> = {
  us: "https://api.itglue.com",
  eu: "https://api.eu.itglue.com",
  au: "https://api.au.itglue.com",
};

// JSON:API types
interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
  relationships?: Record<string, { data: unknown }>;
}

interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  meta?: {
    "current-page"?: number;
    "next-page"?: number | null;
    "prev-page"?: number | null;
    "total-pages"?: number;
    "total-count"?: number;
  };
  included?: JsonApiResource[];
  errors?: Array<{
    title?: string;
    detail?: string;
    status?: string;
  }>;
}

interface PaginationMeta {
  currentPage: number;
  nextPage: number | null;
  prevPage: number | null;
  totalPages: number;
  totalCount: number;
}

// Utility functions for JSON:API
function kebabToCamel(str: string): string {
  return str.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function camelToKebab(str: string): string {
  return str.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);
}

function convertKeysToCamel(obj: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    const camelKey = kebabToCamel(key);
    if (value && typeof value === "object" && !Array.isArray(value)) {
      result[camelKey] = convertKeysToCamel(value as Record<string, unknown>);
    } else {
      result[camelKey] = value;
    }
  }
  return result;
}

function deserializeResource(resource: JsonApiResource): Record<string, unknown> {
  const result: Record<string, unknown> = {
    id: resource.id,
    type: resource.type,
  };
  if (resource.attributes) {
    Object.assign(result, convertKeysToCamel(resource.attributes));
  }
  return result;
}

function buildFilterParams(filter: Record<string, unknown>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value !== undefined && value !== null) {
      const kebabKey = camelToKebab(key);
      result[kebabKey] = String(value);
    }
  }
  return result;
}

// Simple IT Glue client
class ITGlueClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: { apiKey: string; region?: ITGlueRegion; baseUrl?: string }) {
    this.apiKey = config.apiKey;
    this.baseUrl = config.baseUrl || REGION_URLS[config.region || "us"];
  }

  private buildQueryString(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;

      if (key === "filter" && typeof value === "object") {
        const filterParams = buildFilterParams(value as Record<string, unknown>);
        for (const [filterKey, filterValue] of Object.entries(filterParams)) {
          searchParams.append(`filter[${filterKey}]`, filterValue);
        }
      } else if (key === "page" && typeof value === "object") {
        const pageObj = value as { size?: number; number?: number };
        if (pageObj.size) searchParams.append("page[size]", String(pageObj.size));
        if (pageObj.number) searchParams.append("page[number]", String(pageObj.number));
      } else if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        searchParams.append(key, String(value));
      }
    }

    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : "";
  }

  async request<T>(
    path: string,
    params: Record<string, unknown> = {}
  ): Promise<{ data: T[]; meta: PaginationMeta }> {
    const url = `${this.baseUrl}${path}${this.buildQueryString(params)}`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "x-api-key": this.apiKey,
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      },
    });

    if (!response.ok) {
      const errorBody = await response.text();
      throw new Error(`IT Glue API error (${response.status}): ${errorBody}`);
    }

    const json = (await response.json()) as JsonApiResponse;

    if (json.errors && json.errors.length > 0) {
      const errorMessages = json.errors.map((e) => e.detail || e.title).join(", ");
      throw new Error(`IT Glue API error: ${errorMessages}`);
    }

    const data = Array.isArray(json.data)
      ? json.data.map(deserializeResource)
      : [deserializeResource(json.data)];

    const meta: PaginationMeta = {
      currentPage: json.meta?.["current-page"] || 1,
      nextPage: json.meta?.["next-page"] || null,
      prevPage: json.meta?.["prev-page"] || null,
      totalPages: json.meta?.["total-pages"] || 1,
      totalCount: json.meta?.["total-count"] || data.length,
    };

    return { data: data as T[], meta };
  }

  async get<T>(path: string, params: Record<string, unknown> = {}): Promise<T> {
    const result = await this.request<T>(path, params);
    return result.data[0];
  }
}

// Credential extraction from gateway headers
interface GatewayCredentials {
  apiKey?: string;
  region?: ITGlueRegion;
  baseUrl?: string;
}

function getCredentialsFromEnv(): GatewayCredentials {
  return {
    apiKey: process.env.ITGLUE_API_KEY || process.env.X_API_KEY,
    region: (process.env.ITGLUE_REGION || "us") as ITGlueRegion,
    baseUrl: process.env.ITGLUE_BASE_URL,
  };
}

function createClient(credentials: GatewayCredentials): ITGlueClient {
  if (!credentials.apiKey) {
    throw new Error("No IT Glue API key provided");
  }
  return new ITGlueClient({
    apiKey: credentials.apiKey,
    region: credentials.region || "us",
    baseUrl: credentials.baseUrl,
  });
}

/**
 * Create a fresh MCP Server with all tool handlers registered.
 * Called per-request in HTTP (stateless) mode so each initialize gets a clean server.
 */
function createMcpServer(): Server {
  const server = new Server(
    {
      name: "itglue-mcp",
      version: "1.0.0",
    },
    {
      capabilities: {
        tools: {},
      },
    }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      // Organizations
      {
        name: "search_organizations",
        description: "Search for organizations in IT Glue with optional filtering",
        inputSchema: {
          type: "object",
          properties: {
            name: {
              type: "string",
              description: "Filter by organization name (partial match)",
            },
            organization_type_id: {
              type: "number",
              description: "Filter by organization type ID",
            },
            organization_status_id: {
              type: "number",
              description: "Filter by organization status ID",
            },
            psa_id: {
              type: "string",
              description: "Filter by PSA integration ID",
            },
            page_size: {
              type: "number",
              description: "Number of results per page (max 1000, default 50)",
            },
            page_number: {
              type: "number",
              description: "Page number to retrieve (default 1)",
            },
            sort: {
              type: "string",
              description: "Sort field (prefix with - for descending, e.g., '-name')",
            },
          },
          required: [],
        },
      },
      {
        name: "get_organization",
        description: "Get a specific organization by ID from IT Glue",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The organization ID",
            },
          },
          required: ["id"],
        },
      },
      // Configurations
      {
        name: "search_configurations",
        description: "Search for configurations (devices/assets) in IT Glue",
        inputSchema: {
          type: "object",
          properties: {
            organization_id: {
              type: "number",
              description: "Filter by organization ID",
            },
            name: {
              type: "string",
              description: "Filter by configuration name (partial match)",
            },
            configuration_type_id: {
              type: "number",
              description: "Filter by configuration type ID",
            },
            configuration_status_id: {
              type: "number",
              description: "Filter by configuration status ID",
            },
            serial_number: {
              type: "string",
              description: "Filter by serial number",
            },
            rmm_id: {
              type: "string",
              description: "Filter by RMM integration ID",
            },
            psa_id: {
              type: "string",
              description: "Filter by PSA integration ID",
            },
            page_size: {
              type: "number",
              description: "Number of results per page (max 1000, default 50)",
            },
            page_number: {
              type: "number",
              description: "Page number to retrieve (default 1)",
            },
            sort: {
              type: "string",
              description: "Sort field (prefix with - for descending)",
            },
          },
          required: [],
        },
      },
      {
        name: "get_configuration",
        description: "Get a specific configuration (device/asset) by ID from IT Glue",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The configuration ID",
            },
          },
          required: ["id"],
        },
      },
      // Passwords
      {
        name: "search_passwords",
        description: "Search for password entries in IT Glue (returns metadata only, not actual passwords)",
        inputSchema: {
          type: "object",
          properties: {
            organization_id: {
              type: "number",
              description: "Filter by organization ID",
            },
            name: {
              type: "string",
              description: "Filter by password entry name (partial match)",
            },
            password_category_id: {
              type: "number",
              description: "Filter by password category ID",
            },
            url: {
              type: "string",
              description: "Filter by URL",
            },
            username: {
              type: "string",
              description: "Filter by username",
            },
            page_size: {
              type: "number",
              description: "Number of results per page (max 1000, default 50)",
            },
            page_number: {
              type: "number",
              description: "Page number to retrieve (default 1)",
            },
            sort: {
              type: "string",
              description: "Sort field (prefix with - for descending)",
            },
          },
          required: [],
        },
      },
      {
        name: "get_password",
        description: "Get a specific password entry by ID from IT Glue (includes the actual password value)",
        inputSchema: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "The password entry ID",
            },
            show_password: {
              type: "boolean",
              description: "Whether to include the actual password value (default true)",
            },
          },
          required: ["id"],
        },
      },
      // Documents
      {
        name: "search_documents",
        description: "Search for documents in IT Glue",
        inputSchema: {
          type: "object",
          properties: {
            organization_id: {
              type: "number",
              description: "Filter by organization ID",
            },
            name: {
              type: "string",
              description: "Filter by document name (partial match)",
            },
            page_size: {
              type: "number",
              description: "Number of results per page (max 1000, default 50)",
            },
            page_number: {
              type: "number",
              description: "Page number to retrieve (default 1)",
            },
            sort: {
              type: "string",
              description: "Sort field (prefix with - for descending)",
            },
          },
          required: [],
        },
      },
      // Flexible Assets
      {
        name: "search_flexible_assets",
        description: "Search for flexible assets in IT Glue (requires flexible_asset_type_id filter)",
        inputSchema: {
          type: "object",
          properties: {
            flexible_asset_type_id: {
              type: "number",
              description: "Required: The flexible asset type ID to search within",
            },
            organization_id: {
              type: "number",
              description: "Filter by organization ID",
            },
            name: {
              type: "string",
              description: "Filter by flexible asset name (partial match)",
            },
            page_size: {
              type: "number",
              description: "Number of results per page (max 1000, default 50)",
            },
            page_number: {
              type: "number",
              description: "Page number to retrieve (default 1)",
            },
            sort: {
              type: "string",
              description: "Sort field (prefix with - for descending)",
            },
          },
          required: ["flexible_asset_type_id"],
        },
      },
      // Health check
      {
        name: "itglue_health_check",
        description: "Check connectivity to IT Glue API by fetching organization types",
        inputSchema: {
          type: "object",
          properties: {},
          required: [],
        },
      },
    ],
  };
});

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const credentials = getCredentialsFromEnv();

  if (!credentials.apiKey) {
    return {
      content: [
        {
          type: "text",
          text: "Error: No API credentials provided. Please configure your IT Glue API key via the ITGLUE_API_KEY or X_API_KEY environment variable.",
        },
      ],
      isError: true,
    };
  }

  try {
    const client = createClient(credentials);

    switch (name) {
      // Organizations
      case "search_organizations": {
        const params: Record<string, unknown> = {};
        const filter: Record<string, unknown> = {};

        if (args?.name) filter.name = args.name;
        if (args?.organization_type_id) filter.organizationTypeId = args.organization_type_id;
        if (args?.organization_status_id) filter.organizationStatusId = args.organization_status_id;
        if (args?.psa_id) filter.psaId = args.psa_id;

        if (Object.keys(filter).length > 0) params.filter = filter;
        if (args?.sort) params.sort = args.sort;
        params.page = {
          size: (args?.page_size as number) || 50,
          number: (args?.page_number as number) || 1,
        };

        const result = await client.request("/organizations", params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_organization": {
        if (!args?.id) {
          return {
            content: [{ type: "text", text: "Error: Organization ID is required" }],
            isError: true,
          };
        }
        const org = await client.get(`/organizations/${args.id}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(org, null, 2),
            },
          ],
        };
      }

      // Configurations
      case "search_configurations": {
        const params: Record<string, unknown> = {};
        const filter: Record<string, unknown> = {};

        if (args?.organization_id) filter.organizationId = args.organization_id;
        if (args?.name) filter.name = args.name;
        if (args?.configuration_type_id) filter.configurationTypeId = args.configuration_type_id;
        if (args?.configuration_status_id) filter.configurationStatusId = args.configuration_status_id;
        if (args?.serial_number) filter.serialNumber = args.serial_number;
        if (args?.rmm_id) filter.rmmId = args.rmm_id;
        if (args?.psa_id) filter.psaId = args.psa_id;

        if (Object.keys(filter).length > 0) params.filter = filter;
        if (args?.sort) params.sort = args.sort;
        params.page = {
          size: (args?.page_size as number) || 50,
          number: (args?.page_number as number) || 1,
        };

        const result = await client.request("/configurations", params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_configuration": {
        if (!args?.id) {
          return {
            content: [{ type: "text", text: "Error: Configuration ID is required" }],
            isError: true,
          };
        }
        const config = await client.get(`/configurations/${args.id}`);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(config, null, 2),
            },
          ],
        };
      }

      // Passwords
      case "search_passwords": {
        const params: Record<string, unknown> = {};
        const filter: Record<string, unknown> = {};

        if (args?.organization_id) filter.organizationId = args.organization_id;
        if (args?.name) filter.name = args.name;
        if (args?.password_category_id) filter.passwordCategoryId = args.password_category_id;
        if (args?.url) filter.url = args.url;
        if (args?.username) filter.username = args.username;

        if (Object.keys(filter).length > 0) params.filter = filter;
        if (args?.sort) params.sort = args.sort;
        params.page = {
          size: (args?.page_size as number) || 50,
          number: (args?.page_number as number) || 1,
        };
        // Don't show passwords in search results for security
        params.show_password = false;

        const result = await client.request("/passwords", params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      case "get_password": {
        if (!args?.id) {
          return {
            content: [{ type: "text", text: "Error: Password ID is required" }],
            isError: true,
          };
        }
        const showPassword = args?.show_password !== false;
        const password = await client.get(`/passwords/${args.id}`, {
          show_password: showPassword,
        });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(password, null, 2),
            },
          ],
        };
      }

      // Documents
      case "search_documents": {
        const params: Record<string, unknown> = {};
        const filter: Record<string, unknown> = {};

        if (args?.organization_id) filter.organizationId = args.organization_id;
        if (args?.name) filter.name = args.name;

        if (Object.keys(filter).length > 0) params.filter = filter;
        if (args?.sort) params.sort = args.sort;
        params.page = {
          size: (args?.page_size as number) || 50,
          number: (args?.page_number as number) || 1,
        };

        const result = await client.request("/documents", params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Flexible Assets
      case "search_flexible_assets": {
        if (!args?.flexible_asset_type_id) {
          return {
            content: [{ type: "text", text: "Error: flexible_asset_type_id is required" }],
            isError: true,
          };
        }

        const params: Record<string, unknown> = {};
        const filter: Record<string, unknown> = {
          flexibleAssetTypeId: args.flexible_asset_type_id,
        };

        if (args?.organization_id) filter.organizationId = args.organization_id;
        if (args?.name) filter.name = args.name;

        params.filter = filter;
        if (args?.sort) params.sort = args.sort;
        params.page = {
          size: (args?.page_size as number) || 50,
          number: (args?.page_number as number) || 1,
        };

        const result = await client.request("/flexible_assets", params);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      }

      // Health check
      case "itglue_health_check": {
        const result = await client.request("/organization_types", { page: { size: 1 } });
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(
                {
                  status: "ok",
                  message: "IT Glue API is reachable",
                  region: credentials.region,
                  organizationTypesFound: result.meta.totalCount,
                },
                null,
                2
              ),
            },
          ],
        };
      }

      default:
        return {
          content: [
            {
              type: "text",
              text: `Unknown tool: ${name}`,
            },
          ],
          isError: true,
        };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    return {
      content: [
        {
          type: "text",
          text: `Error: ${errorMessage}`,
        },
      ],
      isError: true,
    };
  }
});

  return server;
}

/**
 * Start with stdio transport (default for local/CLI usage)
 */
async function startStdioTransport(): Promise<void> {
  const server = createMcpServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error("IT Glue MCP server running on stdio");
}

/**
 * Start with HTTP Streamable transport (for Docker/cloud deployment)
 * Supports both env-based and gateway (header-based) credential modes
 */
async function startHttpTransport(): Promise<void> {
  const port = parseInt(process.env.MCP_HTTP_PORT || "8080", 10);
  const host = process.env.MCP_HTTP_HOST || "0.0.0.0";
  const isGatewayMode = process.env.AUTH_MODE === "gateway";

  const httpServer = createServer((req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url || "/", `http://${req.headers.host || "localhost"}`);

    // Health endpoint - no auth required
    if (url.pathname === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          status: "ok",
          transport: "http",
          authMode: isGatewayMode ? "gateway" : "env",
          timestamp: new Date().toISOString(),
        })
      );
      return;
    }

    // MCP endpoint — stateless: fresh server + transport per request
    if (url.pathname === "/mcp") {
      // Only POST is supported in stateless mode
      if (req.method !== "POST") {
        res.writeHead(405, { "Content-Type": "application/json" });
        res.end(JSON.stringify({
          jsonrpc: "2.0",
          error: { code: -32000, message: "Method not allowed" },
          id: null,
        }));
        return;
      }

      // In gateway mode, extract credentials from headers
      if (isGatewayMode) {
        const headers = req.headers as Record<string, string | string[] | undefined>;
        const apiKey =
          (headers["x-itglue-api-key"] as string) ||
          (headers["x-api-key"] as string);

        if (!apiKey) {
          res.writeHead(401, { "Content-Type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Missing credentials",
              message: "Gateway mode requires X-ITGlue-API-Key header",
              required: ["X-ITGlue-API-Key"],
            })
          );
          return;
        }

        process.env.ITGLUE_API_KEY = apiKey;

        const baseUrl = headers["x-itglue-base-url"] as string | undefined;
        if (baseUrl) {
          process.env.ITGLUE_BASE_URL = baseUrl;
        }

        const region = headers["x-itglue-region"] as string | undefined;
        if (region) {
          process.env.ITGLUE_REGION = region;
        }
      }

      // Stateless: create fresh server + transport for each request
      const server = createMcpServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });

      res.on("close", () => {
        transport.close();
        server.close();
      });

      server.connect(transport as unknown as Transport).then(() => {
        transport.handleRequest(req, res);
      }).catch((err) => {
        console.error("MCP transport error:", err);
        if (!res.headersSent) {
          res.writeHead(500, { "Content-Type": "application/json" });
          res.end(JSON.stringify({
            jsonrpc: "2.0",
            error: { code: -32603, message: "Internal error" },
            id: null,
          }));
        }
      });

      return;
    }

    // 404 for everything else
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found", endpoints: ["/mcp", "/health"] }));
  });

  await new Promise<void>((resolve) => {
    httpServer.listen(port, host, () => {
      console.error(`IT Glue MCP server listening on http://${host}:${port}/mcp`);
      console.error(`Health check available at http://${host}:${port}/health`);
      console.error(
        `Authentication mode: ${isGatewayMode ? "gateway (header-based)" : "env (environment variables)"}`
      );
      resolve();
    });
  });

  // Graceful shutdown
  const shutdown = async () => {
    console.error("Shutting down IT Glue MCP server...");
    await new Promise<void>((resolve, reject) => {
      httpServer.close((err) => (err ? reject(err) : resolve()));
    });
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Start the server
async function main() {
  const transportType = process.env.MCP_TRANSPORT || "stdio";

  if (transportType === "http") {
    await startHttpTransport();
  } else {
    await startStdioTransport();
  }
}

main().catch(console.error);
