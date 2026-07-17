/**
 * Iframe bridge + renderer for the IT Glue document card (MCP Apps, SEP-1865).
 *
 * Runs inside the host's sandboxed iframe. Uses the official MCP Apps client
 * (`App`) to receive the tool result from the host. The card is read-only —
 * IT Glue is a documentation system, so there is no in-card write round-trip.
 *
 * The server attaches a normalized `_card` payload to get_document results
 * (see src/card.builder.ts) so this renderer never needs to resolve ids or
 * strip HTML itself.
 *
 * Rendering uses DOM construction (no innerHTML) — document names and section
 * previews are untrusted vendor data, so text only ever lands in text nodes.
 *
 * White-label: the card is neutral by default (no vendor identity) and applies
 * an injected `window.__BRAND__` override (set by the MCP server via
 * MCP_BRAND_* env vars, or a gateway per-org) so the same card can render in
 * any operator's brand.
 */
import { App } from "@modelcontextprotocol/ext-apps";

interface Brand {
  name?: string;
  logoUrl?: string;
  primaryColor?: string;
  accentColor?: string;
  bg?: string;
  text?: string;
}
declare global {
  interface Window {
    __BRAND__?: Brand;
  }
}

/** Mirror of DocumentCard in src/card.builder.ts — keep in sync. */
interface DocumentCard {
  id: string;
  name: string;
  organization?: string;
  folder?: string;
  archived?: boolean;
  createdAt?: string;
  updatedAt?: string;
  sections: Array<{ heading?: boolean; text: string }>;
}

const brand: Brand = window.__BRAND__ ?? {};
const brandName = brand.name ?? "";

// Apply any injected brand overrides onto the CSS custom properties.
function applyBrand(): void {
  const root = document.documentElement.style;
  if (brand.primaryColor) root.setProperty("--brand-primary", brand.primaryColor);
  if (brand.accentColor) root.setProperty("--brand-accent", brand.accentColor);
  if (brand.bg) root.setProperty("--brand-bg", brand.bg);
  if (brand.text) root.setProperty("--brand-text", brand.text);
}

const app = new App({ name: "IT Glue Document Card", version: "1.0.0" });

/** Create an element with a class and (safe, text-node) children. */
function el(
  tag: string,
  className = "",
  ...children: Array<Node | string | null>
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const child of children) {
    if (child == null) continue;
    node.append(child); // strings become text nodes — never parsed as HTML
  }
  return node;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function field(label: string, value: string | undefined): HTMLElement | null {
  if (!value) return null;
  return el(
    "div",
    "field",
    el("div", "field__label", label),
    el("div", "field__value", value),
  );
}

function badge(text: string | undefined, cls: string): HTMLElement | null {
  return text ? el("span", `badge ${cls}`, text) : null;
}

function sectionEl(s: { heading?: boolean; text: string }): HTMLElement {
  return el("div", s.heading ? "section section--heading" : "section", s.text);
}

function render(doc: DocumentCard): void {
  // Brand identity only renders when a brand was injected — the neutral
  // default shows just the document number/vendor context in the header.
  let brandId: HTMLElement | null = null;
  if (brandName || brand.logoUrl) {
    brandId = el("span", "brandid");
    if (brand.logoUrl) {
      const logo = document.createElement("img");
      logo.src = brand.logoUrl;
      logo.alt = brandName;
      logo.style.display = "inline-block";
      brandId.append(logo);
    }
    if (brandName) brandId.append(el("span", "brand", brandName));
  }

  const sectionsBlock = el(
    "div",
    "sections",
    el("div", "sections__h", `Content preview (${doc.sections.length} sections)`),
  );
  for (const s of doc.sections) sectionsBlock.append(sectionEl(s));

  const body = el(
    "div",
    "card__body",
    el("div", "brandrow", brandId, el("span", "docno", `#${doc.id} · IT Glue`)),
    el("h1", "", doc.name),
    el(
      "div",
      "badges",
      badge("Document", "badge--status"),
      badge(doc.archived ? "Archived" : undefined, "badge--archived"),
    ),
    el(
      "div",
      "grid",
      field("Organization", doc.organization),
      field("Folder", doc.folder),
      field("Created", doc.createdAt && fmtDate(doc.createdAt)),
      field("Updated", doc.updatedAt && fmtDate(doc.updatedAt)),
    ),
    doc.sections.length > 0 ? sectionsBlock : null,
  );

  const root = document.getElementById("root")!;
  root.replaceChildren(el("div", "card", el("div", "card__bar"), body));
}

// itglue-mcp returns the document JSON directly and attaches the normalized
// card to get_document results as _card.
function extractCard(obj: unknown): DocumentCard | null {
  const card = (obj as { _card?: DocumentCard })?._card;
  return card && typeof card.id === "string" && typeof card.name === "string"
    ? card
    : null;
}

applyBrand();

// Must be set before connect() so the initial tool-result isn't missed.
app.ontoolresult = (result: { content?: Array<{ type: string; text?: string }> }) => {
  const payload = (result.content ?? []).find((c) => c.type === "text");
  if (!payload?.text) return;
  try {
    const card = extractCard(JSON.parse(payload.text));
    if (card) render(card);
  } catch {
    /* ignore malformed payloads */
  }
};

app.connect();
