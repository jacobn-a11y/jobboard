import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { mapWithConcurrency } from "./utils/concurrency.ts";
import { decodeEntities, extractJobPostingJsonLd, extractMetaContent, htmlToText } from "./utils/html-parsing.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(5, 1000, "iCIMS");
const DETAIL_FETCH_CONCURRENCY = Number(process.env.ICIMS_DETAIL_CONCURRENCY ?? "6");
const parsedCompanyConcurrency = Number(process.env.ICIMS_COMPANY_CONCURRENCY ?? "5");
const COMPANY_FETCH_CONCURRENCY = Number.isFinite(parsedCompanyConcurrency) && parsedCompanyConcurrency > 0
  ? Math.floor(parsedCompanyConcurrency)
  : 5;

function normalizeSearchUrl(rawUrl: string, expectedHost: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.host !== expectedHost) return null;
    if (!parsed.pathname.includes("/jobs/search")) return null;

    const normalized = new URL("/jobs/search", `${parsed.protocol}//${parsed.host}`);
    const allowedParams = ["ss", "pr", "hashed", "in_iframe", "searchRelation"];
    for (const key of allowedParams) {
      const value = parsed.searchParams.get(key);
      if (value !== null && value !== "") {
        normalized.searchParams.set(key, value);
      }
    }

    if (!normalized.searchParams.has("ss") && !normalized.searchParams.has("pr")) {
      normalized.searchParams.set("ss", "1");
    }
    if (normalized.searchParams.has("pr") && !normalized.searchParams.has("in_iframe")) {
      normalized.searchParams.set("in_iframe", "1");
    }

    return normalized.toString();
  } catch {
    return null;
  }
}

function buildSearchCandidates(seedUrl: string): { candidates: string[]; expectedHost: string } {
  const candidates: string[] = [];
  let expectedHost = "";

  try {
    const parsed = new URL(seedUrl);
    expectedHost = parsed.host;
    const hashed = parsed.searchParams.get("hashed");

    if (parsed.pathname.includes("/jobs/search")) {
      const normalizedSeed = normalizeSearchUrl(parsed.toString(), parsed.host);
      if (normalizedSeed) candidates.push(normalizedSeed);
    }

    const search = new URL("/jobs/search", `${parsed.protocol}//${parsed.host}`);
    search.searchParams.set("ss", "1");
    if (hashed) search.searchParams.set("hashed", hashed);
    const normalizedSearch = normalizeSearchUrl(search.toString(), parsed.host);
    if (normalizedSearch) candidates.push(normalizedSearch);

    const iframe = new URL(search.toString());
    iframe.searchParams.set("in_iframe", "1");
    const normalizedIframe = normalizeSearchUrl(iframe.toString(), parsed.host);
    if (normalizedIframe) candidates.push(normalizedIframe);

    if (!parsed.pathname.includes("/jobs/search")) {
      candidates.push(parsed.toString());
    }
  } catch {
    // Ignore malformed seed URL.
  }

  return { candidates: [...new Set(candidates)], expectedHost };
}

