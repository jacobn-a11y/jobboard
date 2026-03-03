import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { decodeEntities, extractMetaContent, extractTextByClass, htmlToText } from "./utils/html-parsing.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(6, 1000, "TriNetHire");

function extractCompanySlug(seedUrl: string): string {
  try {
    const parsed = new URL(seedUrl);
    if (parsed.hostname !== "app.trinethire.com") return "";
    const parts = parsed.pathname.split("/").filter(Boolean);
    const companiesIndex = parts.indexOf("companies");
    if (companiesIndex < 0 || !parts[companiesIndex + 1]) return "";
    return parts[companiesIndex + 1];
  } catch {
    return "";
  }
}

function extractDetailLinks(html: string, baseUrl: string, companySlug: string): string[] {
  const links = new Set<string>();
  const re = new RegExp(`href=["'](/companies/${companySlug}/jobs/[0-9]+-[^"']+)["']`, "gi");

  for (const match of html.matchAll(re)) {
    try {
      links.add(new URL(match[1], baseUrl).toString());
    } catch {
      // Ignore malformed URL.
    }
  }

  return [...links];
}

function parseLocationFromMeta(html: string): string {
  const listBlockMatch = html.match(/<ul[^>]*class=["'][^"']*job-meta[^"']*["'][^>]*>([\s\S]*?)<\/ul>/i);
  if (!listBlockMatch) return "";

  const liMatches = [...listBlockMatch[1].matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
  for (const li of liMatches) {
    const text = htmlToText(li[1]).trim();
    if (!text) continue;
    if (!text.toLowerCase().startsWith("type:") && !text.toLowerCase().startsWith("min. experience:")) {
      return text;
    }
  }

  return "";
}

function parseContractInfo(html: string): { contractType: string | null; contractTime: string | null } {
  const typeMatch = html.match(/<li>\s*<strong>\s*Type:\s*<\/strong>\s*([^<]+)<\/li>/i);
  const type = typeMatch ? decodeEntities(typeMatch[1]).trim().toLowerCase() : "";

  let contractType: string | null = null;
  let contractTime: string | null = null;

  if (type.includes("contract")) contractType = "contract";
  else if (type.includes("full") || type.includes("part") || type.includes("permanent")) {
    contractType = "permanent";
  }
  if (type.includes("full")) contractTime = "full_time";
  else if (type.includes("part")) contractTime = "part_time";

  return { contractType, contractTime };
}

async function fetchTriNetDetail(detailUrl: string, companyName: string): Promise<RawListing | null> {
  await rateLimiter.acquire();
  const response = await fetchWithRetry(detailUrl, { redirect: "follow" });
  if (!response.ok) return null;

  const html = await response.text();
  const title = extractTextByClass(html, "job-name") || extractMetaContent(html, "og:title");
  const descriptionHtml = extractTextByClass(html, "job-descr");
  const ogDescription = extractMetaContent(html, "og:description");
  const description = descriptionHtml || htmlToText(ogDescription);

  if (!title) return null;
  const { contractType, contractTime } = parseContractInfo(html);

  return {
    title,
    company: companyName,
    location: parseLocationFromMeta(html),
    description,
    sourceUrl: response.url,
    datePosted: new Date().toISOString(),
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType,
    contractTime,
    category: null,
    source: "trinethire",
  };
}

export async function fetchTriNetHireJobs(seedUrl: string, companyName: string): Promise<RawListing[]> {
  const companySlug = extractCompanySlug(seedUrl);
  if (!companySlug) return [];

  const boardUrl = `https://app.trinethire.com/companies/${companySlug}/jobs`;
  await rateLimiter.acquire();
  const response = await fetchWithRetry(boardUrl, { redirect: "follow" });

  if (!response.ok) {
    if ([404, 410].includes(response.status)) return [];
    throw new Error(`TriNet Hire board error ${response.status} for ${boardUrl}`);
  }

  const html = await response.text();
  const detailLinks = extractDetailLinks(html, response.url, companySlug);

  const listings: RawListing[] = [];
  for (const link of detailLinks) {
    try {
      const listing = await fetchTriNetDetail(link, companyName);
      if (listing) listings.push(listing);
    } catch {
      // Skip failed detail.
    }
  }

  return listings;
}

export async function ingestFromTriNetHire(
  companies: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { seedUrl, companyName } of companies) {
    try {
      const jobs = await fetchTriNetHireJobs(seedUrl, companyName);
      if (jobs.length > 0) {
        logger.info(`TriNet Hire: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`TriNet Hire error for ${companyName} (${seedUrl})`, err);
    }
  }

  logger.info(`TriNet Hire total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
