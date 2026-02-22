import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const LEVER_BASE = "https://api.lever.co/v0/postings";

// Self-imposed rate limit
const rateLimiter = new RateLimiter(10, 1000, "Lever");

// ── Lever API types ──────────────────────────────────────────────────

interface LeverPosting {
  id: string;
  text: string; // Job title
  description: string; // Short description (plain text or light HTML)
  descriptionPlain: string; // Plain text version
  additional: string; // Additional info (HTML)
  additionalPlain: string; // Additional info (plain text)
  categories: {
    team?: string;
    department?: string;
    location?: string;
    commitment?: string; // "Full-time", "Part-time", "Contract", etc.
    allLocations?: string[];
  };
  lists: Array<{
    text: string; // Section heading ("Requirements", "Responsibilities", etc.)
    content: string; // HTML content of the section
  }>;
  hostedUrl: string; // Public URL for the posting
  applyUrl: string;
  createdAt?: number; // Unix timestamp in ms (undocumented, may be absent)
  workplaceType?: string;
  country?: string;
  salaryRange?: {
    min: number;
    max: number;
    currency: string;
    interval: string; // "per-year-salary", etc.
  };
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
 * Probe whether a company slug is valid on Lever.
 * Returns true if the company has postings.
 */
export async function probeLever(companySlug: string): Promise<boolean> {
  try {
    const response = await fetchWithRetry(`${LEVER_BASE}/${companySlug}?limit=1&mode=json`);
    if (!response.ok) return false;
    const data = await response.json();
    return Array.isArray(data) && data.length > 0;
  } catch {
    return false;
  }
}

/**
 * Fetch all postings from a Lever company.
 * Lever paginates via `offset` parameter (returns next offset in response headers or empty array).
 */
export async function fetchLeverPostings(
  companySlug: string,
  companyName: string
): Promise<RawListing[]> {
  const allPostings: LeverPosting[] = [];
  let skip = 0;
  const pageSize = 100;

  while (true) {
    await rateLimiter.acquire();

    const url = `${LEVER_BASE}/${companySlug}?mode=json&limit=${pageSize}&skip=${skip}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      if (response.status === 404) break;
      throw new Error(`Lever API error ${response.status} for ${companySlug}`);
    }

    const postings: LeverPosting[] = await response.json();
    if (!Array.isArray(postings) || postings.length === 0) break;

    allPostings.push(...postings);

    // If we got fewer than the page size, we're done
    if (postings.length < pageSize) break;
    skip += pageSize;
  }

  return allPostings.map((posting): RawListing => {
    // Build full description from all sections
    const parts = [posting.descriptionPlain || htmlToText(posting.description || "")];
    for (const list of posting.lists ?? []) {
      parts.push(`${list.text}:\n${htmlToText(list.content)}`);
    }
    if (posting.additionalPlain || posting.additional) {
      parts.push(posting.additionalPlain || htmlToText(posting.additional));
    }

    const description = parts.filter(Boolean).join("\n\n");

    // Map commitment to contract type/time
    const commitment = posting.categories?.commitment?.toLowerCase() ?? "";
    let contractType: string | null = null;
    let contractTime: string | null = null;
    if (commitment.includes("contract")) contractType = "contract";
    else if (commitment.includes("permanent") || commitment.includes("full")) contractType = "permanent";
    if (commitment.includes("full")) contractTime = "full_time";
    else if (commitment.includes("part")) contractTime = "part_time";

    // Salary
    let salaryMin: number | null = null;
    let salaryMax: number | null = null;
    if (posting.salaryRange && posting.salaryRange.interval?.includes("year")) {
      salaryMin = posting.salaryRange.min;
      salaryMax = posting.salaryRange.max;
    }

    return {
      title: posting.text,
      company: companyName,
      location: posting.categories?.location ?? "",
      description,
      sourceUrl: posting.hostedUrl,
      datePosted: posting.createdAt
        ? new Date(posting.createdAt).toISOString()
        : new Date().toISOString(),
      salaryMin,
      salaryMax,
      salaryIsPredicted: false,
      contractType,
      contractTime,
      category: posting.categories?.team ?? posting.categories?.department ?? null,
      adzunaId: null,
      source: "lever",
    };
  });
}

/**
 * Ingest jobs from multiple Lever companies.
 */
export async function ingestFromLever(
  companies: Array<{ companySlug: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { companySlug, companyName } of companies) {
    try {
      const postings = await fetchLeverPostings(companySlug, companyName);
      if (postings.length > 0) {
        logger.info(`Lever [${companySlug}]: ${postings.length} postings from ${companyName}`);
        listings.push(...postings);
      }
    } catch (err) {
      logger.error(`Lever error for ${companyName} (${companySlug})`, err);
    }
  }

  logger.info(`Lever total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
