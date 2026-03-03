import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { loadWebsiteATSSources, type WebsiteATSEntry } from "../src/utils/ats-website-scrape-cache.ts";
import { fetchWithRetry } from "../src/utils/fetch-with-retry.ts";
import { fetchAshbyJobs } from "../src/ingest-ashby.ts";
import { fetchWorkableJobs } from "../src/ingest-workable.ts";
import { fetchSmartRecruitersJobs } from "../src/ingest-smartrecruiters.ts";
import { fetchBreezyJobs } from "../src/ingest-breezy.ts";
import { fetchZohoJobs } from "../src/ingest-zoho.ts";
import { fetchJobScoreJobs } from "../src/ingest-jobscore.ts";
import { fetchWorkdayJobs } from "../src/ingest-workday.ts";
import { fetchPaylocityJobs } from "../src/ingest-paylocity.ts";
import { fetchUltiProJobs } from "../src/ingest-ultipro.ts";
import { fetchICIMSJobs } from "../src/ingest-icims.ts";
import { fetchFreshteamJobs } from "../src/ingest-freshteam.ts";
import { fetchJobviteJobs } from "../src/ingest-jobvite.ts";
import { fetchTriNetHireJobs } from "../src/ingest-trinethire.ts";
import type { RawListing } from "../src/utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_PATH = join(__dirname, "../data/ats-validation-report.json");

const args = process.argv.slice(2);

function parseArgValue(flag: string): string {
  const prefixed = `${flag}=`;
  const exact = args.find((arg) => arg.startsWith(prefixed));
  if (exact) return exact.slice(prefixed.length).trim();

  const idx = args.indexOf(flag);
  if (idx >= 0 && args[idx + 1]) return args[idx + 1].trim();
  return "";
}

interface EntryResult {
  index: number;
  companyName: string;
  provider: WebsiteATSEntry["provider"];
  token: string;
  sourceUrl: string;
  endpointChecked: string;
  endpointStatus: number | null;
  fetchOk: boolean;
  error: string;
  listingCount: number;
  titleCoverage: number;
  sourceUrlCoverage: number;
  dateCoverage: number;
  locationCoverage: number;
  descriptionCoverage: number;
  avgDescriptionLength: number;
  qualityFlag: "good" | "mixed" | "no-openings-or-invalid" | "fetch-error";
  durationMs: number;
}

function pctWithValue(values: Array<string | null | undefined>): number {
  if (values.length === 0) return 0;
  const filled = values.filter((value) => Boolean(value && value.trim())).length;
  return Number((filled / values.length).toFixed(2));
}

function avgLength(values: string[]): number {
  if (values.length === 0) return 0;
  const total = values.reduce((sum, value) => sum + value.length, 0);
  return Number((total / values.length).toFixed(2));
}

function summarizeQuality(listings: RawListing[]): {
  listingCount: number;
  titleCoverage: number;
  sourceUrlCoverage: number;
  dateCoverage: number;
  locationCoverage: number;
  descriptionCoverage: number;
  avgDescriptionLength: number;
  qualityFlag: EntryResult["qualityFlag"];
} {
  const listingCount = listings.length;
  if (listingCount === 0) {
    return {
      listingCount,
      titleCoverage: 0,
      sourceUrlCoverage: 0,
      dateCoverage: 0,
      locationCoverage: 0,
      descriptionCoverage: 0,
      avgDescriptionLength: 0,
      qualityFlag: "no-openings-or-invalid",
    };
  }

  const titleCoverage = pctWithValue(listings.map((listing) => listing.title ?? ""));
  const sourceUrlCoverage = pctWithValue(listings.map((listing) => listing.sourceUrl ?? ""));
  const dateCoverage = pctWithValue(listings.map((listing) => listing.datePosted ?? ""));
  const locationCoverage = pctWithValue(listings.map((listing) => listing.location ?? ""));
  const descriptionCoverage = pctWithValue(listings.map((listing) => listing.description ?? ""));
  const avgDescriptionLength = avgLength(
    listings.map((listing) => (listing.description ?? "").trim()).filter(Boolean)
  );

  const isGood =
    titleCoverage >= 1 &&
    sourceUrlCoverage >= 1 &&
    dateCoverage >= 1 &&
    locationCoverage >= 0.8 &&
    descriptionCoverage >= 0.8;

  return {
    listingCount,
    titleCoverage,
    sourceUrlCoverage,
    dateCoverage,
    locationCoverage,
    descriptionCoverage,
    avgDescriptionLength,
    qualityFlag: isGood ? "good" : "mixed",
  };
}

