import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(6, 1000, "Workday");

interface WorkdayBoardRef {
  origin: string;
  tenant: string;
  site: string;
}

interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  postedOn?: string;
}

interface WorkdaySearchResponse {
  total?: number;
  jobPostings?: WorkdayPosting[];
}

function parseWorkdayBoard(seedUrl: string): WorkdayBoardRef | null {
  try {
    const parsed = new URL(seedUrl);
    if (!parsed.hostname.includes("myworkdayjobs.com")) return null;

    const pathParts = parsed.pathname.split("/").filter(Boolean);
    if (pathParts.length === 0) return null;

    let site = pathParts[0] ?? "";
    if (/^[a-z]{2}-[A-Z]{2}$/.test(site) && pathParts[1]) {
      site = pathParts[1];
    }
    if (!site) return null;

    const tenant = parsed.hostname.split(".")[0] ?? "";
    if (!tenant) return null;

    return {
      // Some tenants return HTTP_400 for CXS over http:// but work on https://.
      origin: `https://${parsed.host}`,
      tenant,
      site,
    };
  } catch {
    return null;
  }
}

function parsePostedOn(postedOn: string | undefined): string {
  if (!postedOn) return new Date().toISOString();

  const lower = postedOn.toLowerCase();
  const now = new Date();

  if (lower.includes("today")) return now.toISOString();
  if (lower.includes("yesterday")) {
    return new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  }

  const dayMatch = lower.match(/(\d+)\s+day/);
  if (dayMatch) {
    const days = Number(dayMatch[1]);
    return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
  }

  const weekMatch = lower.match(/(\d+)\s+week/);
  if (weekMatch) {
    const weeks = Number(weekMatch[1]);
    return new Date(now.getTime() - weeks * 7 * 24 * 60 * 60 * 1000).toISOString();
  }

  const hourMatch = lower.match(/(\d+)\s+hour/);
  if (hourMatch) {
    const hours = Number(hourMatch[1]);
    return new Date(now.getTime() - hours * 60 * 60 * 1000).toISOString();
  }

  return now.toISOString();
}

async function fetchWorkdayPage(board: WorkdayBoardRef, offset: number, limit: number): Promise<WorkdaySearchResponse | null> {
  await rateLimiter.acquire();

  const url = `${board.origin}/wday/cxs/${board.tenant}/${board.site}/jobs`;
  const response = await fetchWithRetry(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
    },
    body: JSON.stringify({
      appliedFacets: {},
      limit,
      offset,
      searchText: "",
    }),
  });

  if (!response.ok) {
    if ([404, 410, 422].includes(response.status)) return null;
    throw new Error(`Workday CXS error ${response.status} for ${board.origin}/${board.site}`);
  }

  return response.json();
}

export async function fetchWorkdayJobs(seedUrl: string, companyName: string): Promise<RawListing[]> {
  const board = parseWorkdayBoard(seedUrl);
  if (!board) return [];

  const listings: RawListing[] = [];
  const seen = new Set<string>();
  const limit = 20;
  let offset = 0;
  let total = Number.POSITIVE_INFINITY;

  while (offset < total) {
    const page = await fetchWorkdayPage(board, offset, limit);
    if (!page) break;

    const postings = page.jobPostings ?? [];
    if (postings.length === 0) break;
    total = typeof page.total === "number" ? page.total : offset + postings.length;

    for (const posting of postings) {
      const title = (posting.title ?? "").trim();
      const externalPath = posting.externalPath ?? "";
      const dedupKey = externalPath || `${title}|${posting.locationsText ?? ""}|${posting.postedOn ?? ""}`;
      if (!title || seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      const sourceUrl = externalPath
        ? `${board.origin}/${board.site}${externalPath}`
        : `${board.origin}/${board.site}`;

      listings.push({
        title,
        company: companyName,
        location: posting.locationsText ?? "",
        description: "",
        sourceUrl,
        datePosted: parsePostedOn(posting.postedOn),
        salaryMin: null,
        salaryMax: null,
        salaryIsPredicted: false,
        contractType: null,
        contractTime: null,
        category: null,
        source: "workday",
      });
    }

    if (postings.length < limit) break;
    offset += limit;
  }

  return listings;
}

export async function ingestFromWorkday(
  boards: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { seedUrl, companyName } of boards) {
    try {
      const jobs = await fetchWorkdayJobs(seedUrl, companyName);
      if (jobs.length > 0) {
        logger.info(`Workday: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`Workday error for ${companyName} (${seedUrl})`, err);
    }
  }

  logger.info(`Workday total: ${listings.length} listings from ${boards.length} companies`);
  return listings;
}
