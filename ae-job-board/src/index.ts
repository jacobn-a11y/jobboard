import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./utils/logger.ts";
import { ingestFromGreenhouse } from "./ingest-greenhouse.ts";
import { ingestFromLever } from "./ingest-lever.ts";
import { ingestFromAshby } from "./ingest-ashby.ts";
import { ingestFromWorkable } from "./ingest-workable.ts";
import { ingestFromSmartRecruiters } from "./ingest-smartrecruiters.ts";
import { ingestFromBreezy } from "./ingest-breezy.ts";
import { ingestFromZoho } from "./ingest-zoho.ts";
import { ingestFromJobScore } from "./ingest-jobscore.ts";
import { ingestFromWorkday } from "./ingest-workday.ts";
import { ingestFromPaylocity } from "./ingest-paylocity.ts";
import { ingestFromUltiPro } from "./ingest-ultipro.ts";
import { ingestFromICIMS } from "./ingest-icims.ts";
import { ingestFromFreshteam } from "./ingest-freshteam.ts";
import { ingestFromJobvite } from "./ingest-jobvite.ts";
import { ingestFromTriNetHire } from "./ingest-trinethire.ts";
import { deduplicateListings, deduplicateListingsBySourceUrl } from "./dedup.ts";
import { loadATSCache, normalizeCacheKey, isCacheValid } from "./utils/ats-cache.ts";
import { loadWebsiteATSSources } from "./utils/ats-website-scrape-cache.ts";
import { parseCSV } from "./utils/csv.ts";
import { filterListings } from "./filter.ts";
import { enrichCompany, lookupENRRank } from "./enrich.ts";
import { estimateSalary } from "./salary.ts";
import { generateContent, aiCallsMade, aiCallsSkipped } from "./ai-content.ts";
import { extractTools } from "./tools-extract.ts";
import { calculateQualityScore, calculatePreAIScore, detectExperienceLevel } from "./quality-score.ts";
import { generateSlug, deduplicateSlugs } from "./slug.ts";
import { pushToWebflow, getExistingItems, getExistingSlugs } from "./webflow.ts";
import { parseLocation } from "./utils/parse-location.ts";
import { normalizeIndustry, unmatchedIndustries } from "./utils/normalize-industry.ts";
import { appendRunHistory } from "./utils/run-history.ts";
import { mapWithConcurrency, createConcurrencyLimiter } from "./utils/concurrency.ts";
import type { RunRecord } from "./utils/run-history.ts";
import type { EnrichedListing, PipelineSummary, RawListing } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "../../AccountsforBoard.csv");

const PRE_AI_SCORE_THRESHOLD = 45;

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipPdl = args.includes("--skip-pdl");
const ALL_ATS_PROVIDERS = [
  "greenhouse",
  "lever",
  "ashby",
  "workable",
  "smartrecruiters",
  "breezy",
  "zoho",
  "jobscore",
  "workday",
  "paylocity",
  "ultipro",
  "icims",
  "freshteam",
  "jobvite",
  "trinethire",
] as const;
type ATSProvider = (typeof ALL_ATS_PROVIDERS)[number];
const allProviderSet = new Set<string>(ALL_ATS_PROVIDERS);
const configuredProviders = (process.env.ATS_PROVIDERS ?? "")
  .split(",")
  .map((provider) => provider.trim().toLowerCase())
  .filter(Boolean);
const unknownProviders = configuredProviders.filter((provider) => !allProviderSet.has(provider));
const enabledProviders = new Set<string>(
  configuredProviders.length > 0
    ? configuredProviders.filter((provider) => allProviderSet.has(provider))
    : ALL_ATS_PROVIDERS
);
const parsedEnrichConcurrency = Number(process.env.ENRICH_CONCURRENCY ?? "12");
const ENRICH_CONCURRENCY = Number.isFinite(parsedEnrichConcurrency) && parsedEnrichConcurrency > 0
  ? Math.floor(parsedEnrichConcurrency)
  : 12;
