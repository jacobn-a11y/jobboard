import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { mapWithConcurrency } from "./utils/concurrency.ts";
import type { RawListing } from "./utils/types.ts";

const WORKABLE_WIDGET_BASE = "https://apply.workable.com/api/v1/widget/accounts";
const rateLimiter = new RateLimiter(10, 1000, "Workable");
const INGEST_CONCURRENCY = Number(process.env.WORKABLE_INGEST_CONCURRENCY ?? "8");

interface WorkableJobLocation {
  city?: string;
  region?: string;
  country?: string;
}

interface WorkableJob {
  title: string;
  shortcode: string;
  employment_type?: string;
  telecommuting?: boolean;
  department?: string | null;
  url?: string;
  shortlink?: string;
  application_url?: string;
  published_on?: string;
  created_at?: string;
  country?: string;
  city?: string;
  state?: string;
  description?: string;
  locations?: WorkableJobLocation[];
}

interface WorkableResponse {
  jobs?: WorkableJob[];
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

function parseAccountSlugFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "apply.workable.com") return "";
    const first = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
    if (!first || first === "j" || first === "jobs" || first === "api") return "";
    return first;
  } catch {
    return "";
  }
}

async function resolveWorkableSlug(seedUrl: string): Promise<string> {
  // First try the URL directly.
  const direct = parseAccountSlugFromUrl(seedUrl);
  if (direct) return direct;

  // For /j/{shortcode} links, Workable redirects to /{account}/j/{shortcode}.
  try {
    const head = await fetchWithRetry(seedUrl, { method: "HEAD", redirect: "follow" });
    const fromHead = parseAccountSlugFromUrl(head.url);
    if (fromHead) return fromHead;
  } catch {
    // Fall through.
  }

  try {
    const get = await fetchWithRetry(seedUrl, { method: "GET", redirect: "follow" });
    const fromGet = parseAccountSlugFromUrl(get.url);
    if (fromGet) return fromGet;
  } catch {
    // Ignore and return empty below.
  }

  return "";
}

export async function fetchWorkableJobs(
  accountSlug: string,
  companyName: string
): Promise<RawListing[]> {
  await rateLimiter.acquire();

  const url = `${WORKABLE_WIDGET_BASE}/${accountSlug}?details=true`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Workable API error ${response.status} for ${accountSlug}`);
  }

  const data: WorkableResponse = await response.json();
  const jobs = data.jobs ?? [];

  return jobs.map((job): RawListing => {
    const location = [job.city, job.state].filter(Boolean).join(", ") || job.country || "";
    const employment = (job.employment_type ?? "").toLowerCase();

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
      location,
      description: htmlToText(job.description ?? ""),
      sourceUrl: job.url || job.shortlink || `https://apply.workable.com/${accountSlug}/j/${job.shortcode}`,
      datePosted: job.published_on
        ? new Date(job.published_on).toISOString()
        : job.created_at
          ? new Date(job.created_at).toISOString()
          : new Date().toISOString(),
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType,
      contractTime,
      category: job.department || null,
      source: "workable",
    };
  });
}

export async function ingestFromWorkable(
  boards: Array<{ accountSlug?: string; seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const groups = await mapWithConcurrency(
    boards,
    INGEST_CONCURRENCY,
    async (board) => {
      try {
        const accountSlug = board.accountSlug || (await resolveWorkableSlug(board.seedUrl));
        if (!accountSlug) {
          logger.warn(`Workable: could not resolve account slug for ${board.companyName} (${board.seedUrl})`);
          return [] as RawListing[];
        }

        const jobs = await fetchWorkableJobs(accountSlug, board.companyName);
        if (jobs.length > 0) {
          logger.info(`Workable [${accountSlug}]: ${jobs.length} jobs from ${board.companyName}`);
        }
        return jobs;
      } catch (err) {
        logger.error(`Workable error for ${board.companyName} (${board.seedUrl})`, err);
        return [] as RawListing[];
      }
    }
  );

  for (const jobs of groups) {
    listings.push(...jobs);
  }

  logger.info(`Workable total: ${listings.length} listings from ${boards.length} companies`);
  return listings;
}
