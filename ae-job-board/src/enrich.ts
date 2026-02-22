import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { CompanyEnrichment, ENRRanking } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "../data/enrichment-cache.json");
const ENR_PATH = join(__dirname, "../data/enr-rankings.json");
const CACHE_TTL_DAYS = 30;

const PDL_BASE = "https://api.peopledatalabs.com/v5/company/enrich";

// 10 req/min for PDL free tier
const rateLimiter = new RateLimiter(10, 60_000, "PDL");

// ── Cache ────────────────────────────────────────────────────────────

type EnrichmentCache = Record<string, CompanyEnrichment>;

function loadCache(): EnrichmentCache {
  if (!existsSync(CACHE_PATH)) return {};
  try {
    return JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    return {};
  }
}

function saveCache(cache: EnrichmentCache): void {
  writeFileSync(CACHE_PATH, JSON.stringify(cache, null, 2));
}

function isCacheValid(entry: CompanyEnrichment): boolean {
  const fetchedAt = new Date(entry.fetchedAt).getTime();
  const now = Date.now();
  return now - fetchedAt < CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
}

// ── ENR Rankings ─────────────────────────────────────────────────────

let enrRankings: ENRRanking[] = [];
try {
  enrRankings = JSON.parse(readFileSync(ENR_PATH, "utf-8"));
} catch {
  logger.warn("enr-rankings.json not found");
}

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]|(\b(inc|llc|corp|lp|llp|ltd|group|co|pc|pllc|associates)\b)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function lookupENRRank(companyName: string): number | null {
  const normalized = normalizeName(companyName);
  for (const entry of enrRankings) {
    const entryNorm = normalizeName(entry.firm);
    if (entryNorm === normalized || normalized.includes(entryNorm) || entryNorm.includes(normalized)) {
      return entry.rank;
    }
  }
  return null;
}

// ── Employee count mapping ───────────────────────────────────────────

function mapEmployeeCount(count: number | null): string {
  if (!count) return "";
  if (count < 50) return "1–50 employees";
  if (count < 200) return "50–200 employees";
  if (count < 500) return "200–500 employees";
  if (count < 1000) return "500–1,000 employees";
  if (count < 5000) return "1,000–5,000 employees";
  return "5,000+ employees";
}

// ── PDL enrichment ───────────────────────────────────────────────────

async function fetchFromPDL(
  companyName: string,
  apiKey: string
): Promise<CompanyEnrichment | null> {
  await rateLimiter.acquire();

  const url = new URL(PDL_BASE);
  url.searchParams.set("name", companyName);

  const response = await fetchWithRetry(url.toString(), {
    headers: {
      "X-Api-Key": apiKey,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    if (response.status === 404) return null;
    const text = await response.text();
    throw new Error(`PDL API error ${response.status}: ${text}`);
  }

  const data = await response.json();

  return {
    employeeCount: mapEmployeeCount(data.employee_count),
    industry: data.industry ?? "",
    hq:
      [data.location?.locality, data.location?.region]
        .filter(Boolean)
        .join(", ") || "",
    summary: data.summary ?? "",
    founded: data.founded ? String(data.founded) : "",
    companyType: data.type ?? "",
    fetchedAt: new Date().toISOString(),
  };
}

// ── Public API ───────────────────────────────────────────────────────

export async function enrichCompany(
  companyName: string
): Promise<CompanyEnrichment | null> {
  const cache = loadCache();
  const cacheKey = normalizeName(companyName);

  // Check cache
  if (cache[cacheKey] && isCacheValid(cache[cacheKey])) {
    logger.debug(`Enrichment cache hit: ${companyName}`);
    return cache[cacheKey];
  }

  const apiKey = process.env.PDL_API_KEY;
  if (!apiKey) {
    logger.debug("PDL_API_KEY not set — skipping enrichment");
    return null;
  }

  try {
    const enrichment = await fetchFromPDL(companyName, apiKey);
    if (enrichment) {
      cache[cacheKey] = enrichment;
      saveCache(cache);
      logger.debug(`Enriched: ${companyName}`);
    }
    return enrichment;
  } catch (err) {
    logger.error(`Enrichment failed for ${companyName}`, err);
    return null;
  }
}

export async function enrichCompanies(
  companyNames: string[]
): Promise<Map<string, CompanyEnrichment | null>> {
  const unique = [...new Set(companyNames)];
  const results = new Map<string, CompanyEnrichment | null>();

  logger.info(`Enriching ${unique.length} unique companies`);

  for (const name of unique) {
    const enrichment = await enrichCompany(name);
    results.set(name, enrichment);
  }

  return results;
}
