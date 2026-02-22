/**
 * Converts AccountsforBoard.csv into data/ae-firms.json.
 * Run: npx tsx scripts/build-firm-list.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { normalizeIndustry } from "../src/utils/normalize-industry.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const CSV_PATH = join(__dirname, "../data/AccountsforBoard.csv");
const OUT_PATH = join(__dirname, "../data/ae-firms.json");
const ENR_PATH = join(__dirname, "../data/enr-rankings.json");

interface CSVRow {
  accountName: string;
  industry: string;
  website: string;
  linkedin: string;
  country: string;
  state: string;
  city: string;
}

function parseCSV(raw: string): CSVRow[] {
  const lines = raw.split("\n");
  const rows: CSVRow[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    // Simple CSV parse handling quoted fields
    const fields: string[] = [];
    let current = "";
    let inQuotes = false;
    for (const char of line) {
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        fields.push(current.trim());
        current = "";
      } else {
        current += char;
      }
    }
    fields.push(current.trim());

    if (fields.length >= 7) {
      rows.push({
        accountName: fields[0],
        industry: fields[1],
        website: fields[2],
        linkedin: fields[3],
        country: fields[4],
        state: fields[5],
        city: fields[6],
      });
    }
  }
  return rows;
}

function inferFirmType(name: string): string {
  const lower = name.toLowerCase();
  if (lower.includes("engineer") || lower.includes("engineering")) return "Engineering";
  if (lower.includes("architect") || lower.includes("architecture")) return "Architecture";
  if (lower.includes("design")) return "Design";
  if (lower.includes("survey") || lower.includes("surveying")) return "Surveying";
  if (lower.includes("landscape")) return "Landscape Architecture";
  if (lower.includes("planning")) return "Planning";
  return "Architecture & Engineering";
}

function buildHQ(city: string, state: string, country: string): string {
  const parts: string[] = [];
  if (city) parts.push(city);
  if (state) parts.push(state);
  if (country && country !== "United States") parts.push(country);
  return parts.join(", ") || "Unknown";
}

// Load ENR rankings for cross-referencing
const enrRankings: { rank: number; firm: string }[] = JSON.parse(
  readFileSync(ENR_PATH, "utf-8")
);

function normalizeName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]|(\b(inc|llc|corp|lp|llp|ltd|group|co|pc|pllc|psc|associates|& associates)\b)/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findENRRank(name: string): number | null {
  const normalized = normalizeName(name);
  for (const entry of enrRankings) {
    if (normalizeName(entry.firm) === normalized) return entry.rank;
    if (normalized.includes(normalizeName(entry.firm)) || normalizeName(entry.firm).includes(normalized)) {
      return entry.rank;
    }
  }
  return null;
}

const csvRaw = readFileSync(CSV_PATH, "utf-8");
const rows = parseCSV(csvRaw);

// Deduplicate by normalized account name
const seen = new Set<string>();
const firms = [];

for (const row of rows) {
  const norm = normalizeName(row.accountName);
  if (seen.has(norm)) continue;
  seen.add(norm);

  firms.push({
    name: row.accountName,
    aliases: [] as string[],
    firmType: inferFirmType(row.accountName),
    industry: normalizeIndustry(row.industry) || "Architecture & Engineering",
    enrRank: findENRRank(row.accountName),
    specializations: [] as string[],
    hq: buildHQ(row.city, row.state, row.country),
    hqState: row.state || "",
    hqCity: row.city || "",
    size: "",
    website: row.website,
    linkedin: row.linkedin,
  });
}

writeFileSync(OUT_PATH, JSON.stringify(firms, null, 2));
console.log(`Wrote ${firms.length} firms to ${OUT_PATH}`);