function parseWorkableSlug(url: string): string {
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
  const direct = parseWorkableSlug(seedUrl);
  if (direct) return direct;

  try {
    const head = await fetchWithRetry(seedUrl, { method: "HEAD", redirect: "follow" });
    const fromHead = parseWorkableSlug(head.url);
    if (fromHead) return fromHead;
  } catch {
    // Fall through.
  }

  try {
    const get = await fetchWithRetry(seedUrl, { method: "GET", redirect: "follow" });
    const fromGet = parseWorkableSlug(get.url);
    if (fromGet) return fromGet;
  } catch {
    // Return empty below.
  }

  return "";
}

function resolveWorkdayEndpoint(seedUrl: string): string {
  try {
    const parsed = new URL(seedUrl);
    if (!parsed.hostname.includes("myworkdayjobs.com")) return seedUrl;

    const parts = parsed.pathname.split("/").filter(Boolean);
    if (parts.length === 0) return seedUrl;

    let site = parts[0] ?? "";
    if (/^[a-z]{2}-[A-Z]{2}$/.test(site) && parts[1]) {
      site = parts[1];
    }

    if (!site) return seedUrl;
    const tenant = parsed.hostname.split(".")[0] ?? "";
    if (!tenant) return seedUrl;

    return `${parsed.origin}/wday/cxs/${tenant}/${site}/jobs`;
  } catch {
    return seedUrl;
  }
}

