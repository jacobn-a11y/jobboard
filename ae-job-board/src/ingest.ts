import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const ADZUNA_BASE = "https://api.adzuna.com/v1/api/jobs/us/search";
const RESULTS_PER_PAGE = 50;
const MAX_PAGES = 5;

const SEARCH_QUERIES = [
  // Project Management roles
  "project manager architecture",
  "project manager engineering firm",
  "project manager AEC",
  "project director architecture",
  "project engineer design firm",
  "senior project manager construction",
  "project coordinator architecture",
  // Resource Management roles
  "resource manager architecture",
  "resource manager engineering",
  "resource planner AEC",
  "capacity planning manager",
  "workforce planning manager engineering",
  "utilization manager",
  // Operations roles
  "operations manager architecture firm",
  "operations manager engineering",
  "director of operations architecture",
  "studio director architecture",
  "office director engineering",
  "PMO director construction",
];

// Rate limiter: stay well under 250/day free tier
const rateLimiter = new RateLimiter(4, 1000, "Adzuna"); // 4 req/sec

interface AdzunaResult {
  id: string;
  title: string;
  company?: { display_name: string };
  location?: { display_name: string; area?: string[] };
  description: string;
  redirect_url: string;
  created: string;
  salary_min?: number;
  salary_max?: number;
  salary_is_predicted?: string; // "0" = from ad, "1" = Adzuna estimate
  contract_type?: string;
  contract_time?: string;
  category?: { label: string; tag: string };
}

interface AdzunaResponse {
  results: AdzunaResult[];
  count: number;
}

function mapResult(result: AdzunaResult): RawListing {
  return {
    title: result.title,
    company: result.company?.display_name ?? "Unknown",
    location: result.location?.display_name ?? "",
    description: result.description ?? "",
    sourceUrl: result.redirect_url,
    datePosted: result.created,
    salaryMin: result.salary_min ?? null,
    salaryMax: result.salary_max ?? null,
    salaryIsPredicted: result.salary_is_predicted === "1",
    contractType: result.contract_type ?? null,
    contractTime: result.contract_time ?? null,
    category: result.category?.label ?? null,
    adzunaId: result.id ?? null,
    source: "adzuna",
  };
}

async function fetchPage(
  query: string,
  page: number,
  appId: string,
  appKey: string
): Promise<AdzunaResult[]> {
  await rateLimiter.acquire();

  const url = new URL(`${ADZUNA_BASE}/${page}`);
  url.searchParams.set("app_id", appId);
  url.searchParams.set("app_key", appKey);
  url.searchParams.set("results_per_page", String(RESULTS_PER_PAGE));
  url.searchParams.set("what", query);
  url.searchParams.set("content-type", "application/json");

  const response = await fetchWithRetry(url.toString());
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Adzuna API error ${response.status}: ${text}`);
  }

  const data: AdzunaResponse = await response.json();
  return data.results ?? [];
}

export async function ingestFromAdzuna(
  limit?: number
): Promise<RawListing[]> {
  const appId = process.env.ADZUNA_APP_ID;
  const appKey = process.env.ADZUNA_APP_KEY;

  if (!appId || !appKey) {
    logger.warn("ADZUNA_APP_ID or ADZUNA_APP_KEY not set — returning empty results");
    return [];
  }

  const seen = new Set<string>();
  const listings: RawListing[] = [];

  for (const query of SEARCH_QUERIES) {
    logger.info(`Ingesting: "${query}"`);

    for (let page = 1; page <= MAX_PAGES; page++) {
      try {
        const results = await fetchPage(query, page, appId, appKey);
        if (results.length === 0) break;

        for (const result of results) {
          const dedup = result.id ?? result.redirect_url;
          if (!dedup || seen.has(dedup)) continue;
          seen.add(dedup);
          listings.push(mapResult(result));
        }

        logger.debug(
          `  Page ${page}: ${results.length} results, ${listings.length} total unique`
        );

        // If we got fewer results than requested, no more pages
        if (results.length < RESULTS_PER_PAGE) break;
      } catch (err) {
        logger.error(`Error fetching "${query}" page ${page}`, err);
        break; // Move to next query on error
      }

      if (limit && listings.length >= limit) break;
    }

    if (limit && listings.length >= limit) break;
  }

  const final = limit ? listings.slice(0, limit) : listings;
  logger.info(`Ingestion complete: ${final.length} unique listings`);
  return final;
}