function extractICIMSJobLinks(html: string, baseUrl: string): string[] {
  const links = new Set<string>();
  const absolute = [...html.matchAll(/https?:\/\/[^"'\s]+\/jobs\/\d+\/[^"'\s<]+/gi)];
  for (const match of absolute) {
    links.add(match[0].replace(/&amp;/g, "&"));
  }

  const relative = [...html.matchAll(/href=["'](\/jobs\/\d+\/[^"']+)["']/gi)];
  for (const match of relative) {
    try {
      links.add(new URL(decodeEntities(match[1]), baseUrl).toString());
    } catch {
      // Ignore malformed relative URL.
    }
  }

  return [...links];
}

function extractICIMSSearchLinks(html: string, baseUrl: string, expectedHost: string): string[] {
  const links = new Set<string>();

  const absolute = [...html.matchAll(/https?:\/\/[^"'\s<]+\/jobs\/search\?[^"'\s<]+/gi)];
  for (const match of absolute) {
    const normalized = normalizeSearchUrl(match[0].replace(/&amp;/g, "&"), expectedHost);
    if (normalized) links.add(normalized);
  }

  const relative = [...html.matchAll(/href=["'](\/jobs\/search\?[^"']+)["']/gi)];
  for (const match of relative) {
    try {
      const absoluteUrl = new URL(decodeEntities(match[1]), baseUrl).toString();
      const normalized = normalizeSearchUrl(absoluteUrl, expectedHost);
      if (normalized) links.add(normalized);
    } catch {
      // Ignore malformed relative URL.
    }
  }

  return [...links];
}

function parsePostingFromJsonLd(jobPosting: Record<string, unknown>, fallbackUrl: string, companyName: string): RawListing | null {
  const title = String(jobPosting.title ?? "").trim();
  if (!title) return null;

  const rawDescription = String(jobPosting.description ?? "");
  const description = htmlToText(decodeEntities(rawDescription));

  let location = "";
  const jobLocation = jobPosting.jobLocation;
  if (Array.isArray(jobLocation) && jobLocation.length > 0) {
    const first = jobLocation[0] as Record<string, unknown>;
    const address = first?.address as Record<string, unknown> | undefined;
    const city = String(address?.addressLocality ?? "").trim();
    const region = String(address?.addressRegion ?? "").trim();
    const country = String(address?.addressCountry ?? "").trim();
    location = [city, region].filter(Boolean).join(", ") || country;
  } else if (jobLocation && typeof jobLocation === "object") {
    const first = jobLocation as Record<string, unknown>;
    const address = first.address as Record<string, unknown> | undefined;
    const city = String(address?.addressLocality ?? "").trim();
    const region = String(address?.addressRegion ?? "").trim();
    const country = String(address?.addressCountry ?? "").trim();
    location = [city, region].filter(Boolean).join(", ") || country;
  }

  const datePosted = String(jobPosting.datePosted ?? "").trim();
  const canonicalUrl = String(jobPosting.url ?? "").trim() || fallbackUrl;

  let contractType: string | null = null;
  let contractTime: string | null = null;
  const employmentType = String(jobPosting.employmentType ?? "").toLowerCase();
  if (employmentType.includes("contract")) contractType = "contract";
  else if (employmentType.includes("full") || employmentType.includes("part") || employmentType.includes("permanent")) {
    contractType = "permanent";
  }
  if (employmentType.includes("full")) contractTime = "full_time";
  else if (employmentType.includes("part")) contractTime = "part_time";

  return {
    title,
    company: companyName,
    location,
    description,
    sourceUrl: canonicalUrl,
    datePosted: datePosted ? new Date(datePosted).toISOString() : new Date().toISOString(),
    salaryMin: null,
    salaryMax: null,
    salaryIsPredicted: false,
    contractType,
    contractTime,
    category: null,
    source: "icims",
  };
}

async function fetchICIMSDetail(detailUrl: string, companyName: string): Promise<RawListing | null> {
  await rateLimiter.acquire();
  const response = await fetchWithRetry(detailUrl, { redirect: "follow" });
  if (!response.ok) return null;

  const html = await response.text();
  const posting = extractJobPostingJsonLd(html);
  if (posting) {
    return parsePostingFromJsonLd(posting, response.url, companyName);
  }

  const title = extractMetaContent(html, "og:title");
  const description = extractMetaContent(html, "og:description");
  if (!title && !description) return null;

  return {
    title: title || "Job Opening",
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
    source: "icims",
  };
}

export async function fetchICIMSJobs(seedUrl: string, companyName: string): Promise<RawListing[]> {
  const { candidates, expectedHost } = buildSearchCandidates(seedUrl);
  const detailLinks = new Set<string>();
  const visitedSearchPages = new Set<string>();
  const searchQueue = [...candidates];

  while (searchQueue.length > 0) {
    const candidate = searchQueue.shift();
    if (!candidate || visitedSearchPages.has(candidate)) continue;
    visitedSearchPages.add(candidate);

    try {
      await rateLimiter.acquire();
      const response = await fetchWithRetry(candidate, { redirect: "follow" });
      if (!response.ok) continue;

      const html = await response.text();
      for (const link of extractICIMSJobLinks(html, response.url)) {
        detailLinks.add(link);
      }

      for (const searchLink of extractICIMSSearchLinks(html, response.url, expectedHost || new URL(response.url).host)) {
        if (!visitedSearchPages.has(searchLink)) {
          searchQueue.push(searchLink);
        }
      }
    } catch {
      // Try next candidate.
    }
  }

  // Direct job-detail seeds should still ingest even if search is blocked.
  if (detailLinks.size === 0 && /\/jobs\/\d+\/.+\/job/i.test(seedUrl)) {
    detailLinks.add(seedUrl);
  }

  const normalizedLinks = [...detailLinks].map((link) => {
    const detail = new URL(link);
    detail.searchParams.delete("in_iframe");
    return detail.toString();
  });

  const resolved = await mapWithConcurrency(
    normalizedLinks,
    DETAIL_FETCH_CONCURRENCY,
    async (link) => {
      try {
        return await fetchICIMSDetail(link, companyName);
      } catch {
        // Skip failed detail.
        return null;
      }
    }
  );

  return resolved.filter((listing): listing is RawListing => Boolean(listing));
}

export async function ingestFromICIMS(
  companies: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];
  const groups = await mapWithConcurrency(
    companies,
    Math.max(1, COMPANY_FETCH_CONCURRENCY),
    async ({ seedUrl, companyName }) => {
      try {
        const jobs = await fetchICIMSJobs(seedUrl, companyName);
        if (jobs.length > 0) {
          logger.info(`iCIMS: ${jobs.length} jobs from ${companyName}`);
        }
        return jobs;
      } catch (err) {
        logger.error(`iCIMS error for ${companyName} (${seedUrl})`, err);
        return [] as RawListing[];
      }
    }
  );

  for (const jobs of groups) {
    listings.push(...jobs);
  }

  logger.info(`iCIMS total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
