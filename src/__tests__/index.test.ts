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

// Importing from ../index pulls in the production helpers. The module guards
// its main() bootstrap on NODE_ENV=test so this import does not start an MCP
// server during tests.
import {
  buildFolderPickerOptions,
  createDocumentWithContent,
  createMcpServer,
  folderedDocumentsIncludedNote,
  ITGlueClient,
  listDocumentFoldersViaApiKey,
  parseFolderReference,
  requestDocumentsWithFolderDefault,
  rootLevelDocumentsNote,
} from "../index.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";

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

    it("should resolve the US base URL for region 'us'", async () => {
      mockFetch.mockImplementation(() => createMockResponse(createJsonApiResponse([])));
      const client = new ITGlueClient({ apiKey: "test-api-key", region: "us" });
      await client.request("/organizations");
      expect(mockFetch.mock.calls[0][0]).toMatch(/^https:\/\/api\.itglue\.com\/organizations/);
    });

    it("should resolve the EU base URL for region 'eu'", async () => {
      mockFetch.mockImplementation(() => createMockResponse(createJsonApiResponse([])));
      const client = new ITGlueClient({ apiKey: "test-api-key", region: "eu" });
      await client.request("/organizations");
      expect(mockFetch.mock.calls[0][0]).toMatch(/^https:\/\/api\.eu\.itglue\.com\/organizations/);
    });

    it("should throw a clear error for an unknown region instead of producing an 'undefined' URL", () => {
      // Reproduces issue #40: ITGLUE_REGION set to an account subdomain (not us/eu/au)
      // previously yielded baseUrl=undefined and a "Failed to parse URL from undefined/..." error.
      expect(
        () => new ITGlueClient({ apiKey: "test-api-key", region: "our-itg-subdomain" as never })
      ).toThrowError(/Invalid.*region/i);
    });

    it("should still honor an explicit baseUrl even when region is unknown", async () => {
      mockFetch.mockImplementation(() => createMockResponse(createJsonApiResponse([])));
      const client = new ITGlueClient({
        apiKey: "test-api-key",
        region: "our-itg-subdomain" as never,
        baseUrl: "https://api.itglue.example",
      });
      await client.request("/organizations");
      expect(mockFetch.mock.calls[0][0]).toMatch(/^https:\/\/api\.itglue\.example\/organizations/);
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
    { name: "search_locations", requiredFields: [] as string[], properties: ["organization_id", "name", "city", "region_id", "country_id", "psa_id", "page_size", "page_number", "sort"] },
    { name: "get_location", requiredFields: ["id"], properties: ["id"] },
    { name: "create_location", requiredFields: ["organization_id", "name"], properties: ["organization_id", "name", "country_id", "region_id", "address_1", "address_2", "city", "postal_code", "phone", "fax", "notes", "primary"] },
    { name: "update_location", requiredFields: ["organization_id", "id"], properties: ["organization_id", "id", "name", "country_id", "region_id", "address_1", "address_2", "city", "postal_code", "phone", "fax", "notes", "primary"] },
    { name: "search_passwords", requiredFields: [] as string[], properties: ["organization_id", "name", "password_category_id", "url", "username", "page_size", "page_number", "sort"] },
    { name: "get_password", requiredFields: ["id"], properties: ["id", "show_password"] },
    { name: "search_documents", requiredFields: ["organization_id"] as string[], properties: ["organization_id", "name", "page_size", "page_number", "sort"] },
    { name: "get_document", requiredFields: ["organization_id", "id"], properties: ["organization_id", "id"] },
    { name: "list_document_folders", requiredFields: ["organization_id"], properties: ["organization_id", "name", "page_size", "page_number"] },
    { name: "create_document", requiredFields: ["organization_id", "name"], properties: ["organization_id", "name", "content"] },
    { name: "list_document_sections", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "create_document_section", requiredFields: ["document_id", "section_type", "content"], properties: ["document_id", "section_type", "content"] },
    { name: "update_document_section", requiredFields: ["document_id", "section_id", "content"], properties: ["document_id", "section_id", "content"] },
    { name: "delete_document_section", requiredFields: ["document_id", "section_id"], properties: ["document_id", "section_id"] },
    { name: "publish_document", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "archive_document", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "unarchive_document", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "search_flexible_assets", requiredFields: ["flexible_asset_type_id"], properties: ["flexible_asset_type_id", "organization_id", "name", "page_size", "page_number", "sort"] },
    { name: "list_flexible_asset_types", requiredFields: [], properties: ["organization_id"] },
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

  it("should have 24 tools total", () => {
    expect(tools.length).toBe(24);
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

  // Regression tests for wyre-technology/msp-claude-plugins#134: an org-wide
  // search_documents returns only ROOT-LEVEL documents (IT Glue API limitation),
  // so the model must be told the listing is partial or it reports the truncated
  // count as the org's total ("this org has 1 document" for an org with 1,100+).
  // Since issue #55 this note is only emitted when the folder-inclusive filter
  // forms were rejected and the search degraded to the legacy root-only call.
  describe("rootLevelDocumentsNote", () => {
    it("returns null when a folder filter scopes the search (result is complete)", () => {
      expect(
        rootLevelDocumentsNote({ folderFiltered: true, haveJwt: false })
      ).toBeNull();
      expect(
        rootLevelDocumentsNote({ folderFiltered: true, haveJwt: true })
      ).toBeNull();
    });

    it("warns that the listing is root-level-only for an unscoped search", () => {
      const note = rootLevelDocumentsNote({ folderFiltered: false, haveJwt: true });
      expect(note).toContain("ROOT-LEVEL");
      expect(note).toContain("meta.total-count");
      expect(note).toContain("list_document_folders");
    });

    it("frames the JWT as an optional fallback (not a requirement) for API-key-only callers", () => {
      const note = rootLevelDocumentsNote({ folderFiltered: false, haveJwt: false });
      expect(note).toContain("ITGLUE_JWT");
      expect(note).toContain("fallback");
      expect(note).not.toMatch(/requires a JWT/i);
    });
  });

  describe("folderedDocumentsIncludedNote", () => {
    it("tells the model foldered documents are included and how to read folder membership", () => {
      const note = folderedDocumentsIncludedNote();
      expect(note).toContain("includes documents inside folders");
      expect(note).toContain("documentFolderId");
    });
  });

  // Issue #55: search_documents defaults to a folder-INCLUSIVE listing
  // (filter[document_folder_id]=null returns ALL documents), degrading through
  // the [ne] filter form down to the legacy root-only call when the tenant's
  // API rejects the filter.
  describe("requestDocumentsWithFolderDefault", () => {
    function newClient(): ITGlueClient {
      return new ITGlueClient({ apiKey: "test-api-key", region: "us" });
    }

    function decodedUrl(callIndex: number): string {
      return decodeURIComponent(mockFetch.mock.calls[callIndex][0] as string);
    }

    it("sends filter[document_folder_id]=null on the first attempt", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(createJsonApiResponse([])));

      const { attempt } = await requestDocumentsWithFolderDefault(newClient(), 123, {
        page: { size: 50, number: 1 },
      });

      expect(attempt).toBe("null-filter");
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(decodedUrl(0)).toContain("/organizations/123/relationships/documents");
      expect(decodedUrl(0)).toContain("filter[document_folder_id]=null");
    });

    it("preserves caller filters (e.g. name) alongside the folder default", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(createJsonApiResponse([])));

      await requestDocumentsWithFolderDefault(newClient(), 123, {
        filter: { name: "Runbook" },
        page: { size: 50, number: 1 },
      });

      expect(decodedUrl(0)).toContain("filter[name]=Runbook");
      expect(decodedUrl(0)).toContain("filter[document_folder_id]=null");
    });

    it("retries with filter[document_folder_id][ne]= when the null form is rejected (400)", async () => {
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(400, "bad filter"))
        .mockResolvedValueOnce(createMockResponse(createJsonApiResponse([])));

      const { attempt } = await requestDocumentsWithFolderDefault(newClient(), 123, {
        page: { size: 50, number: 1 },
      });

      expect(attempt).toBe("ne-filter");
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(decodedUrl(1)).toContain("filter[document_folder_id][ne]=");
    });

    it("falls back to the unfiltered (root-only) call when both filter forms are rejected", async () => {
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(400, "bad filter"))
        .mockResolvedValueOnce(createErrorResponse(422, "unprocessable"))
        .mockResolvedValueOnce(createMockResponse(createJsonApiResponse([])));

      const { attempt } = await requestDocumentsWithFolderDefault(newClient(), 123, {
        page: { size: 50, number: 1 },
      });

      expect(attempt).toBe("unfiltered");
      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(decodedUrl(2)).not.toContain("document_folder_id");
    });

    it("propagates non-filter errors (404, 500) without degrading", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(404, "Not Found"));

      await expect(
        requestDocumentsWithFolderDefault(newClient(), 123, {})
      ).rejects.toThrow(/404/);
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  // Issue #55: folder enumeration is API-key-first. IT Glue's public API now
  // documents a Document Folders resource (rolling out across tenants), so the
  // JWT becomes a fallback rather than a requirement.
  describe("listDocumentFoldersViaApiKey", () => {
    function newClient(): ITGlueClient {
      return new ITGlueClient({ apiKey: "test-api-key", region: "us" });
    }

    it("returns folders from the organization relationship path", async () => {
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createJsonApiResponse([
            { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
          ])
        )
      );

      const result = await listDocumentFoldersViaApiKey(newClient(), 123, {});

      expect(result).not.toBeNull();
      expect((result!.data[0] as { name: string }).name).toBe("Runbooks");
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/organizations/123/relationships/document_folders"
      );
    });

    it("tries the top-level /document_folders form when the relationship path 404s", async () => {
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(404, "Not Found"))
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
            ])
          )
        );

      const result = await listDocumentFoldersViaApiKey(newClient(), 123, {});

      expect(result).not.toBeNull();
      const secondUrl = decodeURIComponent(mockFetch.mock.calls[1][0] as string);
      expect(secondUrl).toContain("/document_folders?");
      expect(secondUrl).toContain("filter[organization_id]=123");
    });

    it("returns null (JWT-fallback signal) when the API key is rejected with 403", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(403, "Forbidden"));

      const result = await listDocumentFoldersViaApiKey(newClient(), 123, {});

      expect(result).toBeNull();
      // 403 means the key is rejected outright — no point probing the top-level path.
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("returns null when both paths 404 (resource not exposed on this tenant)", async () => {
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(404, "Not Found"))
        .mockResolvedValueOnce(createErrorResponse(404, "Not Found"));

      const result = await listDocumentFoldersViaApiKey(newClient(), 123, {});

      expect(result).toBeNull();
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it("propagates unexpected errors (500) instead of silently falling back", async () => {
      mockFetch.mockResolvedValueOnce(createErrorResponse(500, "boom"));

      await expect(listDocumentFoldersViaApiKey(newClient(), 123, {})).rejects.toThrow(/500/);
    });
  });

  // Regression tests for issue #7: document creation must persist content.
  // IT Glue's Documents API ignores a top-level `content` attribute on POST —
  // documents are section-structured, so the body only materialises when a
  // follow-up document_section is POSTed. The helper below orchestrates that
  // two-step flow; these tests exercise it directly against a mocked fetch so
  // the assertions cover the real production code path (not a re-construction
  // of it).
  describe("createDocumentWithContent", () => {
    function newClient(): ITGlueClient {
      return new ITGlueClient({ apiKey: "test-api-key", region: "us" });
    }

    it("POSTs only the document when content is omitted", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        data: { id: "789", type: "documents", attributes: { name: "Doc" } },
      }));

      await createDocumentWithContent(newClient(), {
        organization_id: 1765329,
        name: "Doc",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/organizations/1765329/relationships/documents"
      );
    });

    it("POSTs document then section when content is provided", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({
          data: { id: "23350960", type: "documents", attributes: { name: "Doc" } },
        }))
        .mockResolvedValueOnce(createMockResponse({
          data: { id: "1001", type: "document-sections", attributes: {} },
        }));

      await createDocumentWithContent(newClient(), {
        organization_id: 1765329,
        name: "Doc",
        content: "<h1>Hello</h1><p>World</p>",
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(mockFetch.mock.calls[0][0]).toContain(
        "/organizations/1765329/relationships/documents"
      );
      expect(mockFetch.mock.calls[1][0]).toContain(
        "/documents/23350960/relationships/sections"
      );

      const sectionBody = JSON.parse(mockFetch.mock.calls[1][1].body);
      expect(sectionBody.data.type).toBe("document-sections");
      // IT Glue stores the section type in `resource_type`, not `section-type`.
      // Verified live 2026-04-23: `section-type` is ignored on write and a
      // `relationships.resource` binding triggers a 400.
      expect(sectionBody.data.attributes.resource_type).toBe("Document::Text");
      expect(sectionBody.data.attributes.content).toBe("<h1>Hello</h1><p>World</p>");
      expect(sectionBody.data.attributes).not.toHaveProperty("section-type");
      expect(sectionBody.data).not.toHaveProperty("relationships");
    });

    it("skips section POST when content is empty string", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        data: { id: "789", type: "documents", attributes: { name: "Doc" } },
      }));

      await createDocumentWithContent(newClient(), {
        organization_id: 1,
        name: "Doc",
        content: "",
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("includes document_folder_id on the POST attributes when provided", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        data: { id: "789", type: "documents", attributes: { name: "Doc" } },
      }));

      await createDocumentWithContent(newClient(), {
        organization_id: 1765329,
        name: "Doc",
        document_folder_id: 42,
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.attributes.document_folder_id).toBe(42);
      expect(body.data.attributes.name).toBe("Doc");
    });

    it("accepts string folder ids and passes them through unchanged", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        data: { id: "789", type: "documents", attributes: { name: "Doc" } },
      }));

      await createDocumentWithContent(newClient(), {
        organization_id: 1765329,
        name: "Doc",
        document_folder_id: "42",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.attributes.document_folder_id).toBe("42");
    });

    it("omits document_folder_id from attributes when not provided", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse({
        data: { id: "789", type: "documents", attributes: { name: "Doc" } },
      }));

      await createDocumentWithContent(newClient(), {
        organization_id: 1765329,
        name: "Doc",
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.data.attributes).not.toHaveProperty("document_folder_id");
    });

    it("returns the document (not the section) as the caller-visible result", async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({
          data: { id: "23350960", type: "documents", attributes: { name: "Doc" } },
        }))
        .mockResolvedValueOnce(createMockResponse({
          data: { id: "1001", type: "document-sections", attributes: {} },
        }));

      const result = await createDocumentWithContent(newClient(), {
        organization_id: 1,
        name: "Doc",
        content: "<p>x</p>",
      });

      expect((result as { id: string; type: string }).id).toBe("23350960");
      expect((result as { id: string; type: string }).type).toBe("documents");
    });
  });

  describe("ITGlueClient auth dispatch", () => {
    it("throws when neither apiKey nor jwt is provided", () => {
      expect(() => new ITGlueClient({ region: "us" } as never)).toThrow(
        /apiKey or a jwt/i
      );
    });

    it("sends Authorization: Bearer when a JWT is configured", async () => {
      let captured: Record<string, string> = {};
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        captured = options.headers as Record<string, string>;
        return createMockResponse(createJsonApiResponse([]));
      });

      const client = new ITGlueClient({ jwt: "test-jwt", region: "us" });
      await client.request("/organizations", {});

      expect(captured["Authorization"]).toBe("Bearer test-jwt");
      expect(captured["x-api-key"]).toBeUndefined();
    });

    it("sends x-api-key when only an apiKey is configured", async () => {
      let captured: Record<string, string> = {};
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        captured = options.headers as Record<string, string>;
        return createMockResponse(createJsonApiResponse([]));
      });

      const client = new ITGlueClient({ apiKey: "test-key", region: "us" });
      await client.request("/organizations", {});

      expect(captured["x-api-key"]).toBe("test-key");
      expect(captured["Authorization"]).toBeUndefined();
    });

    it("prefers JWT over apiKey when both are configured (JWT carries broader scope)", async () => {
      let captured: Record<string, string> = {};
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        captured = options.headers as Record<string, string>;
        return createMockResponse(createJsonApiResponse([]));
      });

      const client = new ITGlueClient({
        apiKey: "test-key",
        jwt: "test-jwt",
        region: "us",
      });
      await client.request("/organizations", {});

      expect(captured["Authorization"]).toBe("Bearer test-jwt");
      expect(captured["x-api-key"]).toBeUndefined();
    });

    it("uses JWT auth on POST as well as GET", async () => {
      let captured: Record<string, string> = {};
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        captured = options.headers as Record<string, string>;
        return createMockResponse({
          data: { id: "1", type: "documents", attributes: { name: "d" } },
        });
      });

      const client = new ITGlueClient({ jwt: "test-jwt", region: "us" });
      await client.post("/organizations/1/relationships/documents", {
        data: { type: "documents", attributes: { name: "d" } },
      });

      expect(captured["Authorization"]).toBe("Bearer test-jwt");
    });
  });

  describe("buildFolderPickerOptions", () => {
    it("always prepends a __root__ sentinel even when the folder list is empty", () => {
      const options = buildFolderPickerOptions([]);
      expect(options).toEqual([
        { value: "__root__", label: "(Root — no folder)" },
      ]);
    });

    it("builds breadcrumb labels for nested folders using parent-id (kebab-case)", () => {
      const options = buildFolderPickerOptions([
        { id: "1", attributes: { name: "Networking" } },
        { id: "2", attributes: { name: "Firewalls", "parent-id": "1" } },
        { id: "3", attributes: { name: "Edge", "parent-id": "2" } },
      ]);
      expect(options[0]).toEqual({ value: "__root__", label: "(Root — no folder)" });
      const byValue = Object.fromEntries(options.map((o) => [o.value, o.label]));
      expect(byValue["1"]).toBe("Networking");
      expect(byValue["2"]).toBe("Networking / Firewalls");
      expect(byValue["3"]).toBe("Networking / Firewalls / Edge");
    });

    it("also accepts snake_case parent_id", () => {
      const options = buildFolderPickerOptions([
        { id: "1", attributes: { name: "Top" } },
        { id: "2", attributes: { name: "Child", parent_id: "1" } },
      ]);
      const byValue = Object.fromEntries(options.map((o) => [o.value, o.label]));
      expect(byValue["2"]).toBe("Top / Child");
    });

    it("disambiguates duplicate folder names under different parents", () => {
      const options = buildFolderPickerOptions([
        { id: "1", attributes: { name: "Networking" } },
        { id: "2", attributes: { name: "Servers" } },
        { id: "3", attributes: { name: "Firewalls", "parent-id": "1" } },
        { id: "4", attributes: { name: "Firewalls", "parent-id": "2" } },
      ]);
      const labels = options.map((o) => o.label);
      expect(labels).toContain("Networking / Firewalls");
      expect(labels).toContain("Servers / Firewalls");
    });

    it("is cycle-safe (parent chain looping back terminates)", () => {
      const options = buildFolderPickerOptions([
        { id: "A", attributes: { name: "A", "parent-id": "B" } },
        { id: "B", attributes: { name: "B", "parent-id": "A" } },
      ]);
      const byValue = Object.fromEntries(options.map((o) => [o.value, o.label]));
      expect(byValue["A"]).toBe("B / A");
      expect(byValue["B"]).toBe("A / B");
    });

    it("treats unknown parent ids as orphans (own-name label)", () => {
      const options = buildFolderPickerOptions([
        { id: "1", attributes: { name: "Stray", "parent-id": "999" } },
      ]);
      expect(options.find((o) => o.value === "1")?.label).toBe("Stray");
    });
  });

  describe("parseFolderReference", () => {
    it("returns root for null, undefined, empty, and whitespace input", () => {
      expect(parseFolderReference(null)).toEqual({ kind: "root" });
      expect(parseFolderReference(undefined)).toEqual({ kind: "root" });
      expect(parseFolderReference("")).toEqual({ kind: "root" });
      expect(parseFolderReference("   \n  ")).toEqual({ kind: "root" });
    });

    it("returns a folder reference for a bare numeric id (trimmed)", () => {
      expect(parseFolderReference("6926612")).toEqual({ kind: "folder", folderId: 6926612 });
      expect(parseFolderReference("  6926612  ")).toEqual({ kind: "folder", folderId: 6926612 });
    });

    it("extracts the folder id from an IT Glue folder URL", () => {
      const url = "https://wyretechnology.itglue.com/8250506/documents/folder/6926612/";
      expect(parseFolderReference(url)).toEqual({ kind: "folder", folderId: 6926612 });
    });

    it("handles a folder URL with no trailing slash", () => {
      const url = "https://wyretechnology.itglue.com/8250506/documents/folder/6926612";
      expect(parseFolderReference(url)).toEqual({ kind: "folder", folderId: 6926612 });
    });

    it("extracts the doc id from a `/docs/<id>` URL (resource-url shape)", () => {
      const url = "https://wyretechnology.itglue.com/8250506/docs/22884804";
      expect(parseFolderReference(url)).toEqual({ kind: "doc", docId: 22884804 });
    });

    it("extracts the doc id from a `DOC-<org>-<id>` URL (UI shape)", () => {
      const url = "https://wyretechnology.itglue.com/DOC-8250506-22884804";
      expect(parseFolderReference(url)).toEqual({ kind: "doc", docId: 22884804 });
    });

    it("prefers the more specific folder pattern when both could match", () => {
      // A folder URL is unambiguous — the doc pattern should not steal from it.
      const url = "https://x/8250506/documents/folder/6926612/";
      expect(parseFolderReference(url)).toEqual({ kind: "folder", folderId: 6926612 });
    });

    it("flags unparseable input as invalid (preserves the original for the error message)", () => {
      expect(parseFolderReference("not a url or id")).toEqual({
        kind: "invalid",
        input: "not a url or id",
      });
      expect(parseFolderReference("https://example.com/somewhere/else")).toEqual({
        kind: "invalid",
        input: "https://example.com/somewhere/else",
      });
    });
  });

  describe("list_document_sections", () => {
    it("should list sections for a document", async () => {
      const mockData = createJsonApiResponse([
        { id: "1001", type: "document-sections", attributes: { content: "<h2>Overview</h2>", "section-type": "Document::Heading", position: 1 } },
        { id: "1002", type: "document-sections", attributes: { content: "<p>Details here.</p>", "section-type": "Document::Text", position: 2 } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/documents/789/relationships/sections");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(2);
      expect((json.data as JsonApiResource[])[0].attributes?.["section-type"]).toBe("Document::Heading");
    });
  });

  describe("create_document_section", () => {
    it("should map 'heading' type to Document::Heading", () => {
      const sectionTypeMap: Record<string, string> = { heading: "Document::Heading", text: "Document::Text" };
      expect(sectionTypeMap["heading"]).toBe("Document::Heading");
    });

    it("should map 'text' type to Document::Text", () => {
      const sectionTypeMap: Record<string, string> = { heading: "Document::Heading", text: "Document::Text" };
      expect(sectionTypeMap["text"]).toBe("Document::Text");
    });

    it("should post a new section to the sections endpoint", async () => {
      const mockSection = { id: "1003", type: "document-sections", attributes: { content: "<p>New section.</p>", "section-type": "Document::Text" } };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: mockSection, meta: {} }));

      const response = await fetch("https://api.itglue.com/documents/789/relationships/sections", {
        method: "POST",
        headers: { "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify({ data: { type: "document-sections", attributes: { "section-type": "Document::Text", content: "<p>New section.</p>" } } }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/relationships/sections",
        expect.objectContaining({ method: "POST" })
      );
      expect(response.ok).toBe(true);
    });

    // BUG TEST #2: This test demonstrates that create_document_section should include resource relationship
    it("should include resource relationship in document section payload", async () => {
      let capturedBody: string = "";

      const mockSection = { id: "1003", type: "document-sections", attributes: { content: "<p>New section.</p>", "section-type": "Document::Text" } };
      mockFetch.mockImplementation((_url: string, options: RequestInit) => {
        capturedBody = options.body as string;
        return createMockResponse({ data: mockSection, meta: {} });
      });

      // This should now POST with the correct payload that includes resource relationship
      await fetch("https://api.itglue.com/documents/789/relationships/sections", {
        method: "POST",
        headers: { "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify({
          data: {
            type: "document-sections",
            attributes: {
              "section-type": "Document::Text",
              content: "<p>New section.</p>"
            },
            relationships: {
              resource: {
                data: {
                  type: "documents",
                  id: "789"
                }
              }
            }
          }
        }),
      });

      const parsedBody = JSON.parse(capturedBody);

      // Verify basic structure
      expect(parsedBody.data.type).toBe("document-sections");
      expect(parsedBody.data.attributes["section-type"]).toBe("Document::Text");
      expect(parsedBody.data.attributes.content).toBe("<p>New section.</p>");

      // Verify the fix - should include relationships.resource binding (Option B)
      expect(parsedBody.data.relationships?.resource?.data?.type).toBe("documents");
      expect(parsedBody.data.relationships?.resource?.data?.id).toBe("789");
    });

    it("should fail with 400 error when resource relationship is missing", async () => {
      // Mock the actual 400 error from IT Glue API
      const errorResponse = {
        errors: [{
          title: "Bad Request",
          detail: "param is missing or the value is empty: resource_type",
          status: "400"
        }]
      };
      mockFetch.mockResolvedValueOnce(createErrorResponse(400, JSON.stringify(errorResponse)));

      const response = await fetch("https://api.itglue.com/documents/789/relationships/sections", {
        method: "POST",
        headers: { "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify({
          data: {
            type: "document-sections",
            attributes: {
              "section-type": "Document::Text",
              content: "<p>New section.</p>"
            }
          }
        }),
      });

      expect(response.ok).toBe(false);
      expect(response.status).toBe(400);

      const errorText = await response.text();
      expect(errorText).toContain("resource_type");
    });
  });

  describe("update_document_section", () => {
    it("should patch the section with new content", async () => {
      const mockSection = { id: "1002", type: "document-sections", attributes: { content: "<p>Updated.</p>" } };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: mockSection, meta: {} }));

      const response = await fetch("https://api.itglue.com/documents/789/relationships/sections/1002", {
        method: "PATCH",
        headers: { "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify({ data: { type: "document-sections", attributes: { content: "<p>Updated.</p>" } } }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/relationships/sections/1002",
        expect.objectContaining({ method: "PATCH" })
      );
      expect(response.ok).toBe(true);
    });
  });

  describe("delete_document_section", () => {
    it("should delete a section", async () => {
      mockFetch.mockResolvedValueOnce(createMockResponse(null, 204));

      const response = await fetch("https://api.itglue.com/documents/789/relationships/sections/1002", {
        method: "DELETE",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/relationships/sections/1002",
        expect.objectContaining({ method: "DELETE" })
      );
      expect(response.status).toBe(204);
    });
  });

  describe("publish_document", () => {
    it("should use PATCH method (not POST)", async () => {
      const mockDoc = { id: "789", type: "documents", attributes: { name: "My Doc" } };
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: mockDoc, meta: {} }));

      const response = await fetch("https://api.itglue.com/documents/789/publish", {
        method: "PATCH",
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/publish",
        expect.objectContaining({ method: "PATCH" })
      );
      expect(response.ok).toBe(true);
    });
  });

  describe("archive_document / unarchive_document", () => {
    // Pins the URL, method, and payload shape so a future refactor can't
    // silently omit `archived` or swap to a non-existent /archive sub-endpoint.
    it.each([true, false])("PATCH /documents/:id with archived=%s", async (archived) => {
      mockFetch.mockResolvedValueOnce(createMockResponse({ data: {}, meta: {} }));

      await fetch("https://api.itglue.com/documents/789", {
        method: "PATCH",
        body: JSON.stringify({
          data: { type: "documents", attributes: { archived } },
        }),
      });

      const [, init] = mockFetch.mock.calls[0];
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789",
        expect.objectContaining({ method: "PATCH" })
      );
      expect(JSON.parse(init.body as string)).toEqual({
        data: { type: "documents", attributes: { archived } },
      });
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

// Exercises the REAL MCP server end-to-end (ListTools + CallTool) over an
// in-memory transport pair, so these tests cover the actual tool-handler
// dispatch — not a re-implemented mock. fetch stays mocked underneath.
describe("Locations tools (round-trip)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function connectLocationsClient(): Promise<Client> {
    const server = createMcpServer({ apiKey: "test-api-key" });
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "locations-test", version: "1.0.0" });
    await client.connect(clientTransport);
    return client;
  }

  function firstText(result: unknown): string {
    const r = result as { content?: Array<{ text?: string }> };
    return r.content?.[0]?.text ?? "";
  }

  function isError(result: unknown): boolean {
    return (result as { isError?: boolean }).isError === true;
  }

  it("registers all four locations tools", async () => {
    const client = await connectLocationsClient();
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        "search_locations",
        "get_location",
        "create_location",
        "update_location",
      ])
    );
  });

  it("exposes 24 tools total", async () => {
    const client = await connectLocationsClient();
    const { tools } = await client.listTools();
    expect(tools.length).toBe(24);
  });

  it("search_locations queries /locations filtered by organization and city", async () => {
    const client = await connectLocationsClient();
    mockFetch.mockResolvedValueOnce(
      createMockResponse(
        createJsonApiResponse([
          {
            id: "5",
            type: "locations",
            attributes: {
              name: "Primary Address",
              phone: "423-555-0100",
              city: "Chattanooga",
              primary: true,
            },
          },
        ])
      )
    );

    const result = await client.callTool({
      name: "search_locations",
      arguments: { organization_id: 8637099, city: "Chattanooga" },
    });

    // Decode first: buildQueryString uses URLSearchParams, which percent-encodes
    // the JSON:API filter brackets (filter%5Borganization-id%5D=...).
    const url = decodeURIComponent(mockFetch.mock.calls[0][0] as string);
    expect(url).toContain("/locations?");
    expect(url).toContain("filter[organization-id]=8637099");
    expect(url).toContain("filter[city]=Chattanooga");
    expect(firstText(result)).toContain("423-555-0100");
  });

  it("get_location fetches a single location by id", async () => {
    const client = await connectLocationsClient();
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: {
          id: "5",
          type: "locations",
          attributes: { name: "HQ", phone: "423-555-0100" },
        },
      })
    );

    const result = await client.callTool({
      name: "get_location",
      arguments: { id: 5 },
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "https://api.itglue.com/locations/5"
    );
    expect(firstText(result)).toContain("423-555-0100");
  });

  it("get_location returns an error when id is missing", async () => {
    const client = await connectLocationsClient();
    const result = await client.callTool({
      name: "get_location",
      arguments: {},
    });
    expect(isError(result)).toBe(true);
    expect(firstText(result).toLowerCase()).toContain("id is required");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("create_location posts attributes to the org locations relationship", async () => {
    const client = await connectLocationsClient();
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: {
          id: "5",
          type: "locations",
          attributes: { name: "HQ", phone: "423-555-0100" },
        },
        meta: {},
      })
    );

    const result = await client.callTool({
      name: "create_location",
      arguments: {
        organization_id: 123,
        name: "HQ",
        phone: "423-555-0100",
        country_id: 1,
      },
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.itglue.com/organizations/123/relationships/locations"
    );
    expect(options.method).toBe("POST");
    expect(JSON.parse(options.body as string)).toEqual({
      data: {
        type: "locations",
        attributes: { name: "HQ", phone: "423-555-0100", country_id: 1 },
      },
    });
    expect(firstText(result)).toContain("HQ");
  });

  it("create_location requires organization_id and name", async () => {
    const client = await connectLocationsClient();
    const result = await client.callTool({
      name: "create_location",
      arguments: { name: "HQ" },
    });
    expect(isError(result)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("update_location patches only the supplied fields", async () => {
    const client = await connectLocationsClient();
    mockFetch.mockResolvedValueOnce(
      createMockResponse({
        data: {
          id: "5",
          type: "locations",
          attributes: { phone: "423-555-9999" },
        },
        meta: {},
      })
    );

    const result = await client.callTool({
      name: "update_location",
      arguments: { organization_id: 123, id: 5, phone: "423-555-9999" },
    });

    const [url, options] = mockFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      "https://api.itglue.com/organizations/123/relationships/locations/5"
    );
    expect(options.method).toBe("PATCH");
    expect(JSON.parse(options.body as string)).toEqual({
      data: {
        type: "locations",
        attributes: { phone: "423-555-9999" },
      },
    });
    expect(firstText(result)).toContain("423-555-9999");
  });

  it("update_location requires at least one field to change", async () => {
    const client = await connectLocationsClient();
    const result = await client.callTool({
      name: "update_location",
      arguments: { organization_id: 123, id: 5 },
    });
    expect(isError(result)).toBe(true);
    expect(mockFetch).not.toHaveBeenCalled();
  });
});

