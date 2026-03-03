import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { htmlToText } from "./utils/html-parsing.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(6, 1000, "UltiPro");

interface UltiProLocation {
  LocalizedDescription?: string | null;
  LocalizedName?: string | null;
  Address?: {
    City?: string | null;
    State?: { Name?: string | null };
    Country?: { Name?: string | null };
  };
}

interface UltiProOpportunity {
  Id?: string;
  Title?: string;
  PostedDate?: string;
  BriefDescription?: string;
  FullTime?: boolean;
  JobCategoryName?: string | null;
  Locations?: UltiProLocation[];
}

interface UltiProSearchResponse {
  opportunities?: UltiProOpportunity[];
  totalCount?: number;
}

function extractBracketedBlockAt(
  html: string,
  startIndex: number,
  openChar: "[" | "{",
  closeChar: "]" | "}"
): string | null {
  if (startIndex < 0) return null;

  let start = html.indexOf(openChar, startIndex);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let isEscaped = false;

  for (let i = start; i < html.length; i += 1) {
    const ch = html[i];

    if (inString) {
      if (isEscaped) {
        isEscaped = false;
      } else if (ch === "\\") {
        isEscaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
      continue;
    }

    if (ch === openChar) depth += 1;
    else if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }

  return null;
}

function findMarkerIndex(html: string, markerPattern: RegExp): number {
  const marker = markerPattern.exec(html);
  return marker ? marker.index : -1;
}

function extractOpportunityTemplate(html: string): string {
  const match = html.match(/opportunityLinkUrl:\s*"([^"]+)"/i);
  return match ? match[1] : "";
}

function extractLoadUrl(html: string): string {
  const match = html.match(/loadUrl:\s*"([^"]+)"/i);
  return match ? match[1] : "";
}

function parseOpportunities(html: string): UltiProOpportunity[] {
  const markers = [
    /featuredOpportunities\s*:/i,
    /initialFeaturedOpportunities\s*:/i,
  ];

  for (const marker of markers) {
    const markerIndex = findMarkerIndex(html, marker);
    const raw = extractBracketedBlockAt(html, markerIndex, "[", "]");
    if (!raw) continue;

    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
    } catch {
      // Try next marker.
    }
  }

  return [];
}

async function fetchOpportunitiesFromLoadUrl(loadUrl: string): Promise<UltiProOpportunity[]> {
  const opportunities: UltiProOpportunity[] = [];
  const seen = new Set<string>();
  const pageSize = 50;
  let skip = 0;
  let totalCount = Number.POSITIVE_INFINITY;

  while (skip < totalCount) {
    await rateLimiter.acquire();
    const response = await fetchWithRetry(loadUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json; charset=utf-8",
        accept: "application/json, text/javascript, */*; q=0.01",
        "x-requested-with": "XMLHttpRequest",
      },
      body: JSON.stringify({
        opportunitySearch: {
          QueryString: "",
          Filters: [],
          Top: pageSize,
          Skip: skip,
        },
      }),
    });

    if (!response.ok) {
      if ([404, 410, 415].includes(response.status)) return [];
      throw new Error(`UltiPro load endpoint error ${response.status} for ${loadUrl}`);
    }

    const payload: UltiProSearchResponse = await response.json();
    const page = Array.isArray(payload.opportunities) ? payload.opportunities : [];
    totalCount = typeof payload.totalCount === "number" ? payload.totalCount : skip + page.length;

    for (const opportunity of page) {
      const key = opportunity.Id ?? `${opportunity.Title ?? ""}|${opportunity.PostedDate ?? ""}`;
      if (seen.has(key)) continue;
      seen.add(key);
      opportunities.push(opportunity);
    }

    if (page.length < pageSize) break;
    skip += pageSize;
  }

  return opportunities;
}

function normalizeLocation(opportunity: UltiProOpportunity): string {
  const first = opportunity.Locations?.[0];
  if (!first) return "";

  if (first.LocalizedDescription) return first.LocalizedDescription;
  if (first.LocalizedName) return first.LocalizedName;

  const cityState = [first.Address?.City, first.Address?.State?.Name].filter(Boolean).join(", ");
  return cityState || first.Address?.Country?.Name || "";
}

export async function fetchUltiProJobs(seedUrl: string, companyName: string): Promise<RawListing[]> {
  await rateLimiter.acquire();
  const response = await fetchWithRetry(seedUrl, { redirect: "follow" });

  if (!response.ok) {
    if ([404, 410].includes(response.status)) return [];
    throw new Error(`UltiPro board error ${response.status} for ${seedUrl}`);
  }

  const html = await response.text();
  const loadUrlRaw = extractLoadUrl(html);
  const loadUrl = loadUrlRaw ? new URL(loadUrlRaw, response.url).toString() : "";
  const apiOpportunities = loadUrl ? await fetchOpportunitiesFromLoadUrl(loadUrl) : [];
  const opportunities = apiOpportunities.length > 0 ? apiOpportunities : parseOpportunities(html);
  if (opportunities.length === 0) return [];

  const template = extractOpportunityTemplate(html);
  const origin = new URL(response.url).origin;

  return opportunities
    .filter((opportunity) => Boolean(opportunity.Id) && Boolean(opportunity.Title?.trim()))
    .map((opportunity): RawListing => {
      const opportunityId = opportunity.Id ?? "";
      const rel = template
        ? template.replace("00000000-0000-0000-0000-000000000000", opportunityId)
        : "";

      const sourceUrl = rel
        ? new URL(rel, response.url).toString()
        : `${origin}/OpportunityDetail?opportunityId=${encodeURIComponent(opportunityId)}`;

      const contractType = opportunity.FullTime === false ? null : "permanent";
      const contractTime = opportunity.FullTime === true ? "full_time" : null;

      return {
        title: opportunity.Title?.trim() ?? "",
        company: companyName,
        location: normalizeLocation(opportunity),
        description: htmlToText(opportunity.BriefDescription ?? ""),
        sourceUrl,
        datePosted: opportunity.PostedDate
          ? new Date(opportunity.PostedDate).toISOString()
          : new Date().toISOString(),
        salaryMin: null,
        salaryMax: null,
        salaryIsPredicted: false,
        contractType,
        contractTime,
        category: opportunity.JobCategoryName ?? null,
        source: "ultipro",
      };
    });
}

export async function ingestFromUltiPro(
  boards: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { seedUrl, companyName } of boards) {
    try {
      const jobs = await fetchUltiProJobs(seedUrl, companyName);
      if (jobs.length > 0) {
        logger.info(`UltiPro: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`UltiPro error for ${companyName} (${seedUrl})`, err);
    }
  }

  logger.info(`UltiPro total: ${listings.length} listings from ${boards.length} companies`);
  return listings;
}
