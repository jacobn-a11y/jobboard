/**
 * Merges AccountsforBoard.csv into ae-firms.json.
 *
 * - Existing firms keep their ENR ranks, aliases, specializations, and size.
 * - CSV fills in missing website, linkedin, and hq fields on existing firms.
 * - New firms from CSV are appended.
 *
 * Run: npx tsx scripts/merge-firms.ts
 */
import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const FIRMS_PATH = join(__dirname, "../data/ae-firms.json");
const CSV_PATH = join(__dirname, "../../AccountsforBoard.csv");

interface AEFirm {
  name: string;
  aliases: string[];
  firmType: string;
  enrRank: number | null;
  specializations: string[];
  hq: string;
  size: string;
  website: string;
  linkedin: string;
}

// ── Simple quoted-CSV parser ─────────────────────────────────────────

function parseCSV(raw: string): string[][] {
  const rows: string[][] = [];
  const lines = raw.split("\n");

  for (const line of lines) {
    if (!line.trim()) continue;
    const fields: string[] = [];
    let i = 0;

    while (i < line.length) {
      if (line[i] === '"') {
        // Quoted field
        i++; // skip opening quote
        let value = "";
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') {
            value += '"';
            i += 2;
          } else if (line[i] === '"') {
            i++; // skip closing quote
            break;
          } else {
            value += line[i];
            i++;
          }
        }
        fields.push(value);
        if (line[i] === ",") i++; // skip comma
      } else {
        // Unquoted field
        const end = line.indexOf(",", i);
        if (end === -1) {
          fields.push(line.slice(i).trim());
          break;
        }
        fields.push(line.slice(i, end).trim());
        i = end + 1;
      }
    }

    rows.push(fields);
  }

  return rows;
}

// ── Name normalization (matches filter.ts logic) ─────────────────────

const STRIP_SUFFIXES =
  /\b(inc|llc|corp|corporation|lp|llp|ltd|limited|group|co|pc|pllc|psc|associates|& associates|the)\b/gi;

function normalize(name: string): string {
  return name
    .toLowerCase()
    .replace(/[,.]/g, "")
    .replace(STRIP_SUFFIXES, "")
    .replace(/\s+/g, " ")
    .trim();
}

// ── Main ─────────────────────────────────────────────────────────────

const existing: AEFirm[] = JSON.parse(readFileSync(FIRMS_PATH, "utf-8"));
console.log(`Loaded ${existing.length} existing firms`);

const csv = readFileSync(CSV_PATH, "utf-8");
const rows = parseCSV(csv);
const header = rows[0];
console.log(`CSV columns: ${header.join(", ")}`);
const dataRows = rows.slice(1);
console.log(`CSV data rows: ${dataRows.length}`);

// Build lookup by normalized name
const firmMap = new Map<string, AEFirm>();
for (const firm of existing) {
  firmMap.set(normalize(firm.name), firm);
}

let updated = 0;
let added = 0;
let skipped = 0;

for (const row of dataRows) {
  const [name, _industry, website, linkedin, _country, state, city] = row;
  if (!name) continue;

  const key = normalize(name);
  const hq = city && state ? `${city}, ${state}` : city || state || "";

  const existingFirm = firmMap.get(key);
  if (existingFirm) {
    // Fill in missing fields
    let changed = false;
    if (!existingFirm.website && website) {
      existingFirm.website = website;
      changed = true;
    }
    if (!existingFirm.linkedin && linkedin) {
      existingFirm.linkedin = linkedin;
      changed = true;
    }
    if (!existingFirm.hq && hq) {
      existingFirm.hq = hq;
      changed = true;
    }
    if (changed) updated++;
    else skipped++;
  } else {
    // New firm from CSV
    const newFirm: AEFirm = {
      name,
      aliases: [],
      firmType: "Architecture & Engineering",
      enrRank: null,
      specializations: [],
      hq,
      size: "",
      website: website || "",
      linkedin: linkedin || "",
    };
    firmMap.set(key, newFirm);
    added++;
  }
}

// Rebuild array (existing first in original order, then new)
const existingKeys = new Set(existing.map((f) => normalize(f.name)));
const merged: AEFirm[] = [
  ...existing, // Keep existing in original order (with updates applied in-place)
  ...[...firmMap.entries()]
    .filter(([key]) => !existingKeys.has(key))
    .map(([, firm]) => firm),
];

writeFileSync(FIRMS_PATH, JSON.stringify(merged, null, 2) + "\n");

console.log(`\nMerge complete:`);
console.log(`  Existing firms updated: ${updated}`);
console.log(`  New firms added: ${added}`);
console.log(`  Skipped (no new data): ${skipped}`);
console.log(`  Total firms: ${merged.length}`);