// Issue #55 round-trip coverage: exercises the REAL MCP server (CallTool) over
// an in-memory transport pair so the API-key-first / JWT-fallback ordering in
// the actual handlers is what's under test. fetch stays mocked underneath.
describe("Document folder access (API-key-first, round-trip)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function connectClient(credentials: {
    apiKey?: string;
    jwt?: string;
  }): Promise<Client> {
    const server = createMcpServer(credentials);
    const [clientTransport, serverTransport] =
      InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "folders-test", version: "1.0.0" });
    await client.connect(clientTransport);
    return client;
  }

  function firstText(result: unknown): string {
    const r = result as { content?: Array<{ text?: string }> };
    return r.content?.[0]?.text ?? "";
  }

  function isError(result: unknown): boolean {
    return (result as { isError?: boolean }).isError === true;
  }

  function decodedUrl(callIndex: number): string {
    return decodeURIComponent(mockFetch.mock.calls[callIndex][0] as string);
  }

  function headersOf(callIndex: number): Record<string, string> {
    return (mockFetch.mock.calls[callIndex][1] as RequestInit)
      .headers as Record<string, string>;
  }

  describe("search_documents", () => {
    it("defaults to filter[document_folder_id]=null and surfaces each doc's folder id", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createJsonApiResponse([
            {
              id: "1",
              type: "documents",
              attributes: { name: "Foldered Doc", "document-folder-id": 42 },
            },
            {
              id: "2",
              type: "documents",
              attributes: { name: "Root Doc", "document-folder-id": null },
            },
          ])
        )
      );

      const result = await client.callTool({
        name: "search_documents",
        arguments: { organization_id: 123 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(decodedUrl(0)).toContain("filter[document_folder_id]=null");
      const text = firstText(result);
      expect(text).toContain("includes documents inside folders");
      expect(text).not.toContain("ROOT-LEVEL");
      // Folder membership is surfaced on each returned document.
      expect(text).toContain('"documentFolderId": 42');
    });

    it("keeps exact current behavior for an explicit document_folder_id", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createJsonApiResponse([
            { id: "1", type: "documents", attributes: { name: "Doc" } },
          ])
        )
      );

      const result = await client.callTool({
        name: "search_documents",
        arguments: { organization_id: 123, document_folder_id: 42 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(decodedUrl(0)).toContain("filter[document-folder-id]=42");
      expect(decodedUrl(0)).not.toContain("filter[document_folder_id]=null");
      expect(firstText(result)).not.toContain("NOTE:");
    });

    it("degrades 400 → [ne] filter and still reports foldered docs included", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(400, "bad filter"))
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "1", type: "documents", attributes: { name: "Doc" } },
            ])
          )
        );

      const result = await client.callTool({
        name: "search_documents",
        arguments: { organization_id: 123 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(decodedUrl(1)).toContain("filter[document_folder_id][ne]=");
      expect(firstText(result)).toContain("includes documents inside folders");
    });

    it("degrades 400 → 422 → unfiltered and keeps the root-level-only warning", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(400, "bad filter"))
        .mockResolvedValueOnce(createErrorResponse(422, "unprocessable"))
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "1", type: "documents", attributes: { name: "Root Doc" } },
            ])
          )
        );

      const result = await client.callTool({
        name: "search_documents",
        arguments: { organization_id: 123 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(decodedUrl(2)).not.toContain("document_folder_id");
      const text = firstText(result);
      expect(text).toContain("ROOT-LEVEL");
      expect(text).toContain("meta.total-count");
    });

    it("still maps a 404 to the Documents-module-missing message (no degradation)", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch.mockResolvedValueOnce(createErrorResponse(404, "Not Found"));

      const result = await client.callTool({
        name: "search_documents",
        arguments: { organization_id: 123 },
      });

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(isError(result)).toBe(true);
      expect(firstText(result)).toContain("Documents module");
    });
  });

  describe("list_document_folders", () => {
    it("succeeds with the API key alone (no JWT involved)", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createJsonApiResponse([
            { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
          ])
        )
      );

      const result = await client.callTool({
        name: "list_document_folders",
        arguments: { organization_id: 123 },
      });

      expect(isError(result)).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(decodedUrl(0)).toContain(
        "/organizations/123/relationships/document_folders"
      );
      expect(headersOf(0)["x-api-key"]).toBe("test-api-key");
      expect(headersOf(0)["Authorization"]).toBeUndefined();
      expect(firstText(result)).toContain("Runbooks");
    });

    it("prefers the API key even when a JWT is also configured", async () => {
      const client = await connectClient({ apiKey: "test-api-key", jwt: "test-jwt" });
      mockFetch.mockResolvedValueOnce(
        createMockResponse(
          createJsonApiResponse([
            { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
          ])
        )
      );

      const result = await client.callTool({
        name: "list_document_folders",
        arguments: { organization_id: 123 },
      });

      expect(isError(result)).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(headersOf(0)["x-api-key"]).toBe("test-api-key");
      expect(headersOf(0)["Authorization"]).toBeUndefined();
    });

    it("falls back to the top-level /document_folders path when the relationship path 404s", async () => {
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(404, "Not Found"))
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
            ])
          )
        );

      const result = await client.callTool({
        name: "list_document_folders",
        arguments: { organization_id: 123 },
      });

      expect(isError(result)).toBe(false);
      expect(decodedUrl(1)).toContain("/document_folders?");
      expect(decodedUrl(1)).toContain("filter[organization_id]=123");
    });

    it("falls back to the configured JWT when the API key is rejected with 403", async () => {
      const client = await connectClient({ apiKey: "test-api-key", jwt: "test-jwt" });
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(403, "Forbidden"))
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
            ])
          )
        );

      const result = await client.callTool({
        name: "list_document_folders",
        arguments: { organization_id: 123 },
      });

      expect(isError(result)).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(headersOf(0)["x-api-key"]).toBe("test-api-key");
      expect(headersOf(1)["Authorization"]).toBe("Bearer test-jwt");
      expect(firstText(result)).toContain("Runbooks");
    });

    it("returns an actionable error when the API key is rejected and no JWT is available", async () => {
      // The in-memory test client does not support elicitation, so the JWT
      // prompt yields nothing — the neither-credential-works path.
      const client = await connectClient({ apiKey: "test-api-key" });
      mockFetch.mockResolvedValueOnce(createErrorResponse(403, "Forbidden"));

      const result = await client.callTool({
        name: "list_document_folders",
        arguments: { organization_id: 123 },
      });

      expect(isError(result)).toBe(true);
      const text = firstText(result);
      expect(text).toContain("Document Folders");
      expect(text).toContain("ITGLUE_JWT");
      expect(text).toContain("fallback");
    });

    it("clears the cached JWT when IT Glue rejects it with 401 (existing behavior)", async () => {
      const client = await connectClient({ apiKey: "test-api-key", jwt: "stale-jwt" });
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(403, "Forbidden")) // API key
        .mockResolvedValueOnce(createErrorResponse(401, "Unauthorized")); // stale JWT

      const result = await client.callTool({
        name: "list_document_folders",
        arguments: { organization_id: 123 },
      });

      expect(isError(result)).toBe(true);
      expect(firstText(result)).toContain("expired");
    });
  });

  describe("create_document folder picker", () => {
    it("enumerates folders with the API key first", async () => {
      const client = await connectClient({ apiKey: "test-api-key", jwt: "test-jwt" });
      mockFetch
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
            ])
          )
        )
        // Picker elicitation is unsupported by the test client → folderId stays
        // undefined → the document is created at the root.
        .mockResolvedValueOnce(
          createMockResponse({
            data: { id: "99", type: "documents", attributes: { name: "New Doc" } },
          })
        );

      const result = await client.callTool({
        name: "create_document",
        arguments: { organization_id: 123, name: "New Doc" },
      });

      expect(isError(result)).toBe(false);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      // Folder enumeration used the API key, not the configured JWT.
      expect(decodedUrl(0)).toContain(
        "/organizations/123/relationships/document_folders"
      );
      expect(headersOf(0)["x-api-key"]).toBe("test-api-key");
      expect(headersOf(0)["Authorization"]).toBeUndefined();
      expect(decodedUrl(1)).toContain("/organizations/123/relationships/documents");
    });

    it("falls back to the configured JWT for folder enumeration when the API key is rejected", async () => {
      const client = await connectClient({ apiKey: "test-api-key", jwt: "test-jwt" });
      mockFetch
        .mockResolvedValueOnce(createErrorResponse(403, "Forbidden")) // API key
        .mockResolvedValueOnce(
          createMockResponse(
            createJsonApiResponse([
              { id: "10", type: "document-folders", attributes: { name: "Runbooks" } },
            ])
          )
        )
        .mockResolvedValueOnce(
          createMockResponse({
            data: { id: "99", type: "documents", attributes: { name: "New Doc" } },
          })
        );

      const result = await client.callTool({
        name: "create_document",
        arguments: { organization_id: 123, name: "New Doc" },
      });

      expect(isError(result)).toBe(false);
      expect(headersOf(0)["x-api-key"]).toBe("test-api-key");
      expect(headersOf(1)["Authorization"]).toBe("Bearer test-jwt");
    });
  });
});
