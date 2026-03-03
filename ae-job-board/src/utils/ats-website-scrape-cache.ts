import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger.ts";
import { normalizeCacheKey } from "./ats-cache.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CACHE_PATH = join(__dirname, "../../data/ats-website-scrape-cache.json");

export type EasyATSProvider =
  | "ashby"
  | "workable"
  | "smartrecruiters"
  | "breezy"
  | "zoho"
  | "jobscore"
  | "workday"
  | "paylocity"
  | "ultipro"
  | "icims"
  | "freshteam"
  | "jobvite"
  | "trinethire";

export interface WebsiteATSEntry {
  companyName: string;
  provider: EasyATSProvider;
  token: string;
  sourceUrl: string;
}

export interface WebsiteATSSources {
  entries: WebsiteATSEntry[];
  allowedFirmKeys: Set<string>;
}

interface WebsiteATSCandidate {
  ats?: string;
  url?: string;
}

interface WebsiteATSResult {
  firmName?: string;
  industry?: string;
  atsDetected?: WebsiteATSCandidate[];
}

interface WebsiteATSCache {
  results?: Record<string, WebsiteATSResult>;
}

let memoizedSources: WebsiteATSSources | null = null;

function baseATSName(raw: string): string {
  return raw.replace(/\s*\(.+?\)\s*$/, "").trim().toLowerCase();
}

function unwrapOutlookSafelink(url: URL): string {
  if (!url.hostname.includes("safelinks.protection.outlook.com")) return url.toString();
  const nested = url.searchParams.get("url");
  return nested ? nested : url.toString();
}

