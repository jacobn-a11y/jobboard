import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(8, 1000, "JobScore");

function decodeEntities(input: string): string {
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

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr|ul|ol)[^>]*>/gi, "\n")
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

function getHrefByRel(block: string, rel: string): string {
  const re = new RegExp(`<link[^>]*rel=["']${rel}["'][^>]*href=["']([^"']+)["']`, "i");
  const match = block.match(re);
  return match ? decodeEntities(match[1]) : "";
}

function getCategoryTerm(block: string, kind: "location" | "department" | "job_type"): string {
  const re = new RegExp(
    `<category[^>]*scheme=["'][^"']*#${kind}["'][^>]*term=["']([^"']+)["']`,
    "i"
  );
  const match = block.match(re);
  return match ? decodeEntities(match[1]) : "";
}

function mapEmployment(jobType: string): { contractType: string | null; contractTime: string | null } {
  const lower = jobType.toLowerCase();

  let contractType: string | null = null;
  if (lower.includes("contract")) contractType = "contract";
  else if (lower.includes("full") || lower.includes("part") || lower.includes("permanent") || lower.includes("intern")) {
    contractType = "permanent";
  }

  let contractTime: string | null = null;
  if (lower.includes("full")) contractTime = "full_time";
  else if (lower.includes("part") || lower.includes("intern")) contractTime = "part_time";

  return { contractType, contractTime };
}

export async function fetchJobScoreJobs(
  companySlug: string,
  companyName: string
): Promise<RawListing[]> {
  await rateLimiter.acquire();

  const feedUrl = `https://careers.jobscore.com/jobs/${companySlug}/feed.atom`;
  const response = await fetchWithRetry(feedUrl);

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`JobScore feed error ${response.status} for ${companySlug}`);
  }

  const xml = await response.text();
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => m[1]);

  return entries.map((entry): RawListing => {
    const rawTitle = getTagValue(entry, "title");
    const rawContent = getTagValue(entry, "content");
    const updated = getTagValue(entry, "updated");
    const altLink = getHrefByRel(entry, "alternate");
    const applyLink = getHrefByRel(entry, "tag:jobscore.com/apply_url");

    const title = decodeEntities(stripCDATA(rawTitle));
    const contentHtml = decodeEntities(stripCDATA(rawContent));
    const description = htmlToText(contentHtml);

    const location = getCategoryTerm(entry, "location");
    const department = getCategoryTerm(entry, "department");
    const jobType = getCategoryTerm(entry, "job_type");
    const employment = mapEmployment(jobType);

    let sourceUrl = altLink || applyLink || "";
    if (sourceUrl) {
      try {
        const parsed = new URL(sourceUrl);
        parsed.search = "";
        sourceUrl = parsed.toString();
      } catch {
        // Keep original sourceUrl
      }
    }

    return {
      title,
      company: companyName,
      location,
      description,
      sourceUrl,
      datePosted: updated || new Date().toISOString(),
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType: employment.contractType,
      contractTime: employment.contractTime,
      category: department || null,
      source: "jobscore",
    };
  });
}

export async function ingestFromJobScore(
  companies: Array<{ companySlug: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { companySlug, companyName } of companies) {
    try {
      const jobs = await fetchJobScoreJobs(companySlug, companyName);
      if (jobs.length > 0) {
        logger.info(`JobScore [${companySlug}]: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`JobScore error for ${companyName} (${companySlug})`, err);
    }
  }

  logger.info(`JobScore total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
