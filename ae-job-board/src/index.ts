import "dotenv/config";
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./utils/logger.ts";
import { ingestFromAdzuna } from "./ingest.ts";
import { ingestFromGreenhouse } from "./ingest-greenhouse.ts";
import { ingestFromLever } from "./ingest-lever.ts";
import { deduplicateListings } from "./dedup.ts";
import { loadATSCache, normalizeCacheKey, isCacheValid } from "./utils/ats-cache.ts";
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
import type { RunRecord } from "./utils/run-history.ts";
import type { EnrichedListing, PipelineSummary, RawListing } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "../../AccountsforBoard.csv");

const PRE_AI_SCORE_THRESHOLD = 45;

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipPdl = args.includes("--skip-pdl");
const limitIdx = args.indexOf("--limit");
const limitRaw = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;
const limit = limitRaw && !isNaN(limitRaw) && limitRaw > 0 ? limitRaw : undefined;

if (dryRun) logger.info("DRY RUN MODE — no CMS writes");
if (skipPdl) logger.info("Skipping PDL enrichment (--skip-pdl)");
if (limitIdx >= 0 && !limit) logger.warn("Invalid --limit value, ignoring");
if (limit) logger.info(`Limiting to ${limit} listings`);

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
    logger.info("=== Step 1: Ingesting from all sources ===");

    // 1a: Adzuna (keyword-based discovery)
    logger.info("--- 1a: Adzuna ---");
    const adzunaListings = await ingestFromAdzuna(limit);
    logger.info(`Adzuna: ${adzunaListings.length} listings`);

    // 1b: Greenhouse + Lever (direct ATS APIs, from CSV firm list)
    let ghListings: RawListing[] = [];
    let leverListings: RawListing[] = [];

    const atsCache = loadATSCache();
    const ghBoards: Array<{ boardToken: string; companyName: string }> = [];
    const leverCompanies: Array<{ companySlug: string; companyName: string }> = [];

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

        if (entry.provider === "greenhouse") {
          ghBoards.push({ boardToken: entry.boardToken, companyName: name });
        } else if (entry.provider === "lever") {
          leverCompanies.push({ companySlug: entry.boardToken, companyName: name });
        }
      }
    } catch {
      logger.warn("Could not read AccountsforBoard.csv — skipping ATS ingestion");
    }

    if (ghBoards.length > 0) {
      logger.info(`--- 1b: Greenhouse (${ghBoards.length} boards) ---`);
      ghListings = await ingestFromGreenhouse(ghBoards);
    }

    if (leverCompanies.length > 0) {
      logger.info(`--- 1c: Lever (${leverCompanies.length} companies) ---`);
      leverListings = await ingestFromLever(leverCompanies);
    }

    // 1d: Cross-source dedup (prefer longer descriptions)
    const allRaw = [...ghListings, ...leverListings, ...adzunaListings];
    summary.totalIngested = allRaw.length;
    const rawListings = deduplicateListings(allRaw);
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

    for (let i = 0; i < filtered.length; i++) {
      const { listing, roleCategory, firmMatch } = filtered[i];
      const stepLabel = `[${i + 1}/${filtered.length}]`;

      try {
        // 3a: Company enrichment (skip if --skip-pdl)
        logger.info(`${stepLabel} Enriching: ${listing.title} at ${listing.company}`);
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
          const aiResult = await generateContent(
            listing.title,
            listing.company,
            listing.location,
            listing.description,
            firmMatch,
            enrichment,
            enrRank
          );
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

        enrichedListings.push({
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
        });
      } catch (err) {
        logger.error(
          `Error enriching ${listing.title} at ${listing.company}`,
          err
        );
        summary.errors++;
      }
    }

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
