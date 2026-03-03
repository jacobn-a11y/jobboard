export function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#x2F;/g, "/")
    .replace(/&nbsp;/g, " ");
}

export function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr|ul|ol|span|table|tbody|thead|section|article)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function stripCDATA(input: string): string {
  const match = input.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return match ? match[1] : input;
}

function coerceObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object") return null;
  return value as Record<string, unknown>;
}

function isJobPostingNode(node: Record<string, unknown>): boolean {
  const type = node["@type"];
  if (Array.isArray(type)) {
    return type.some((entry) => String(entry).toLowerCase() === "jobposting");
  }
  return String(type ?? "").toLowerCase() === "jobposting";
}

function findJobPostingInJsonLd(value: unknown): Record<string, unknown> | null {
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findJobPostingInJsonLd(item);
      if (found) return found;
    }
    return null;
  }

  const node = coerceObject(value);
  if (!node) return null;
  if (isJobPostingNode(node)) return node;

  const graph = node["@graph"];
  if (graph) {
    const inGraph = findJobPostingInJsonLd(graph);
    if (inGraph) return inGraph;
  }

  for (const child of Object.values(node)) {
    const found = findJobPostingInJsonLd(child);
    if (found) return found;
  }

  return null;
}

export function extractJobPostingJsonLd(html: string): Record<string, unknown> | null {
  const scripts = [...html.matchAll(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  for (const script of scripts) {
    const raw = decodeEntities(stripCDATA(script[1].trim()));
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      const posting = findJobPostingInJsonLd(parsed);
      if (posting) return posting;
    } catch {
      // Skip malformed script block.
    }
  }

  return null;
}

export function extractMetaContent(html: string, propertyOrName: string): string {
  const escaped = propertyOrName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<meta[^>]*(?:property|name)=["']${escaped}["'][^>]*content=["']([\\s\\S]*?)["'][^>]*>`,
    "i"
  );
  const match = html.match(re);
  return match ? decodeEntities(match[1].trim()) : "";
}

export function extractTextByClass(html: string, className: string): string {
  const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `<([a-z0-9]+)[^>]*class=["'][^"']*${escaped}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`,
    "i"
  );
  const match = html.match(re);
  return match ? htmlToText(decodeEntities(match[2])) : "";
}
