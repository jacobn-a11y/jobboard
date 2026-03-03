import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { mapWithConcurrency } from "./utils/concurrency.ts";
import { decodeEntities, extractJobPostingJsonLd, extractMetaContent, htmlToText } from "./utils/html-parsing.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(6, 1000, "Paylocity");
const INGEST_CONCURRENCY = Number(process.env.PAYLOCITY_INGEST_CONCURRENCY ?? "8");

interface PaylocityJobLocation {
  Name?: string;
  City?: string;
  State?: string;
  Country?: string;
}

interface PaylocityJob {
  JobId?: number;
  JobTitle?: string;
  LocationName?: string;
  PublishedDate?: string;
  HiringDepartment?: string | null;
  JobLocation?: PaylocityJobLocation;
}

interface PaylocityPageData {
  Jobs?: PaylocityJob[];
  ModuleId?: string | number;
}

function parseISODate(value: string | undefined): string {
  if (!value?.trim()) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

function extractJsonObjectByMarker(html: string, marker: string): string | null {
  const markerIndex = html.indexOf(marker);
  if (markerIndex < 0) return null;

  let start = html.indexOf("{", markerIndex);
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

    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return html.slice(start, i + 1);
      }
    }
  }

  return null;
}

function parsePageData(html: string): PaylocityPageData | null {
  const raw = extractJsonObjectByMarker(html, "window.pageData");
  if (!raw) return null;

  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function normalizeLocation(job: PaylocityJob): string {
  if (job.LocationName?.trim()) return job.LocationName.trim();
  const cityState = [job.JobLocation?.City, job.JobLocation?.State].filter(Boolean).join(", ");
  return cityState || job.JobLocation?.Name || "";
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

function contractFromEmploymentType(employmentType: string): { contractType: string | null; contractTime: string | null } {
  const lower = employmentType.toLowerCase();
  let contractType: string | null = null;
  let contractTime: string | null = null;

  if (lower.includes("contract")) contractType = "contract";
  else if (lower.includes("full") || lower.includes("part") || lower.includes("permanent")) {
    contractType = "permanent";
  }
  if (lower.includes("full")) contractTime = "full_time";
  else if (lower.includes("part")) contractTime = "part_time";

  return { contractType, contractTime };
}

function parseDetailListing(html: string, sourceUrl: string, companyName: string): RawListing | null {
  const posting = extractJobPostingJsonLd(html);
  if (posting) {
    const title = String(posting.title ?? "").trim();
    if (!title) return null;

    const rawDescription = String(posting.description ?? "");
    const canonicalUrl = String(posting.url ?? "").trim() || sourceUrl;
    const datePosted = parseISODate(String(posting.datePosted ?? ""));
    const { contractType, contractTime } = contractFromEmploymentType(String(posting.employmentType ?? ""));

    return {
      title,
      company: companyName,
      location: locationFromJsonLd(posting),
      description: htmlToText(decodeEntities(rawDescription)),
      sourceUrl: canonicalUrl,
      datePosted,
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType,
      contractTime,
      category: null,
      source: "paylocity",
    };
  }

  const title = extractMetaContent(html, "og:title");
  if (!title) return null;

  return {
    title,
    company: companyName,
    location: "",
    description: htmlToText(extractMetaContent(html, "og:description")),
    sourceUrl,
    datePosted: new Date().toISOString(),
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType: null,
    contractTime: null,
    category: null,
    source: "paylocity",
  };
}

export async function fetchPaylocityJobs(seedUrl: string, companyName: string): Promise<RawListing[]> {
  await rateLimiter.acquire();
  const response = await fetchWithRetry(seedUrl, { redirect: "follow" });

  if (!response.ok) {
    if ([404, 410].includes(response.status)) return [];
    throw new Error(`Paylocity page error ${response.status} for ${seedUrl}`);
  }

  const html = await response.text();
  const pageData = parsePageData(html);
  const jobs = pageData?.Jobs ?? [];
  if (jobs.length === 0) {
    const fallback = parseDetailListing(html, response.url, companyName);
    return fallback ? [fallback] : [];
  }

  const moduleId = pageData?.ModuleId ? String(pageData.ModuleId) : "";
  const origin = new URL(response.url).origin;

  return jobs
    .filter((job) => Boolean(job.JobId) && Boolean(job.JobTitle?.trim()))
    .map((job): RawListing => {
      const jobId = String(job.JobId);
      const detailBase = `${origin}/Recruiting/Jobs/Details/${jobId}`;
      const sourceUrl = moduleId ? `${detailBase}?moduleId=${encodeURIComponent(moduleId)}` : detailBase;

      return {
        title: job.JobTitle?.trim() ?? "",
        company: companyName,
        location: normalizeLocation(job),
        description: "",
        sourceUrl,
        datePosted: parseISODate(job.PublishedDate),
        salaryMin: null,
        salaryMax: null,
        salaryIsPredicted: false,
        contractType: null,
        contractTime: null,
        category: job.HiringDepartment ?? null,
        source: "paylocity",
      };
    });
}

export async function ingestFromPaylocity(
  boards: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const groups = await mapWithConcurrency(
    boards,
    INGEST_CONCURRENCY,
    async ({ seedUrl, companyName }) => {
      try {
        const jobs = await fetchPaylocityJobs(seedUrl, companyName);
        if (jobs.length > 0) {
          logger.info(`Paylocity: ${jobs.length} jobs from ${companyName}`);
        }
        return jobs;
      } catch (err) {
        logger.error(`Paylocity error for ${companyName} (${seedUrl})`, err);
        return [] as RawListing[];
      }
    }
  );

  for (const jobs of groups) {
    listings.push(...jobs);
  }

  logger.info(`Paylocity total: ${listings.length} listings from ${boards.length} companies`);
  return listings;
}
