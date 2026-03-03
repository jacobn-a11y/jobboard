import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(10, 1000, "Breezy");

interface BreezyJob {
  id: string;
  friendly_id?: string;
  name: string;
  url?: string;
  published_date?: string;
  department?: string | null;
  type?: {
    name?: string;
  };
  location?: {
    name?: string;
    city?: string;
    state?: { name?: string };
    is_remote?: boolean;
  };
  locations?: Array<{
    name?: string;
    is_remote?: boolean;
    city?: string;
    state?: { name?: string };
    primary?: boolean;
  }>;
}

function mapEmployment(name: string): { contractType: string | null; contractTime: string | null } {
  const lower = name.toLowerCase();

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

function pickLocation(job: BreezyJob): string {
  if (job.location?.name) return job.location.name;

  const primary = (job.locations ?? []).find((loc) => loc.primary && loc.name);
  if (primary?.name) return primary.name;

  const first = (job.locations ?? []).find((loc) => loc.name);
  if (first?.name) return first.name;

  const cityState = [job.location?.city, job.location?.state?.name].filter(Boolean).join(", ");
  return cityState || "";
}

export async function fetchBreezyJobs(
  companySlug: string,
  companyName: string
): Promise<RawListing[]> {
  await rateLimiter.acquire();

  const url = `https://${companySlug}.breezy.hr/json`;
  const response = await fetchWithRetry(url);

  if (!response.ok) {
    if (response.status === 404) return [];
    throw new Error(`Breezy API error ${response.status} for ${companySlug}`);
  }

  const data: BreezyJob[] = await response.json();
  if (!Array.isArray(data)) return [];

  return data.map((job): RawListing => {
    const employment = mapEmployment(job.type?.name ?? "");

    return {
      title: job.name,
      company: companyName,
      location: pickLocation(job),
      // Breezy's public JSON endpoint does not include job description HTML/text.
      description: "",
      sourceUrl: job.url || `https://${companySlug}.breezy.hr/p/${job.friendly_id || job.id}`,
      datePosted: job.published_date || new Date().toISOString(),
      salaryMin: null,
      salaryMax: null,
      salaryIsPredicted: false,
      contractType: employment.contractType,
      contractTime: employment.contractTime,
      category: job.department || null,
      source: "breezy",
    };
  });
}

export async function ingestFromBreezy(
  companies: Array<{ companySlug: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { companySlug, companyName } of companies) {
    try {
      const jobs = await fetchBreezyJobs(companySlug, companyName);
      if (jobs.length > 0) {
        logger.info(`Breezy [${companySlug}]: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`Breezy error for ${companyName} (${companySlug})`, err);
    }
  }

  logger.info(`Breezy total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
