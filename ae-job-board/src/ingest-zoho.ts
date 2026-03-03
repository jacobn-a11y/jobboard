import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(6, 1000, "ZohoRecruit");

function decodeEntities(input: string): string {
  return input
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr|ul|ol|span)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function stripCDATA(input: string): string {
  const match = input.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  return match ? match[1] : input;
}

function getTagValue(block: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = block.match(re);
  return match ? match[1].trim() : "";
}

function extractFeedPath(pageHtml: string): string {
  const match = pageHtml.match(/(?:\/recruit\/)?downloadrssfeed\?[^"'\s<]+/i);
  if (!match) return "";

  const raw = decodeEntities(match[0]);
  if (raw.startsWith("/")) return raw;
  if (raw.startsWith("recruit/")) return `/${raw}`;
  return `/recruit/${raw}`;
}

async function resolveZohoFeedUrl(companySlug: string, seedUrl: string): Promise<string> {
  const candidates = new Set<string>();

  if (seedUrl) candidates.add(seedUrl);
  candidates.add(`https://${companySlug}.zohorecruit.com/careers?iframe=true`);
  candidates.add(`https://${companySlug}.zohorecruit.com/jobs/Careers?iframe=true`);

  for (const url of candidates) {
    try {
      await rateLimiter.acquire();
      const res = await fetchWithRetry(url);
      if (!res.ok) continue;
      const html = await res.text();
      const path = extractFeedPath(html);
      if (!path) continue;

      const origin = new URL(url).origin;
      return `${origin}${path}`;
    } catch {
      // Try next candidate.
    }
  }

  return "";
}

function extractCategory(descriptionHtml: string): string | null {
  const match = descriptionHtml.match(/Category:\s*([^<]+)/i);
  return match ? decodeEntities(match[1]).trim() : null;
}

function extractLocation(descriptionHtml: string): string {
  const match = descriptionHtml.match(/Location:\s*([^<]+)/i);
  return match ? decodeEntities(match[1]).trim() : "";
}

export async function fetchZohoJobs(
  companySlug: string,
  seedUrl: string,
  companyName: string
): Promise<RawListing[]> {
  const feedUrl = await resolveZohoFeedUrl(companySlug, seedUrl);
  if (!feedUrl) return [];

  await rateLimiter.acquire();
  const response = await fetchWithRetry(feedUrl);

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Zoho RSS error ${response.status} for ${companySlug}`);
  }

  const xml = await response.text();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map((m) => m[1]);

  return items.map((item): RawListing => {
    const title = decodeEntities(stripCDATA(getTagValue(item, "title")));
    const link = decodeEntities(getTagValue(item, "link"));
    const rawDescription = decodeEntities(stripCDATA(getTagValue(item, "description")));
    const pubDate = decodeEntities(getTagValue(item, "pubDate"));

    const location = extractLocation(rawDescription);
    const category = extractCategory(rawDescription);
    const description = htmlToText(rawDescription);

    return {
      title,
      company: companyName,
      location,
      description,
      sourceUrl: link,
      datePosted: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType: null,
      contractTime: null,
      category,
      source: "zoho",
    };
  });
}

export async function ingestFromZoho(
  companies: Array<{ companySlug: string; seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { companySlug, seedUrl, companyName } of companies) {
    try {
      const jobs = await fetchZohoJobs(companySlug, seedUrl, companyName);
      if (jobs.length > 0) {
        logger.info(`Zoho Recruit [${companySlug}]: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`Zoho Recruit error for ${companyName} (${companySlug})`, err);
    }
  }

  logger.info(`Zoho Recruit total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
