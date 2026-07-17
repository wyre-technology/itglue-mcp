/**
 * Document-card payload builder for the MCP Apps (SEP-1865) UI surface.
 *
 * get_document results get a normalized `_card` object attached (see
 * mcp-server.ts) that the ui:// document card renders from. The card is
 * progressive enhancement: every step here is best-effort, and a null return
 * simply means the host renders no card while the JSON payload is unchanged.
 *
 * The card is read-only — IT Glue is a documentation system, so there is no
 * in-card write round-trip.
 */

import type { ITGlueClient } from "./mcp-server.js";

export const DOCUMENT_CARD_RESOURCE_URI = "ui://itglue/document-card.html";

/** MCP Apps resource MIME (RESOURCE_MIME_TYPE in @modelcontextprotocol/ext-apps). */
export const MCP_APP_RESOURCE_MIME = "text/html;profile=mcp-app";

/**
 * Tool `_meta` advertising the card. Carries both the canonical flat key
 * (RESOURCE_URI_META_KEY in ext-apps) and the nested form ext-apps'
 * registerAppTool emits, so any MCP Apps host revision finds it.
 */
export const DOCUMENT_CARD_META = {
  "ui/resourceUri": DOCUMENT_CARD_RESOURCE_URI,
  ui: { resourceUri: DOCUMENT_CARD_RESOURCE_URI },
} as const;

/** Mirror of Brand in ui/document-card.ts — keep in sync. */
export interface CardBrand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}

/** The BRAND_INJECT comment marker baked into the card HTML (see ui/index.html). */
const BRAND_INJECT_RE = /<!--\s*BRAND_INJECT:[\s\S]*?-->/;

/**
 * Serve-time brand injection: replace the BRAND_INJECT marker with an inline
 * `window.__BRAND__` script so self-hosters can theme the card without
 * rebuilding the bundle. An empty brand returns the HTML unchanged (the card
 * renders its neutral defaults). `<` is escaped so brand values can never
 * break out of the script tag.
 */
export function applyBrandInjection(html: string, brand: CardBrand): string {
  if (!brand || Object.values(brand).every((v) => !v)) return html;
  const json = JSON.stringify(brand).replace(/</g, "\\u003c");
  return html.replace(BRAND_INJECT_RE, `<script>window.__BRAND__=${json}</script>`);
}

/**
 * Resolve brand overrides from MCP_BRAND_* environment variables. Guarded for
 * runtimes without `process` (Cloudflare Workers), where this returns an empty
 * brand and the card serves its neutral defaults.
 */
export function resolveBrandFromEnv(): CardBrand {
  if (typeof process === "undefined" || !process.env) return {};
  const env = process.env;
  const brand: CardBrand = {};
  if (env.MCP_BRAND_NAME) brand.name = env.MCP_BRAND_NAME;
  if (env.MCP_BRAND_LOGO_URL) brand.logoUrl = env.MCP_BRAND_LOGO_URL;
  if (env.MCP_BRAND_PRIMARY_COLOR) brand.primaryColor = env.MCP_BRAND_PRIMARY_COLOR;
  if (env.MCP_BRAND_ACCENT_COLOR) brand.accentColor = env.MCP_BRAND_ACCENT_COLOR;
  if (env.MCP_BRAND_BG) brand.bg = env.MCP_BRAND_BG;
  if (env.MCP_BRAND_TEXT) brand.text = env.MCP_BRAND_TEXT;
  return brand;
}

/** Mirror of DocumentCard in ui/document-card.ts — keep in sync. */
export interface DocumentCard {
  id: string;
  name: string;
  organization?: string;
  folder?: string;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  sections: Array<{ heading?: boolean; text: string }>;
}

const CARD_SECTION_LIMIT = 6;
const CARD_SECTION_MAX_LENGTH = 300;

/**
 * Resolve a display label for an IT Glue field: many resources carry a
 * resolved `*Name` string alongside the id, so prefer the name and fall back
 * to `#id`.
 */
function label(name: unknown, id: unknown): string | undefined {
  if (typeof name === "string" && name) return name;
  if (id != null) return `#${id}`;
  return undefined;
}

/**
 * Flatten a section's HTML body to a short plain-text preview. Vendor HTML is
 * untrusted; the card renders this string only ever as a DOM text node, so
 * this strip is about signal (a readable preview), not sanitization.
 */
function htmlToPreview(html: string): string {
  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, CARD_SECTION_MAX_LENGTH);
}

/**
 * Normalize one entry of a document's sectioned body — either an element of
 * the `content` array IT Glue embeds on the document itself, or a resource
 * from the `/documents/:id/relationships/sections` endpoint (deserialized to
 * camelCase by the client).
 */
function toCardSection(entry: unknown): DocumentCard["sections"][number] | null {
  if (typeof entry === "string") {
    const text = htmlToPreview(entry);
    return text ? { text } : null;
  }
  if (!entry || typeof entry !== "object") return null;
  const section = entry as Record<string, unknown>;
  const body = section.content;
  if (typeof body !== "string" || !body) return null;
  const text = htmlToPreview(body);
  if (!text) return null;
  const resourceType = String(
    section.resourceType ?? section["resource-type"] ?? section.resource_type ?? ""
  );
  return /heading/i.test(resourceType) ? { heading: true, text } : { text };
}

/**
 * Build the renderable card from a get_document payload. `doc` may already
 * carry its sectioned body in `content` (IT Glue embeds it on the document
 * resource); otherwise sections are fetched best-effort so the card has a
 * visible content preview.
 */
export async function buildDocumentCard(
  doc: Record<string, unknown>,
  client: Pick<ITGlueClient, "request">
): Promise<DocumentCard | null> {
  if (doc?.id == null || typeof doc.name !== "string" || !doc.name) {
    return null;
  }

  const card: DocumentCard = {
    id: String(doc.id),
    name: doc.name,
    sections: [],
  };

  const organization = label(doc.organizationName, doc.organizationId);
  if (organization) card.organization = organization;
  // Folder names are a separate (tenant-gated) resource — the card shows the
  // raw id rather than fetching the whole folder tree per read.
  if (doc.documentFolderId != null) card.folder = `#${doc.documentFolderId}`;
  if (doc.archived === true) card.archived = true;
  if (doc.createdAt) card.createdAt = String(doc.createdAt);
  if (doc.updatedAt) card.updatedAt = String(doc.updatedAt);

  // A short content preview gives the card its value. Prefer the body IT Glue
  // embeds on the document; fall back to the sections endpoint.
  try {
    let body: unknown = doc.content;
    if (!Array.isArray(body)) {
      const response = await client.request(
        `/documents/${card.id}/relationships/sections`,
        {}
      );
      body = response.data;
    }
    if (Array.isArray(body)) {
      card.sections = body
        .map(toCardSection)
        .filter((s): s is DocumentCard["sections"][number] => s !== null)
        .slice(0, CARD_SECTION_LIMIT);
    }
  } catch {
    // Best-effort: render the card without a preview rather than failing the tool.
  }

  return card;
}