async function validateEntry(index: number, entry: WebsiteATSEntry): Promise<EntryResult> {
  const startedAt = Date.now();
  let endpointChecked = entry.sourceUrl;
  let endpointStatus: number | null = null;
  let fetchOk = false;
  let error = "";
  let listings: RawListing[] = [];

  try {
    if (entry.provider === "ashby") {
      endpointChecked = `https://api.ashbyhq.com/posting-api/job-board/${entry.token}?includeCompensation=true`;
      const endpointResponse = await fetchWithRetry(endpointChecked);
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Ashby endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchAshbyJobs(entry.token, entry.companyName);
    } else if (entry.provider === "workable") {
      const slug = entry.token || (await resolveWorkableSlug(entry.sourceUrl));
      if (!slug) {
        throw new Error("Could not resolve workable account slug");
      }
      endpointChecked = `https://apply.workable.com/api/v1/widget/accounts/${slug}?details=true`;
      const endpointResponse = await fetchWithRetry(endpointChecked);
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Workable endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchWorkableJobs(slug, entry.companyName);
    } else if (entry.provider === "smartrecruiters") {
      endpointChecked = `https://api.smartrecruiters.com/v1/companies/${entry.token}/postings?limit=1&offset=0`;
      const endpointResponse = await fetchWithRetry(endpointChecked);
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`SmartRecruiters endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchSmartRecruitersJobs(entry.token, entry.companyName);
    } else if (entry.provider === "breezy") {
      endpointChecked = `https://${entry.token}.breezy.hr/json`;
      const endpointResponse = await fetchWithRetry(endpointChecked);
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Breezy endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchBreezyJobs(entry.token, entry.companyName);
    } else if (entry.provider === "zoho") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked);
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Zoho seed endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchZohoJobs(entry.token, entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "jobscore") {
      endpointChecked = `https://careers.jobscore.com/jobs/${entry.token}/feed.atom`;
      const endpointResponse = await fetchWithRetry(endpointChecked);
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`JobScore endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchJobScoreJobs(entry.token, entry.companyName);
    } else if (entry.provider === "workday") {
      endpointChecked = resolveWorkdayEndpoint(entry.sourceUrl);
      const endpointResponse = await fetchWithRetry(endpointChecked, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          accept: "application/json",
        },
        body: JSON.stringify({
          appliedFacets: {},
          limit: 1,
          offset: 0,
          searchText: "",
        }),
      });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404 && endpointResponse.status !== 422) {
        throw new Error(`Workday endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchWorkdayJobs(entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "paylocity") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked, { redirect: "follow" });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Paylocity endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchPaylocityJobs(entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "ultipro") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked, { redirect: "follow" });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`UltiPro endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchUltiProJobs(entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "icims") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked, { redirect: "follow" });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404 && endpointResponse.status !== 403) {
        throw new Error(`iCIMS endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchICIMSJobs(entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "freshteam") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked, { redirect: "follow" });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Freshteam endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchFreshteamJobs(entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "jobvite") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked, { redirect: "follow" });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`Jobvite endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchJobviteJobs(entry.sourceUrl, entry.companyName);
    } else if (entry.provider === "trinethire") {
      endpointChecked = entry.sourceUrl;
      const endpointResponse = await fetchWithRetry(endpointChecked, { redirect: "follow" });
      endpointStatus = endpointResponse.status;
      if (!endpointResponse.ok && endpointResponse.status !== 404) {
        throw new Error(`TriNet endpoint status ${endpointResponse.status}`);
      }
      listings = await fetchTriNetHireJobs(entry.sourceUrl, entry.companyName);
    }

    fetchOk = true;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    error = message;
  }

  const quality = fetchOk
    ? summarizeQuality(listings)
    : {
        listingCount: 0,
        titleCoverage: 0,
        sourceUrlCoverage: 0,
        dateCoverage: 0,
        locationCoverage: 0,
        descriptionCoverage: 0,
        avgDescriptionLength: 0,
        qualityFlag: "fetch-error" as const,
      };

  return {
    index,
    companyName: entry.companyName,
    provider: entry.provider,
    token: entry.token,
    sourceUrl: entry.sourceUrl,
    endpointChecked,
    endpointStatus,
    fetchOk,
    error,
    ...quality,
    durationMs: Date.now() - startedAt,
  };
}

function buildSummary(entries: EntryResult[]) {
  const byProvider: Record<string, {
    total: number;
    ok: number;
    withListings: number;
    avgListings: number;
    mixedOrWorse: number;
  }> = {};

  for (const entry of entries) {
    if (!byProvider[entry.provider]) {
      byProvider[entry.provider] = {
        total: 0,
        ok: 0,
        withListings: 0,
        avgListings: 0,
        mixedOrWorse: 0,
      };
    }

    const group = byProvider[entry.provider];
    group.total += 1;
    if (entry.fetchOk) group.ok += 1;
    if (entry.listingCount > 0) group.withListings += 1;
    if (entry.qualityFlag !== "good") group.mixedOrWorse += 1;
  }

  for (const provider of Object.keys(byProvider)) {
    const rows = entries.filter((entry) => entry.provider === provider);
    const totalListings = rows.reduce((sum, row) => sum + row.listingCount, 0);
    byProvider[provider].avgListings = Number((totalListings / rows.length).toFixed(2));
  }

  return {
    totalEntries: entries.length,
    reachableAndFetched: entries.filter((entry) => entry.fetchOk).length,
    withListings: entries.filter((entry) => entry.listingCount > 0).length,
    zeroListings: entries.filter((entry) => entry.fetchOk && entry.listingCount === 0).length,
    fetchErrors: entries.filter((entry) => !entry.fetchOk).length,
    mixedOrWorse: entries.filter((entry) => entry.qualityFlag !== "good").length,
    byProvider,
  };
}

async function main() {
  const { entries } = loadWebsiteATSSources();
  const providerArg = parseArgValue("--provider");
  const limitArg = parseArgValue("--limit");

  const providerFilter = new Set(
    providerArg
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean)
  );
  const limit = Number(limitArg);

  let filteredEntries = entries.filter((entry) =>
    providerFilter.size > 0 ? providerFilter.has(entry.provider) : true
  );
  if (Number.isFinite(limit) && limit > 0) {
    filteredEntries = filteredEntries.slice(0, limit);
  }

  const results: EntryResult[] = [];

  console.log(
    `Validating ${filteredEntries.length} website ATS entries sequentially` +
      (providerFilter.size > 0 ? ` (providers: ${[...providerFilter].join(", ")})` : "") +
      (Number.isFinite(limit) && limit > 0 ? ` (limit: ${limit})` : "") +
      "..."
  );

  for (let i = 0; i < filteredEntries.length; i += 1) {
    const entry = filteredEntries[i];
    const result = await validateEntry(i + 1, entry);
    results.push(result);

    const status = result.fetchOk ? "ok" : "error";
    console.log(
      `[${result.index}/${filteredEntries.length}] ${status} ${result.provider} ${result.companyName} -> ${result.listingCount} listings`
    );
  }

  const summary = buildSummary(results);
  const report = {
    generatedAt: new Date().toISOString(),
    filters: {
      provider: providerFilter.size > 0 ? [...providerFilter] : null,
      limit: Number.isFinite(limit) && limit > 0 ? limit : null,
    },
    summary,
    entries: results,
  };

  writeFileSync(OUTPUT_PATH, JSON.stringify(report, null, 2));

  console.log("\nValidation summary:");
  console.log(JSON.stringify(summary, null, 2));
  console.log(`\nWrote ${OUTPUT_PATH}`);
}

main().catch((err) => {
  console.error("Validation failed:", err);
  process.exit(1);
});
