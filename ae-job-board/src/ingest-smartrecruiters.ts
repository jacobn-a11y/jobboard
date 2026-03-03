import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { mapWithConcurrency } from "./utils/concurrency.ts";
import type { RawListing } from "./utils/types.ts";

const SMART_BASE = "https://api.smartrecruiters.com/v1/companies";
const rateLimiter = new RateLimiter(8, 1000, "SmartRecruiters");
const COMPANY_INGEST_CONCURRENCY = Number(process.env.SMARTRECRUITERS_COMPANY_CONCURRENCY ?? "5");
const DETAIL_FETCH_CONCURRENCY = Number(process.env.SMARTRECRUITERS_DETAIL_CONCURRENCY ?? "8");

interface SmartPostingListItem {
  id: string;
}

interface SmartPostingListResponse {
  content?: SmartPostingListItem[];
  offset?: number;
  limit?: number;
  totalFound?: number;
}

interface SmartPostingDetail {
  id: string;
  name: string;
  releasedDate?: string;
  location?: {
    fullLocation?: string;
    city?: string;
    region?: string;
    country?: string;
  };
  typeOfEmployment?: {
    label?: string;
  };
  department?: {
    label?: string;
  };
  refNumber?: string;
  applyUrl?: string;
  canonicalPath?: string;
  jobAd?: {
    sections?: Record<string, { title?: string; text?: string }>;
  };
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

function mapEmployment(label: string): { contractType: string | null; contractTime: string | null } {
  const lower = label.toLowerCase();

  let contractType: string | null = null;
  if (lower.includes("contract")) contractType = "contract";
  else if (lower.includes("full") || lower.includes("part") || lower.includes("permanent")) {
    contractType = "permanent";
  }

  let contractTime: string | null = null;
  if (lower.includes("full")) contractTime = "full_time";
  else if (lower.includes("part")) contractTime = "part_time";

  return { contractType, contractTime };
}

function buildDescription(detail: SmartPostingDetail): string {
  const sections = detail.jobAd?.sections ?? {};
  const parts: string[] = [];

  for (const section of Object.values(sections)) {
    const heading = section.title ? `${section.title}:\n` : "";
    const text = htmlToText(section.text ?? "");
    if (text) parts.push(`${heading}${text}`.trim());
  }

  return parts.join("\n\n").trim();
}

async function fetchSmartPostingIds(companyIdentifier: string): Promise<string[]> {
  const ids: string[] = [];
  let offset = 0;
  const limit = 100;

  while (true) {
    await rateLimiter.acquire();

    const url = `${SMART_BASE}/${companyIdentifier}/postings?limit=${limit}&offset=${offset}`;
    const response = await fetchWithRetry(url);

    if (!response.ok) {
      if (response.status === 404) return [];
      throw new Error(`SmartRecruiters API error ${response.status} for ${companyIdentifier}`);
    }

    const page: SmartPostingListResponse = await response.json();
    const content = page.content ?? [];
    ids.push(...content.map((item) => item.id).filter(Boolean));

    if (content.length < limit) break;
    offset += limit;
  }

  return ids;
}

async function fetchSmartPostingDetail(
  companyIdentifier: string,
  postingId: string
): Promise<SmartPostingDetail | null> {
  await rateLimiter.acquire();

  const url = `${SMART_BASE}/${companyIdentifier}/postings/${postingId}`;
  const response = await fetchWithRetry(url);
  if (!response.ok) return null;

  return response.json();
}

export async function fetchSmartRecruitersJobs(
  companyIdentifier: string,
  companyName: string
): Promise<RawListing[]> {
  const ids = await fetchSmartPostingIds(companyIdentifier);
  const rows = await mapWithConcurrency(
    ids,
    DETAIL_FETCH_CONCURRENCY,
    async (postingId) => {
      const detail = await fetchSmartPostingDetail(companyIdentifier, postingId);
      if (!detail) return null;

      const description = buildDescription(detail);
      const location = detail.location?.fullLocation
        || [detail.location?.city, detail.location?.region, detail.location?.country]
          .filter(Boolean)
          .join(", ");

      const employment = mapEmployment(detail.typeOfEmployment?.label ?? "");

      return {
        title: detail.name,
        company: companyName,
        location: location || "",
        description,
        sourceUrl: detail.applyUrl
          || (detail.canonicalPath ? `https://careers.smartrecruiters.com${detail.canonicalPath}` : "")
          || `${SMART_BASE}/${companyIdentifier}/postings/${postingId}`,
        datePosted: detail.releasedDate || new Date().toISOString(),
        salaryMin: null,
        salaryMax: null,
        salaryIsPredicted: false,
        contractType: employment.contractType,
        contractTime: employment.contractTime,
        category: detail.department?.label || null,
        source: "smartrecruiters",
      } as RawListing;
    }
  );

  return rows.filter((row): row is RawListing => Boolean(row));
}

export async function ingestFromSmartRecruiters(
  companies: Array<{ companyIdentifier: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const groups = await mapWithConcurrency(
    companies,
    COMPANY_INGEST_CONCURRENCY,
    async ({ companyIdentifier, companyName }) => {
      try {
        const jobs = await fetchSmartRecruitersJobs(companyIdentifier, companyName);
        if (jobs.length > 0) {
          logger.info(`SmartRecruiters [${companyIdentifier}]: ${jobs.length} jobs from ${companyName}`);
        }
        return jobs;
      } catch (err) {
        logger.error(`SmartRecruiters error for ${companyName} (${companyIdentifier})`, err);
        return [] as RawListing[];
      }
    }
  );

  for (const jobs of groups) {
    listings.push(...jobs);
  }

  logger.info(`SmartRecruiters total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
