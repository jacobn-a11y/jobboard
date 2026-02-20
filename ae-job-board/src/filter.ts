import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { logger } from "./utils/logger.ts";
import type { RawListing, AEFirm, RoleKeywords } from "./utils/types.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load data files ──────────────────────────────────────────────────

const roleKeywords: RoleKeywords = JSON.parse(
  readFileSync(join(__dirname, "../data/role-keywords.json"), "utf-8")
);

let firmList: AEFirm[] = [];
try {
  firmList = JSON.parse(
    readFileSync(join(__dirname, "../data/ae-firms.json"), "utf-8")
  );
} catch {
  logger.warn("ae-firms.json not found — firm matching disabled");
}

// ── Normalization helpers ────────────────────────────────────────────

const STRIP_SUFFIXES =
  /\b(inc|llc|corp|corporation|lp|llp|ltd|limited|group|co|pc|pllc|psc|associates|& associates|the)\b/gi;

function normalizeFirmName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, "")
    .replace(STRIP_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Pre-compute normalized firm names for fast lookup
const normalizedFirms = firmList.map((f) => ({
  firm: f,
  normalized: normalizeFirmName(f.name),
  aliasesNormalized: f.aliases.map(normalizeFirmName),
}));

// ── Levenshtein distance ─────────────────────────────────────────────

function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] =
        a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

function similarity(a: string, b: string): number {
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

// ── Layer 1: Role Match ──────────────────────────────────────────────

type RoleCategory = "project-management" | "resource-management" | "operations";

function matchRoleByTitle(title: string): RoleCategory | null {
  const lower = title.toLowerCase();

  for (const kw of roleKeywords.titleKeywords.projectManagement) {
    if (lower.includes(kw)) return "project-management";
  }
  for (const kw of roleKeywords.titleKeywords.resourceManagement) {
    if (lower.includes(kw)) return "resource-management";
  }
  for (const kw of roleKeywords.titleKeywords.operations) {
    if (lower.includes(kw)) return "operations";
  }
  return null;
}

function matchRoleByDescription(description: string): boolean {
  const lower = description.toLowerCase();
  let matches = 0;
  for (const kw of roleKeywords.descriptionKeywords) {
    if (lower.includes(kw)) {
      matches++;
      if (matches >= 2) return true;
    }
  }
  return false;
}

// ── Layer 2: Firm Match ──────────────────────────────────────────────

const AE_SIGNALS = [
  "architecture",
  "architectural",
  "architect",
  "civil engineering",
  "structural engineering",
  "mechanical engineering",
  "electrical engineering",
  "environmental engineering",
  "mep",
  "aec",
  "a&e",
  "design firm",
  "design studio",
  "leed",
  "building design",
  "construction documents",
  "schematic design",
  "landscape architecture",
  "urban planning",
  "interior design",
  "revit",
  "autocad",
  "bim",
  "rhino",
  "sketchup",
];

function matchFirm(
  companyName: string,
  description: string
): { matched: boolean; firm: AEFirm | null } {
  const normalizedCompany = normalizeFirmName(companyName);

  // Exact or fuzzy match against seed list
  for (const entry of normalizedFirms) {
    // Exact normalized match
    if (entry.normalized === normalizedCompany) {
      return { matched: true, firm: entry.firm };
    }
    // Check aliases
    for (const alias of entry.aliasesNormalized) {
      if (alias === normalizedCompany) {
        return { matched: true, firm: entry.firm };
      }
    }
    // Fuzzy match (85% threshold)
    if (similarity(entry.normalized, normalizedCompany) >= 0.85) {
      return { matched: true, firm: entry.firm };
    }
  }

  // Fallback: check description for A&E industry signals (need 2+)
  const lower = description.toLowerCase();
  let signalCount = 0;
  for (const signal of AE_SIGNALS) {
    if (lower.includes(signal)) {
      signalCount++;
      if (signalCount >= 2) {
        return { matched: true, firm: null };
      }
    }
  }

  return { matched: false, firm: null };
}

// ── Public API ───────────────────────────────────────────────────────

export interface FilterResult {
  listing: RawListing;
  roleCategory: RoleCategory;
  firmMatch: AEFirm | null;
}

export function filterListings(listings: RawListing[]): FilterResult[] {
  const results: FilterResult[] = [];

  for (const listing of listings) {
    // Layer 1: Role match
    let roleCategory = matchRoleByTitle(listing.title);
    if (!roleCategory) {
      if (matchRoleByDescription(listing.description)) {
        // Default to operations if matched by description only
        roleCategory = "operations";
      } else {
        continue;
      }
    }

    // Layer 2: Firm match
    const { matched, firm } = matchFirm(listing.company, listing.description);
    if (!matched) continue;

    results.push({ listing, roleCategory, firmMatch: firm });
  }

  logger.info(
    `Filter: ${listings.length} → ${results.length} listings passed both layers`
  );
  return results;
}

// Exported for testing
export { matchRoleByTitle, matchRoleByDescription, matchFirm, normalizeFirmName, similarity };
