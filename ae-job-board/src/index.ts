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
import { generateContent } from "./ai-content.ts";
import { extractTools } from "./tools-extract.ts";
import { calculateQualityScore, detectExperienceLevel } from "./quality-score.ts";
import { generateSlug, deduplicateSlugs } from "./slug.ts";
import { pushToWebflow, getExistingSlugs } from "./webflow.ts";
import type { EnrichedListing, PipelineSummary, RawListing } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "../../AccountsforBoard.csv");

// ── CLI args ─────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const skipPdl = args.includes("--skip-pdl");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

if (dryRun) logger.info("DRY RUN MODE — no CMS writes");
if (skipPdl) logger.info("Skipping PDL enrichment (--skip-pdl)");
if (limit) logger.info(`Limiting to ${limit} listings`);

// ── Main pipeline ────────────────────────────────────────────────────

async function run(): Promise<void> {
  const summary: PipelineSummary = {
    totalIngested: 0,
    afterDedup: 0,
    afterFilter: 0,
    afterQualityFilter: 0,
    created: 0,
    updated: 0,
    expired: 0,
    skipped: 0,
    errors: 0,
  };

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

    // Read firm list from CSV (source of truth)
    try {
      const csv = readFileSync(CSV_PATH, "utf-8");
      const firms = parseCSV(csv);

      for (const firm of firms) {
        const name = firm["Account Name"];
        if (!name) continue;
        const key = normalizeCacheKey(name);
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

    // ── Step 3: Enrich each listing ──────────────────────────────────
    logger.info("=== Step 3: Enriching listings ===");
    const enrichedListings: EnrichedListing[] = [];

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

        // 3e-f: AI content
        const { roleSummary, companyDescription } = await generateContent(
          listing.title,
          listing.company,
          listing.location,
          listing.description,
          firmMatch,
          enrichment,
          enrRank
        );

        // 3g: Experience level
        const experienceLevel = detectExperienceLevel(listing.title);

        // 3h: Quality score
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

    // ── Step 4: Generate slugs ───────────────────────────────────────
    logger.info("=== Step 4: Generating slugs ===");
    const rawSlugs = enrichedListings.map((l) =>
      generateSlug(l.title, l.company, l.location)
    );

    // Check for existing slugs in Webflow (skip in dry-run or if no API key)
    let existingSlugs = new Set<string>();
    if (!dryRun && process.env.WEBFLOW_API_TOKEN) {
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
      }
    }
  } catch (err) {
    logger.error("Pipeline failed", err);
    summary.errors++;
  }

  logSummary(summary);
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
  logger.info(`  Skipped:        ${summary.skipped}`);
  logger.info(`  Errors:         ${summary.errors}`);
}

run().catch((err) => {
  logger.error("Fatal error", err);
  process.exit(1);
});
