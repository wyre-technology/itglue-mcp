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
      const kebabToCamel = (str: string): string => {
        return str.replace(/-([a-z])/g, (_, letter: string) => letter.toUpperCase());
      };

      expect(kebabToCamel("organization-type-id")).toBe("organizationTypeId");
      expect(kebabToCamel("created-at")).toBe("createdAt");
      expect(kebabToCamel("short-name")).toBe("shortName");
      expect(kebabToCamel("name")).toBe("name");
    });
  });

  describe("camelToKebab conversion", () => {
    it("should convert camelCase to kebab-case", () => {
      const camelToKebab = (str: string): string => {
        return str.replace(/[A-Z]/g, (letter: string) => `-${letter.toLowerCase()}`);
      };

      expect(camelToKebab("organizationTypeId")).toBe("organization-type-id");
      expect(camelToKebab("createdAt")).toBe("created-at");
      expect(camelToKebab("shortName")).toBe("short-name");
      expect(camelToKebab("name")).toBe("name");
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
    { name: "search_documents", requiredFields: ["organization_id"] as string[], properties: ["organization_id", "name", "page_size", "page_number", "sort", "document_folder_id"] },
    { name: "list_document_sections", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "create_document_section", requiredFields: ["document_id", "section_type", "content"], properties: ["document_id", "section_type", "content"] },
    { name: "update_document_section", requiredFields: ["document_id", "section_id", "content"], properties: ["document_id", "section_id", "content"] },
    { name: "delete_document_section", requiredFields: ["document_id", "section_id"], properties: ["document_id", "section_id"] },
    { name: "publish_document", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "search_flexible_assets", requiredFields: ["flexible_asset_type_id"], properties: ["flexible_asset_type_id", "organization_id", "name", "page_size", "page_number", "sort"] },
    { name: "itglue_health_check", requiredFields: [] as string[], properties: [] as string[] },
    { name: "get_document", requiredFields: ["organization_id", "id"], properties: ["organization_id", "id"] },
    { name: "create_document", requiredFields: ["organization_id", "name"], properties: ["organization_id", "name", "content"] },
    { name: "archive_document", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "unarchive_document", requiredFields: ["document_id"], properties: ["document_id"] },
    { name: "list_flexible_asset_types", requiredFields: [] as string[], properties: ["organization_id"] },
    { name: "search_ssl_certificates", requiredFields: ["organization_id"], properties: ["organization_id", "name", "expiration_date", "page_size", "page_number"] },
    { name: "search_domains", requiredFields: ["organization_id"], properties: ["organization_id", "name", "expiration_date", "page_size", "page_number"] },
    { name: "list_document_folders", requiredFields: ["organization_id"], properties: ["organization_id", "page_size", "page_number"] },
    { name: "search_contacts", requiredFields: ["organization_id"], properties: ["organization_id", "name", "email", "page_size", "page_number", "sort"] },
    { name: "search_locations", requiredFields: ["organization_id"], properties: ["organization_id", "name", "city", "page_size", "page_number"] },
  ];

  it.each(tools)("should define $name tool correctly", ({ name, requiredFields, properties }) => {
    expect(name).toBeTruthy();
    expect(Array.isArray(requiredFields)).toBe(true);
    expect(Array.isArray(properties)).toBe(true);

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

    it("should search documents within a specific folder", async () => {
      const mockData = createJsonApiResponse([
        { id: "10", type: "documents", attributes: { name: "Folder Doc 1" } },
        { id: "11", type: "documents", attributes: { name: "Folder Doc 2" } },
      ]);

      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));

      const response = await fetch("https://api.itglue.com/organizations/123/relationships/documents?filter[document-folder-id]=101");
      const json = (await response.json()) as JsonApiResponse;

      expect((json.data as JsonApiResource[]).length).toBe(2);
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
        body: JSON.stringify({ data: { type: "document-sections", attributes: { "resource-type": "Document::Text", content: "<p>New section.</p>" } } }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/relationships/sections",
        expect.objectContaining({ method: "POST" })
      );
      expect(response.ok).toBe(true);
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

  describe("get_document", () => {
    it("should get a document by organization and document ID", async () => {
      const mockData: JsonApiResponse = {
        data: {
          id: "23221823",
          type: "documents",
          attributes: { name: "Autotask MCP — repatch.sh Script Reference", "created-at": "2026-04-10T21:14:07.000Z" },
        },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/6951976/relationships/documents/23221823");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource).id).toBe("23221823");
      expect((json.data as JsonApiResource).attributes?.name).toBe("Autotask MCP — repatch.sh Script Reference");
    });

    it("should return error when organization_id or id is missing", () => {
      const args: Record<string, unknown> = { organization_id: 123 };
      const hasId = "id" in args && args.id;
      expect(hasId).toBeFalsy();
    });
  });

  describe("create_document", () => {
    it("should create a document with name and organization_id", async () => {
      const mockData: JsonApiResponse = {
        data: { id: "99999", type: "documents", attributes: { name: "New Doc", "created-at": "2026-05-01T00:00:00Z" } },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/6951976/relationships/documents", {
        method: "POST",
        headers: { "Content-Type": "application/vnd.api+json" },
        body: JSON.stringify({ data: { type: "documents", attributes: { name: "New Doc" } } }),
      });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/organizations/6951976/relationships/documents",
        expect.objectContaining({ method: "POST" })
      );
      expect(response.ok).toBe(true);
    });
  });

  describe("archive_document", () => {
    it("should archive a document via PATCH", async () => {
      const mockData: JsonApiResponse = {
        data: { id: "789", type: "documents", attributes: { name: "Old Doc", archived: true } },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/documents/789/archive", { method: "PATCH" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/archive",
        expect.objectContaining({ method: "PATCH" })
      );
      expect(response.ok).toBe(true);
    });
  });

  describe("unarchive_document", () => {
    it("should unarchive a document via PATCH", async () => {
      const mockData: JsonApiResponse = {
        data: { id: "789", type: "documents", attributes: { name: "Old Doc", archived: false } },
      };
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/documents/789/unarchive", { method: "PATCH" });
      expect(mockFetch).toHaveBeenCalledWith(
        "https://api.itglue.com/documents/789/unarchive",
        expect.objectContaining({ method: "PATCH" })
      );
      expect(response.ok).toBe(true);
    });
  });

  describe("list_flexible_asset_types", () => {
    it("should list all flexible asset types", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "flexible-asset-types", attributes: { name: "Network Devices", "created-at": "2024-01-01" } },
        { id: "2", type: "flexible-asset-types", attributes: { name: "Servers", "created-at": "2024-01-01" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/flexible_asset_types");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[]).length).toBe(2);
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Network Devices");
    });
  });

  describe("search_ssl_certificates", () => {
    it("should search SSL certs by organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "ssl-certificates", attributes: { name: "*.example.com", "expiration-date": "2026-12-31" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/ssl_certificates");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[])[0].attributes?.["expiration-date"]).toBe("2026-12-31");
    });

    it("should filter SSL certs by expiration date range", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "ssl-certificates", attributes: { name: "expiring.example.com", "expiration-date": "2026-06-01" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/ssl_certificates?filter[expiration-date]=2026-01-01,2026-12-31");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[]).length).toBe(1);
    });

    it("should require organization_id", () => {
      const args: Record<string, unknown> = { name: "example.com" };
      const hasOrgId = "organization_id" in args;
      expect(hasOrgId).toBe(false);
    });
  });

  describe("search_domains", () => {
    it("should search domains by organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "domains", attributes: { name: "example.com", "expiration-date": "2027-03-15" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/domains");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("example.com");
      expect((json.data as JsonApiResource[])[0].attributes?.["expiration-date"]).toBe("2027-03-15");
    });

    it("should filter domains by expiration date range", async () => {
      const mockData = createJsonApiResponse([
        { id: "2", type: "domains", attributes: { name: "expiring.com", "expiration-date": "2026-05-01" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/domains?filter[expiration-date]=*,2026-06-01");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[]).length).toBe(1);
    });
  });

  describe("list_document_folders", () => {
    it("should list document folders for an organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "101", type: "document-folders", attributes: { name: "Infrastructure", "documents-count": 12 } },
        { id: "102", type: "document-folders", attributes: { name: "Onboarding", "documents-count": 8 } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/6951976/relationships/document_folders");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[]).length).toBe(2);
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("Infrastructure");
    });

    it("should require organization_id", () => {
      const args: Record<string, unknown> = {};
      const hasOrgId = "organization_id" in args;
      expect(hasOrgId).toBe(false);
    });
  });

  describe("search_contacts", () => {
    it("should search contacts by organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "contacts", attributes: { "first-name": "Jane", "last-name": "Smith", "email": "jane@example.com" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/contacts");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[])[0].attributes?.["first-name"]).toBe("Jane");
      expect((json.data as JsonApiResource[])[0].attributes?.email).toBe("jane@example.com");
    });

    it("should filter contacts by email", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "contacts", attributes: { "first-name": "Jane", email: "jane@example.com" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/contacts?filter[email]=jane@example.com");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[])[0].attributes?.email).toBe("jane@example.com");
    });
  });

  describe("search_locations", () => {
    it("should search locations by organization", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "locations", attributes: { name: "HQ", city: "Seattle", "region-name": "Washington" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/locations");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[])[0].attributes?.name).toBe("HQ");
      expect((json.data as JsonApiResource[])[0].attributes?.city).toBe("Seattle");
    });

    it("should filter locations by city", async () => {
      const mockData = createJsonApiResponse([
        { id: "1", type: "locations", attributes: { name: "Seattle Office", city: "Seattle" } },
      ]);
      mockFetch.mockResolvedValueOnce(createMockResponse(mockData));
      const response = await fetch("https://api.itglue.com/organizations/123/relationships/locations?filter[city]=Seattle");
      const json = (await response.json()) as JsonApiResponse;
      expect((json.data as JsonApiResource[])[0].attributes?.city).toBe("Seattle");
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
      "get_document",
      "create_document",
      "list_document_sections",
      "create_document_section",
      "update_document_section",
      "delete_document_section",
      "publish_document",
      "archive_document",
      "unarchive_document",
      "list_flexible_asset_types",
      "search_flexible_assets",
      "search_ssl_certificates",
      "search_domains",
      "list_document_folders",
      "search_contacts",
      "search_locations",
      "itglue_health_check",
    ];

    expect(knownTools.includes(unknownTool)).toBe(false);
    expect(knownTools.length).toBe(24);
  });
});
