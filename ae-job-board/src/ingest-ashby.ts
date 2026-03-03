import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const ASHBY_BASE = "https://api.ashbyhq.com/posting-api/job-board";
const rateLimiter = new RateLimiter(10, 1000, "Ashby");

interface AshbyCompensation {
  compensationType?: string;
  interval?: string;
  minValue?: number | null;
  maxValue?: number | null;
  currencyCode?: string;
}

interface AshbyJob {
  id: string;
  title: string;
  department?: string;
  team?: string;
  employmentType?: string;
  location?: string;
  publishedAt?: string;
  jobUrl?: string;
  applyUrl?: string;
  descriptionHtml?: string;
  descriptionPlain?: string;
  compensation?: {
    summaryComponents?: AshbyCompensation[];
  };
}

interface AshbyResponse {
  jobs?: AshbyJob[];
}

function htmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/?(p|div|li|h[1-6]|tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function extractAnnualSalary(job: AshbyJob): { min: number | null; max: number | null } {
  const components = job.compensation?.summaryComponents ?? [];
  for (const comp of components) {
    const type = (comp.compensationType ?? "").toLowerCase();
    const interval = (comp.interval ?? "").toLowerCase();
    const isSalary = type.includes("salary");
    const isAnnual = interval.includes("year");
    if (!isSalary || !isAnnual) continue;

    const min = typeof comp.minValue === "number" ? comp.minValue : null;
    const max = typeof comp.maxValue === "number" ? comp.maxValue : null;
    if (min || max) {
      return { min, max };
    }
  }

  return { min: null, max: null };
}

export async function fetchAshbyJobs(
  organization: string,
  companyName: string
): Promise<RawListing[]> {
  await rateLimiter.acquire();

  const url = `${ASHBY_BASE}/${organization}?includeCompensation=true`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Ashby API error ${response.status} for ${organization}`);
  }

  const data: AshbyResponse = await response.json();
  const jobs = data.jobs ?? [];

  return jobs.map((job): RawListing => {
    const salary = extractAnnualSalary(job);
    const employment = (job.employmentType ?? "").toLowerCase();

    let contractType: string | null = null;
    if (employment.includes("contract")) contractType = "contract";
    else if (employment.includes("full") || employment.includes("part") || employment.includes("permanent")) {
      contractType = "permanent";
    }

    let contractTime: string | null = null;
    if (employment.includes("full")) contractTime = "full_time";
    else if (employment.includes("part")) contractTime = "part_time";

    return {
      title: job.title,
      company: companyName,
      location: job.location ?? "",
      description: job.descriptionPlain || htmlToText(job.descriptionHtml ?? ""),
      sourceUrl: job.jobUrl || job.applyUrl || `https://jobs.ashbyhq.com/${organization}/${job.id}`,
      datePosted: job.publishedAt || new Date().toISOString(),
      salaryMin: salary.min,
      salaryMax: salary.max,
      salaryIsPredicted: false,
      contractType,
      contractTime,
      category: job.department || job.team || null,
      source: "ashby",
    };
  });
}

export async function ingestFromAshby(
  boards: Array<{ organization: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { organization, companyName } of boards) {
    try {
      const jobs = await fetchAshbyJobs(organization, companyName);
      if (jobs.length > 0) {
        logger.info(`Ashby [${organization}]: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`Ashby error for ${companyName} (${organization})`, err);
    }
  }

  logger.info(`Ashby total: ${listings.length} listings from ${boards.length} boards`);
  return listings;
}
