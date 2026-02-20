/**
 * ATS Detection Script
 *
 * Reads AccountsforBoard.csv and probes Greenhouse/Lever APIs to detect
 * which firms have boards on those platforms. Results are cached in
 * data/ats-cache.json with a 30-day TTL.
 *
 * Run: npx tsx scripts/detect-ats.ts [--limit N] [--force]
 *
 * --limit N : Only probe N firms (useful for testing)
 * --force   : Re-probe even if cache is still valid
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseCSV } from "../src/utils/csv.ts";
import {
  loadATSCache,
  saveATSCache,
  isCacheValid,
  normalizeCacheKey,
  type ATSEntry,
} from "../src/utils/ats-cache.ts";
import { probeGreenhouse } from "../src/ingest-greenhouse.ts";
import { probeLever } from "../src/ingest-lever.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "../../AccountsforBoard.csv");

// CSV columns accessed via string keys from parseCSV

// ── Slug generation ──────────────────────────────────────────────────

const STRIP_SUFFIXES =
  /\b(inc|llc|corp|corporation|lp|llp|ltd|limited|group|co|pc|pllc|psc|associates|& associates|the)\b/gi;

function generateSlugs(name: string, website: string): string[] {
  const slugs = new Set<string>();

  // From company name: "Gensler" → "gensler"
  const base = name
    .toLowerCase()
    .replace(STRIP_SUFFIXES, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, "")
    .trim();

  if (base) slugs.add(base);

  // With hyphens: "S9 Architecture" → "s9-architecture"
  const hyphenated = name
    .toLowerCase()
    .replace(STRIP_SUFFIXES, "")
    .replace(/[^a-z0-9 ]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "")
    .trim();

  if (hyphenated) slugs.add(hyphenated);

  // From website domain: "https://www.gensler.com" → "gensler"
  if (website) {
    try {
      let domain = website;
      if (!domain.startsWith("http")) domain = `https://${domain}`;
      const hostname = new URL(domain).hostname;
      const domainSlug = hostname
        .replace(/^www\./, "")
        .replace(/\.(com|org|net|io|co|us|ca|uk).*$/, "")
        .replace(/[^a-z0-9]/g, "");
      if (domainSlug && domainSlug.length > 2) slugs.add(domainSlug);
    } catch {
      // Invalid URL, skip
    }
  }

  return [...slugs];
}

// ── Main ─────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const force = args.includes("--force");
const limitIdx = args.indexOf("--limit");
const limit = limitIdx >= 0 ? parseInt(args[limitIdx + 1], 10) : undefined;

const csv = readFileSync(CSV_PATH, "utf-8");
const firms = parseCSV(csv);
console.log(`Loaded ${firms.length} firms from CSV`);

const cache = loadATSCache();
let probed = 0;
let found = 0;
let skipped = 0;
let ghCount = 0;
let leverCount = 0;

for (const firm of firms) {
  if (limit && probed >= limit) break;

  const name = firm["Account Name"];
  if (!name) continue;

  const key = normalizeCacheKey(name);

  // Skip if cached and valid (unless --force)
  if (!force && cache[key] && isCacheValid(cache[key])) {
    skipped++;
    if (cache[key].provider === "greenhouse") ghCount++;
    if (cache[key].provider === "lever") leverCount++;
    continue;
  }

  const slugs = generateSlugs(name, firm.Website);
  let foundProvider = false;

  // Try Greenhouse first
  for (const slug of slugs) {
    try {
      const isGH = await probeGreenhouse(slug);
      if (isGH) {
        cache[key] = {
          provider: "greenhouse",
          boardToken: slug,
          detectedAt: new Date().toISOString(),
        };
        found++;
        ghCount++;
        foundProvider = true;
        console.log(`  ✓ Greenhouse: ${name} → ${slug}`);
        break;
      }
    } catch {
      // Network error, continue
    }
  }

  // Try Lever if not found on Greenhouse
  if (!foundProvider) {
    for (const slug of slugs) {
      try {
        const isLever = await probeLever(slug);
        if (isLever) {
          cache[key] = {
            provider: "lever",
            boardToken: slug,
            detectedAt: new Date().toISOString(),
          };
          found++;
          leverCount++;
          foundProvider = true;
          console.log(`  ✓ Lever: ${name} → ${slug}`);
          break;
        }
      } catch {
        // Network error, continue
      }
    }
  }

  if (!foundProvider) {
    cache[key] = {
      provider: "none",
      boardToken: "",
      detectedAt: new Date().toISOString(),
    };
  }

  probed++;

  // Save periodically (every 50 firms)
  if (probed % 50 === 0) {
    saveATSCache(cache);
    console.log(`Progress: ${probed} probed, ${found} found (${ghCount} GH, ${leverCount} Lever)`);
  }

  // Brief delay between firms to be respectful
  await new Promise((r) => setTimeout(r, 200));
}

saveATSCache(cache);

console.log(`\nATS Detection complete:`);
console.log(`  Probed:     ${probed}`);
console.log(`  Found:      ${found}`);
console.log(`  Skipped:    ${skipped} (cached)`);
console.log(`  Greenhouse: ${ghCount}`);
console.log(`  Lever:      ${leverCount}`);
console.log(`  Total cached: ${Object.keys(cache).length}`);
