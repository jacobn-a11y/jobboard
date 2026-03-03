import { RateLimiter } from "./utils/rate-limiter.ts";
import { fetchWithRetry } from "./utils/fetch-with-retry.ts";
import { logger } from "./utils/logger.ts";
import { decodeEntities, extractJobPostingJsonLd, extractMetaContent, htmlToText } from "./utils/html-parsing.ts";
import type { RawListing } from "./utils/types.ts";

const rateLimiter = new RateLimiter(5, 1000, "iCIMS");

function buildSearchCandidates(seedUrl: string): string[] {
  const candidates: string[] = [];

  try {
    const parsed = new URL(seedUrl);
    const hashed = parsed.searchParams.get("hashed");

    candidates.push(seedUrl);

    if (parsed.pathname.includes("/jobs/search")) {
      const search = new URL(parsed.toString());
      if (!search.searchParams.get("ss")) search.searchParams.set("ss", "1");
      candidates.push(search.toString());

      const iframe = new URL(search.toString());
      iframe.searchParams.set("in_iframe", "1");
      candidates.push(iframe.toString());
    } else {
      const search = new URL("/jobs/search", `${parsed.protocol}//${parsed.host}`);
      search.searchParams.set("ss", "1");
      if (hashed) search.searchParams.set("hashed", hashed);
      candidates.push(search.toString());

      const iframe = new URL(search.toString());
      iframe.searchParams.set("in_iframe", "1");
      candidates.push(iframe.toString());
    }
  } catch {
    // Ignore malformed seed URL.
  }

  return [...new Set(candidates)];
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
  const candidates = buildSearchCandidates(seedUrl);
  const detailLinks = new Set<string>();

  for (const candidate of candidates) {
    try {
      await rateLimiter.acquire();
      const response = await fetchWithRetry(candidate, { redirect: "follow" });
      if (!response.ok) continue;

      const html = await response.text();
      for (const link of extractICIMSJobLinks(html, response.url)) {
        detailLinks.add(link);
      }
    } catch {
      // Try next candidate.
    }
  }

  // Direct job-detail seeds should still ingest even if search is blocked.
  if (detailLinks.size === 0 && /\/jobs\/\d+\/.+\/job/i.test(seedUrl)) {
    detailLinks.add(seedUrl);
  }

  const listings: RawListing[] = [];
  for (const link of detailLinks) {
    try {
      const detail = new URL(link);
      detail.searchParams.delete("in_iframe");
      const listing = await fetchICIMSDetail(detail.toString(), companyName);
      if (listing) listings.push(listing);
    } catch {
      // Skip failed detail.
    }
  }

  return listings;
}

export async function ingestFromICIMS(
  companies: Array<{ seedUrl: string; companyName: string }>
): Promise<RawListing[]> {
  const listings: RawListing[] = [];

  for (const { seedUrl, companyName } of companies) {
    try {
      const jobs = await fetchICIMSJobs(seedUrl, companyName);
      if (jobs.length > 0) {
        logger.info(`iCIMS: ${jobs.length} jobs from ${companyName}`);
        listings.push(...jobs);
      }
    } catch (err) {
      logger.error(`iCIMS error for ${companyName} (${seedUrl})`, err);
    }
  }

  logger.info(`iCIMS total: ${listings.length} listings from ${companies.length} companies`);
  return listings;
}
