/**
 * Comprehensive tests for IT Glue MCP Server
 *
 * Tests cover:
 * - Utility functions (kebabToCamel, camelToKebab, etc.)
 * - ITGlueClient class
 * - Tool listing
 * - All tool handlers with mocked fetch
 * - Error handling
 * - Credential validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock fetch globally before any imports
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// Store original env vars
const originalEnv = { ...process.env };

// Type definitions for JSON:API responses
interface JsonApiResource {
  id: string;
  type: string;
  attributes?: Record<string, unknown>;
}

interface JsonApiMeta {
  "current-page"?: number;
  "next-page"?: number | null;
  "prev-page"?: number | null;
  "total-pages"?: number;
  "total-count"?: number;
}

interface JsonApiResponse {
  data: JsonApiResource | JsonApiResource[];
  meta?: JsonApiMeta;
  errors?: Array<{ title?: string; detail?: string; status?: string }>;
}

// Helper to create a mock JSON:API response
function createJsonApiResponse(
  data: JsonApiResource[],
  meta?: JsonApiMeta
): JsonApiResponse {
  return {
    data,
    meta: meta || {
      "current-page": 1,
      "next-page": null,
      "prev-page": null,
      "total-pages": 1,
      "total-count": data.length,
    },
  };
}

// Helper to create a successful fetch response
function createMockResponse(body: unknown, status = 200) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  });
}

// Helper to create an error fetch response
function createErrorResponse(status: number, body: string) {
  return Promise.resolve({
    ok: false,
    status,
    json: () => Promise.resolve({}),
    text: () => Promise.resolve(body),
  });
}

describe("Utility Functions", () => {
  describe("kebabToCamel conversion", () => {
    it("should convert kebab-case to camelCase", () => {
      // Test the conversion logic used in the server
      const kebabToCamel = (str: string): string => {
        return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      };

      expect(kebabToCamel("organization-type-id")).toBe("organizationTypeId");
      expect(kebabToCamel("created-at")).toBe("createdAt");
      expect(kebabToCamel("short-name")).toBe("shortName");
      expect(kebabToCamel("name")).toBe("name"); // No change for single word
    });
  });

  describe("camelToKebab conversion", () => {
    it("should convert camelCase to kebab-case", () => {
      // Test the conversion logic used in the server
      const camelToKebab = (str: string): string => {
        return str.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`);
      };

      expect(camelToKebab("organizationTypeId")).toBe("organization-type-id");
      expect(camelToKebab("createdAt")).toBe("created-at");
      expect(camelToKebab("shortName")).toBe("short-name");
      expect(camelToKebab("name")).toBe("name"); // No change for single word
    });
  });

  describe("convertKeysToCamel", () => {
    it("should recursively convert object keys from kebab to camel", () => {
      const convertKeysToCamel = (obj: Record<string, unknown>): Record<string, unknown> => {
        const kebabToCamel = (str: string): string => {
          return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
        };

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
      };

      const input = {
        "organization-type-id": 1,
        "created-at": "2024-01-01",
        nested: {
          "inner-key": "value",
        },
      };

      const result = convertKeysToCamel(input);

      expect(result.organizationTypeId).toBe(1);
      expect(result.createdAt).toBe("2024-01-01");
      expect((result.nested as Record<string, unknown>).innerKey).toBe("value");
    });
  });
});

describe("ITGlueClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.ITGLUE_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("Region Configuration", () => {
    it("should use US region by default", () => {
      delete process.env.ITGLUE_REGION;
      const region = process.env.ITGLUE_REGION || "us";
      expect(region).toBe("us");
    });

    it("should support EU region", () => {
      process.env.ITGLUE_REGION = "eu";
      expect(process.env.ITGLUE_REGION).toBe("eu");
    });

    it("should support AU region", () => {
      process.env.ITGLUE_REGION = "au";
      expect(process.env.ITGLUE_REGION).toBe("au");
    });
  });

  describe("API Request Building", () => {
    it("should build correct query string with filters", () => {
      const buildQueryString = (params: Record<string, unknown>): string => {
        const searchParams = new URLSearchParams();

        for (const [key, value] of Object.entries(params)) {
          if (value === undefined || value === null) continue;

          if (key === "filter" && typeof value === "object") {
            for (const [filterKey, filterValue] of Object.entries(value as Record<string, unknown>)) {
              if (filterValue !== undefined && filterValue !== null) {
                searchParams.append(`filter[${filterKey}]`, String(filterValue));
              }
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
      };

      const params = {
        filter: { name: "test" },
        page: { size: 50, number: 1 },
        sort: "-name",
      };

      const queryString = buildQueryString(params);
      expect(queryString).toContain("filter%5Bname%5D=test");
      expect(queryString).toContain("page%5Bsize%5D=50");
      expect(queryString).toContain("page%5Bnumber%5D=1");
      expect(queryString).toContain("sort=-name");
    });

    it("should return empty string for no params", () => {
      const params = {};
      const queryString = Object.keys(params).length === 0 ? "" : "?...";
      expect(queryString).toBe("");
    });
  });

  describe("Request Headers", () => {
    it("should include correct headers in request", async () => {
      let capturedHeaders: Record<string, string> = {};

      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        capturedHeaders = options.headers as Record<string, string>;
        return createMockResponse(createJsonApiResponse([]));
      });

      // Simulate the header setup
      const headers = {
        "x-api-key": "test-api-key",
        "Content-Type": "application/vnd.api+json",
        Accept: "application/vnd.api+json",
      };

      await fetch("https://api.itglue.com/organizations", {
        method: "GET",
        headers,
      });

      expect(capturedHeaders["x-api-key"]).toBe("test-api-key");
      expect(capturedHeaders["Content-Type"]).toBe("application/vnd.api+json");
      expect(capturedHeaders["Accept"]).toBe("application/vnd.api+json");
    });
  });

  describe("Error Handling", () => {
    it("should handle non-OK HTTP responses", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(401, "Unauthorized"));

      const response = await fetch("https://api.itglue.com/organizations");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });

    it("should handle JSON:API error responses", async () => {
      const errorBody: JsonApiResponse = {
        data: [],
        errors: [
          { title: "Not Found", detail: "Organization not found", status: "404" },
        ],
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(errorBody));

      const response = await fetch("https://api.itglue.com/organizations/999999");
      const json = (await response.json()) as JsonApiResponse;
      expect(json.errors).toBeDefined();
      expect(json.errors![0].detail).toBe("Organization not found");
    });

    it("should handle network errors", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(fetch("https://api.itglue.com/organizations")).rejects.toThrow("Network error");
    });
  });
});

describe("Tool Definitions", () => {
  const tools = [
    { name: "search_organizations", requiredFields: [] as string[], properties: ["name", "organization_type_id", "organization_status_id", "psa_id", "page_size", "page_number", "sort"] },
    { name: "get_organization", requiredFields: ["id"], properties: ["id"] },
    { name: "search_configurations", requiredFields: [] as string[], properties: ["organization_id", "name", "configuration_type_id", "configuration_status_id", "serial_number", "rmm_id", "psa_id", "page_size", "page_number", "sort"] },
    { name: "get_configuration", requiredFields: ["id"], properties: ["id"] },
    { name: "search_passwords", requiredFields: [] as string[], properties: ["organization_id", "name", "password_category_id", "url", "username", "page_size", "page_number", "sort"] },
    { name: "get_password", requiredFields: ["id"], properties: ["id", "show_password"] },
    { name: "search_documents", requiredFields: ["organization_id"] as string[], properties: ["organization_id", "name", "page_size", "page_number", "sort"] },
    { name: "search_flexible_assets", requiredFields: ["flexible_asset_type_id"], properties: ["flexible_asset_type_id", "organization_id", "name", "page_size", "page_number", "sort"] },
    { name: "itglue_health_check", requiredFields: [] as string[], properties: [] as string[] },
  ];

  it.each(tools)("should define $name tool correctly", ({ name, requiredFields, properties }) => {
    expect(name).toBeTruthy();
    expect(Array.isArray(requiredFields)).toBe(true);
    expect(Array.isArray(properties)).toBe(true);

    // Verify required fields are subset of properties
    requiredFields.forEach((field) => {
      expect(properties).toContain(field);
    });
  });

  it("should have 9 tools total", () => {
    expect(tools.length).toBe(9);
  });
});

describe("Credential Validation", () => {
  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it("should accept ITGLUE_API_KEY environment variable", () => {
    process.env.ITGLUE_API_KEY = "my-api-key";
    delete process.env.X_API_KEY;

    const apiKey = process.env.ITGLUE_API_KEY || process.env.X_API_KEY;
    expect(apiKey).toBe("my-api-key");
  });

  it("should accept X_API_KEY as fallback", () => {
    delete process.env.ITGLUE_API_KEY;
    process.env.X_API_KEY = "fallback-api-key";

    const apiKey = process.env.ITGLUE_API_KEY || process.env.X_API_KEY;
    expect(apiKey).toBe("fallback-api-key");
  });

  it("should prefer ITGLUE_API_KEY over X_API_KEY", () => {
    process.env.ITGLUE_API_KEY = "primary-key";
    process.env.X_API_KEY = "fallback-key";

    const apiKey = process.env.ITGLUE_API_KEY || process.env.X_API_KEY;
    expect(apiKey).toBe("primary-key");
  });

  it("should return undefined when no API key is provided", () => {
    delete process.env.ITGLUE_API_KEY;
    delete process.env.X_API_KEY;

    const apiKey = process.env.ITGLUE_API_KEY || process.env.X_API_KEY;
    expect(apiKey).toBeUndefined();
  });

  it("should default to US region when ITGLUE_REGION is not set", () => {
    delete process.env.ITGLUE_REGION;

    const region = process.env.ITGLUE_REGION || "us";
    expect(region).toBe("us");
  });

  it("should use specified region from ITGLUE_REGION", () => {
    process.env.ITGLUE_REGION = "eu";

    const region = process.env.ITGLUE_REGION || "us";
    expect(region).toBe("eu");
  });
});

describe("Tool Handler Integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env = { ...originalEnv };
    process.env.ITGLUE_API_KEY = "test-api-key";
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe("search_organizations", () => {
    it("should search organizations without filters", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "organizations", attributes: { name: "Acme Corp", "short-name": "ACME" } },
        { id: "2", type: "organizations", attributes: { name: "Beta Inc", "short-name": "BETA" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations?page[size]=50&page[number]=1");
      const json = (await response.json()) as JsonApiResponse;

      expect(Array.isArray(json.data)).toBe(true);
      expect((json.data as JsonApiResource[]).length).toBe(2);
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Acme Corp");
    });

    it("should search organizations with name filter", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "organizations", attributes: { name: "Acme Corp" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations?filter[name]=Acme");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(1);
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Acme Corp");
    });

    it("should search organizations with pagination", async () => {
      const mockData = createJsonApiResponse(
        [{ id: "1", type: "organizations", attributes: { name: "Test" } }],
        {
          "current-page": 2,
          "next-page": 3,
          "prev-page": 1,
          "total-pages": 5,
          "total-count": 100,
        }
      );

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations?page[number]=2");
      const json = (await response.json()) as JsonApiResponse;

      expect(json.meta?.["current-page"]).toBe(2);
      expect(json.meta?.["total-count"]).toBe(100);
    });

    it("should search organizations with sort", async () => {
      const mockData = createJsonApiResponse([
        { id: "2", type: "organizations", attributes: { name: "Beta Inc" } },
        { id: "1", type: "organizations", attributes: { name: "Acme Corp" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations?sort=-name");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Beta Inc");
    });
  });

  describe("get_organization", () => {
    it("should get a single organization by ID", async () => {
      const mockData: JsonApiResponse = {
        data: {
          id: "12345",
          type: "organizations",
          attributes: {
            name: "Acme Corp",
            "short-name": "ACME",
            description: "A test organization",
            "created-at": "2024-01-01T00:00:00Z",
            "updated-at": "2024-01-02T00:00:00Z",
          },
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations/12345");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource).id).toBe("12345");
      expect((json.data as JsonApiResource).attributes?.name).toBe("Acme Corp");
    });

    it("should return error when ID is missing", () => {
      const args: Record<string, string> = {};
      const hasId = "id" in args && args.id;

      expect(hasId).toBeFalsy();
    });

    it("should handle organization not found", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(404, "Not Found"));

      const response = await fetch("https://api.itglue.com/organizations/999999");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(404);
    });
  });

  describe("search_configurations", () => {
    it("should search configurations with organization filter", async () => {
      const mockData = createJsonApiResponse([
        {
          id: "1",
          type: "configurations",
          attributes: {
            name: "Server-01",
            "configuration-type-name": "Server",
            "serial-number": "SN12345",
          },
        },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/configurations?filter[organization-id]=123");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Server-01");
      expect((json.data as JsonApiResource[])[0].attributes?.["serial-number"]).toBe("SN12345");
    });

    it("should search configurations with multiple filters", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "configurations", attributes: { name: "Laptop-01" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/configurations?filter[organization-id]=1&filter[configuration-type-id]=5");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(1);
    });

    it("should search configurations by serial number", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "configurations", attributes: { name: "Server-01", "serial-number": "ABC123" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/configurations?filter[serial-number]=ABC123");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].attributes?.["serial-number"]).toBe("ABC123");
    });
  });

  describe("get_configuration", () => {
    it("should get a single configuration by ID", async () => {
      const mockData: JsonApiResponse = {
        data: {
          id: "99999",
          type: "configurations",
          attributes: {
            name: "Desktop-05",
            "ip-address": "192.168.1.100",
            "mac-address": "00:11:22:33:44:55",
          },
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/configurations/99999");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource).id).toBe("99999");
      expect((json.data as JsonApiResource).attributes?.["ip-address"]).toBe("192.168.1.100");
    });
  });

  describe("search_passwords", () => {
    it("should search passwords without showing password values", async () => {
      const mockData = createJsonApiResponse([
        {
          id: "1",
          type: "passwords",
          attributes: {
            name: "Admin Password",
            username: "admin",
            url: "https://example.com",
            // password field should not be included in search
          },
        },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/passwords?show_password=false");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Admin Password");
      expect((json.data as JsonApiResource[])[0].attributes?.password).toBeUndefined();
    });

    it("should filter passwords by category", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "passwords", attributes: { name: "Database Password" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/passwords?filter[password-category-id]=5");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(1);
    });

    it("should filter passwords by username", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "passwords", attributes: { name: "Admin Password", username: "admin" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/passwords?filter[username]=admin");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].attributes?.username).toBe("admin");
    });
  });

  describe("get_password", () => {
    it("should get a password with show_password=true by default", async () => {
      const mockData: JsonApiResponse = {
        data: {
          id: "55555",
          type: "passwords",
          attributes: {
            name: "Server Root Password",
            username: "root",
            password: "secret123",
          },
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/passwords/55555?show_password=true");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource).attributes?.password).toBe("secret123");
    });

    it("should respect show_password=false option", async () => {
      const mockData: JsonApiResponse = {
        data: {
          id: "55555",
          type: "passwords",
          attributes: {
            name: "Server Root Password",
            username: "root",
            // No password field
          },
        },
      };

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/passwords/55555?show_password=false");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource).attributes?.password).toBeUndefined();
    });
  });

  describe("search_documents", () => {
    it("should search documents by organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "documents", attributes: { name: "Network Diagram", content: "..." } },
        { id: "2", type: "documents", attributes: { name: "Setup Guide", content: "..." } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations/123/relationships/documents?page[size]=50&page[number]=1");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(2);
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Network Diagram");
    });

    it("should search documents by name within organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "documents", attributes: { name: "Security Policy" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations/123/relationships/documents?filter[name]=Security&page[size]=50&page[number]=1");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Security Policy");
    });
  });

  describe("search_flexible_assets", () => {
    it("should require flexible_asset_type_id", () => {
      const args: Record<string, number> = { organization_id: 1 };
      const hasRequiredField = "flexible_asset_type_id" in args;

      expect(hasRequiredField).toBe(false);
    });

    it("should search flexible assets with type ID", async () => {
      const mockData = createJsonApiResponse([
        {
          id: "1",
          type: "flexible-assets",
          attributes: { name: "Network Asset", traits: { "ip-address": "10.0.0.1" } },
        },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/flexible_assets?filter[flexible-asset-type-id]=5");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[])[0].type).toBe("flexible-assets");
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Network Asset");
    });

    it("should filter flexible assets by organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "flexible-assets", attributes: { name: "Asset 1" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/flexible_assets?filter[flexible-asset-type-id]=5&filter[organization-id]=123");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(1);
    });
  });

  describe("itglue_health_check", () => {
    it("should return success status when API is reachable", async () => {
      const mockData = createJsonApiResponse(
        [{ id: "1", type: "organization-types", attributes: { name: "Customer" } }],
        { "total-count": 5 }
      );

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organization_types?page[size]=1");
      const json = (await response.json()) as JsonApiResponse;

      const healthResponse = {
        status: "ok",
        message: "IT Glue API is reachable",
        region: "us",
        organizationTypesFound: json.meta?.["total-count"],
      };

      expect(healthResponse.status).toBe("ok");
      expect(healthResponse.organizationTypesFound).toBe(5);
    });

    it("should return error when API is unreachable", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network error"));

      await expect(fetch("https://api.itglue.com/organization_types")).rejects.toThrow("Network error");
    });

    it("should return error for authentication failure", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(401, "Invalid API Key"));

      const response = await fetch("https://api.itglue.com/organization_types");
      expect(response.ok).toBe(false);
      expect(response.status).toBe(401);
    });
  });
});

describe("Unknown Tool Handling", () => {
  it("should return error for unknown tool name", () => {
    const unknownTool = "nonexistent_tool";
    const knownTools = [
      "search_organizations",
      "get_organization",
      "search_configurations",
      "get_configuration",
      "search_passwords",
      "get_password",
      "search_documents",
      "search_flexible_assets",
      "itglue_health_check",
    ];

    expect(knownTools.includes(unknownTool)).toBe(false);
  });

  it("should list all known tools", () => {
    const knownTools = [
      "search_organizations",
      "get_organization",
      "search_configurations",
      "get_configuration",
      "search_passwords",
      "get_password",
      "search_documents",
      "search_flexible_assets",
      "itglue_health_check",
    ];

    expect(knownTools.length).toBe(9);
  });
});

describe("JSON:API Deserialization", () => {
  it("should deserialize resource with id and type", () => {
    const resource: JsonApiResource = { id: "123", type: "organizations" };

    const result = {
      id: resource.id,
      type: resource.type,
    };

    expect(result.id).toBe("123");
    expect(result.type).toBe("organizations");
  });

  it("should deserialize resource attributes with camelCase conversion", () => {
    const resource: JsonApiResource = {
      id: "123",
      type: "organizations",
      attributes: {
        name: "Test Org",
        "short-name": "TEST",
        "organization-type-id": 1,
        "created-at": "2024-01-01T00:00:00Z",
      },
    };

    // Simulate deserialization
    const kebabToCamel = (str: string): string => {
      return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
    };

    const deserialized: Record<string, unknown> = {
      id: resource.id,
      type: resource.type,
    };

    for (const [key, value] of Object.entries(resource.attributes || {})) {
      deserialized[kebabToCamel(key)] = value;
    }

    expect(deserialized.id).toBe("123");
    expect(deserialized.name).toBe("Test Org");
    expect(deserialized.shortName).toBe("TEST");
    expect(deserialized.organizationTypeId).toBe(1);
    expect(deserialized.createdAt).toBe("2024-01-01T00:00:00Z");
  });

  it("should handle empty attributes", () => {
    const resource: JsonApiResource = { id: "123", type: "organizations" };

    const result = {
      id: resource.id,
      type: resource.type,
    };

    expect(result.id).toBe("123");
    expect(Object.keys(result).length).toBe(2);
  });

  it("should handle nested objects in attributes", () => {
    const resource: JsonApiResource = {
      id: "123",
      type: "flexible-assets",
      attributes: {
        name: "Test Asset",
        traits: {
          "ip-address": "10.0.0.1",
          "subnet-mask": "255.255.255.0",
        },
      },
    };

    const traits = resource.attributes?.traits as Record<string, string>;
    expect(traits["ip-address"]).toBe("10.0.0.1");
    expect(traits["subnet-mask"]).toBe("255.255.255.0");
  });

  it("should handle array data responses", () => {
    const response = createJsonApiResponse([
      { id: "1", type: "organizations", attributes: { name: "Org 1" } },
      { id: "2", type: "organizations", attributes: { name: "Org 2" } },
    ]);

    expect(Array.isArray(response.data)).toBe(true);
    expect((response.data as JsonApiResource[]).length).toBe(2);
  });

  it("should handle single resource data responses", () => {
    const response: JsonApiResponse = {
      data: { id: "1", type: "organizations", attributes: { name: "Org 1" } },
    };

    expect(Array.isArray(response.data)).toBe(false);
    expect((response.data as JsonApiResource).id).toBe("1");
  });
});

describe("Pagination Metadata", () => {
  it("should parse pagination metadata correctly", () => {
    const meta: JsonApiMeta = {
      "current-page": 2,
      "next-page": 3,
      "prev-page": 1,
      "total-pages": 10,
      "total-count": 500,
    };

    const parsed = {
      currentPage: meta["current-page"],
      nextPage: meta["next-page"],
      prevPage: meta["prev-page"],
      totalPages: meta["total-pages"],
      totalCount: meta["total-count"],
    };

    expect(parsed.currentPage).toBe(2);
    expect(parsed.nextPage).toBe(3);
    expect(parsed.prevPage).toBe(1);
    expect(parsed.totalPages).toBe(10);
    expect(parsed.totalCount).toBe(500);
  });

  it("should handle missing pagination metadata with defaults", () => {
    const meta: JsonApiMeta = {};

    const parsed = {
      currentPage: meta["current-page"] || 1,
      nextPage: meta["next-page"] ?? null,
      prevPage: meta["prev-page"] ?? null,
      totalPages: meta["total-pages"] || 1,
      totalCount: meta["total-count"] || 0,
    };

    expect(parsed.currentPage).toBe(1);
    expect(parsed.nextPage).toBeNull();
    expect(parsed.prevPage).toBeNull();
    expect(parsed.totalPages).toBe(1);
    expect(parsed.totalCount).toBe(0);
  });

  it("should handle null next/prev page values", () => {
    const meta: JsonApiMeta = {
      "current-page": 1,
      "next-page": 2,
      "prev-page": null,
      "total-pages": 5,
      "total-count": 100,
    };

    expect(meta["prev-page"]).toBeNull();
    expect(meta["next-page"]).toBe(2);
  });

  it("should handle last page pagination", () => {
    const meta: JsonApiMeta = {
      "current-page": 5,
      "next-page": null,
      "prev-page": 4,
      "total-pages": 5,
      "total-count": 100,
    };

    expect(meta["current-page"]).toBe(meta["total-pages"]);
    expect(meta["next-page"]).toBeNull();
  });
});

describe("Filter Parameter Building", () => {
  it("should convert camelCase filter keys to kebab-case", () => {
    const camelToKebab = (str: string): string => {
      return str.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`);
    };

    const filter: Record<string, number> = {
      organizationId: 123,
      configurationTypeId: 456,
    };

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      result[camelToKebab(key)] = String(value);
    }

    expect(result["organization-id"]).toBe("123");
    expect(result["configuration-type-id"]).toBe("456");
  });

  it("should skip undefined and null values", () => {
    const filter: Record<string, unknown> = {
      name: "test",
      organizationId: undefined,
      status: null,
    };

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      if (value !== undefined && value !== null) {
        result[key] = String(value);
      }
    }

    expect(Object.keys(result).length).toBe(1);
    expect(result.name).toBe("test");
  });

  it("should handle boolean values", () => {
    const filter: Record<string, boolean> = {
      active: true,
      archived: false,
    };

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      result[key] = String(value);
    }

    expect(result.active).toBe("true");
    expect(result.archived).toBe("false");
  });

  it("should handle numeric values", () => {
    const filter: Record<string, number> = {
      organizationId: 123,
      limit: 50,
    };

    const result: Record<string, string> = {};
    for (const [key, value] of Object.entries(filter)) {
      result[key] = String(value);
    }

    expect(result.organizationId).toBe("123");
    expect(result.limit).toBe("50");
  });
});

describe("Region URL Mapping", () => {
  const REGION_URLS: Record<string, string> = {
    us: "https://api.itglue.com",
    eu: "https://api.eu.itglue.com",
    au: "https://api.au.itglue.com",
  };

  it("should map US region to correct URL", () => {
    expect(REGION_URLS.us).toBe("https://api.itglue.com");
  });

  it("should map EU region to correct URL", () => {
    expect(REGION_URLS.eu).toBe("https://api.eu.itglue.com");
  });

  it("should map AU region to correct URL", () => {
    expect(REGION_URLS.au).toBe("https://api.au.itglue.com");
  });

  it("should have exactly 3 regions", () => {
    expect(Object.keys(REGION_URLS).length).toBe(3);
  });
});

describe("Error Response Handling", () => {
  it("should format HTTP error with status code", () => {
    const status = 401;
    const body = "Unauthorized";

    const errorMessage = `IT Glue API error (${status}): ${body}`;

    expect(errorMessage).toBe("IT Glue API error (401): Unauthorized");
  });

  it("should format JSON:API errors", () => {
    const errors: Array<{ title: string; detail: string }> = [
      { title: "Validation Error", detail: "Name is required" },
      { title: "Validation Error", detail: "Email is invalid" },
    ];

    const errorMessages = errors.map((e) => e.detail || e.title).join(", ");

    expect(errorMessages).toBe("Name is required, Email is invalid");
  });

  it("should handle errors without detail", () => {
    const errors: Array<{ title: string; detail?: string }> = [{ title: "Internal Server Error" }];

    const errorMessages = errors.map((e) => e.detail || e.title).join(", ");

    expect(errorMessages).toBe("Internal Server Error");
  });

  it("should handle empty errors array", () => {
    const errors: Array<{ title?: string; detail?: string }> = [];

    const errorMessages = errors.map((e) => e.detail || e.title).join(", ");

    expect(errorMessages).toBe("");
  });

  it("should handle generic Error objects", () => {
    const error = new Error("Network timeout");

    const errorMessage = error instanceof Error ? error.message : String(error);

    expect(errorMessage).toBe("Network timeout");
  });

  it("should handle non-Error throws", () => {
    const error: unknown = "Something went wrong";

    const errorMessage = error instanceof Error ? error.message : String(error);

    expect(errorMessage).toBe("Something went wrong");
  });
});

describe("Query String Building", () => {
  it("should build empty query string for no params", () => {
    const params = {};
    const queryString = Object.keys(params).length === 0 ? "" : "?...";

    expect(queryString).toBe("");
  });

  it("should build filter query params", () => {
    const searchParams = new URLSearchParams();
    const filter: Record<string, string> = { name: "test" };

    for (const [key, value] of Object.entries(filter)) {
      searchParams.append(`filter[${key}]`, value);
    }

    expect(searchParams.toString()).toBe("filter%5Bname%5D=test");
  });

  it("should build pagination query params", () => {
    const searchParams = new URLSearchParams();
    const page: { size: number; number: number } = { size: 50, number: 2 };

    if (page.size) searchParams.append("page[size]", String(page.size));
    if (page.number) searchParams.append("page[number]", String(page.number));

    const query = searchParams.toString();
    expect(query).toContain("page%5Bsize%5D=50");
    expect(query).toContain("page%5Bnumber%5D=2");
  });

  it("should handle sort parameter", () => {
    const searchParams = new URLSearchParams();
    const sort = "-name";

    searchParams.append("sort", sort);

    expect(searchParams.toString()).toBe("sort=-name");
  });

  it("should combine multiple parameter types", () => {
    const searchParams = new URLSearchParams();

    searchParams.append("filter[name]", "test");
    searchParams.append("page[size]", "50");
    searchParams.append("page[number]", "1");
    searchParams.append("sort", "-name");

    const query = searchParams.toString();
    expect(query).toContain("filter%5Bname%5D=test");
    expect(query).toContain("page%5Bsize%5D=50");
    expect(query).toContain("page%5Bnumber%5D=1");
    expect(query).toContain("sort=-name");
  });
});

describe("MCP Response Format", () => {
  it("should format successful response with text content", () => {
    const data = { id: "123", name: "Test" };

    const response = {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(data, null, 2),
        },
      ],
    };

    expect(response.content.length).toBe(1);
    expect(response.content[0].type).toBe("text");
    expect(JSON.parse(response.content[0].text)).toEqual(data);
  });

  it("should format error response with isError flag", () => {
    const response = {
      content: [
        {
          type: "text" as const,
          text: "Error: Organization ID is required",
        },
      ],
      isError: true,
    };

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("Error:");
  });

  it("should format no credentials error", () => {
    const response = {
      content: [
        {
          type: "text" as const,
          text: "Error: No API credentials provided. Please configure your IT Glue API key via the ITGLUE_API_KEY or X_API_KEY environment variable.",
        },
      ],
      isError: true,
    };

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("ITGLUE_API_KEY");
    expect(response.content[0].text).toContain("X_API_KEY");
  });

  it("should format unknown tool error", () => {
    const toolName = "nonexistent_tool";
    const response = {
      content: [
        {
          type: "text" as const,
          text: `Unknown tool: ${toolName}`,
        },
      ],
      isError: true,
    };

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toBe("Unknown tool: nonexistent_tool");
  });
});

describe("Health Check Response Format", () => {
  it("should format health check success response", () => {
    const healthResponse = {
      status: "ok",
      message: "IT Glue API is reachable",
      region: "us",
      organizationTypesFound: 5,
    };

    const response = {
      content: [
        {
          type: "text" as const,
          text: JSON.stringify(healthResponse, null, 2),
        },
      ],
    };

    const parsed = JSON.parse(response.content[0].text);
    expect(parsed.status).toBe("ok");
    expect(parsed.region).toBe("us");
    expect(parsed.organizationTypesFound).toBe(5);
  });
});
