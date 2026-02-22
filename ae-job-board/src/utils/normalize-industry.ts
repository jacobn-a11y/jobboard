/**
 * Normalizes freeform industry strings from the CSV to canonical industry names.
 *
 * Strategy (in order):
 *   1. Exact alias match (case-insensitive) against data/industry-map.json
 *   2. Substring match — if any alias appears as a substring of the input
 *      (e.g. "Structural Engineering Firm" contains "structural engineering")
 *   3. Pass-through — return the raw value as-is and track it so it can
 *      be added to the map later
 *
 * Unmatched values are collected in unmatchedIndustries for pipeline logging.
 */
import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MAP_PATH = join(__dirname, "../../data/industry-map.json");

interface IndustryMap {
  canonical: string[];
  aliases: Record<string, string[]>;
}

// Build lookup: lowercased alias → canonical name
const aliasToCanonical = new Map<string, string>();

// For substring matching: sorted longest-first so "structural engineering"
// matches before "engineering"
const aliasesByLength: Array<{ alias: string; canonical: string }> = [];

try {
  const map: IndustryMap = JSON.parse(readFileSync(MAP_PATH, "utf-8"));
  for (const [canonical, aliases] of Object.entries(map.aliases)) {
    for (const alias of aliases) {
      const lower = alias.toLowerCase().trim();
      aliasToCanonical.set(lower, canonical);
      aliasesByLength.push({ alias: lower, canonical });
    }
    // Also map the canonical name itself
    const lower = canonical.toLowerCase().trim();
    aliasToCanonical.set(lower, canonical);
    aliasesByLength.push({ alias: lower, canonical });
  }
  // Sort longest-first for greedy substring matching
  aliasesByLength.sort((a, b) => b.alias.length - a.alias.length);
} catch {
  // If the map can't be loaded, normalizeIndustry will pass through raw values
}

/** Tracks industry values that couldn't be normalized. Check after a pipeline run. */
export const unmatchedIndustries = new Set<string>();

/**
 * Normalize a freeform industry string to its canonical form.
 * Returns the canonical name if found, otherwise the trimmed input as-is.
 */
export function normalizeIndustry(raw: string): string {
  if (!raw || !raw.trim()) return "";

  const trimmed = raw.trim();
  const key = trimmed.toLowerCase();

  // 1. Exact alias match
  const exact = aliasToCanonical.get(key);
  if (exact) return exact;

  // 2. Substring match (input contains an alias, or alias contains input)
  for (const entry of aliasesByLength) {
    if (key.includes(entry.alias) || entry.alias.includes(key)) {
      return entry.canonical;
    }
  }

  // 3. No match — track and pass through
  unmatchedIndustries.add(trimmed);
  return trimmed;
}