function unwrapUrlDefense(url: URL): string {
  if (!url.hostname.includes("urldefense.com")) return url.toString();

  const wrapped = url.pathname.match(/__(.+?)__/);
  if (!wrapped?.[1]) return url.toString();

  let unwrapped = decodeURIComponent(wrapped[1]);
  if (/^https:\/[^/]/i.test(unwrapped)) {
    unwrapped = unwrapped.replace(/^https:\//i, "https://");
  } else if (/^http:\/[^/]/i.test(unwrapped)) {
    unwrapped = unwrapped.replace(/^http:\//i, "http://");
  }

  return unwrapped;
}

function normalizeDetectedUrl(rawUrl: string): string {
  let current = rawUrl.trim();

  for (let i = 0; i < 3; i += 1) {
    let parsed: URL;
    try {
      parsed = new URL(current);
    } catch {
      return current;
    }

    const next = unwrapUrlDefense(new URL(unwrapOutlookSafelink(parsed)));
    if (next === current) break;
    current = next;
  }

  return current;
}

function extractSmartRecruitersToken(url: URL): string {
  const queryToken = url.searchParams.get("dcr_ci") ?? "";
  if (queryToken) return queryToken;

  const parts = url.pathname.split("/").filter(Boolean);
  const companyIndex = parts.indexOf("company");
  if (companyIndex >= 0 && parts[companyIndex + 1]) {
    return parts[companyIndex + 1];
  }

  if (parts[0] && parts[0] !== "oneclick-ui") {
    return parts[0];
  }

  return "";
}

function extractJobScoreToken(url: URL): string {
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  if (host === "careers.jobscore.com" || host === "www.jobscore.com") {
    // /careers/{slug}/...
    const careersIndex = parts.indexOf("careers");
    if (careersIndex >= 0 && parts[careersIndex + 1]) {
      return parts[careersIndex + 1];
    }
    // /jobs/{slug}/...
    const jobsIndex = parts.indexOf("jobs");
    if (jobsIndex >= 0 && parts[jobsIndex + 1]) {
      return parts[jobsIndex + 1];
    }
  }

  if (host === "widgets.jobscore.com") {
    // /jobs/{slug}/widget_iframe
    const jobsIndex = parts.indexOf("jobs");
    if (jobsIndex >= 0 && parts[jobsIndex + 1]) {
      return parts[jobsIndex + 1];
    }
  }

  return "";
}

function extractWorkdaySourceUrl(url: URL): string {
  if (!url.hostname.includes("myworkdayjobs.com")) return "";

  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length === 0) return "";

  let site = parts[0] ?? "";
  if (/^[a-z]{2}-[A-Z]{2}$/.test(site) && parts[1]) {
    site = parts[1];
  }

  if (!site) return "";
  return `${url.origin}/${site}`;
}

function extractPaylocitySourceUrl(url: URL): string {
  if (url.hostname !== "recruiting.paylocity.com") return "";
  return url.toString();
}

function extractUltiProSourceUrl(url: URL): string {
  if (!/^(recruiting|recruiting2)\.ultipro\.com$/i.test(url.hostname)) return "";

  const parts = url.pathname.split("/").filter(Boolean);
  const jobBoardIndex = parts.findIndex((part) => part.toLowerCase() === "jobboard");

  if (jobBoardIndex >= 0 && parts[jobBoardIndex + 1]) {
    return `${url.origin}/${parts[0]}/JobBoard/${parts[jobBoardIndex + 1]}/`;
  }

  if (parts[0]) {
    return `${url.origin}/${parts[0]}/`;
  }

  return "";
}

function extractICIMSSourceUrl(url: URL): string {
  if (!url.hostname.endsWith(".icims.com")) return "";

  const hashed = url.searchParams.get("hashed");
  const search = new URL("/jobs/search", url.origin);
  search.searchParams.set("ss", "1");
  if (hashed) search.searchParams.set("hashed", hashed);
  return search.toString();
}

function extractFreshteamToken(url: URL): string {
  if (!url.hostname.endsWith(".freshteam.com")) return "";
  return url.hostname.replace(/\.freshteam\.com$/, "");
}

function extractJobviteToken(url: URL): string {
  if (url.hostname !== "jobs.jobvite.com") return "";
  const first = url.pathname.split("/").filter(Boolean)[0] ?? "";
  if (!first || first.toLowerCase() === "support") return "";
  return first;
}

function extractTriNetToken(url: URL): string {
  if (url.hostname !== "app.trinethire.com") return "";
  const parts = url.pathname.split("/").filter(Boolean);
  const companiesIndex = parts.indexOf("companies");
  if (companiesIndex < 0 || !parts[companiesIndex + 1]) return "";
  return parts[companiesIndex + 1];
}

export function loadWebsiteATSSources(): WebsiteATSSources {
  if (memoizedSources) return memoizedSources;

  const allowedFirmKeys = new Set<string>();
  const entries: WebsiteATSEntry[] = [];

  if (!existsSync(CACHE_PATH)) {
    logger.warn("ats-website-scrape-cache.json not found — website ATS ingestion disabled");
    memoizedSources = { entries, allowedFirmKeys };
    return memoizedSources;
  }

  let cache: WebsiteATSCache;
  try {
    cache = JSON.parse(readFileSync(CACHE_PATH, "utf-8"));
  } catch {
    logger.warn("Could not parse ats-website-scrape-cache.json — website ATS ingestion disabled");
    memoizedSources = { entries, allowedFirmKeys };
    return memoizedSources;
  }

  const seen = new Set<string>();
  const results = cache.results ?? {};

  for (const [key, result] of Object.entries(results)) {
    const companyName = result.firmName?.trim() || key;
    const firmKey = normalizeCacheKey(companyName);
    if (firmKey) allowedFirmKeys.add(firmKey);

    for (const detected of result.atsDetected ?? []) {
      if (!detected.url || !detected.ats) continue;

      const normalizedUrl = normalizeDetectedUrl(detected.url);
      let parsed: URL;
      try {
        parsed = new URL(normalizedUrl);
      } catch {
        continue;
      }

      const host = parsed.hostname.toLowerCase();
      const atsName = baseATSName(detected.ats);
      let provider: EasyATSProvider | null = null;
      let token = "";
      let sourceUrl = parsed.toString();

      if (atsName === "ashby" && host.endsWith("ashbyhq.com")) {
        provider = "ashby";
        token = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
      } else if (atsName === "workable" && host === "apply.workable.com") {
        provider = "workable";
        const first = parsed.pathname.split("/").filter(Boolean)[0] ?? "";
        // Some detections are /j/{shortcode}. Keep token empty for those; ingestion resolves later.
        token = first === "j" || first === "jobs" || first === "api" ? "" : first;
      } else if (atsName === "smartrecruiters" && host.endsWith("smartrecruiters.com")) {
        provider = "smartrecruiters";
        token = extractSmartRecruitersToken(parsed);
      } else if (atsName === "breezy hr" && host.endsWith(".breezy.hr")) {
        provider = "breezy";
        token = host.replace(/\.breezy\.hr$/, "");
      } else if (atsName === "zoho recruit" && host.endsWith(".zohorecruit.com")) {
        provider = "zoho";
        token = host.replace(/\.zohorecruit\.com$/, "");
      } else if (atsName === "jobscore" && host.endsWith("jobscore.com")) {
        provider = "jobscore";
        token = extractJobScoreToken(parsed);
      } else if (atsName === "workday" && host.includes("myworkdayjobs.com")) {
        provider = "workday";
        sourceUrl = extractWorkdaySourceUrl(parsed);
      } else if (atsName === "paylocity" && host === "recruiting.paylocity.com") {
        provider = "paylocity";
        sourceUrl = extractPaylocitySourceUrl(parsed);
      } else if (atsName === "ultipro" && host.endsWith(".ultipro.com")) {
        provider = "ultipro";
        sourceUrl = extractUltiProSourceUrl(parsed);
      } else if (atsName === "icims" && host.endsWith(".icims.com")) {
        provider = "icims";
        sourceUrl = extractICIMSSourceUrl(parsed);
      } else if (atsName === "freshteam" && host.endsWith(".freshteam.com")) {
        provider = "freshteam";
        token = extractFreshteamToken(parsed);
        sourceUrl = token ? `https://${token}.freshteam.com/jobs` : "";
      } else if (atsName === "jobvite" && host === "jobs.jobvite.com") {
        provider = "jobvite";
        token = extractJobviteToken(parsed);
        sourceUrl = token ? `https://jobs.jobvite.com/${token}/jobs` : "";
      } else if ((atsName === "trinet hire" || atsName === "tri net hire") && host === "app.trinethire.com") {
        provider = "trinethire";
        token = extractTriNetToken(parsed);
        sourceUrl = token ? `https://app.trinethire.com/companies/${token}/jobs` : "";
      }

      if (!provider) continue;
      // Keep Workable tokenless entries (slug can be resolved from redirect),
      // but require a token for all other providers.
      if (!sourceUrl) continue;
      if (provider !== "workable" && provider !== "workday" && provider !== "paylocity" && provider !== "ultipro" && provider !== "icims" && !token) {
        continue;
      }
      // Ignore Breezy messenger API artifacts (not company boards).
      if (
        provider === "breezy" &&
        (token === "app" || parsed.pathname.toLowerCase().includes("/api/messenger/"))
      ) {
        continue;
      }

      const dedupToken = token || sourceUrl;
      const dedupKey = `${firmKey}|${provider}|${dedupToken.toLowerCase()}`;
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);

      entries.push({
        companyName,
        provider,
        token,
        sourceUrl,
      });
    }
  }

  memoizedSources = { entries, allowedFirmKeys };
  return memoizedSources;
}
