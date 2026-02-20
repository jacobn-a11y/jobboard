import { RateLimiter } from "./utils/rate-limiter.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const GH_BASE = "https://boards-api.greenhouse.io/v1/boards";

// Self-imposed rate limit (no official limit, but be respectful)
const rateLimiter = new RateLimiter(10, 1000, "Greenhouse");

// ── Greenhouse API types ─────────────────────────────────────────────

interface GHJob {
  id: number;
  title: string;
  content: string; // Full HTML description (when ?content=true)
  updated_at: string;
  location: { name: string };
  departments: Array<{ name: string }>;
  offices: Array<{ name: string }>;
  absolute_url: string;
  metadata?: Array<{ name: string; value: string | string[] | null }>;
}

interface GHJobsResponse {
  jobs: GHJob[];
  meta: { total: number };
}

// ── HTML → plain text ────────────────────────────────────────────────

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

// ── Public API ───────────────────────────────────────────────────────

/**
 * Probe whether a board_token is valid on Greenhouse.
 * Returns true if the board exists and has at least one job.
 */
export async function probeGreenhouse(boardToken: string): Promise<boolean> {
  try {
    const response = await fetch(`${GH_BASE}/${boardToken}`);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Fetch all jobs from a Greenhouse board.
 * Returns full descriptions (?content=true).
 */
export async function fetchGreenhouseJobs(
  boardToken: string,
  companyName: string
): Promise<RawListing[]> {
  await rateLimiter.acquire();

  const url = `${GH_BASE}/${boardToken}/jobs?content=true`;
  const response = await fetch(url);

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Greenhouse API error ${response.status} for ${boardToken}`);
  }

  const data: GHJobsResponse = await response.json();

  return data.jobs.map((job): RawListing => {
    const location =
      job.location?.name ??
      job.offices?.map((o) => o.name).join(", ") ??
      "";

    return {
      title: job.title,
      company: companyName,
      location,
      description: htmlToText(job.content ?? ""),
      sourceUrl: job.absolute_url,
      datePosted: job.updated_at,
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType: null,
      contractTime: null,
      category: job.departments?.map((d) => d.name).join(", ") ?? null,
      adzunaId: null,
      source: "greenhouse",
    };
  });
}

/**
 * Ingest jobs from multiple Greenhouse boards.
 */
export async function ingestFromGreenhouse(
  boards: Array<{ boardToken: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { boardToken, companyName } of boards) {
    try {
      const jobs = await fetchGreenhouseJobs(boardToken, companyName);
      if (jobs.length > 0) {
        logger.info(`Greenhouse [${boardToken}]: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`Greenhouse error for ${companyName} (${boardToken})`, err);
    }
  }

  logger.info(`Greenhouse total: ${listings.length} listings from ${boards.length} boards`);
  return listings;
}
