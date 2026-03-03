import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { decodeEntities, extractJobPostingJsonLd, extractMetaContent, htmlToText } from "./utils/html-parsing.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(6, 1000, "Jobvite");

function extractCompanySlug(seedUrl: string): string {
  try {
    const parsed = new URL(seedUrl);
    if (parsed.hostname !== "jobs.jobvite.com") return "";
    const first = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!first || first.toLowerCase() === "support") return "";
    return first;
  } catch {
    return "";
  }
}

function extractDetailLinks(html: string, baseUrl: string, companySlug: string): string[] {
  const links = new Set<string>();
  const re = new RegExp(`href=["'](/${companySlug}/job/[^"']+)["']`, "gi");

  for (const match of html.matchAll(re)) {
    try {
      links.add(new URL(match[1], baseUrl).toString());
    } catch {
      // Ignore malformed URL.
    }
  }

  return [...links];
}

function locationFromJsonLd(jobPosting: Record<string, unknown>): string {
  const location = jobPosting.jobLocation;
  if (!location || typeof location !== "object") return "";

  const place = Array.isArray(location) ? location[0] : location;
  if (!place || typeof place !== "object") return "";
  const address = (place as Record<string, unknown>).address as Record<string, unknown> | undefined;
  if (!address) return "";

  const city = String(address.addressLocality ?? "").trim();
  const region = String(address.addressRegion ?? "").trim();
  const country = String(address.addressCountry ?? "").trim();
  return [city, region].filter(Boolean).join(", ") || country;
}

async function fetchJobviteDetail(detailUrl: string, companyName: string): Promise<RawListing | null> {
  await rateLimiter.acquire();
  const response = await fetchWithRetry(detailUrl, { redirect: "follow" });
  if (!response.ok) return null;

  const html = await response.text();
  const posting = extractJobPostingJsonLd(html);
  if (posting) {
    const title = String(posting.title ?? "").trim();
    if (!title) return null;

    const rawDescription = String(posting.description ?? "");
    const employmentType = String(posting.employmentType ?? "").toLowerCase();
    let contractType: string | null = null;
    let contractTime: string | null = null;

    if (employmentType.includes("contract")) contractType = "contract";
    else if (employmentType.includes("full") || employmentType.includes("part") || employmentType.includes("permanent")) {
      contractType = "permanent";
    }
    if (employmentType.includes("full")) contractTime = "full_time";
    else if (employmentType.includes("part")) contractTime = "part_time";

    return {
      title,
      company: companyName,
      location: locationFromJsonLd(posting),
      description: htmlToText(decodeEntities(rawDescription)),
      sourceUrl: String(posting.url ?? response.url),
      datePosted: String(posting.datePosted ?? "").trim()
        ? new Date(String(posting.datePosted)).toISOString()
        : new Date().toISOString(),
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType,
      contractTime,
      category: null,
      source: "jobvite",
    };
  }

  const title = extractMetaContent(html, "og:title");
  const description = extractMetaContent(html, "og:description");
  if (!title) return null;

  return {
    title,
    company: companyName,
    location: "",
    description: htmlToText(description),
    sourceUrl: response.url,
    datePosted: new Date().toISOString(),
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType: null,
    contractTime: null,
    category: null,
    source: "jobvite",
  };
}

export async function fetchJobviteJobs(seedUrl: string, companyName: string): Promise<RawListing[]> {
  const companySlug = extractCompanySlug(seedUrl);
  if (!companySlug) return [];

  const boardUrl = `https://jobs.jobvite.com/${companySlug}/jobs`;
  await rateLimiter.acquire();
  const response = await fetchWithRetry(boardUrl, { redirect: "follow" });

  if (!response.ok) {
    if ([404, 410].includes(response.status)) return [];
    throw new Error(`Jobvite board error ${response.status} for ${boardUrl}`);
  }

  const html = await response.text();
  const detailLinks = extractDetailLinks(html, response.url, companySlug);

  const listings: RawListing[] = [];
  for (const link of detailLinks) {
    try {
      const listing = await fetchJobviteDetail(link, companyName);
      if (listing) listings.push(listing);
    } catch {
      // Skip failed detail.
    }
  }

  return listings;
}

export async function ingestFromJobvite(
  companies: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { seedUrl, companyName } of companies) {
    try {
      const jobs = await fetchJobviteJobs(seedUrl, companyName);
      if (jobs.length > 0) {
        logger.info(`Jobvite: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`Jobvite error for ${companyName} (${seedUrl})`, err);
    }
  }

  logger.info(`Jobvite total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