const parsedAIConcurrency = Number(process.env.AI_CONCURRENCY ?? "2");
const AI_CONCURRENCY = Number.isFinite(parsedAIConcurrency) && parsedAIConcurrency > 0
  ? Math.floor(parsedAIConcurrency)
  : 2;
const runAIWithLimit = createConcurrencyLimiter(AI_CONCURRENCY);

if (dryRun) logger.info("DRY RUN MODE — no CMS writes");
if (skipPdl) logger.info("Skipping PDL enrichment (--skip-pdl)");
if (unknownProviders.length > 0) {
  logger.warn(`Ignoring unknown ATS providers in ATS_PROVIDERS: ${unknownProviders.join(", ")}`);
}
logger.info(`Enrichment concurrency: ${ENRICH_CONCURRENCY}`);
logger.info(`AI concurrency: ${AI_CONCURRENCY}`);
logger.info(`ATS providers: ${[...enabledProviders].join(", ")}`);

function shouldRunProvider(provider: ATSProvider): boolean {
  return enabledProviders.has(provider);
}

function canonicalSeedUrl(seedUrl: string): string {
  try {
    const parsed = new URL(seedUrl);
    const pathname = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin}${pathname}${parsed.search}`;
  } catch {
    return seedUrl.trim().toLowerCase();
  }
}

function dedupeByKey<T>(
  items: T[],
  keyFn: (item: T) => string,
  label: string
): T[] {
  const seen = new Set<string>();
  const deduped: T[] = [];

  for (const item of items) {
    const key = keyFn(item).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  if (items.length !== deduped.length) {
    logger.info(`${label}: ${items.length} -> ${deduped.length} unique seeds`);
  }

  return deduped;
}

// ── Main pipeline ────────────────────────────────────────────────────

async function run(): Promise<void> {
  const startTime = Date.now();
  const summary: PipelineSummary = {
    totalIngested: 0,
    afterDedup: 0,
    afterFilter: 0,
    afterQualityFilter: 0,
    created: 0,
    updated: 0,
    expired: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
  };

  let enrichedListings: EnrichedListing[] = [];

  try {
    // ── Step 1: Multi-source ingest ───────────────────────────────────
    logger.info("=== Step 1: Ingesting from ATS sources ===");

    let ghListings: RawListing[] = [];
    let leverListings: RawListing[] = [];
    let ashbyListings: RawListing[] = [];
    let workableListings: RawListing[] = [];
    let smartRecruitersListings: RawListing[] = [];
    let breezyListings: RawListing[] = [];
    let zohoListings: RawListing[] = [];
    let jobScoreListings: RawListing[] = [];
    let workdayListings: RawListing[] = [];
    let paylocityListings: RawListing[] = [];
    let ultiProListings: RawListing[] = [];
    let icimsListings: RawListing[] = [];
    let freshteamListings: RawListing[] = [];
    let jobviteListings: RawListing[] = [];
    let triNetHireListings: RawListing[] = [];

    const atsCache = loadATSCache();
    const websiteATS = loadWebsiteATSSources();
    const ghBoards: Array<{ boardToken: string; companyName: string }> = [];
    const leverCompanies: Array<{ companySlug: string; companyName: string }> = [];
    const ashbyBoards: Array<{ organization: string; companyName: string }> = [];
    const workableBoards: Array<{ accountSlug?: string; seedUrl: string; companyName: string }> = [];
    const smartRecruitersCompanies: Array<{ companyIdentifier: string; companyName: string }> = [];
    const breezyCompanies: Array<{ companySlug: string; companyName: string }> = [];
    const zohoCompanies: Array<{ companySlug: string; seedUrl: string; companyName: string }> = [];
    const jobScoreCompanies: Array<{ companySlug: string; companyName: string }> = [];
    const workdayBoards: Array<{ seedUrl: string; companyName: string }> = [];
    const paylocityBoards: Array<{ seedUrl: string; companyName: string }> = [];
    const ultiProBoards: Array<{ seedUrl: string; companyName: string }> = [];
    const icimsCompanies: Array<{ seedUrl: string; companyName: string }> = [];
    const freshteamBoards: Array<{ seedUrl: string; companyName: string }> = [];
    const jobviteCompanies: Array<{ seedUrl: string; companyName: string }> = [];
    const triNetHireCompanies: Array<{ seedUrl: string; companyName: string }> = [];

    // Read firm list from CSV (source of truth), dedup by normalized name
    try {
      const csv = readFileSync(CSV_PATH, "utf-8");
      const firms = parseCSV(csv);
      const seenFirmKeys = new Set<string>();

      for (const firm of firms) {
        const name = firm["Account Name"];
        if (!name) continue;
        const key = normalizeCacheKey(name);

        // Skip duplicate company rows in CSV
        if (seenFirmKeys.has(key)) {
          logger.debug(`Skipping duplicate CSV row: "${name}" (normalized: "${key}")`);
          continue;
        }
        seenFirmKeys.add(key);

        const entry = atsCache[key];
        if (!entry || !isCacheValid(entry)) continue;

        if (entry.provider === "greenhouse" && shouldRunProvider("greenhouse")) {
          ghBoards.push({ boardToken: entry.boardToken, companyName: name });
        } else if (entry.provider === "lever" && shouldRunProvider("lever")) {
          leverCompanies.push({ companySlug: entry.boardToken, companyName: name });
        }
      }
    } catch {
      logger.warn("Could not read AccountsforBoard.csv — skipping ATS ingestion");
    }

    // Pull additional providers directly from ats-website-scrape-cache.json
    for (const entry of websiteATS.entries) {
      if (entry.provider === "ashby" && entry.token && shouldRunProvider("ashby")) {
        ashbyBoards.push({ organization: entry.token, companyName: entry.companyName });
      } else if (entry.provider === "workable" && shouldRunProvider("workable")) {
        workableBoards.push({
          accountSlug: entry.token || undefined,
          seedUrl: entry.sourceUrl,
          companyName: entry.companyName,
        });
      } else if (entry.provider === "smartrecruiters" && entry.token && shouldRunProvider("smartrecruiters")) {
        smartRecruitersCompanies.push({
          companyIdentifier: entry.token,
          companyName: entry.companyName,
        });
      } else if (entry.provider === "breezy" && entry.token && shouldRunProvider("breezy")) {
        breezyCompanies.push({ companySlug: entry.token, companyName: entry.companyName });
      } else if (entry.provider === "zoho" && entry.token && shouldRunProvider("zoho")) {
        zohoCompanies.push({
          companySlug: entry.token,
          seedUrl: entry.sourceUrl,
          companyName: entry.companyName,
        });
      } else if (entry.provider === "jobscore" && entry.token && shouldRunProvider("jobscore")) {
        jobScoreCompanies.push({ companySlug: entry.token, companyName: entry.companyName });
      } else if (entry.provider === "workday" && shouldRunProvider("workday")) {
        workdayBoards.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      } else if (entry.provider === "paylocity" && shouldRunProvider("paylocity")) {
        paylocityBoards.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      } else if (entry.provider === "ultipro" && shouldRunProvider("ultipro")) {
        ultiProBoards.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      } else if (entry.provider === "icims" && shouldRunProvider("icims")) {
        icimsCompanies.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      } else if (entry.provider === "freshteam" && shouldRunProvider("freshteam")) {
        freshteamBoards.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      } else if (entry.provider === "jobvite" && shouldRunProvider("jobvite")) {
        jobviteCompanies.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      } else if (entry.provider === "trinethire" && shouldRunProvider("trinethire")) {
        triNetHireCompanies.push({ seedUrl: entry.sourceUrl, companyName: entry.companyName });
      }
    }

    const ghBoardsUnique = dedupeByKey(ghBoards, (b) => b.boardToken, "Greenhouse seed dedup");
    const leverCompaniesUnique = dedupeByKey(leverCompanies, (c) => c.companySlug, "Lever seed dedup");
    const ashbyBoardsUnique = dedupeByKey(ashbyBoards, (b) => b.organization, "Ashby seed dedup");
    const workableBoardsUnique = dedupeByKey(
      workableBoards,
      (b) => b.accountSlug || canonicalSeedUrl(b.seedUrl),
      "Workable seed dedup"
    );
    const smartRecruitersCompaniesUnique = dedupeByKey(
      smartRecruitersCompanies,
      (c) => c.companyIdentifier,
      "SmartRecruiters seed dedup"
    );
    const breezyCompaniesUnique = dedupeByKey(breezyCompanies, (c) => c.companySlug, "Breezy seed dedup");
    const zohoCompaniesUnique = dedupeByKey(
      zohoCompanies,
      (c) => c.companySlug || canonicalSeedUrl(c.seedUrl),
      "Zoho seed dedup"
    );
    const jobScoreCompaniesUnique = dedupeByKey(jobScoreCompanies, (c) => c.companySlug, "JobScore seed dedup");
    const workdayBoardsUnique = dedupeByKey(workdayBoards, (b) => canonicalSeedUrl(b.seedUrl), "Workday seed dedup");
    const paylocityBoardsUnique = dedupeByKey(paylocityBoards, (b) => canonicalSeedUrl(b.seedUrl), "Paylocity seed dedup");
    const ultiProBoardsUnique = dedupeByKey(ultiProBoards, (b) => canonicalSeedUrl(b.seedUrl), "UltiPro seed dedup");
    const icimsCompaniesUnique = dedupeByKey(icimsCompanies, (c) => canonicalSeedUrl(c.seedUrl), "iCIMS seed dedup");
    const freshteamBoardsUnique = dedupeByKey(freshteamBoards, (b) => canonicalSeedUrl(b.seedUrl), "Freshteam seed dedup");
    const jobviteCompaniesUnique = dedupeByKey(jobviteCompanies, (c) => canonicalSeedUrl(c.seedUrl), "Jobvite seed dedup");
    const triNetHireCompaniesUnique = dedupeByKey(
      triNetHireCompanies,
      (c) => canonicalSeedUrl(c.seedUrl),
      "TriNet Hire seed dedup"
    );

    // Ingest providers in parallel to reduce total wall-clock runtime.
    const ingestTasks: Array<Promise<void>> = [];

    if (shouldRunProvider("greenhouse") && ghBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1a: Greenhouse (${ghBoardsUnique.length} boards) ---`);
        ghListings = await ingestFromGreenhouse(ghBoardsUnique);
      })());
    }

    if (shouldRunProvider("lever") && leverCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1b: Lever (${leverCompaniesUnique.length} companies) ---`);
        leverListings = await ingestFromLever(leverCompaniesUnique);
      })());
    }

    if (shouldRunProvider("ashby") && ashbyBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1c: Ashby (${ashbyBoardsUnique.length} boards) ---`);
        ashbyListings = await ingestFromAshby(ashbyBoardsUnique);
      })());
    }

    if (shouldRunProvider("workable") && workableBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1d: Workable (${workableBoardsUnique.length} boards) ---`);
        workableListings = await ingestFromWorkable(workableBoardsUnique);
      })());
    }

    if (shouldRunProvider("smartrecruiters") && smartRecruitersCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1e: SmartRecruiters (${smartRecruitersCompaniesUnique.length} companies) ---`);
        smartRecruitersListings = await ingestFromSmartRecruiters(smartRecruitersCompaniesUnique);
      })());
    }

    if (shouldRunProvider("breezy") && breezyCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1f: Breezy (${breezyCompaniesUnique.length} companies) ---`);
        breezyListings = await ingestFromBreezy(breezyCompaniesUnique);
      })());
    }

    if (shouldRunProvider("zoho") && zohoCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1g: Zoho Recruit (${zohoCompaniesUnique.length} companies) ---`);
        zohoListings = await ingestFromZoho(zohoCompaniesUnique);
      })());
    }

    if (shouldRunProvider("jobscore") && jobScoreCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1h: JobScore (${jobScoreCompaniesUnique.length} companies) ---`);
        jobScoreListings = await ingestFromJobScore(jobScoreCompaniesUnique);
      })());
    }

    if (shouldRunProvider("workday") && workdayBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1i: Workday (${workdayBoardsUnique.length} companies) ---`);
        workdayListings = await ingestFromWorkday(workdayBoardsUnique);
      })());
    }

    if (shouldRunProvider("paylocity") && paylocityBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1j: Paylocity (${paylocityBoardsUnique.length} companies) ---`);
        paylocityListings = await ingestFromPaylocity(paylocityBoardsUnique);
      })());
    }

    if (shouldRunProvider("ultipro") && ultiProBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1k: UltiPro (${ultiProBoardsUnique.length} companies) ---`);
        ultiProListings = await ingestFromUltiPro(ultiProBoardsUnique);
      })());
    }

    if (shouldRunProvider("icims") && icimsCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1l: iCIMS (${icimsCompaniesUnique.length} companies) ---`);
        icimsListings = await ingestFromICIMS(icimsCompaniesUnique);
      })());
    }

    if (shouldRunProvider("freshteam") && freshteamBoardsUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1m: Freshteam (${freshteamBoardsUnique.length} companies) ---`);
        freshteamListings = await ingestFromFreshteam(freshteamBoardsUnique);
      })());
    }

    if (shouldRunProvider("jobvite") && jobviteCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1n: Jobvite (${jobviteCompaniesUnique.length} companies) ---`);
        jobviteListings = await ingestFromJobvite(jobviteCompaniesUnique);
      })());
    }

    if (shouldRunProvider("trinethire") && triNetHireCompaniesUnique.length > 0) {
      ingestTasks.push((async () => {
        logger.info(`--- 1o: TriNet Hire (${triNetHireCompaniesUnique.length} companies) ---`);
        triNetHireListings = await ingestFromTriNetHire(triNetHireCompaniesUnique);
      })());
    }

    await Promise.all(ingestTasks);

    // Cross-source dedup (prefer longer descriptions)
    const allRaw = [
      ...ghListings,
      ...leverListings,
      ...ashbyListings,
      ...workableListings,
      ...smartRecruitersListings,
      ...breezyListings,
      ...zohoListings,
      ...jobScoreListings,
      ...workdayListings,
      ...paylocityListings,
      ...ultiProListings,
      ...icimsListings,
      ...freshteamListings,
      ...jobviteListings,
      ...triNetHireListings,
    ];
    summary.totalIngested = allRaw.length;
    const crossSourceDeduped = deduplicateListings(allRaw);
    const rawListings = deduplicateListingsBySourceUrl(crossSourceDeduped);
    summary.afterDedup = rawListings.length;
    logger.info(`Total: ${allRaw.length} raw → ${rawListings.length} after dedup`);

    // ── Step 2: Filter ───────────────────────────────────────────────
    logger.info("=== Step 2: Filtering (role + firm match) ===");
    const filtered = filterListings(rawListings);
    summary.afterFilter = filtered.length;
    logger.info(`${filtered.length} listings passed filtering`);

    if (filtered.length === 0) {
      logger.warn("No listings passed filtering — pipeline complete");
      logSummary(summary);
      return;
    }

    // ── Step 2b: Fetch existing Webflow items (for AI skip + slug dedup) ──
    // Do this once upfront so we can skip AI for listings already in Webflow
    let existingSourceUrls = new Set<string>();
    let existingSlugs = new Set<string>();
    if (!dryRun && process.env.WEBFLOW_API_TOKEN) {
      try {
        logger.info("Fetching existing Webflow items for dedup...");
        const { bySourceUrl } = await getExistingItems();
        existingSourceUrls = new Set(bySourceUrl.keys());
        existingSlugs = new Set([...bySourceUrl.values()].map((i) => i.slug));
        logger.info(`Found ${existingSourceUrls.size} existing items in Webflow`);
      } catch {
        logger.warn("Could not fetch existing Webflow items");
      }
    }

    // ── Step 3: Enrich each listing ──────────────────────────────────
    logger.info("=== Step 3: Enriching listings ===");
    let aiSkippedLowQuality = 0;
    let aiSkippedExisting = 0;
    let completedEnrichment = 0;

    const enriched = await mapWithConcurrency(
      filtered,
      ENRICH_CONCURRENCY,
      async ({ listing, roleCategory, firmMatch }, index): Promise<EnrichedListing | null> => {
        const stepLabel = `[${index + 1}/${filtered.length}]`;

        try {
          // 3a: Company enrichment (skip if --skip-pdl)
          if (index % 25 === 0 || index === filtered.length - 1) {
            logger.info(`${stepLabel} Enriching: ${listing.title} at ${listing.company}`);
          }
          const enrichment = skipPdl ? null : await enrichCompany(listing.company);

          // 3b: ENR rank
          const enrRank = firmMatch?.enrRank ?? lookupENRRank(listing.company);

          // 3c: Salary
          let salaryMin = listing.salaryMin;
          let salaryMax = listing.salaryMax;
          let salaryEstimated = listing.salaryIsPredicted;

          if (!salaryMin || !salaryMax) {
            const estimate = estimateSalary(
              listing.title,
              listing.location,
              roleCategory
            );
            if (estimate) {
              salaryMin = estimate.salaryMin;
              salaryMax = estimate.salaryMax;
              salaryEstimated = true;
            }
          }

          // 3d: Tools
          const toolsMentioned = extractTools(listing.description);

          // 3e: Experience level
          const experienceLevel = detectExperienceLevel(listing.title);

          // 3f: Pre-AI quality score — decide whether to call AI
          const preAIScore = calculatePreAIScore({
            salaryMin,
            salaryMax,
            salaryEstimated,
            firmMatch,
            enrichment,
            enrRank,
            description: listing.description,
            toolsMentioned,
            title: listing.title,
            location: listing.location,
          });

          let roleSummary = "";
          let companyDescription = "";

          const isExistingInWebflow = existingSourceUrls.has(listing.sourceUrl);

          if (preAIScore < PRE_AI_SCORE_THRESHOLD) {
            // Skip AI for low-quality listings (unlikely to reach publish threshold of 40)
            logger.debug(
              `${stepLabel} Skipping AI (pre-score ${preAIScore} < ${PRE_AI_SCORE_THRESHOLD}): ${listing.title}`
            );
            aiSkippedLowQuality++;
          } else if (isExistingInWebflow) {
            // Skip AI for listings already in Webflow — they already have content
            logger.debug(
              `${stepLabel} Skipping AI (already in Webflow): ${listing.title}`
            );
            aiSkippedExisting++;
          } else {
            // 3g: Generate AI content
            const aiResult = await runAIWithLimit(() => generateContent(
              listing.title,
              listing.company,
              listing.location,
              listing.description,
              firmMatch,
              enrichment,
              enrRank
            ));
            roleSummary = aiResult.roleSummary;
            companyDescription = aiResult.companyDescription;
          }

          // 3h: Final quality score (with AI content if generated)
          const qualityScore = calculateQualityScore({
            salaryMin,
            salaryMax,
            salaryEstimated,
            firmMatch,
            enrichment,
            enrRank,
            description: listing.description,
            toolsMentioned,
            title: listing.title,
            location: listing.location,
            roleSummary,
            companyDescription,
          });

          // 3i: Parse job location into structured fields
          const parsedJobLoc = parseLocation(listing.location);

          // Company HQ: prefer seed list, then enrichment
          const rawHq = firmMatch?.hq ?? enrichment?.hq ?? "";
          const hqState = firmMatch?.hqState ?? "";
          const hqCity = firmMatch?.hqCity ?? "";
          // If seed list didn't have structured fields, parse the combined string
          const parsedHq = (!hqState && rawHq) ? parseLocation(rawHq) : null;

          return {
            title: listing.title,
            company: listing.company,
            location: listing.location,
            description: listing.description,
            sourceUrl: listing.sourceUrl,
            datePosted: listing.datePosted,
            contractType: listing.contractType,
            salaryMin,
            salaryMax,
            salaryEstimated,
            firmMatch,
            companyWebsite: firmMatch?.website ?? "",
            companyLinkedin: firmMatch?.linkedin ?? "",
            enrichment,
            enrRank,
            roleSummary,
            companyDescription,
            toolsMentioned,
            qualityScore,
            slug: "", // Populated in slug step
            jobCity: parsedJobLoc.city,
            jobState: parsedJobLoc.state,
            isRemote: parsedJobLoc.isRemote,
            companyHqCity: hqCity || parsedHq?.city || "",
            companyHqState: hqState || parsedHq?.state || "",
            industry: normalizeIndustry(firmMatch?.industry ?? enrichment?.industry ?? "Architecture & Engineering"),
            experienceLevel,
            roleCategory,
          };
        } catch (err) {
          logger.error(
            `Error enriching ${listing.title} at ${listing.company}`,
            err
          );
          summary.errors++;
          return null;
        } finally {
          completedEnrichment++;
          if (completedEnrichment % 100 === 0 || completedEnrichment === filtered.length) {
            logger.info(`Enrichment progress: ${completedEnrichment}/${filtered.length}`);
          }
        }
      }
    );

    enrichedListings = enriched.filter((listing): listing is EnrichedListing => Boolean(listing));

    logger.info(
      `AI optimization: ${aiSkippedLowQuality} skipped (low quality), ${aiSkippedExisting} skipped (existing in Webflow), ` +
      `${aiCallsMade} API calls made, ${aiCallsSkipped} cache hits`
    );

    // ── Step 4: Generate slugs ───────────────────────────────────────
    logger.info("=== Step 4: Generating slugs ===");
    const rawSlugs = enrichedListings.map((l) =>
      generateSlug(l.title, l.company, l.location)
    );

    // Use existing slugs fetched earlier (or fetch now if not already done)
    if (existingSlugs.size === 0 && !dryRun && process.env.WEBFLOW_API_TOKEN) {
      try {
        existingSlugs = await getExistingSlugs();
      } catch {
        logger.warn("Could not fetch existing Webflow slugs");
      }
    }

    const finalSlugs = deduplicateSlugs(rawSlugs, existingSlugs);
    for (let i = 0; i < enrichedListings.length; i++) {
      enrichedListings[i].slug = finalSlugs[i];
    }

    // ── Step 5: Quality filter ───────────────────────────────────────
    logger.info("=== Step 5: Quality filtering ===");
    const publishable = enrichedListings.filter((l) => l.qualityScore >= 40);
    const skipped = enrichedListings.length - publishable.length;
    summary.afterQualityFilter = publishable.length;
    summary.skipped = skipped;
    logger.info(
      `${publishable.length} publishable, ${skipped} skipped (score < 40)`
    );

    // ── Step 6: Log results (dry-run) or push to Webflow ────────────
    if (dryRun) {
      logger.info("=== DRY RUN: Would push these listings ===");
      for (const listing of publishable) {
        const featured = listing.qualityScore >= 70 ? " ★ FEATURED" : "";
        logger.info(
          `  [${listing.qualityScore}] ${listing.title} at ${listing.company} — ${listing.location}${featured}`
        );
        logger.info(
          `    Slug: ${listing.slug} | Tools: ${listing.toolsMentioned || "none"} | Salary: $${listing.salaryMin?.toLocaleString() ?? "?"}-$${listing.salaryMax?.toLocaleString() ?? "?"}${listing.salaryEstimated ? " (est)" : ""}`
        );
        if (listing.companyWebsite || listing.companyLinkedin) {
          logger.info(
            `    Web: ${listing.companyWebsite || "—"} | LinkedIn: ${listing.companyLinkedin || "—"}`
          );
        }
      }
      logger.info(`DRY RUN complete — ${publishable.length} items would be pushed`);
    } else {
      logger.info("=== Step 6: Pushing to Webflow ===");
      if (!process.env.WEBFLOW_API_TOKEN) {
        logger.warn("WEBFLOW_API_TOKEN not set — skipping CMS push");
      } else {
        const result = await pushToWebflow(publishable);
        summary.created = result.created;
        summary.updated = result.updated;
        summary.expired = result.expired;
        summary.deleted = result.deleted;
      }
    }
  } catch (err) {
    logger.error("Pipeline failed", err);
    summary.errors++;
  }

  // Log any industry values that couldn't be normalized
  if (unmatchedIndustries.size > 0) {
    logger.warn(
      `${unmatchedIndustries.size} industry value(s) not in industry-map.json — add aliases to normalize them:`
    );
    for (const val of unmatchedIndustries) {
      logger.warn(`  "${val}"`);
    }
  }

  logSummary(summary);

  // ── Record run history ─────────────────────────────────────────────
  try {
    const durationMs = Date.now() - startTime;
    buildAndSaveRunRecord(summary, enrichedListings, durationMs);
    logger.info("Run history updated");
  } catch (err) {
    logger.warn("Failed to save run history", err);
  }
}

function buildAndSaveRunRecord(
  summary: PipelineSummary,
  listings: EnrichedListing[],
  durationMs: number
): void {
  // Aggregate stats from enriched listings
  const companies = new Map<string, number>();
  const states = new Set<string>();
  const categories: Record<string, number> = {};
  const industries: Record<string, number> = {};

  for (const listing of listings) {
    companies.set(listing.company, (companies.get(listing.company) ?? 0) + 1);
    if (listing.jobState) states.add(listing.jobState);
    categories[listing.roleCategory] = (categories[listing.roleCategory] ?? 0) + 1;
    if (listing.industry) {
      industries[listing.industry] = (industries[listing.industry] ?? 0) + 1;
    }
  }

  const topCompanies = [...companies.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([name, count]) => ({ name, count }));

  const record: RunRecord = {
    timestamp: new Date().toISOString(),
    durationMs,
    summary,
    uniqueCompanies: companies.size,
    uniqueStates: [...states].sort(),
    listingsByCategory: categories,
    listingsByIndustry: industries,
    unmatchedIndustries: [...unmatchedIndustries],
    aiCallsMade,
    aiCallsSkipped,
    topCompanies,
  };

  appendRunHistory(record);
}

function logSummary(summary: PipelineSummary): void {
  logger.info("=== Pipeline Summary ===");
  logger.info(`  Ingested:       ${summary.totalIngested}`);
  logger.info(`  After dedup:    ${summary.afterDedup}`);
  logger.info(`  After filter:   ${summary.afterFilter}`);
  logger.info(`  After quality:  ${summary.afterQualityFilter}`);
  logger.info(`  Created:        ${summary.created}`);
  logger.info(`  Updated:        ${summary.updated}`);
  logger.info(`  Expired:        ${summary.expired}`);
  logger.info(`  Deleted:        ${summary.deleted}`);
  logger.info(`  Skipped:        ${summary.skipped}`);
  logger.info(`  Errors:         ${summary.errors}`);
}

run().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
